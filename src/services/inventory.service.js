const mongoose = require('mongoose');
const Branch = require('../models/branch.model');
const Inventory = require('../models/inventory.model');
const { NotFoundError, ValidationError, ConflictError } = require('../errors/AppError');

const reorderAlertService = require('./reorderAlert.service');
const { deleteImage } = require('./imageUpload.service');
const { ImageUpload, IMAGE_UPLOAD_STATUS } = require('../models/imageUpload.model');
const { sanitizeLogMessage } = require('../utils/sanitizer');

const INVALID_BRANCH_REFERENCE = 'INVALID_BRANCH_REFERENCE';
const INVALID_INVENTORY_REFERENCE = 'INVALID_INVENTORY_REFERENCE';
const INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK';

const INVENTORY_UPDATE_FIELDS = [
  'branchId',
  'itemName',
  'category',
  'brand',
  'price',
  'imageUrl',
  'imagePublicId',
];

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

/**
 * Validates that an image metadata reference originates from an approved upload,
 * belongs to the authorized branch, and is not already claimed by another inventory item.
 *
 * @param {object} params
 * @param {string} params.imagePublicId - Cloudinary publicId to validate.
 * @param {string} [params.imageUrl] - Corresponding image URL.
 * @param {string} [params.branchId] - Branch context for ownership check.
 * @param {string} [params.currentInventoryId] - Current inventory item ID if updating.
 * @returns {Promise<object|null>} The matched ImageUpload document or null.
 */
async function validateAndClaimImageUpload({
  imagePublicId,
  imageUrl,
  branchId,
  currentInventoryId = null,
}) {
  if (!imagePublicId && !imageUrl) {
    return null;
  }

  if (imageUrl && !imagePublicId) {
    throw new ValidationError(
      'imagePublicId is required when imageUrl is provided.',
      { field: 'imagePublicId' },
      'MISSING_IMAGE_PUBLIC_ID'
    );
  }

  if (imagePublicId && !imageUrl) {
    throw new ValidationError(
      'imageUrl is required when imagePublicId is provided.',
      { field: 'imageUrl' },
      'MISSING_IMAGE_URL'
    );
  }

  if (!imagePublicId.startsWith('osms/inventory/')) {
    throw new ValidationError(
      'imagePublicId must belong to the osms/inventory/ namespace.',
      { field: 'imagePublicId' },
      'INVALID_ASSET_NAMESPACE'
    );
  }

  const uploadRecord = await ImageUpload.findOne({ publicId: imagePublicId });
  if (!uploadRecord) {
    throw new ValidationError(
      'Image metadata is untrusted or does not originate from an approved upload.',
      { field: 'imagePublicId' },
      'UNTRUSTED_IMAGE_METADATA'
    );
  }

  if (uploadRecord.imageUrl !== imageUrl) {
    throw new ValidationError(
      'imageUrl does not match the approved upload record.',
      { field: 'imageUrl' },
      'IMAGE_METADATA_MISMATCH'
    );
  }

  if (
    uploadRecord.branchId &&
    branchId &&
    uploadRecord.branchId.toString() !== branchId.toString()
  ) {
    throw new ValidationError(
      'Image does not belong to the authorized branch.',
      { field: 'imagePublicId' },
      'UNAUTHORIZED_IMAGE_OWNERSHIP'
    );
  }

  if (
    uploadRecord.status !== IMAGE_UPLOAD_STATUS.PENDING &&
    !(
      uploadRecord.status === IMAGE_UPLOAD_STATUS.ATTACHED &&
      currentInventoryId &&
      uploadRecord.inventoryId?.toString() === currentInventoryId.toString()
    )
  ) {
    if (uploadRecord.status === IMAGE_UPLOAD_STATUS.ATTACHED) {
      throw new ConflictError('Image is already associated with another inventory item.');
    }
    throw new ValidationError(
      `Image is in invalid state (${uploadRecord.status}) and cannot be attached.`,
      { field: 'imagePublicId' },
      'INVALID_IMAGE_STATUS'
    );
  }

  return uploadRecord;
}

/**
 * Deletes a Cloudinary asset safely and updates the ImageUpload tracking record status.
 *
 * @param {string} publicId - Cloudinary publicId to delete.
 */
