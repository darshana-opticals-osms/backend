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

const updateInventoryItemQuantity = catchAsync(async (req, res) => {
  const inventory = await updateInventoryQuantity(req.params.id, req.body.quantity);

  return res.status(200).json({
    success: true,
    data: inventory,
  });
});

module.exports = {
  createInventoryItem,
  getInventoryByBranch,
  updateInventoryItem,
  updateInventoryItemQuantity,
};
