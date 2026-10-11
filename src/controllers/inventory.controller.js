const catchAsync = require('../utils/catchAsync');
const {
  createInventory,
  getBranchInventory,
  updateInventory,
  updateInventoryQuantity,
} = require('../services/inventory.service');

const createInventoryItem = catchAsync(async (req, res) => {
  const inventory = await createInventory(req.body);

  return res.status(201).json({
    success: true,
    data: inventory,
  });
});

const getInventoryByBranch = catchAsync(async (req, res) => {
  const inventory = await getBranchInventory(req.params.branchId);

  return res.status(200).json({
    success: true,
    data: inventory,
  });
});

const updateInventoryItem = catchAsync(async (req, res) => {
  const inventory = await updateInventory(req.params.id, req.body);

  return res.status(200).json({
    success: true,
    data: inventory,
  });
});

const { getActiveReorderAlerts } = require('../services/reorderAlert.service');

const updateInventoryItemQuantity = catchAsync(async (req, res) => {
  const inventory = await updateInventoryQuantity(req.params.id, req.body.quantity);

  return res.status(200).json({
    success: true,
    data: inventory,
  });
});

const getReorderAlerts = catchAsync(async (req, res) => {
  const branchId = req.params.branchId || req.query.branchId || null;
  const { page, limit } = req.query;

  const result = await getActiveReorderAlerts({ branchId, page, limit });

  return res.status(200).json({
    success: true,
    data: result,
  });
});

module.exports = {
  createInventoryItem,
  getInventoryByBranch,
  updateInventoryItem,
  updateInventoryItemQuantity,
  getReorderAlerts,
};

