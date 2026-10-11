const mongoose = require('mongoose');
const Inventory = require('../models/inventory.model');
const { ROLE_VALUES } = require('../constants/roles');
const { ForbiddenError, NotFoundError } = require('../errors/AppError');

const authorizeCreateInventoryBranch = (req, _res, next) => {
  const { role, branchId } = req.auth || {};
  const requestedBranchId = req.body && req.body.branchId;

  if (role === ROLE_VALUES.BRANCH_MANAGER) {
    if (!branchId || !requestedBranchId || branchId.toString() !== requestedBranchId.toString()) {
      return next(
        new ForbiddenError('Branch Managers may only create inventory for their assigned branch.')
      );
    }
  }

  return next();
};

const authorizeBranchInventoryAccess = (req, _res, next) => {
  const { role, branchId } = req.auth || {};
  const targetBranchId = req.params && req.params.branchId;

  if (role === ROLE_VALUES.BRANCH_MANAGER) {
    if (!branchId || !targetBranchId || branchId.toString() !== targetBranchId.toString()) {
      return next(
        new ForbiddenError('Branch Managers may only view inventory for their assigned branch.')
      );
    }
  }

  return next();
};

const authorizeInventoryItemBranch = async (req, _res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return next();
    }

    const item = await Inventory.findById(id);

    if (!item) {
      return next(new NotFoundError('Inventory item not found.'));
    }

    const { role, branchId } = req.auth || {};

    if (role === ROLE_VALUES.BRANCH_MANAGER) {
      if (!branchId || item.branchId.toString() !== branchId.toString()) {
        return next(
          new ForbiddenError('Branch Managers may only modify inventory for their assigned branch.')
        );
      }

      if (req.body && req.body.branchId && req.body.branchId.toString() !== branchId.toString()) {
        return next(
          new ForbiddenError('Branch Managers may not reassign inventory to another branch.')
        );
      }
    }

    req.inventoryItem = item;
    return next();
  } catch (err) {
    return next(err);
  }
};

const authorizeReorderAlertsBranch = (req, _res, next) => {
  const { role, branchId } = req.auth || {};

  if (role === ROLE_VALUES.BRANCH_MANAGER) {
    if (req.query && req.query.branchId) {
      if (!branchId || req.query.branchId.toString() !== branchId.toString()) {
        return next(
          new ForbiddenError('Branch Managers may only view alerts for their assigned branch.')
        );
      }
    } else if (branchId) {
      req.query = req.query || {};
      req.query.branchId = branchId.toString();
    }
  }

  return next();
};

const authorizeReorderAlertsBranchParam = (req, _res, next) => {
  const { role, branchId } = req.auth || {};
  const targetBranchId = req.params && req.params.branchId;

  if (role === ROLE_VALUES.BRANCH_MANAGER) {
    if (!branchId || !targetBranchId || branchId.toString() !== targetBranchId.toString()) {
      return next(
        new ForbiddenError('Branch Managers may only view alerts for their assigned branch.')
      );
    }
  }

  return next();
};

module.exports = {
  authorizeCreateInventoryBranch,
  authorizeBranchInventoryAccess,
  authorizeInventoryItemBranch,
  authorizeReorderAlertsBranch,
  authorizeReorderAlertsBranchParam,
};
