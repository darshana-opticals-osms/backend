const express = require('express');
const mongoose = require('mongoose');
const {
  createInventoryItem,
  getInventoryByBranch,
  updateInventoryItem,
  updateInventoryItemQuantity,
  getReorderAlerts,
  getReorderThreshold,
  updateReorderThreshold,
} = require('../controllers/inventory.controller');


const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');
const { ForbiddenError } = require('../errors/AppError');

const CREATE_FIELDS = new Set(['branchId', 'itemName', 'category', 'brand', 'price', 'quantity']);

const UPDATE_FIELDS = new Set(['branchId', 'itemName', 'category', 'brand', 'price']);

const validateObjectBody = (body, errors) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    errors.push({
      field: 'body',
      message: 'Inventory data must be an object.',
    });
    return false;
  }

  return true;
};

const validateObjectId = (value, field, errors) => {
  if (!mongoose.isValidObjectId(value)) {
    errors.push({
      field,
      message: `${field} must be a valid MongoDB ObjectId.`,
    });
  }
};

const validateStringField = (value, field, errors) => {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push({
      field,
      message: `${field} must be a non-empty string.`,
    });
  }
};

const validateNonNegativeNumber = (value, field, errors) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push({
      field,
      message: `${field} must be a non-negative number.`,
    });
  }
};

const createInventoryValidation = (req) => {
  const { body } = req;
  const errors = [];

  if (!validateObjectBody(body, errors)) {
    return errors;
  }

  for (const key of Object.keys(body)) {
    if (!CREATE_FIELDS.has(key)) {
      errors.push({
        field: key,
        message: `${key} is not allowed for inventory creation.`,
      });
    }
  }

  for (const field of CREATE_FIELDS) {
    if (
      !Object.prototype.hasOwnProperty.call(body, field) ||
      body[field] === undefined ||
      body[field] === null ||
      body[field] === ''
    ) {
      errors.push({
        field,
        message: `${field} is required.`,
      });
    }
  }

  if (body.branchId !== undefined && body.branchId !== null && body.branchId !== '') {
    validateObjectId(body.branchId, 'branchId', errors);
  }

  for (const field of ['itemName', 'category', 'brand']) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== '') {
      validateStringField(body[field], field, errors);
    }
  }

  if (body.price !== undefined && body.price !== null && body.price !== '') {
    validateNonNegativeNumber(body.price, 'price', errors);
  }

  if (body.quantity !== undefined && body.quantity !== null && body.quantity !== '') {
    validateNonNegativeNumber(body.quantity, 'quantity', errors);
  }

  return errors;
};

const branchInventoryValidation = (req) => {
  const errors = [];

  validateObjectId(req.params.branchId, 'branchId', errors);

  return errors;
};

const updateInventoryValidation = (req) => {
  const { body } = req;
  const errors = [];

  validateObjectId(req.params.id, 'inventoryId', errors);

  if (!validateObjectBody(body, errors)) {
    return errors;
  }

  const fields = Object.keys(body);

  if (fields.length === 0) {
    errors.push({
      field: 'body',
      message: 'Inventory update data is required.',
    });

    return errors;
  }

  for (const field of fields) {
    if (!UPDATE_FIELDS.has(field)) {
      errors.push({
        field,
        message: `${field} is not allowed for general inventory updates.`,
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'branchId')) {
    validateObjectId(body.branchId, 'branchId', errors);
  }

  for (const field of ['itemName', 'category', 'brand']) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      validateStringField(body[field], field, errors);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'price')) {
    validateNonNegativeNumber(body.price, 'price', errors);
  }

  return errors;
};

const authorizeInventoryUpdateFields = (req, _res, next) => {
  const { role } = req.auth;
  const fields = Object.keys(req.body);

  const includesNonPriceFields = fields.some((field) => field !== 'price');

  if (role === ROLE_VALUES.BRANCH_MANAGER) {
    return next();
  }

  if (role === ROLE_VALUES.SYSTEM_ADMIN) {
    if (includesNonPriceFields) {
      return next(
        new ForbiddenError('System Administrators may only update price overrides.')
      );
    }

    return next();
  }

  return next(new ForbiddenError('Access forbidden'));
};

const quantityUpdateValidation = (req) => {
  const { body } = req;
  const errors = [];

  validateObjectId(req.params.id, 'inventoryId', errors);

  if (!validateObjectBody(body, errors)) {
    return errors;
  }

  for (const field of Object.keys(body)) {
    if (field !== 'quantity') {
      errors.push({
        field,
        message: `${field} is not allowed for quantity updates.`,
      });
    }
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'quantity')) {
    errors.push({
      field: 'quantity',
      message: 'quantity is required.',
    });

    return errors;
  }

  validateNonNegativeNumber(body.quantity, 'quantity', errors);

  return errors;
};

const reorderAlertsQueryValidation = (req) => {
  const errors = [];
  const branchId = req.params.branchId || req.query.branchId;

  if (branchId) {
    validateObjectId(branchId, 'branchId', errors);
  }

  if (req.query.page !== undefined) {
    const pageNum = Number(req.query.page);
    if (!Number.isInteger(pageNum) || pageNum < 1) {
      errors.push({
        field: 'page',
        message: 'page must be a positive integer.',
      });
    }
  }

  if (req.query.limit !== undefined) {
    const limitNum = Number(req.query.limit);
    if (!Number.isInteger(limitNum) || limitNum < 1) {
      errors.push({
        field: 'limit',
        message: 'limit must be a positive integer.',
      });
    }
  }

  return errors;
};

