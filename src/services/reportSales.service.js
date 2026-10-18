const mongoose = require('mongoose');
const Order = require('../models/order.model');
const Payment = require('../models/payment.model');
const OrderItem = require('../models/orderItem.model');
const Branch = require('../models/branch.model');
const {
  REPORTING_TIMEZONE,
  REPORTING_CURRENCY,
  QUALIFYING_ORDER_STATUSES,
  CANCELLED_ORDER_STATUS,
  QUALIFYING_PAYMENT_STATUSES,
  REFUNDED_PAYMENT_STATUS,
  REFUNDED_PAYMENT_STATUSES,
  PAGINATION_LIMITS,
} = require('../constants/report.constants');
const { resolveReportDateRange } = require('../utils/reportDates');
const { shapeReportCustomer } = require('../utils/reportMasking');

/**
 * Builds the MongoDB match condition for qualifying sales payments.
 * A payment qualifies if:
 * 1. status == 'COMPLETED'
 * 2. paidAt (or createdAt) falls within [startUtc, endUtc]
 */
function buildQualifyingPaymentMatch({ startUtc, endUtc }) {
  return {
    status: { $in: QUALIFYING_PAYMENT_STATUSES },
    $expr: {
      $and: [
        {
          $gte: [
            { $ifNull: ['$paidAt', '$createdAt'] },
            startUtc,
          ],
        },
        {
          $lte: [
            { $ifNull: ['$paidAt', '$createdAt'] },
            endUtc,
          ],
        },
      ],
    },
  };
}

/**
 * Builds the match condition for refunds executed in the date range.
 * Refunded payments have:
 * status in REFUNDED_PAYMENT_STATUSES OR refundAmount > 0
 * and refundedAt (or updatedAt) within [startUtc, endUtc]
 */
function buildRefundMatch({ startUtc, endUtc }) {
  return {
    $or: [
      { status: { $in: REFUNDED_PAYMENT_STATUSES } },
      { refundAmount: { $gt: 0 } },
    ],
    $expr: {
      $and: [
        {
          $gte: [
            { $ifNull: ['$refundedAt', '$updatedAt'] },
            startUtc,
          ],
        },
        {
          $lte: [
            { $ifNull: ['$refundedAt', '$updatedAt'] },
            endUtc,
          ],
        },
      ],
    },
  };
}

/**
 * Helper to round financial numbers to 2 decimal places deterministically.
 */
