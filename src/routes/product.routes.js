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
 *     summary: List and filter catalog products
 *     description: Returns public product discovery data. Internal inventory fields are not exposed.
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive partial match against item name or brand.
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Case-insensitive exact category filter.
 *       - in: query
 *         name: brand
 *         schema:
 *           type: string
 *         description: Case-insensitive exact brand filter.
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
 *       422:
 *         description: Invalid query parameter.
 */
router.get('/products', validate(catalogQueryValidation), getProducts);

/**
 * @openapi
 * /products/{id}:
 *   get:
 *     summary: Get one catalog product
 *     description: Returns public product discovery data for one inventory item.
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
 *       404:
 *         description: Product not found.
 *       422:
 *         description: Invalid product identifier.
 */
router.get('/products/:id', validate(productIdValidation), getProduct);

module.exports = router;
