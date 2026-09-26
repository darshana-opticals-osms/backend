const express = require('express');
const mongoose = require('mongoose');
const { getProducts, getProduct } = require('../controllers/product.controller');
const { validate } = require('../middleware/validate');

const router = express.Router();

const allowedQueryFields = new Set(['search', 'category', 'brand', 'minPrice', 'maxPrice']);

const catalogQueryValidation = (req) => {
  const query = req.query || {};
  const errors = [];

  for (const key of Object.keys(query)) {
    if (!allowedQueryFields.has(key)) {
      errors.push({
        field: key,
        message: `${key} is not a supported product filter.`,
      });
    }
  }

  for (const field of ['search', 'category', 'brand']) {
    if (!Object.prototype.hasOwnProperty.call(query, field)) {
      continue;
    }

    const value = query[field];

    if (typeof value !== 'string' || !value.trim()) {
      errors.push({
        field,
        message: `${field} must be a non-empty string.`,
      });
      continue;
    }

    if (value.trim().length > 100) {
      errors.push({
        field,
        message: `${field} must not exceed 100 characters.`,
      });
      continue;
    }

    req.query[field] = value.trim();
  }

  for (const field of ['minPrice', 'maxPrice']) {
    if (!Object.prototype.hasOwnProperty.call(query, field)) {
      continue;
    }

    const value = query[field];

    if (typeof value !== 'string' || value.trim() === '') {
      errors.push({
        field,
        message: `${field} must be a non-negative number.`,
      });
      continue;
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || numericValue < 0) {
      errors.push({
        field,
        message: `${field} must be a non-negative number.`,
      });
      continue;
    }

    req.query[field] = numericValue;
  }

  if (
    typeof req.query.minPrice === 'number' &&
    typeof req.query.maxPrice === 'number' &&
    req.query.minPrice > req.query.maxPrice
  ) {
    errors.push({
      field: 'price',
      message: 'minPrice must be less than or equal to maxPrice.',
    });
  }

  return errors;
};

const productIdValidation = (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return [
      {
        field: 'id',
        message: 'id must be a valid product identifier.',
      },
    ];
  }

  return [];
};

/**
 * @openapi
 * /products:
 *   get:
 *     summary: List catalog products
 *     description: Returns the public product catalogue. Internal inventory-only fields are intentionally excluded.
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *           maxLength: 100
 *         description: Case-insensitive partial match against the product name or brand.
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           maxLength: 100
 *         description: Exact category match, case-insensitive.
 *       - in: query
 *         name: brand
 *         schema:
 *           type: string
 *           maxLength: 100
 *         description: Exact brand match, case-insensitive.
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Minimum product price.
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Maximum product price.
 *     responses:
 *       200:
 *         description: Product list returned successfully.
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
 *                     $ref: '#/components/schemas/Product'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.get('/products', validate(catalogQueryValidation), getProducts);

/**
 * @openapi
 * /products/{id}:
 *   get:
 *     summary: Get one catalog product by ID
 *     description: Returns public product discovery data for a single item.
 *     tags:
 *       - Products
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB inventory item identifier.
 *     responses:
 *       200:
 *         description: Product returned successfully.
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
 *                   $ref: '#/components/schemas/Product'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 */
router.get('/products/:id', validate(productIdValidation), getProduct);

module.exports = router;
