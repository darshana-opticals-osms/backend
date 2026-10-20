const catchAsync = require('../utils/catchAsync');
const { provisionStaff } = require('../services/staffProvisioning.service');
const {
  listStaffMembers,
  getStaffById,
  updateStaffProfile,
  updateStaffRole,
  updateStaffBranch,
  updateStaffStatus,
} = require('../services/staffManagement.service');

const createStaff = catchAsync(async (req, res) => {
  const staff = await provisionStaff(req.body);

  return res.status(201).json({
    success: true,
    data: staff,
  });
});

const listStaffHandler = catchAsync(async (req, res) => {
  const result = await listStaffMembers(req.query);

  return res.status(200).json({
    success: true,
    data: result.staff,
    pagination: result.pagination,
  });
});

const getStaffByIdHandler = catchAsync(async (req, res) => {
  const staff = await getStaffById(req.params.id);

  return res.status(200).json({
    success: true,
    data: staff,
  });
});

const updateStaffProfileHandler = catchAsync(async (req, res) => {
  const staff = await updateStaffProfile(req.params.id, req.body, req.auth);

  return res.status(200).json({
    success: true,
    data: staff,
  });
});

const updateStaffRoleHandler = catchAsync(async (req, res) => {
  const staff = await updateStaffRole(req.params.id, req.body && req.body.role, req.auth);

  return res.status(200).json({
    success: true,
    data: staff,
  });
});

const updateStaffBranchHandler = catchAsync(async (req, res) => {
  const branchId = req.body && req.body.branchId !== undefined ? req.body.branchId : null;
  const staff = await updateStaffBranch(req.params.id, branchId, req.auth);

  return res.status(200).json({
    success: true,
    data: staff,
  });
});

const updateStaffStatusHandler = catchAsync(async (req, res) => {
  const statusValue =
    req.body && req.body.isActive !== undefined ? req.body.isActive : req.body && req.body.status;
  const staff = await updateStaffStatus(req.params.id, statusValue, req.auth);

  return res.status(200).json({
    success: true,
    data: staff,
  });
});

module.exports = {
  createStaff,
  listStaffHandler,
  getStaffByIdHandler,
  updateStaffProfileHandler,
  updateStaffRoleHandler,
  updateStaffBranchHandler,
  updateStaffStatusHandler,
};
