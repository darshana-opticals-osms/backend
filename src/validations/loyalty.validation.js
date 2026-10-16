const { ValidationError } = require('../errors/AppError');

const ALLOWED_QUERY_FIELDS = Object.freeze(['page', 'limit']);

function validatePaginationField(field, value, maximum) {
  if (value === undefined) return null;
  if (
    typeof value !== 'string' ||
    value.length > 5 ||
    !/^[1-9]\d*$/.test(value) ||
    Number(value) > maximum
  ) {
    return { field, message: `${field} must be an integer from 1 to ${maximum}.` };
  }
  return null;
}

function validateOwnLoyaltyRequest(req) {
  const query = req.loyaltyOriginalQuery ?? req.query ?? {};
  const body = req.loyaltyOriginalBody ?? req.body ?? {};
  const errors = [];

  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    errors.push({ field: 'query', message: 'Query parameters must be an object.' });
  } else {
    for (const field of Object.keys(query)) {
      if (!ALLOWED_QUERY_FIELDS.includes(field)) {
        errors.push({ field, message: 'Unsupported loyalty query parameter.' });
      }
    }
    const pageError = validatePaginationField('page', query.page, 10000);
    const limitError = validatePaginationField('limit', query.limit, 100);
    if (pageError) errors.push(pageError);
    if (limitError) errors.push(limitError);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    errors.push({ field: 'body', message: 'Request body must be an empty object.' });
  } else {
    for (const field of Object.keys(body)) {
      errors.push({
        field,
        message: 'This read-only endpoint does not accept request body fields.',
      });
    }
  }

  return errors;
}

function parseOwnLoyaltyPagination(query = {}) {
  const errors = [
    validatePaginationField('page', query.page, 10000),
    validatePaginationField('limit', query.limit, 100),
  ].filter(Boolean);
  if (errors.length) throw new ValidationError('Invalid loyalty pagination.', errors);

  const page = Number(query.page || 1);
  const limit = Number(query.limit || 25);
  return { page, limit, skip: (page - 1) * limit };
}

module.exports = { validateOwnLoyaltyRequest, parseOwnLoyaltyPagination };
