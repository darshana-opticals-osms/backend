const express = require('express');
const mongoose = require('mongoose');
const {
  getCart,
  addCartItemController,
  updateCartItemController,
  removeCartItemController,
} = require('../controllers/cart.controller');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');

const validateAddCartItem = (req) => {
  const errors = [];
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'Cart item data must be an object.' }];
  }

  for (const field of Object.keys(body)) {
    if (field !== 'inventoryId' && field !== 'quantity') {
      errors.push({ field, message: `${field} is not allowed for Cart items.` });
    }
  }

  if (typeof body.inventoryId !== 'string' || !mongoose.isValidObjectId(body.inventoryId)) {
    errors.push({ field: 'inventoryId', message: 'inventoryId must be a valid MongoDB ObjectId.' });
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'quantity')) {
    errors.push({ field: 'quantity', message: 'quantity is required.' });
  } else if (!Number.isSafeInteger(body.quantity) || body.quantity < 1) {
    errors.push({ field: 'quantity', message: 'quantity must be a positive integer.' });
  }

  return errors;
};

const validateCartItemQuantity = (req) => {
  const errors = [];
  const body = req.body;

  if (!mongoose.isValidObjectId(req.params.inventoryId)) {
    errors.push({
      field: 'inventoryId',
      message: 'inventoryId must be a valid MongoDB ObjectId.',
    });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [...errors, { field: 'body', message: 'Cart quantity data must be an object.' }];
  }

  for (const field of Object.keys(body)) {
    if (field !== 'quantity') {
      errors.push({ field, message: `${field} is not allowed for Cart quantity updates.` });
    }
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'quantity')) {
    errors.push({ field: 'quantity', message: 'quantity is required.' });
  } else if (!Number.isSafeInteger(body.quantity) || body.quantity < 1) {
    errors.push({ field: 'quantity', message: 'quantity must be a positive integer.' });
  }

  return errors;
};

const validateCartItemId = (req) => {
  const errors = [];

  if (!mongoose.isValidObjectId(req.params.inventoryId)) {
    errors.push({ field: 'inventoryId', message: 'inventoryId must be a valid MongoDB ObjectId.' });
  }

  if (Array.isArray(req.body) || (req.body && Object.keys(req.body).length > 0)) {
    errors.push({ field: 'body', message: 'A Cart item removal does not accept a request body.' });
  }

  return errors;
};

const rejectUnsupportedQuery = (req) =>
  Object.keys(req.query).map((field) => ({
    field,
    message: `${field} is not supported for Cart requests.`,
  }));

const withCartQueryValidation = (validator) => (req) => [
  ...rejectUnsupportedQuery(req),
  ...validator(req),
];

const router = express.Router();

/**
 * @openapi
 * /cart:
 *   get:
 *     summary: Retrieve the authenticated customer's Cart
 *     description: CUSTOMER-only. Ownership is derived from the verified JWT; an absent Cart is returned as an empty items array and is not persisted.
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Persisted Cart or empty Cart returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CartResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  '/cart',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(rejectUnsupportedQuery),
  getCart
);

/**
 * @openapi
 * /cart/items:
 *   post:
 *     summary: Add an Inventory item to the authenticated customer's Cart
 *     description: CUSTOMER-only. Adding an existing item increases its requested quantity. This operation does not reserve or reduce stock.
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CartAddItemRequest'
 *     responses:
 *       200:
 *         description: Backend-confirmed Cart state.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CartResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  '/cart/items',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(withCartQueryValidation(validateAddCartItem)),
  addCartItemController
);

/**
 * @openapi
 * /cart/items/{inventoryId}:
 *   patch:
 *     summary: Set an absolute Cart item quantity
 *     description: CUSTOMER-only. Replaces the requested quantity and does not modify Inventory stock.
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: inventoryId
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: MongoDB Inventory identifier.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CartQuantityRequest'
 *     responses:
 *       200:
 *         description: Backend-confirmed Cart state.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CartResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.patch(
  '/cart/items/:inventoryId',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(withCartQueryValidation(validateCartItemQuantity)),
  updateCartItemController
);

/**
 * @openapi
 * /cart/items/{inventoryId}:
 *   delete:
 *     summary: Remove an item from the authenticated customer's Cart
 *     description: CUSTOMER-only. Removes the Cart document when its final item is removed. Does not modify Inventory stock.
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: inventoryId
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *         description: MongoDB Inventory identifier.
 *     responses:
 *       200:
 *         description: Backend-confirmed Cart state, empty when the final item was removed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CartResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.delete(
  '/cart/items/:inventoryId',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(withCartQueryValidation(validateCartItemId)),
  removeCartItemController
);

module.exports = router;