const reorderThresholdValidation = (req) => {
  const { body } = req;
  const errors = [];

  if (!validateObjectBody(body, errors)) {
    return errors;
  }

  for (const field of Object.keys(body)) {
    if (field !== 'threshold') {
      errors.push({
        field,
        message: `${field} is not allowed for threshold update.`,
      });
    }
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'threshold')) {
    errors.push({
      field: 'threshold',
      message: 'threshold is required.',
    });
    return errors;
  }

  validateNonNegativeNumber(body.threshold, 'threshold', errors);

  return errors;
};

const router = express.Router();



/**
 * @openapi
 * /inventory:
 *   post:
 *     summary: Create a new inventory item
 *     description: Inventory creation is restricted to BRANCH_MANAGER. The request must include branchId, itemName, category, brand, price, and quantity.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InventoryCreateRequest'
 *     responses:
 *       201:
 *         description: Inventory item created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - success
 *                 - data
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/InventoryItem'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post(
  '/inventory',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER),
  validate(createInventoryValidation),
  createInventoryItem
);

/**
 * @openapi
 * /inventory/branch/{branchId}:
 *   get:
 *     summary: Retrieve inventory for a branch
 *     description: Returns all inventory records for a branch. Allowed roles are BRANCH_MANAGER and SYSTEM_ADMIN.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB branch identifier.
 *     responses:
 *       200:
 *         description: Branch inventory returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - success
 *                 - data
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/InventoryItem'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.get(
  '/inventory/branch/:branchId',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER, ROLE_VALUES.SYSTEM_ADMIN),
  validate(branchInventoryValidation),
  getInventoryByBranch
);

/**
 * @openapi
 * /inventory/{id}:
 *   patch:
 *     summary: Update inventory metadata or apply an authorized price override
 *     description: Roles are permission-sensitive. BRANCH_MANAGER may update general inventory fields for their branch; SYSTEM_ADMIN may perform price-only override updates.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB inventory item identifier.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InventoryUpdateRequest'
 *     responses:
 *       200:
 *         description: Inventory item updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - success
 *                 - data
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/InventoryItem'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.patch(
  '/inventory/:id',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.BRANCH_MANAGER,
    ROLE_VALUES.SYSTEM_ADMIN
  ),
  validate(updateInventoryValidation),
  authorizeInventoryUpdateFields,
  updateInventoryItem
);

/**
 * @openapi
 * /inventory/{id}/quantity:
 *   patch:
 *     summary: Update inventory quantity
 *     description: Updates stock quantity for an inventory record. Only BRANCH_MANAGER can perform this action.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB inventory item identifier.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InventoryQuantityUpdateRequest'
 *     responses:
 *       200:
 *         description: Inventory quantity updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - success
 *                 - data
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/InventoryItem'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.patch(
  '/inventory/:id/quantity',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER),
  validate(quantityUpdateValidation),
  updateInventoryItemQuantity
);

/**
 * @openapi
 * /inventory/reorder-alerts:
 *   get:
 *     summary: Retrieve active inventory reorder alerts
 *     description: Returns paginated active low-stock alerts. Permitted roles are BRANCH_MANAGER and SYSTEM_ADMIN. Optional branchId query parameter filters by branch.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: branchId
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional MongoDB branch identifier to filter alerts.
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination.
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of alerts per page.
 *     responses:
 *       200:
 *         description: Active reorder alerts returned successfully.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.get(
  '/inventory/reorder-alerts',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.BRANCH_MANAGER,
    ROLE_VALUES.SYSTEM_ADMIN
  ),
  validate(reorderAlertsQueryValidation),
  getReorderAlerts
);

/**
 * @openapi
 * /inventory/reorder-alerts/branch/{branchId}:
 *   get:
 *     summary: Retrieve active inventory reorder alerts for a specific branch
 *     description: Returns active reorder alerts scoped to the specified branchId. Permitted roles are BRANCH_MANAGER and SYSTEM_ADMIN.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: branchId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB branch identifier.
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Branch-scoped reorder alerts returned successfully.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.get(
  '/inventory/reorder-alerts/branch/:branchId',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.BRANCH_MANAGER,
    ROLE_VALUES.SYSTEM_ADMIN
  ),
  validate(reorderAlertsQueryValidation),
  getReorderAlerts
);

/**
 * @openapi
 * /inventory/reorder-threshold:
 *   get:
 *     summary: Retrieve the global inventory reorder threshold
 *     description: Returns the currently configured authoritative reorder threshold. Permitted roles are BRANCH_MANAGER and SYSTEM_ADMIN.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Global reorder threshold returned successfully.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *   put:
 *     summary: Update the global inventory reorder threshold
 *     description: Updates the authoritative reorder threshold and automatically triggers reconciliation across all existing inventory records. Restricted strictly to BRANCH_MANAGER.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - threshold
 *             properties:
 *               threshold:
 *                 type: number
 *                 minimum: 0
 *                 example: 5
 *     responses:
 *       200:
 *         description: Reorder threshold updated and inventories reconciled successfully.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.get(
  '/inventory/reorder-threshold',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.BRANCH_MANAGER,
    ROLE_VALUES.SYSTEM_ADMIN
  ),
  getReorderThreshold
);

router.put(
  '/inventory/reorder-threshold',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER),
  validate(reorderThresholdValidation),
  updateReorderThreshold
);

module.exports = router;