function roundToTwo(num) {
  if (typeof num !== 'number' || !Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Generates the sales summary, time-series, branch, category, and payment method breakdowns.
 *
 * @param {Object} options
 * @param {string} [options.preset]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @param {string|null} [options.branchId]
 * @param {string} [options.groupBy] - 'day' | 'week' | 'month' | 'branch' | 'category'
 * @returns {Promise<Object>}
 */
async function getSalesReport({ preset, startDate, endDate, branchId = null, groupBy = 'day' }) {
  const dateRange = resolveReportDateRange({ preset, startDate, endDate });
  const { startUtc, endUtc } = dateRange;

  const targetBranchObjectId =
    branchId && mongoose.isValidObjectId(branchId) ? new mongoose.Types.ObjectId(branchId) : null;

  // 1. Aggregate Qualifying Sales Payments joined with Orders
  const salesPipeline = [
    { $match: buildQualifyingPaymentMatch({ startUtc, endUtc }) },
    {
      $lookup: {
        from: 'orders',
        localField: 'orderId',
        foreignField: '_id',
        as: 'order',
      },
    },
    { $unwind: '$order' },
    // Order must be non-cancelled and in qualifying lifecycle state
    {
      $match: {
        'order.status': { $in: QUALIFYING_ORDER_STATUSES },
        ...(targetBranchObjectId ? { 'order.branchId': targetBranchObjectId } : {}),
      },
    },
    {
      $project: {
        amount: 1,
        method: 1,
        paidDate: { $ifNull: ['$paidAt', '$createdAt'] },
        orderId: '$order._id',
        branchId: '$order.branchId',
      },
    },
  ];

  // 2. Fetch sales payments and refunds in parallel
  const [salesRecords, refundsAggregation, cancellationsAggregation] = await Promise.all([
    Payment.aggregate(salesPipeline),

    // Refund deductions query
    Payment.aggregate([
      { $match: buildRefundMatch({ startUtc, endUtc }) },
      {
        $lookup: {
          from: 'orders',
          localField: 'orderId',
          foreignField: '_id',
          as: 'order',
        },
      },
      { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
      ...(targetBranchObjectId ? [{ $match: { 'order.branchId': targetBranchObjectId } }] : []),
      {
        $group: {
          _id: null,
          totalRefundDeductions: {
            $sum: {
              $cond: [
                { $gt: ['$refundAmount', 0] },
                '$refundAmount',
                { $cond: [{ $eq: ['$status', REFUNDED_PAYMENT_STATUS] }, '$amount', 0] },
              ],
            },
          },
        },
      },
    ]),

    // Cancelled orders query (SM-10)
    Order.aggregate([
      {
        $match: {
          status: CANCELLED_ORDER_STATUS,
          updatedAt: { $gte: startUtc, $lte: endUtc },
          ...(targetBranchObjectId ? { branchId: targetBranchObjectId } : {}),
        },
      },
      {
        $group: {
          _id: null,
          cancelledCount: { $sum: 1 },
          cancelledValue: { $sum: '$orderAmount' },
        },
      },
    ]),
  ]);

  // Compute SM-01, SM-04, distinct qualifying order IDs
  let grossRevenue = 0;
  const distinctOrderIds = new Set();
  const branchSalesMap = new Map();
  const methodMap = new Map();
  const timeMap = new Map();

  // Helper for time grouping format
  const getTimeKey = (date) => {
    // Format date in Asia/Colombo
    const colomboDate = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
    const y = colomboDate.getUTCFullYear();
    const m = String(colomboDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(colomboDate.getUTCDate()).padStart(2, '0');

    if (groupBy === 'month') return `${y}-${m}`;
    if (groupBy === 'week') {
      // Calculate ISO week
      const tempDate = new Date(Date.UTC(y, colomboDate.getUTCMonth(), colomboDate.getUTCDate()));
      const dayNum = tempDate.getUTCDay() || 7;
      tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(((tempDate - yearStart) / 86400000 + 1) / 7);
      return `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }
    return `${y}-${m}-${d}`;
  };

  for (const record of salesRecords) {
    const amt = record.amount || 0;
    grossRevenue += amt;

    const orderIdStr = record.orderId.toString();
    distinctOrderIds.add(orderIdStr);

    // Branch breakdown
    const branchKey = record.branchId ? record.branchId.toString() : 'UNASSIGNED';
    const branchEntry = branchSalesMap.get(branchKey) || { branchId: branchKey, grossRevenue: 0, orderCount: 0 };
    branchEntry.grossRevenue += amt;
    branchEntry.orderCount += 1;
    branchSalesMap.set(branchKey, branchEntry);

    // Payment method breakdown
    const methodKey = record.method || 'OTHER';
    const methodEntry = methodMap.get(methodKey) || { method: methodKey, count: 0, volume: 0 };
    methodEntry.count += 1;
    methodEntry.volume += amt;
    methodMap.set(methodKey, methodEntry);

    // Time series grouping
    if (['day', 'week', 'month'].includes(groupBy)) {
      const timeKey = getTimeKey(record.paidDate);
      const timeEntry = timeMap.get(timeKey) || { period: timeKey, grossRevenue: 0, orderCount: 0 };
      timeEntry.grossRevenue += amt;
      timeEntry.orderCount += 1;
      timeMap.set(timeKey, timeEntry);
    }
  }

  // Calculate items sold quantity (SM-06) and category breakdown (SM-08)
  const qualifyingOrderObjectIds = Array.from(distinctOrderIds).map((id) => new mongoose.Types.ObjectId(id));

  let itemsSoldQuantity = 0;
  const categoryBreakdown = [];

  if (qualifyingOrderObjectIds.length > 0) {
    const itemAggregations = await OrderItem.aggregate([
      { $match: { orderId: { $in: qualifyingOrderObjectIds } } },
      {
        $group: {
          _id: { $ifNull: ['$classificationSnapshot.category', 'General Optical'] },
          quantity: { $sum: '$quantity' },
          volume: { $sum: { $multiply: ['$price', '$quantity'] } },
        },
      },
    ]);

    for (const itemAgg of itemAggregations) {
      itemsSoldQuantity += itemAgg.quantity;
      categoryBreakdown.push({
        category: itemAgg._id,
        quantity: itemAgg.quantity,
        revenue: roundToTwo(itemAgg.volume),
      });
    }
  }

  // Enrich branch names
  const branchBreakdown = [];
  const branchIdsToLookup = Array.from(branchSalesMap.keys()).filter((id) => id !== 'UNASSIGNED');
  const branches = branchIdsToLookup.length > 0 ? await Branch.find({ _id: { $in: branchIdsToLookup } }).lean() : [];
  const branchNameById = new Map(branches.map((b) => [b._id.toString(), b.codeName || b.name || b.address || 'Unknown Branch']));

  for (const [bId, entry] of branchSalesMap.entries()) {
    branchBreakdown.push({
      branchId: bId === 'UNASSIGNED' ? null : bId,
      branchName: bId === 'UNASSIGNED' ? 'Unassigned / Online' : branchNameById.get(bId) || 'Unknown Branch',
      grossRevenue: roundToTwo(entry.grossRevenue),
      orderCount: entry.orderCount,
    });
  }

  // Format payment method breakdown
  const paymentMethodBreakdown = Array.from(methodMap.values()).map((m) => ({
    method: m.method,
    count: m.count,
    volume: roundToTwo(m.volume),
  }));

  // Format time series breakdown sorted chronologically
  const timeSeriesBreakdown = Array.from(timeMap.values())
    .map((t) => ({
      period: t.period,
      grossRevenue: roundToTwo(t.grossRevenue),
      orderCount: t.orderCount,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const totalRefundDeductions = roundToTwo(refundsAggregation[0]?.totalRefundDeductions || 0);
  const totalQualifyingOrders = distinctOrderIds.size;
  const netRevenue = roundToTwo(grossRevenue - totalRefundDeductions);
  const averageOrderValue = totalQualifyingOrders > 0 ? roundToTwo(grossRevenue / totalQualifyingOrders) : 0;

  const cancelledOrdersCount = cancellationsAggregation[0]?.cancelledCount || 0;
  const cancelledOrdersValue = roundToTwo(cancellationsAggregation[0]?.cancelledValue || 0);

  return {
    success: true,
    data: {
      currency: REPORTING_CURRENCY,
      timezone: REPORTING_TIMEZONE,
      dateRange: {
        preset: dateRange.preset,
        startDate: dateRange.startDateStr,
        endDate: dateRange.endDateStr,
      },
      summary: {
        grossRevenue: roundToTwo(grossRevenue),
        refundDeductions: totalRefundDeductions,
        netRevenue,
        totalOrders: totalQualifyingOrders,
        itemsSold: itemsSoldQuantity,
        averageOrderValue,
        cancelledOrdersCount,
        cancelledOrdersValue,
      },
      breakdowns: {
        byTime: timeSeriesBreakdown,
        byBranch: branchBreakdown,
        byCategory: categoryBreakdown,
        byPaymentMethod: paymentMethodBreakdown,
      },
    },
  };
}

/**
 * Returns paginated detailed sales orders with masked customer PII.
 *
 * @param {Object} options
 * @param {string} [options.preset]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @param {string|null} [options.branchId]
 * @param {number} [options.page=1]
 * @param {number} [options.limit=20]
 * @param {string} [options.sortBy='paidAt']
 * @param {string} [options.sortOrder='desc']
 * @param {string} [options.orderStatus]
 * @returns {Promise<Object>}
 */
async function getSalesOrdersList({
  preset,
  startDate,
  endDate,
  branchId = null,
  page = PAGINATION_LIMITS.DEFAULT_PAGE,
  limit = PAGINATION_LIMITS.DEFAULT_LIMIT,
  sortBy = 'paidAt',
  sortOrder = 'desc',
  orderStatus,
}) {
  const dateRange = resolveReportDateRange({ preset, startDate, endDate });
  const { startUtc, endUtc } = dateRange;

  const targetBranchObjectId =
    branchId && mongoose.isValidObjectId(branchId) ? new mongoose.Types.ObjectId(branchId) : null;

  const allowedStatuses = orderStatus ? [orderStatus] : QUALIFYING_ORDER_STATUSES;

  const matchPayment = buildQualifyingPaymentMatch({ startUtc, endUtc });

  const numericPage = Math.max(1, parseInt(page, 10) || 1);
  const numericLimit = Math.min(
    PAGINATION_LIMITS.MAX_LIMIT,
    Math.max(1, parseInt(limit, 10) || PAGINATION_LIMITS.DEFAULT_LIMIT)
  );
  const skip = (numericPage - 1) * numericLimit;

  // Pipeline to count and fetch qualifying orders with payments
  const pipeline = [
    { $match: matchPayment },
    {
      $lookup: {
        from: 'orders',
        localField: 'orderId',
        foreignField: '_id',
        as: 'order',
      },
    },
    { $unwind: '$order' },
    {
      $match: {
        'order.status': { $in: allowedStatuses },
        ...(targetBranchObjectId ? { 'order.branchId': targetBranchObjectId } : {}),
      },
    },
    {
      $lookup: {
        from: 'customers',
        localField: 'order.customerId',
        foreignField: '_id',
        as: 'customer',
      },
    },
    { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'branches',
        localField: 'order.branchId',
        foreignField: '_id',
        as: 'branch',
      },
    },
    { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'orderitems',
        localField: 'order._id',
        foreignField: 'orderId',
        as: 'items',
      },
    },
    {
      $project: {
        _id: 1,
        paymentId: '$_id',
        orderId: '$order._id',
        orderAmount: '$order.orderAmount',
        paidAmount: '$amount',
        paymentMethod: '$method',
        paymentStatus: '$status',
        orderStatus: '$order.status',
        orderDate: '$order.orderDate',
        paidAt: { $ifNull: ['$paidAt', '$createdAt'] },
        createdAt: '$order.createdAt',
        branchId: '$order.branchId',
        branchName: {
          $ifNull: ['$branch.codeName', { $ifNull: ['$branch.name', { $ifNull: ['$branch.address', 'Unassigned / Online'] }] }],
        },
        totalItemsCount: { $sum: '$items.quantity' },
        customer: {
          name: '$customer.name',
          email: '$customer.email',
          phone: '$customer.phone',
          address: '$customer.address',
        },
      },
    },
  ];

  // Sorting
  const sortDirection = sortOrder === 'asc' ? 1 : -1;
  const sortFieldMap = {
    paidAt: 'paidAt',
    createdAt: 'createdAt',
    totalAmount: 'paidAmount',
    quantity: 'totalItemsCount',
  };
  const resolvedSortField = sortFieldMap[sortBy] || 'paidAt';

  const facetPipeline = [
    ...pipeline,
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $sort: { [resolvedSortField]: sortDirection, _id: sortDirection } },
          { $skip: skip },
          { $limit: numericLimit },
        ],
      },
    },
  ];

  const [facetResult] = await Payment.aggregate(facetPipeline);
  const total = facetResult?.metadata[0]?.total || 0;
  const rawOrders = facetResult?.data || [];

  const maskedOrders = rawOrders.map((row) => ({
    orderId: row.orderId.toString(),
    paymentId: row.paymentId.toString(),
    paidAt: row.paidAt,
    orderDate: row.orderDate,
    paidAmount: roundToTwo(row.paidAmount),
    orderAmount: roundToTwo(row.orderAmount),
    orderStatus: row.orderStatus,
    paymentMethod: row.paymentMethod,
    branchId: row.branchId ? row.branchId.toString() : null,
    branchName: row.branchName,
    itemCount: row.totalItemsCount || 0,
    customer: shapeReportCustomer(row.customer),
  }));

  const totalPages = Math.ceil(total / numericLimit) || 0;

  return {
    success: true,
    data: {
      orders: maskedOrders,
      pagination: {
        page: numericPage,
        limit: numericLimit,
        totalRecords: total,
        totalPages,
      },
      dateRange: {
        preset: dateRange.preset,
        startDate: dateRange.startDateStr,
        endDate: dateRange.endDateStr,
      },
    },
  };
}

module.exports = {
  getSalesReport,
  getSalesOrdersList,
};
