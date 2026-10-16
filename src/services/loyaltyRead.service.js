const mongoose = require('mongoose');
const Customer = require('../models/customer.model');
const LoyaltyTransaction = require('../models/loyaltyTransaction.model');
const { ROLE_VALUES } = require('../constants/roles');
const { NotFoundError, ConflictError, ValidationError } = require('../errors/AppError');
const { toMinor, fromMinor } = require('../utils/loyaltyDecimal');
const { parseOwnLoyaltyPagination } = require('../validations/loyalty.validation');

function shapeTransaction(record) {
  return {
    id: record._id.toString(),
    type: record.eventType,
    pointsDelta: fromMinor(toMinor(record.pointsDelta)),
    balanceAfter: fromMinor(toMinor(record.balanceAfter)),
    orderId: record.orderId.toString(),
    createdAt: record.createdAt,
  };
}

async function getOwnLoyalty({ customerId, query = {} }) {
  if (!mongoose.isValidObjectId(customerId)) {
    throw new ValidationError('Authenticated customer identity is invalid.');
  }

  // Ownership is enforced in the query itself; no client-supplied Customer ID is accepted.
  const customer = await Customer.findOne({ _id: customerId, role: ROLE_VALUES.CUSTOMER })
    .select('_id +loyaltyBalance')
    .lean();
  if (!customer) throw new NotFoundError('Customer not found.', null, 'CUSTOMER_NOT_FOUND');
  if (customer.loyaltyBalance === undefined || customer.loyaltyBalance === null) {
    throw new ConflictError(
      'Legacy balance requires authoritative initialization.',
      null,
      'LOYALTY_BALANCE_UNINITIALIZED'
    );
  }

  const { page, limit, skip } = parseOwnLoyaltyPagination(query);
  const filter = { customerId: customer._id };
  const [records, total] = await Promise.all([
    LoyaltyTransaction.find(filter)
      .select('_id eventType pointsDelta balanceAfter orderId createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    LoyaltyTransaction.countDocuments(filter),
  ]);

  return {
    balance: fromMinor(toMinor(customer.loyaltyBalance)),
    transactions: records.map(shapeTransaction),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

module.exports = { getOwnLoyalty, shapeTransaction };
