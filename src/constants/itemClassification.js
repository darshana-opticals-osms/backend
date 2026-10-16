// Explicit catalog facts. Never infer these values from names or free-text categories.
const ITEM_CLASSIFICATIONS = Object.freeze(['UNKNOWN', 'MERCHANDISE', 'CLINICAL']);
const LOYALTY_ELIGIBILITY = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  MERCHANDISE: 'ELIGIBLE',
  CLINICAL: 'INELIGIBLE',
});

module.exports = { ITEM_CLASSIFICATIONS, LOYALTY_ELIGIBILITY };
