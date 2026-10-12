const mongoose = require('mongoose');
const Branch = require('../models/branch.model');
const Inventory = require('../models/inventory.model');
const { NotFoundError, ValidationError, ConflictError } = require('../errors/AppError');

const reorderAlertService = require('./reorderAlert.service');

const INVALID_BRANCH_REFERENCE = 'INVALID_BRANCH_REFERENCE';
const INVALID_INVENTORY_REFERENCE = 'INVALID_INVENTORY_REFERENCE';

const INVENTORY_UPDATE_FIELDS = ['branchId', 'itemName', 'category', 'brand', 'price', 'imageUrl'];

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

/**
 * Helper to execute an operation inside a MongoDB transaction when supported by the cluster,
 * falling back to an explicit compensation/recovery mechanism on standalone deployments.
 */
async function executeWithTransactionOrRecovery(transactionFn, recoveryFn) {
  const isDbConnected = mongoose.connection && mongoose.connection.readyState === 1;

  if (isDbConnected) {
    let session = null;
    try {
      session = await mongoose.startSession();
      if (session && typeof session.withTransaction === 'function') {
        let result;
        await session.withTransaction(async () => {
          result = await transactionFn(session);
        });
        return result;
      }
    } catch (err) {
      const isStandaloneUnsupported =
        (err.name === 'MongoServerError' &&
          (err.code === 20 ||
            err.codeName === 'IllegalOperation' ||
            (err.message && err.message.includes('Transaction numbers are only allowed')))) ||
        (err.message && err.message.includes('replica set'));

      if (!isStandaloneUnsupported) {
        throw err;
      }
    } finally {
      if (session && session.endSession) {
        await session.endSession();
      }
    }
  }

  return recoveryFn();
}

async function createInventory(inventoryInput = {}, externalSession = null) {
  const { branchId } = inventoryInput;

  await validateBranch(branchId);

  if (externalSession) {
    const [createdInventory] = await Inventory.create([inventoryInput], {
      session: externalSession,
    });
    await reorderAlertService.evaluateReorderAlert(createdInventory, null, externalSession);
    return createdInventory;
  }

  return executeWithTransactionOrRecovery(
    async (session) => {
      const [createdInventory] = await Inventory.create([inventoryInput], { session });
      await reorderAlertService.evaluateReorderAlert(createdInventory, null, session);
      return createdInventory;
    },
    async () => {
      const createdInventory = await Inventory.create(inventoryInput);
      try {
        await reorderAlertService.evaluateReorderAlert(createdInventory);
        return createdInventory;
      } catch (alertError) {
        if (createdInventory && createdInventory._id && Inventory.deleteOne) {
          await Inventory.deleteOne({ _id: createdInventory._id });
        }
        throw alertError;
      }
    }
  );
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

async function updateInventoryQuantity(inventoryId, quantity, externalSession = null) {
  validateInventoryId(inventoryId);

  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) {
    throw new ValidationError('Quantity must be a non-negative number.', {
      field: 'quantity',
    });
  }

  if (externalSession) {
    const updatedInventory = await Inventory.findByIdAndUpdate(
      inventoryId,
      { $set: { quantity } },
      {
        new: true,
        runValidators: true,
        context: 'query',
        session: externalSession,
      }
    );

    if (!updatedInventory) {
      throw new NotFoundError('Inventory item not found.');
    }

    await reorderAlertService.evaluateReorderAlert(updatedInventory, null, externalSession);
    return updatedInventory;
  }

  return executeWithTransactionOrRecovery(
    async (session) => {
      const updatedInventory = await Inventory.findByIdAndUpdate(
        inventoryId,
        { $set: { quantity } },
        {
          new: true,
          runValidators: true,
          context: 'query',
          session,
        }
      );

      if (!updatedInventory) {
        throw new NotFoundError('Inventory item not found.');
      }

      await reorderAlertService.evaluateReorderAlert(updatedInventory, null, session);
      return updatedInventory;
    },
    async () => {
      const currentDoc = await Inventory.findById(inventoryId);
      const previousQuantity = currentDoc ? currentDoc.quantity : null;

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

      try {
        await reorderAlertService.evaluateReorderAlert(updatedInventory);
        return updatedInventory;
      } catch (alertError) {
        if (previousQuantity !== null) {
          await Inventory.findByIdAndUpdate(
            inventoryId,
            { $set: { quantity: previousQuantity } },
            {
              new: true,
              runValidators: true,
              context: 'query',
            }
          );
        }
        throw alertError;
      }
    }
  );
}

/**
 * Authoritative stock deduction helper used by checkout and orders.
 * Safely decrements stock preventing negative quantities and triggers reorder evaluation.
 * @param {Array<{ inventoryId: string|mongoose.Types.ObjectId, quantity: number }>} items
 * @param {import('mongoose').ClientSession|null} [session=null]
 * @returns {Promise<Array<object>>} Updated inventory records
 */
async function deductInventoryStock(items, session = null) {
  const updatedRecords = [];

  for (const item of items) {
    const { inventoryId, quantity } = item;
    validateInventoryId(inventoryId);

    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new ValidationError('Deduction quantity must be a positive number.');
    }

    const updated = await Inventory.findOneAndUpdate(
      { _id: inventoryId, quantity: { $gte: quantity } },
      { $inc: { quantity: -quantity } },
      { new: true, session }
    );

    if (!updated) {
      const exists = await Inventory.findById(inventoryId).session(session);
      if (!exists) {
        throw new NotFoundError('Inventory item not found.');
      }
      throw new ConflictError('Insufficient Inventory stock.');
    }

    await reorderAlertService.evaluateReorderAlert(updated, null, session);
    updatedRecords.push(updated);
  }

  return updatedRecords;
}

module.exports = {
  INVALID_BRANCH_REFERENCE,
  INVALID_INVENTORY_REFERENCE,
  INVENTORY_UPDATE_FIELDS,
  createInventory,
  getBranchInventory,
  updateInventory,
  updateInventoryQuantity,
  deductInventoryStock,
};
