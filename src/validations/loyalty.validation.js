const { ValidationError } = require('../errors/AppError');
const { LOYALTY_EVENT_TYPE } = require('../constants/loyalty');

const OWN_QUERY_FIELDS = Object.freeze(['page', 'limit']);
const MANAGEMENT_QUERY_FIELDS = Object.freeze([
  'page',
  'limit',
  'customerId',
  'orderId',
  'paymentId',
  'eventType',
  'sortOrder',
]);
const IDENTIFIER_FIELDS = Object.freeze(['customerId', 'orderId', 'paymentId']);
const isIdentifier = (value) => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);

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
      if (!OWN_QUERY_FIELDS.includes(field)) {
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

function validateManagementLoyaltyRequest(req) {
  const query = req.loyaltyOriginalQuery ?? req.query ?? {};
  const body = req.loyaltyOriginalBody ?? req.body ?? {};
  const errors = [];

  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    errors.push({ field: 'query', message: 'Query parameters must be an object.' });
  } else {
    for (const field of Object.keys(query)) {
      if (!MANAGEMENT_QUERY_FIELDS.includes(field)) {
        errors.push({ field, message: 'Unsupported loyalty monitoring query parameter.' });
      }
    }
    const pageError = validatePaginationField('page', query.page, 10000);
    const limitError = validatePaginationField('limit', query.limit, 100);
    if (pageError) errors.push(pageError);
    if (limitError) errors.push(limitError);
    for (const field of IDENTIFIER_FIELDS) {
      if (query[field] !== undefined && !isIdentifier(query[field])) {
        errors.push({ field, message: `${field} must be a valid MongoDB ObjectId.` });
      }
    }
    if (
      query.eventType !== undefined &&
      (typeof query.eventType !== 'string' ||
        !Object.values(LOYALTY_EVENT_TYPE).includes(query.eventType))
    ) {
      errors.push({ field: 'eventType', message: 'Invalid loyalty eventType.' });
    }
    if (
      query.sortOrder !== undefined &&
      (typeof query.sortOrder !== 'string' || !['asc', 'desc'].includes(query.sortOrder))
    ) {
      errors.push({ field: 'sortOrder', message: 'sortOrder must be asc or desc.' });
    }
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

function parseManagementLoyaltyQuery(query = {}) {
  const errors = validateManagementLoyaltyRequest({ query, body: {} });
  if (errors.length) throw new ValidationError('Invalid loyalty monitoring query.', errors);
  const { page, limit, skip } = parseOwnLoyaltyPagination(query);
  const direction = query.sortOrder === 'asc' ? 1 : -1;
  const filter = {};
  for (const field of IDENTIFIER_FIELDS) {
    if (query[field] !== undefined) filter[field] = query[field];
  }
  if (query.eventType !== undefined) filter.eventType = query.eventType;
  return {
    page,
    limit,
    skip,
    filter,
    sort: { createdAt: direction, _id: direction },
  };
}

module.exports = {
  validateOwnLoyaltyRequest,
  validateManagementLoyaltyRequest,
  parseOwnLoyaltyPagination,
  parseManagementLoyaltyQuery,
};