async function safeDeleteAssetWithTracking(publicId) {
  if (!publicId) return;

  try {
    const deleteResult = await deleteImage(publicId);
    if (deleteResult && deleteResult.success) {
      await ImageUpload.updateOne(
        { publicId },
        {
          $set: { status: IMAGE_UPLOAD_STATUS.DELETED, inventoryId: null },
          $unset: { lastCleanupError: 1 },
        }
      );
    } else {
      const safeError = sanitizeLogMessage(
        deleteResult?.result || 'Provider deletion unsuccessful'
      );
      console.warn(`Image cleanup unsuccessful for ${publicId}:`, safeError);
      await ImageUpload.updateOne(
        { publicId },
        {
          $set: { status: IMAGE_UPLOAD_STATUS.FAILED_CLEANUP, lastCleanupError: safeError },
          $inc: { cleanupAttempts: 1 },
        }
      );
    }
  } catch (cleanupErr) {
    const safeError = sanitizeLogMessage(cleanupErr?.message || 'Provider deletion failed');
    console.warn(`Image cleanup failed for ${publicId}:`, safeError);
    await ImageUpload.updateOne(
      { publicId },
      {
        $set: { status: IMAGE_UPLOAD_STATUS.FAILED_CLEANUP, lastCleanupError: safeError },
        $inc: { cleanupAttempts: 1 },
      }
    );
  }
}

