const { ValidationError } = require('../errors/AppError');
const { sanitizeValue } = require('../utils/sanitizer');

/**
 * Validates a single field value against given rules.
 *
 * @param {string} field - Field name
 * @param {any} value - Field value
 * @param {Object} rules - Rules object (required, type, minLength, maxLength, isEmail, pattern, custom)
 * @returns {Array<{field: string, message: string}>} Array of error objects
 */
const validateField = (field, value, rules) => {
  const errors = [];

  if (rules.required && (value === undefined || value === null || value === '')) {
    errors.push({ field, message: `${field} is required` });
    return errors;
  }

  // If value is missing and not required, skip subsequent rule checks
  if (value === undefined || value === null || value === '') {
    return errors;
  }

  if (rules.type && typeof value !== rules.type) {
    errors.push({ field, message: `${field} must be of type ${rules.type}` });
  }

  if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
    errors.push({ field, message: `${field} must be at least ${rules.minLength} characters long` });
  }

  if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
    errors.push({ field, message: `${field} must not exceed ${rules.maxLength} characters` });
  }

  if (rules.isEmail && typeof value === 'string') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      errors.push({ field, message: `${field} must be a valid email address` });
    }
  }

  if (rules.pattern && rules.pattern instanceof RegExp) {
    if (!rules.pattern.test(String(value))) {
      errors.push({ field, message: `${field} format is invalid` });
    }
  }

  if (rules.custom && typeof rules.custom === 'function') {
    const customResult = rules.custom(value);
    if (customResult !== true && typeof customResult === 'string') {
      errors.push({ field, message: customResult });
    } else if (customResult === false) {
      errors.push({ field, message: `${field} is invalid` });
    }
  }

  return errors;
};

/**
 * Reusable Express request validation middleware factory.
 * Accepts a schema object or custom validator function.
 *
 * @param {Object|Function} schemaOrFn - Validation schema object or custom function
 * @returns {import('express').RequestHandler} Express middleware
 */
const validate = (schemaOrFn) => {
  return (req, _res, next) => {
    // Sanitize request data
    if (req.body) req.body = sanitizeValue(req.body);
    if (req.query) req.query = sanitizeValue(req.query);
    if (req.params) req.params = sanitizeValue(req.params);

    let fieldErrors = [];

    if (typeof schemaOrFn === 'function') {
      const result = schemaOrFn(req);
      if (Array.isArray(result) && result.length > 0) {
        fieldErrors = result;
      } else if (typeof result === 'string') {
        fieldErrors = [{ field: 'request', message: result }];
      }
    } else if (typeof schemaOrFn === 'object' && schemaOrFn !== null) {
      const locations = ['body', 'query', 'params'];

      for (const location of locations) {
        if (schemaOrFn[location]) {
          const rules = schemaOrFn[location];
          const data = req[location] || {};

          for (const [field, fieldRules] of Object.entries(rules)) {
            const val = data[field];
            const errors = validateField(field, val, fieldRules);
            fieldErrors.push(...errors);
          }
        }
      }
    }

    if (fieldErrors.length > 0) {
      const errorMessage =
        fieldErrors.length === 1
          ? fieldErrors[0].message
          : 'Validation failed for incoming request data';
      return next(new ValidationError(errorMessage, fieldErrors));
    }

    return next();
  };
};

module.exports = {
  validate,
  validateField,
};
