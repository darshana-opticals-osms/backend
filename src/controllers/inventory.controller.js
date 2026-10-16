const catchAsync = require('../utils/catchAsync');
const auditService = require('../services/audit.service');
const {
  createInventory,
  getBranchInventory,
  updateInventory,
  updateInventoryQuantity,
  removeInventoryImage: removeInventoryImageService,
} = require('../services/inventory.service');
const { uploadImage } = require('../services/imageUpload.service');
const { ImageUpload, IMAGE_UPLOAD_STATUS } = require('../models/imageUpload.model');

const uploadInventoryImage = catchAsync(async (req, res) => {
  const result = await uploadImage(req.file);

  const authUser = req.auth || req.user || {};
  await ImageUpload.create({
    publicId: result.imagePublicId,
    imageUrl: result.imageUrl,
    uploadedBy: authUser.userId || authUser.id || authUser._id,
    branchId: authUser.branchId || null,
    status: IMAGE_UPLOAD_STATUS.PENDING,
  });

  return res.status(200).json({
    success: true,
    data: {
      imageUrl: result.imageUrl,
      imagePublicId: result.imagePublicId,
    },
  });
});

const removeInventoryImage = catchAsync(async (req, res) => {
  const inventory = await removeInventoryImageService(req.params.id);

  return res.status(200).json({
    success: true,
    data: inventory,
    message: 'Inventory image removed successfully.',
  });
});

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

const {
  getActiveReorderAlerts,
  getGlobalReorderThreshold,
  setGlobalReorderThreshold,
} = require('../services/reorderAlert.service');

const updateInventoryItemQuantity = catchAsync(async (req, res) => {
  const authUser = req.user || req.auth;
  const actor =
    authUser && (authUser.userId || authUser.id || authUser._id)
      ? auditService.buildUserActor({
          userId: authUser.userId || authUser.id || authUser._id,
          role: authUser.role,
        })
      : null;
  const correlationId = req.headers ? req.headers['x-correlation-id'] : null;

  const inventory = await updateInventoryQuantity(req.params.id, req.body.quantity, null, {
    actor,
    correlationId,
  });

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

const getReorderThreshold = catchAsync(async (req, res) => {
  const threshold = await getGlobalReorderThreshold();

  return res.status(200).json({
    success: true,
    data: { threshold },
  });
});

const updateReorderThreshold = catchAsync(async (req, res) => {
  const { threshold } = req.body;
  const authUser = req.user || req.auth;
  const updatedBy = authUser ? authUser.userId || authUser.id || authUser._id : null;
  const actor =
    authUser && (authUser.userId || authUser.id || authUser._id)
      ? auditService.buildUserActor({
          userId: authUser.userId || authUser.id || authUser._id,
          role: authUser.role,
        })
      : null;
  const correlationId = req.headers ? req.headers['x-correlation-id'] : null;

  const result = await setGlobalReorderThreshold(threshold, updatedBy, null, {
    actor,
    correlationId,
  });

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
  getReorderThreshold,
  updateReorderThreshold,
  uploadInventoryImage,
  removeInventoryImage,
};
