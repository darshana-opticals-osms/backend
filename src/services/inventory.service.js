const mongoose = require('mongoose');
const Branch = require('../models/branch.model');
const Inventory = require('../models/inventory.model');
const { NotFoundError, ValidationError } = require('../errors/AppError');

const INVALID_BRANCH_REFERENCE = 'INVALID_BRANCH_REFERENCE';
const INVALID_INVENTORY_REFERENCE = 'INVALID_INVENTORY_REFERENCE';

const INVENTORY_UPDATE_FIELDS = ['branchId', 'itemName', 'category', 'brand', 'price'];

function validateInventoryId(inventoryId) {
  if (!mongoose.isValidObjectId(inventoryId)) {
    throw new ValidationError(
      'Inventory reference is invalid.',
      { field: 'inventoryId' },
      INVALID_INVENTORY_REFERENCE
    );
  }
}

async function validateBranch(branchId) {
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
}

async function createInventory(inventoryInput = {}) {
  const { branchId } = inventoryInput;

  await validateBranch(branchId);

  return Inventory.create(inventoryInput);
}

async function getBranchInventory(branchId) {
  await validateBranch(branchId);

  return Inventory.find({ branchId });
}

async function updateInventory(inventoryId, inventoryInput = {}) {
  validateInventoryId(inventoryId);

  if (
    !inventoryInput ||
    typeof inventoryInput !== 'object' ||
    Array.isArray(inventoryInput) ||
    Object.keys(inventoryInput).length === 0
  ) {
    throw new ValidationError('Inventory update data is required.');
  }

  const unsupportedFields = Object.keys(inventoryInput).filter(
    (field) => !INVENTORY_UPDATE_FIELDS.includes(field)
  );

  if (unsupportedFields.length > 0) {
    throw new ValidationError(`Unsupported inventory fields: ${unsupportedFields.join(', ')}.`);
  }

  if (Object.prototype.hasOwnProperty.call(inventoryInput, 'branchId')) {
    await validateBranch(inventoryInput.branchId);
  }

  const updatedInventory = await Inventory.findByIdAndUpdate(
    inventoryId,
    { $set: inventoryInput },
    {
      new: true,
      runValidators: true,
      context: 'query',
    }
  );

  if (!updatedInventory) {
    throw new NotFoundError('Inventory item not found.');
  }

  return updatedInventory;
}

async function updateInventoryQuantity(inventoryId, quantity) {
  validateInventoryId(inventoryId);

  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) {
    throw new ValidationError('Quantity must be a non-negative number.', {
      field: 'quantity',
    });
  }

  const updatedInventory = await Inventory.findByIdAndUpdate(
    inventoryId,
    { $set: { quantity } },
    {
      new: true,
      runValidators: true,
      context: 'query',
    }
  );

  if (!updatedInventory) {
    throw new NotFoundError('Inventory item not found.');
  }

  return updatedInventory;
}

module.exports = {
  INVALID_BRANCH_REFERENCE,
  INVALID_INVENTORY_REFERENCE,
  INVENTORY_UPDATE_FIELDS,
  createInventory,
  getBranchInventory,
  updateInventory,
  updateInventoryQuantity,
};
