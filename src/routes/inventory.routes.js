const express = require('express');
const mongoose = require('mongoose');
const {
  createInventoryItem,
  getInventoryByBranch,
  updateInventoryItem,
  updateInventoryItemQuantity,
} = require('../controllers/inventory.controller');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');

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

const router = express.Router();

/**
 * @openapi
 * /inventory:
 *   post:
 *     summary: Create an inventory item
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
 *               - branchId
 *               - itemName
 *               - category
 *               - brand
 *               - price
 *               - quantity
 *             properties:
 *               branchId:
 *                 type: string
 *               itemName:
 *                 type: string
 *               category:
 *                 type: string
 *               brand:
 *                 type: string
 *               price:
 *                 type: number
 *                 minimum: 0
 *               quantity:
 *                 type: number
 *                 minimum: 0
 *     responses:
 *       201:
 *         description: Inventory item created successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: User is not authorized to manage inventory
 *       422:
 *         description: Invalid inventory data
 */
router.post(
  '/inventory',
  authenticate,
  authorizeRoles(ROLE_VALUES.INVENTORY_MANAGER),
  validate(createInventoryValidation),
  createInventoryItem
);

/**
 * @openapi
 * /inventory/branch/{branchId}:
 *   get:
 *     summary: Retrieve inventory for a branch
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
 *     responses:
 *       200:
 *         description: Branch inventory returned successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: User does not have inventory viewing permission
 *       422:
 *         description: Invalid branch reference
 */
router.get(
  '/inventory/branch/:branchId',
  authenticate,
  authorizeRoles(ROLE_VALUES.INVENTORY_MANAGER, ROLE_VALUES.BRANCH_MANAGER, ROLE_VALUES.MANAGEMENT),
  validate(branchInventoryValidation),
  getInventoryByBranch
);

/**
 * @openapi
 * /inventory/{id}:
 *   patch:
 *     summary: Update an inventory item
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
 *     responses:
 *       200:
 *         description: Inventory item updated successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: User is not authorized to manage inventory
 *       404:
 *         description: Inventory item not found
 *       422:
 *         description: Invalid inventory data
 */
router.patch(
  '/inventory/:id',
  authenticate,
  authorizeRoles(ROLE_VALUES.INVENTORY_MANAGER),
  validate(updateInventoryValidation),
  updateInventoryItem
);

/**
 * @openapi
 * /inventory/{id}/quantity:
 *   patch:
 *     summary: Update inventory stock quantity
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *             properties:
 *               quantity:
 *                 type: number
 *                 minimum: 0
 *     responses:
 *       200:
 *         description: Inventory quantity updated successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: User is not authorized to manage inventory
 *       404:
 *         description: Inventory item not found
 *       422:
 *         description: Invalid quantity
 */
router.patch(
  '/inventory/:id/quantity',
  authenticate,
  authorizeRoles(ROLE_VALUES.INVENTORY_MANAGER),
  validate(quantityUpdateValidation),
  updateInventoryItemQuantity
);

module.exports = router;