async function createInventory(inventoryInput = {}, externalSession = null) {
  let uploadRecord = null;
  try {
    const { branchId, imagePublicId, imageUrl } = inventoryInput;

    await validateBranch(branchId);

    if (imagePublicId || imageUrl) {
      uploadRecord = await validateAndClaimImageUpload({
        imagePublicId,
        imageUrl,
        branchId,
      });
    }

    let createdInventory;
    if (externalSession) {
      const [created] = await Inventory.create([inventoryInput], {
        session: externalSession,
      });
      createdInventory = created;
      await reorderAlertService.evaluateReorderAlert(createdInventory, null, externalSession);

      if (uploadRecord) {
        await ImageUpload.updateOne(
          { _id: uploadRecord._id },
          { $set: { status: IMAGE_UPLOAD_STATUS.ATTACHED, inventoryId: createdInventory._id } },
          { session: externalSession }
        );
      }
    } else {
      createdInventory = await executeWithTransactionOrRecovery(
        async (session) => {
          const [created] = await Inventory.create([inventoryInput], { session });
          await reorderAlertService.evaluateReorderAlert(created, null, session);
          if (uploadRecord) {
            await ImageUpload.updateOne(
              { _id: uploadRecord._id },
              { $set: { status: IMAGE_UPLOAD_STATUS.ATTACHED, inventoryId: created._id } },
              { session }
            );
          }
          return created;
        },
        async () => {
          const created = await Inventory.create(inventoryInput);
          try {
            await reorderAlertService.evaluateReorderAlert(created);
            if (uploadRecord) {
              await ImageUpload.updateOne(
                { _id: uploadRecord._id },
                { $set: { status: IMAGE_UPLOAD_STATUS.ATTACHED, inventoryId: created._id } }
              );
            }
            return created;
          } catch (recoveryError) {
            if (created && created._id && Inventory.deleteOne) {
              await Inventory.deleteOne({ _id: created._id });
            }
            throw recoveryError;
          }
        }
      );
    }

    return createdInventory;
  } catch (createError) {
    if (uploadRecord && uploadRecord.publicId) {
      await safeDeleteAssetWithTracking(uploadRecord.publicId);
    }
    throw createError;
  }
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

  let existingInventory = null;
  const isImageMutation =
    Object.prototype.hasOwnProperty.call(inventoryInput, 'imageUrl') ||
    Object.prototype.hasOwnProperty.call(inventoryInput, 'imagePublicId');

  if (isImageMutation) {
    existingInventory = await Inventory.findById(inventoryId);
    if (!existingInventory) {
      throw new NotFoundError('Inventory item not found.');
    }
  }

  let newUploadRecord = null;
  if (isImageMutation) {
    const targetPublicId =
      inventoryInput.imagePublicId !== undefined
        ? inventoryInput.imagePublicId
        : existingInventory?.imagePublicId;
    const targetUrl =
      inventoryInput.imageUrl !== undefined ? inventoryInput.imageUrl : existingInventory?.imageUrl;

    const isImageChanged =
      targetPublicId !== existingInventory?.imagePublicId ||
      targetUrl !== existingInventory?.imageUrl;

    if (isImageChanged) {
      newUploadRecord = await validateAndClaimImageUpload({
        imagePublicId: targetPublicId,
        imageUrl: targetUrl,
        branchId: inventoryInput.branchId || existingInventory?.branchId,
        currentInventoryId: existingInventory?._id,
      });
    }
  }

  let updatedInventory;
  try {
    updatedInventory = await executeWithTransactionOrRecovery(
      async (session) => {
        const updated = await Inventory.findByIdAndUpdate(
          inventoryId,
          { $set: inventoryInput },
          {
            new: true,
            runValidators: true,
            context: 'query',
            session,
          }
        );

        if (!updated) {
          throw new NotFoundError('Inventory item not found.');
        }

        if (newUploadRecord) {
          await ImageUpload.updateOne(
            { _id: newUploadRecord._id },
            { $set: { status: IMAGE_UPLOAD_STATUS.ATTACHED, inventoryId: updated._id } },
            { session }
          );
        }

        return updated;
      },
      async () => {
        const originalValues = {
          itemName: existingInventory?.itemName,
          category: existingInventory?.category,
          brand: existingInventory?.brand,
          price: existingInventory?.price,
          branchId: existingInventory?.branchId,
          imageUrl: existingInventory?.imageUrl,
          imagePublicId: existingInventory?.imagePublicId,
        };

        const updated = await Inventory.findByIdAndUpdate(
          inventoryId,
          { $set: inventoryInput },
          {
            new: true,
            runValidators: true,
            context: 'query',
          }
        );

        if (!updated) {
          throw new NotFoundError('Inventory item not found.');
        }

        try {
          if (newUploadRecord) {
            await ImageUpload.updateOne(
              { _id: newUploadRecord._id },
              { $set: { status: IMAGE_UPLOAD_STATUS.ATTACHED, inventoryId: updated._id } }
            );
          }
          return updated;
        } catch (trackingError) {
          if (isImageMutation && existingInventory) {
            await Inventory.findByIdAndUpdate(
              inventoryId,
              { $set: originalValues },
              { context: 'query' }
            );
          }
          throw trackingError;
        }
      }
    );

    // Failure-safe replacement sequencing:
    // Only after new Inventory metadata is safely persisted, cleanup previous provider asset
    if (
      existingInventory &&
      existingInventory.imagePublicId &&
      inventoryInput.imagePublicId !== undefined &&
      existingInventory.imagePublicId !== updatedInventory.imagePublicId
    ) {
      await safeDeleteAssetWithTracking(existingInventory.imagePublicId);
    }

    return updatedInventory;
  } catch (updateError) {
    // Immediate compensation only if a verified new upload was claimed by this operation
    if (newUploadRecord && newUploadRecord.publicId) {
      await safeDeleteAssetWithTracking(newUploadRecord.publicId);
    }
    throw updateError;
  }
}

async function removeInventoryImage(inventoryId) {
  validateInventoryId(inventoryId);

  const inventory = await Inventory.findById(inventoryId);
  if (!inventory) {
    throw new NotFoundError('Inventory item not found.');
  }

  const previousPublicId = inventory.imagePublicId;

  // Clear Inventory image metadata
  inventory.imageUrl = null;
  inventory.imagePublicId = null;
  await inventory.save();

  // Safely delete Cloudinary asset using trusted persisted imagePublicId
  if (previousPublicId) {
    await safeDeleteAssetWithTracking(previousPublicId);
  }

  return inventory;
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
      throw new ConflictError('Insufficient Inventory stock.', null, INSUFFICIENT_STOCK);
    }

    await reorderAlertService.evaluateReorderAlert(updated, null, session);
    updatedRecords.push(updated);
  }

  return updatedRecords;
}

module.exports = {
  INVALID_BRANCH_REFERENCE,
  INVALID_INVENTORY_REFERENCE,
  INSUFFICIENT_STOCK,
  INVENTORY_UPDATE_FIELDS,
  createInventory,
  getBranchInventory,
  updateInventory,
  removeInventoryImage,
  updateInventoryQuantity,
  deductInventoryStock,
};
