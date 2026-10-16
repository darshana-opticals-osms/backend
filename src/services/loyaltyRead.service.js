const mongoose = require('mongoose');
const Customer = require('../models/customer.model');
const LoyaltyTransaction = require('../models/loyaltyTransaction.model');
const { ROLE_VALUES } = require('../constants/roles');
const {
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
} = require('../errors/AppError');
const { toMinor, fromMinor } = require('../utils/loyaltyDecimal');
const {
  parseOwnLoyaltyPagination,
  parseManagementLoyaltyQuery,
} = require('../validations/loyalty.validation');

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

function shapeManagementTransaction(record) {
  return {
    id: record._id.toString(),
    customerId: record.customerId.toString(),
    orderId: record.orderId.toString(),
    paymentId: record.paymentId.toString(),
    type: record.eventType,
    pointsDelta: fromMinor(toMinor(record.pointsDelta)),
    balanceAfter: fromMinor(toMinor(record.balanceAfter)),
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
      .maxTimeMS(5000)
      .lean(),
    LoyaltyTransaction.countDocuments(filter).maxTimeMS(5000),
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

async function listManagementLoyalty({ role, query = {} }) {
  if (role !== ROLE_VALUES.BRANCH_MANAGER) {
    throw new ForbiddenError('Loyalty monitoring requires BRANCH_MANAGER.');
  }
  const options = parseManagementLoyaltyQuery(query);
  const [records, total] = await Promise.all([
    LoyaltyTransaction.find(options.filter)
      .select('_id customerId orderId paymentId eventType pointsDelta balanceAfter createdAt')
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .maxTimeMS(5000)
      .lean(),
    LoyaltyTransaction.countDocuments(options.filter).maxTimeMS(5000),
  ]);
  return {
    transactions: records.map(shapeManagementTransaction),
    pagination: {
      page: options.page,
      limit: options.limit,
      total,
      totalPages: Math.ceil(total / options.limit),
    },
  };
}

module.exports = {
  getOwnLoyalty,
  listManagementLoyalty,
  shapeTransaction,
  shapeManagementTransaction,
};
