const mongoose = require('mongoose');
const Inventory = require('../models/inventory.model');
const {
  REPORTING_CURRENCY,
  PAGINATION_LIMITS,
} = require('../constants/report.constants');
const { getGlobalReorderThreshold } = require('./reorderAlert.service');

function roundToTwo(num) {
  if (typeof num !== 'number' || !Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Computes the real-time inventory snapshot report (IM-01 to IM-06).
 *
 * @param {Object} options
 * @param {string|null} [options.branchId]
 * @param {string|null} [options.category]
 * @param {string|null} [options.reorderStatus] - 'OK' | 'LOW_STOCK' | 'REORDER_TRIGGERED'
 * @returns {Promise<Object>}
 */
async function getInventoryReport({ branchId = null, category = null, reorderStatus = null } = {}) {
  const threshold = await getGlobalReorderThreshold();

  const matchStage = {
    quantity: { $gte: 0 },
  };

  if (branchId && mongoose.isValidObjectId(branchId)) {
    matchStage.branchId = new mongoose.Types.ObjectId(branchId);
  }

  if (category) {
    matchStage.category = category;
  }

  // Define reorder status classification expression
  const reorderStatusExpr = {
    $cond: [
      { $eq: ['$quantity', 0] },
      'REORDER_TRIGGERED',
      {
        $cond: [
          { $lte: ['$quantity', threshold] },
          'LOW_STOCK',
          'OK',
        ],
      },
    ],
  };

  // 1. Overall Snapshot Summary Aggregation
  const summaryPipeline = [
    { $match: matchStage },
    {
      $project: {
        quantity: 1,
        price: 1,
        branchId: 1,
        category: 1,
        reorderStatus: reorderStatusExpr,
      },
    },
    ...(reorderStatus ? [{ $match: { reorderStatus } }] : []),
    {
      $group: {
        _id: null,
        totalStockOnHand: { $sum: '$quantity' },
        totalRetailValuation: { $sum: { $multiply: ['$quantity', '$price'] } },
        totalUniqueProducts: { $sum: 1 },
        lowStockCount: {
          $sum: { $cond: [{ $eq: ['$reorderStatus', 'LOW_STOCK'] }, 1, 0] },
        },
        reorderTriggeredCount: {
          $sum: { $cond: [{ $eq: ['$reorderStatus', 'REORDER_TRIGGERED'] }, 1, 0] },
        },
        okStockCount: {
          $sum: { $cond: [{ $eq: ['$reorderStatus', 'OK'] }, 1, 0] },
        },
      },
    },
  ];

  // 2. Branch Breakdown Aggregation
  const branchPipeline = [
    { $match: matchStage },
    {
      $project: {
        quantity: 1,
        price: 1,
        branchId: 1,
        reorderStatus: reorderStatusExpr,
      },
    },
    ...(reorderStatus ? [{ $match: { reorderStatus } }] : []),
    {
      $group: {
        _id: '$branchId',
        totalStock: { $sum: '$quantity' },
        totalRetailValuation: { $sum: { $multiply: ['$quantity', '$price'] } },
        itemCount: { $sum: 1 },
        lowStockCount: {
          $sum: { $cond: [{ $eq: ['$reorderStatus', 'LOW_STOCK'] }, 1, 0] },
        },
        reorderTriggeredCount: {
          $sum: { $cond: [{ $eq: ['$reorderStatus', 'REORDER_TRIGGERED'] }, 1, 0] },
        },
      },
    },
    {
      $lookup: {
        from: 'branches',
        localField: '_id',
        foreignField: '_id',
        as: 'branch',
      },
    },
    { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        branchId: '$_id',
        branchName: {
          $ifNull: ['$branch.codeName', { $ifNull: ['$branch.name', { $ifNull: ['$branch.address', 'Unassigned Branch'] }] }],
        },
        totalStock: 1,
        totalRetailValuation: 1,
        itemCount: 1,
        lowStockCount: 1,
        reorderTriggeredCount: 1,
      },
    },
  ];

  // 3. Category Breakdown Aggregation
  const categoryPipeline = [
    { $match: matchStage },
    {
      $project: {
        quantity: 1,
        price: 1,
        category: 1,
        reorderStatus: reorderStatusExpr,
      },
    },
    ...(reorderStatus ? [{ $match: { reorderStatus } }] : []),
    {
      $group: {
        _id: '$category',
        totalStock: { $sum: '$quantity' },
        totalRetailValuation: { $sum: { $multiply: ['$quantity', '$price'] } },
        itemCount: { $sum: 1 },
      },
    },
  ];

  const [summaryResult, branchResults, categoryResults] = await Promise.all([
    Inventory.aggregate(summaryPipeline),
    Inventory.aggregate(branchPipeline),
    Inventory.aggregate(categoryPipeline),
  ]);

  const summary = summaryResult[0] || {
    totalStockOnHand: 0,
    totalRetailValuation: 0,
    totalUniqueProducts: 0,
    lowStockCount: 0,
    reorderTriggeredCount: 0,
    okStockCount: 0,
  };

  const branchBreakdown = branchResults.map((b) => ({
    branchId: b.branchId ? b.branchId.toString() : null,
    branchName: b.branchName,
    totalStock: b.totalStock || 0,
    totalRetailValuation: roundToTwo(b.totalRetailValuation || 0),
    itemCount: b.itemCount || 0,
    lowStockCount: b.lowStockCount || 0,
    reorderTriggeredCount: b.reorderTriggeredCount || 0,
  }));

  const categoryBreakdown = categoryResults.map((c) => ({
    category: c._id || 'General Optical',
    totalStock: c.totalStock || 0,
    totalRetailValuation: roundToTwo(c.totalRetailValuation || 0),
    itemCount: c.itemCount || 0,
  }));

  return {
    success: true,
    data: {
      currency: REPORTING_CURRENCY,
      generatedAt: new Date().toISOString(),
      reorderThresholdUsed: threshold,
      summary: {
        totalStockOnHand: summary.totalStockOnHand,
        totalRetailValuation: roundToTwo(summary.totalRetailValuation),
        totalUniqueProducts: summary.totalUniqueProducts,
        lowStockCount: summary.lowStockCount,
        reorderTriggeredCount: summary.reorderTriggeredCount,
        okStockCount: summary.okStockCount,
      },
      breakdowns: {
        byBranch: branchBreakdown,
        byCategory: categoryBreakdown,
      },
    },
  };
}

/**
 * Returns paginated detailed inventory items with live reorder states.
 *
 * @param {Object} options
 * @param {string|null} [options.branchId]
 * @param {string|null} [options.category]
 * @param {string|null} [options.reorderStatus] - 'OK' | 'LOW_STOCK' | 'REORDER_TRIGGERED'
 * @param {number} [options.page=1]
 * @param {number} [options.limit=20]
 * @param {string} [options.sortBy='quantity']
 * @param {string} [options.sortOrder='desc']
 * @param {boolean} [options.isExport=false]
 * @returns {Promise<Object>}
 */
async function getInventoryItemsList({
  branchId = null,
  category = null,
  reorderStatus = null,
  page = PAGINATION_LIMITS.DEFAULT_PAGE,
  limit = PAGINATION_LIMITS.DEFAULT_LIMIT,
  sortBy = 'quantity',
  sortOrder = 'desc',
  isExport = false,
} = {}) {
  const threshold = await getGlobalReorderThreshold();

  const matchStage = {
    quantity: { $gte: 0 },
  };

  if (branchId && mongoose.isValidObjectId(branchId)) {
    matchStage.branchId = new mongoose.Types.ObjectId(branchId);
  }

  if (category) {
    matchStage.category = category;
  }

  const reorderStatusExpr = {
    $cond: [
      { $eq: ['$quantity', 0] },
      'REORDER_TRIGGERED',
      {
        $cond: [
          { $lte: ['$quantity', threshold] },
          'LOW_STOCK',
          'OK',
        ],
      },
    ],
  };

  const numericPage = Math.max(1, parseInt(page, 10) || 1);
  const numericLimit = isExport
    ? Math.min(10000, Math.max(1, parseInt(limit, 10) || 10000))
    : Math.min(
        PAGINATION_LIMITS.MAX_LIMIT,
        Math.max(1, parseInt(limit, 10) || PAGINATION_LIMITS.DEFAULT_LIMIT)
      );
  const skip = (numericPage - 1) * numericLimit;

  const sortDirection = sortOrder === 'asc' ? 1 : -1;
  const sortFieldMap = {
    quantity: 'quantity',
    unitPrice: 'price',
    name: 'itemName',
    category: 'category',
    sku: '_id',
  };
  const resolvedSortField = sortFieldMap[sortBy] || 'quantity';

  const pipeline = [
    { $match: matchStage },
    {
      $project: {
        _id: 1,
        itemName: 1,
        category: 1,
        brand: 1,
        price: 1,
        quantity: 1,
        branchId: 1,
        reorderStatus: reorderStatusExpr,
      },
    },
    ...(reorderStatus ? [{ $match: { reorderStatus } }] : []),
    {
      $lookup: {
        from: 'branches',
        localField: 'branchId',
        foreignField: '_id',
        as: 'branch',
      },
    },
    { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
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

  const [facetResult] = await Inventory.aggregate(pipeline);
  const total = facetResult?.metadata[0]?.total || 0;
  const rawItems = facetResult?.data || [];

  const items = rawItems.map((item) => ({
    id: item._id.toString(),
    sku: item._id.toString(),
    name: item.itemName,
    category: item.category,
    brand: item.brand,
    unitPrice: roundToTwo(item.price),
    quantity: item.quantity,
    reorderThreshold: threshold,
    reorderStatus: item.reorderStatus,
    retailValuation: roundToTwo(item.quantity * item.price),
    branchId: item.branchId ? item.branchId.toString() : null,
    branchName:
      item.branch?.codeName || item.branch?.name || item.branch?.address || 'Unassigned Branch',
  }));

  const totalPages = Math.ceil(total / numericLimit) || 0;

  return {
    success: true,
    data: {
      items,
      reorderThresholdUsed: threshold,
      pagination: {
        page: numericPage,
        limit: numericLimit,
        totalRecords: total,
        totalPages,
      },
    },
  };
}

module.exports = {
  getInventoryReport,
  getInventoryItemsList,
};
