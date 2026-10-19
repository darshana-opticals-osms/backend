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
const { ROLE_VALUES } = require('../constants/roles');
const { ForbiddenError } = require('../errors/AppError');

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
          $gte: [{ $ifNull: ['$paidAt', '$createdAt'] }, startUtc],
        },
        {
          $lte: [{ $ifNull: ['$paidAt', '$createdAt'] }, endUtc],
        },
      ],
    },
  };
}

/**
 * Builds the match condition for refunds executed in the date range.
 * ADR-014 strictly defines refund reporting using Payment.refundedAt.
 * Documents lacking refundedAt are excluded from period refund deductions
 * to avoid attributing generic document updates to financial refund events.
 */
function buildRefundMatch({ startUtc, endUtc }) {
  return {
    $or: [{ status: { $in: REFUNDED_PAYMENT_STATUSES } }, { refundAmount: { $gt: 0 } }],
    refundedAt: {
      $gte: startUtc,
      $lte: endUtc,
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
 * @param {string} [options.userRole] - Role of authenticated user
 * @returns {Promise<Object>}
 */
async function getSalesReport({
  preset,
  startDate,
  endDate,
  branchId = null,
  groupBy = 'day',
  userRole = null,
}) {
  const isBranchManager = userRole === ROLE_VALUES.BRANCH_MANAGER;
  const dateRange = resolveReportDateRange({ preset, startDate, endDate });
  const { startUtc, endUtc } = dateRange;

  if (branchId && branchId !== 'ALL' && !mongoose.isValidObjectId(branchId)) {
    throw new ForbiddenError('Invalid branch identifier.');
  }

  const targetBranchObjectId =
    branchId && branchId !== 'ALL' && mongoose.isValidObjectId(branchId)
      ? new mongoose.Types.ObjectId(branchId)
      : null;

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

  // 2. Fetch sales payments, refunds, cancellations, and qualifying orders in parallel
  const [salesRecords, refundsAggregation, cancellationsAggregation, qualifyingOrdersAggregation] =
    await Promise.all([
      Payment.aggregate(salesPipeline),

      // Refund deductions query - project refund details for branch and time breakdowns
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
          $project: {
            amount: 1,
            refundAmount: 1,
            status: 1,
            refundedAt: 1,
            branchId: '$order.branchId',
            refundDeduction: {
              $cond: [
                { $gt: ['$refundAmount', 0] },
                '$refundAmount',
                { $cond: [{ $eq: ['$status', REFUNDED_PAYMENT_STATUS] }, '$amount', 0] },
              ],
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

      // Operational qualifying orders query (SM-04 per ADR-014: Order.createdAt within [startUtc, endUtc])
      Order.aggregate([
        {
          $match: {
            status: { $in: QUALIFYING_ORDER_STATUSES },
            $expr: {
              $and: [
                { $gte: [{ $ifNull: ['$createdAt', '$orderDate'] }, startUtc] },
                { $lte: [{ $ifNull: ['$createdAt', '$orderDate'] }, endUtc] },
              ],
            },
            ...(targetBranchObjectId ? { branchId: targetBranchObjectId } : {}),
          },
        },
        {
          $lookup: {
            from: 'payments',
            localField: '_id',
            foreignField: 'orderId',
            as: 'payments',
          },
        },
        {
          $match: {
            'payments.status': { $in: QUALIFYING_PAYMENT_STATUSES },
          },
        },
        {
          $project: {
            _id: 1,
            branchId: 1,
            orderDate: { $ifNull: ['$createdAt', '$orderDate'] },
          },
        },
      ]),
    ]);

  // Helper for time grouping format
  const getTimeKey = (date) => {
    // Format date in Asia/Colombo
    const colomboDate = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
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

  // Compute total, branch, and period refund deductions
  const branchRefundMap = new Map();
  const timeRefundMap = new Map();
  let totalRefundDeductions = 0;
  for (const ref of refundsAggregation) {
    const bKey = ref.branchId ? ref.branchId.toString() : 'UNASSIGNED';
    const amt = ref.refundDeduction || 0;
    branchRefundMap.set(bKey, (branchRefundMap.get(bKey) || 0) + amt);
    totalRefundDeductions += amt;

    if (['day', 'week', 'month'].includes(groupBy) && ref.refundedAt) {
      const timeKey = getTimeKey(new Date(ref.refundedAt));
      timeRefundMap.set(timeKey, (timeRefundMap.get(timeKey) || 0) + amt);
    }
  }
  totalRefundDeductions = roundToTwo(totalRefundDeductions);

  // Compute operational qualifying orders (SM-04 per ADR-014: Order.createdAt within [startUtc, endUtc])
  const totalQualifyingOrders = qualifyingOrdersAggregation.length;
  const branchOperationalOrderCountMap = new Map();
  const timeOperationalOrderCountMap = new Map();

  for (const qOrder of qualifyingOrdersAggregation) {
    const bKey = qOrder.branchId ? qOrder.branchId.toString() : 'UNASSIGNED';
    branchOperationalOrderCountMap.set(bKey, (branchOperationalOrderCountMap.get(bKey) || 0) + 1);

    if (['day', 'week', 'month'].includes(groupBy) && qOrder.orderDate) {
      const timeKey = getTimeKey(new Date(qOrder.orderDate));
      timeOperationalOrderCountMap.set(
        timeKey,
        (timeOperationalOrderCountMap.get(timeKey) || 0) + 1
      );
    }
  }

  // Compute SM-01, distinct qualifying order IDs for items sold
  let grossRevenue = 0;
  const distinctOrderIds = new Set();
  const branchSalesMap = new Map();
  const methodMap = new Map();
  const timeMap = new Map();

  for (const record of salesRecords) {
    const amt = record.amount || 0;
    grossRevenue += amt;

    const orderIdStr = record.orderId.toString();
    distinctOrderIds.add(orderIdStr);

    // Branch breakdown - track gross revenue
    const branchKey = record.branchId ? record.branchId.toString() : 'UNASSIGNED';
    let branchEntry = branchSalesMap.get(branchKey);
    if (!branchEntry) {
      branchEntry = {
        branchId: branchKey,
        grossRevenue: 0,
      };
      branchSalesMap.set(branchKey, branchEntry);
    }
    branchEntry.grossRevenue += amt;

    // Payment method breakdown
    const methodKey = record.method || 'OTHER';
    const methodEntry = methodMap.get(methodKey) || { method: methodKey, count: 0, volume: 0 };
    methodEntry.count += 1;
    methodEntry.volume += amt;
    methodMap.set(methodKey, methodEntry);

    // Time series grouping - track gross revenue
    if (['day', 'week', 'month'].includes(groupBy)) {
      const timeKey = getTimeKey(record.paidDate);
      let timeEntry = timeMap.get(timeKey);
      if (!timeEntry) {
        timeEntry = { period: timeKey, grossRevenue: 0 };
        timeMap.set(timeKey, timeEntry);
      }
      timeEntry.grossRevenue += amt;
    }
  }

  // Calculate items sold quantity (SM-06), category breakdown (SM-08), and branch items sold
  const qualifyingOrderObjectIds = Array.from(distinctOrderIds).map(
    (id) => new mongoose.Types.ObjectId(id)
  );

  let itemsSoldQuantity = 0;
  const categoryBreakdown = [];
  const branchItemCountMap = new Map();

  if (qualifyingOrderObjectIds.length > 0) {
    const [itemAggregations, branchItemAggregations] = await Promise.all([
      OrderItem.aggregate([
        { $match: { orderId: { $in: qualifyingOrderObjectIds } } },
        {
          $group: {
            _id: { $ifNull: ['$classificationSnapshot.category', 'General Optical'] },
            quantity: { $sum: '$quantity' },
            volume: { $sum: { $multiply: ['$price', '$quantity'] } },
          },
        },
      ]),
      OrderItem.aggregate([
        { $match: { orderId: { $in: qualifyingOrderObjectIds } } },
        {
          $lookup: {
            from: 'orders',
            localField: 'orderId',
            foreignField: '_id',
            as: 'order',
          },
        },
        { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ['$order.branchId', 'UNASSIGNED'] },
            itemCount: { $sum: '$quantity' },
          },
        },
      ]),
    ]);

    for (const itemAgg of itemAggregations) {
      itemsSoldQuantity += itemAgg.quantity;
      categoryBreakdown.push({
        category: itemAgg._id,
        quantity: itemAgg.quantity,
        revenue: roundToTwo(itemAgg.volume),
      });
    }

    for (const bAgg of branchItemAggregations) {
      const bKey = bAgg._id && bAgg._id !== 'UNASSIGNED' ? bAgg._id.toString() : 'UNASSIGNED';
      branchItemCountMap.set(bKey, bAgg.itemCount);
    }
  }

  // Ensure branches with operational orders or refunds are also present in branchSalesMap
  for (const bId of branchOperationalOrderCountMap.keys()) {
    if (!branchSalesMap.has(bId)) {
      branchSalesMap.set(bId, { branchId: bId, grossRevenue: 0 });
    }
  }
  for (const bId of branchRefundMap.keys()) {
    if (!branchSalesMap.has(bId)) {
      branchSalesMap.set(bId, { branchId: bId, grossRevenue: 0 });
    }
  }

  // Enrich branch names
  const branchBreakdown = [];
  const branchIdsToLookup = Array.from(branchSalesMap.keys()).filter((id) => id !== 'UNASSIGNED');
  const branches =
    branchIdsToLookup.length > 0
      ? await Branch.find({ _id: { $in: branchIdsToLookup } }).lean()
      : [];
  const branchNameById = new Map(
    branches.map((b) => [b._id.toString(), b.codeName || b.name || b.address || 'Unknown Branch'])
  );

  for (const [bId, entry] of branchSalesMap.entries()) {
    const bGross = roundToTwo(entry.grossRevenue);
    const bRefund = roundToTwo(branchRefundMap.get(bId) || 0);
    const bNet = roundToTwo(bGross - bRefund);
    const bOrders = branchOperationalOrderCountMap.get(bId) || 0;
    const bItems = branchItemCountMap.get(bId) || 0;

    branchBreakdown.push({
      branchId: bId === 'UNASSIGNED' ? null : bId,
      branchName:
        bId === 'UNASSIGNED' ? 'Unassigned / Online' : branchNameById.get(bId) || 'Unknown Branch',
      grossRevenue: bGross,
      ...(!isBranchManager ? { refundDeductions: bRefund } : {}),
      netRevenue: bNet,
      orderCount: bOrders,
      itemCount: bItems,
    });
  }

  // Format payment method breakdown
  const paymentMethodBreakdown = Array.from(methodMap.values()).map((m) => ({
    method: m.method,
    count: m.count,
    volume: roundToTwo(m.volume),
  }));

  // Ensure time periods with operational orders or refunds are also present in timeMap
  for (const timeKey of timeOperationalOrderCountMap.keys()) {
    if (!timeMap.has(timeKey)) {
      timeMap.set(timeKey, { period: timeKey, grossRevenue: 0 });
    }
  }
  for (const timeKey of timeRefundMap.keys()) {
    if (!timeMap.has(timeKey)) {
      timeMap.set(timeKey, { period: timeKey, grossRevenue: 0 });
    }
  }

  // Format time series breakdown sorted chronologically with authoritative netRevenue
  const timeSeriesBreakdown = Array.from(timeMap.values())
    .map((t) => {
      const periodGross = roundToTwo(t.grossRevenue);
      const periodRefund = roundToTwo(timeRefundMap.get(t.period) || 0);
      return {
        period: t.period,
        grossRevenue: periodGross,
        netRevenue: roundToTwo(periodGross - periodRefund),
        orderCount: timeOperationalOrderCountMap.get(t.period) || 0,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  const netRevenue = roundToTwo(grossRevenue - totalRefundDeductions);
  const averageOrderValue =
    totalQualifyingOrders > 0 ? roundToTwo(grossRevenue / totalQualifyingOrders) : 0;

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
        ...(!isBranchManager ? { refundDeductions: totalRefundDeductions } : {}),
        netRevenue,
        totalOrders: totalQualifyingOrders,
        itemsSold: itemsSoldQuantity,
        ...(!isBranchManager ? { averageOrderValue } : {}),
        cancelledOrdersCount,
        cancelledOrdersValue,
      },
      // Breakdowns: byPaymentMethod (SM-09) is restricted to SYSTEM_ADMIN per ADR-014 §10.1;
      // byCategory is scoped strictly to the branch's qualifying orders when targetBranchObjectId is set.
      breakdowns: {
        byTime: timeSeriesBreakdown,
        byBranch: branchBreakdown,
        byCategory: categoryBreakdown,
        ...(!isBranchManager ? { byPaymentMethod: paymentMethodBreakdown } : {}),
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
 * @param {boolean} [options.isExport=false]
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
  isExport = false,
  _userRole = null,
}) {
  const dateRange = resolveReportDateRange({ preset, startDate, endDate });
  const { startUtc, endUtc } = dateRange;

  const targetBranchObjectId =
    branchId && mongoose.isValidObjectId(branchId) ? new mongoose.Types.ObjectId(branchId) : null;

  const allowedStatuses = orderStatus ? [orderStatus] : QUALIFYING_ORDER_STATUSES;

  const matchPayment = buildQualifyingPaymentMatch({ startUtc, endUtc });

  const numericPage = Math.max(1, parseInt(page, 10) || 1);
  const numericLimit = isExport
    ? Math.min(10000, Math.max(1, parseInt(limit, 10) || 10000))
    : Math.min(
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
          $ifNull: [
            '$branch.codeName',
            { $ifNull: ['$branch.name', { $ifNull: ['$branch.address', 'Unassigned / Online'] }] },
          ],
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

  const isTruncated = isExport && total > numericLimit;
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
        isTruncated,
        totalMatching: total,
        exportedCount: maskedOrders.length,
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
