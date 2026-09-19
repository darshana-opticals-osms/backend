const mongoose = require('mongoose');
const Branch = require('../models/branch.model');
const Inventory = require('../models/inventory.model');
const { ValidationError } = require('../errors/AppError');

const INVALID_BRANCH_REFERENCE = 'INVALID_BRANCH_REFERENCE';

async function createInventory(inventoryInput = {}) {
  const { branchId } = inventoryInput;

  if (!mongoose.isValidObjectId(branchId)) {
    throw new ValidationError(
      'Inventory must reference a valid branch.',
      { field: 'branchId' },
      INVALID_BRANCH_REFERENCE
    );
  }

  const branchExists = await Branch.exists({ _id: branchId });

  if (!branchExists) {
    throw new ValidationError(
      'Inventory must reference an existing branch.',
      { field: 'branchId' },
      INVALID_BRANCH_REFERENCE
    );
  }

  return Inventory.create(inventoryInput);
}

module.exports = {
  INVALID_BRANCH_REFERENCE,
  createInventory,
};
