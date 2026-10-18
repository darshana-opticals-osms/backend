const mongoose = require('mongoose');
const Inventory = require('../models/inventory.model');
const { REPORTING_CURRENCY, PAGINATION_LIMITS } = require('../constants/report.constants');
const { getGlobalReorderThreshold } = require('./reorderAlert.service');

function roundToTwo(num) {
  if (typeof num !== 'number' || !Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Builds aggregation stages that compute authoritative reorder status aligned with
 * ADR-006's active ReorderAlert model (Review Comment 6):
 * - If an active alert exists in ReorderAlert (or quantity is 0):
 *   - quantity === 0 -> REORDER_TRIGGERED (out of stock, urgent reorder triggered)
 *   - quantity <= threshold or active alert -> LOW_STOCK
 *   - else -> OK
 */
function buildReorderStatusStages(threshold) {
  return [
    {
      $lookup: {
        from: 'reorderalerts',
        let: { invId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ['$inventoryId', '$$invId'] }, { $eq: ['$status', 'ACTIVE'] }],
              },
            },
          },
        ],
        as: 'activeAlerts',
      },
    },
    {
      $addFields: {
        hasActiveAlert: { $gt: [{ $size: '$activeAlerts' }, 0] },
      },
    },
    {
      $addFields: {
        reorderStatus: {
          $cond: [
            { $eq: ['$quantity', 0] },
            'REORDER_TRIGGERED',
            {
              $cond: [
                {
                  $or: ['$hasActiveAlert', { $lte: ['$quantity', threshold] }],
                },
                'LOW_STOCK',
                'OK',
              ],
            },
          ],
        },
      },
    },
  ];
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

  // 1. Overall Snapshot Summary Aggregation
  const summaryPipeline = [
    { $match: matchStage },
    ...buildReorderStatusStages(threshold),
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
    ...buildReorderStatusStages(threshold),
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
          $ifNull: [
            '$branch.codeName',
            { $ifNull: ['$branch.name', { $ifNull: ['$branch.address', 'Unassigned Branch'] }] },
          ],
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
    ...buildReorderStatusStages(threshold),
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

  const branches = branchResults.map((b) => ({
    branchId: b.branchId ? b.branchId.toString() : null,
    branchName: b.branchName,
    totalStock: b.totalStock,
    totalRetailValuation: roundToTwo(b.totalRetailValuation),
    itemCount: b.itemCount,
    lowStockCount: b.lowStockCount,
    reorderTriggeredCount: b.reorderTriggeredCount,
  }));

  const categories = categoryResults.map((c) => ({
    category: c._id || 'Uncategorized',
    totalStock: c.totalStock,
    totalRetailValuation: roundToTwo(c.totalRetailValuation),
    itemCount: c.itemCount,
  }));

  return {
    success: true,
    data: {
      currency: REPORTING_CURRENCY,
      snapshotTimestamp: new Date().toISOString(),
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
        byBranch: branches,
        byCategory: categories,
      },
    },
  };
}

/**
 * Retrieves paginated list of inventory stock records with live reorder states.
 *
 * @param {Object} options
 * @param {string|null} [options.branchId]
 * @param {string|null} [options.category]
 * @param {string|null} [options.reorderStatus]
 * @param {number} [options.page=1]
 * @param {number} [options.limit=20]
 * @param {string} [options.sortBy='quantity']
 * @param {string} [options.sortOrder='asc']
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
  sortOrder = 'asc',
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
    ...buildReorderStatusStages(threshold),
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

  const isTruncated = isExport && total > numericLimit;
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
        isTruncated,
        totalMatching: total,
        exportedCount: items.length,
      },
    },
  };
}

module.exports = {
  getInventoryReport,
  getInventoryItemsList,
};
