const mongoose = require('mongoose');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const reorderAlertService = require('../../src/services/reorderAlert.service');
const {
  INVALID_BRANCH_REFERENCE,
  INVALID_INVENTORY_REFERENCE,
  createInventory,
  getBranchInventory,
  updateInventory,
  removeInventoryImage,
  updateInventoryQuantity,
  deductInventoryStock,
} = require('../../src/services/inventory.service');
const { deleteImage } = require('../../src/services/imageUpload.service');
const { ImageUpload } = require('../../src/models/imageUpload.model');

jest.mock('../../src/services/imageUpload.service', () => ({
  uploadImage: jest.fn(),
  deleteImage: jest.fn().mockResolvedValue({ success: true, result: 'ok' }),
  INVENTORY_IMAGE_FOLDER: 'osms/inventory',
}));

jest.mock('../../src/services/reorderAlert.service', () => ({
  evaluateReorderAlert: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/models/branch.model', () => ({
  exists: jest.fn(),
}));

jest.mock('../../src/models/inventory.model', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findById: jest.fn(),
}));

jest.mock('../../src/models/imageUpload.model', () => ({
  ImageUpload: {
    findOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  },
  IMAGE_UPLOAD_STATUS: {
    PENDING: 'PENDING',
    ATTACHED: 'ATTACHED',
    FAILED_CLEANUP: 'FAILED_CLEANUP',
    DELETED: 'DELETED',
  },
}));

describe('Inventory service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ImageUpload.findOne.mockImplementation(async ({ publicId }) => ({
      _id: new mongoose.Types.ObjectId(),
      publicId,
      imageUrl:
        publicId === 'osms/inventory/new'
          ? 'https://res.cloudinary.com/test/image/upload/v2/osms/inventory/new.jpg'
          : 'https://res.cloudinary.com/test-cloud/image/upload/sample.jpg',
      status: 'PENDING',
    }));
  });

  describe('createInventory', () => {
    it('should create inventory when the branch exists', async () => {
      const branchId = new mongoose.Types.ObjectId().toString();

      const inventoryInput = {
        branchId,
        itemName: 'Classic Frame',
        category: 'Men',
        brand: 'Ray-Ban',
        price: 12500,
        quantity: 5,
      };

      const createdInventory = {
        _id: new mongoose.Types.ObjectId(),
        ...inventoryInput,
      };

      Branch.exists.mockResolvedValue({ _id: branchId });
      Inventory.create.mockResolvedValue(createdInventory);

      const result = await createInventory(inventoryInput);

      expect(Branch.exists).toHaveBeenCalledWith({ _id: branchId });
      expect(Inventory.create).toHaveBeenCalledWith(inventoryInput);
      expect(reorderAlertService.evaluateReorderAlert).toHaveBeenCalledWith(createdInventory);
      expect(result).toEqual(createdInventory);
    });

    it('should reject inventory creation when the branch does not exist', async () => {
      const branchId = new mongoose.Types.ObjectId().toString();

      Branch.exists.mockResolvedValue(null);

      await expect(
        createInventory({
          branchId,
          itemName: 'Classic Frame',
          category: 'Men',
          brand: 'Ray-Ban',
          price: 12500,
          quantity: 5,
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        errorCode: INVALID_BRANCH_REFERENCE,
      });

      expect(Inventory.create).not.toHaveBeenCalled();
    });
  });

  describe('getBranchInventory', () => {
    it('should return inventory records for an existing branch', async () => {
      const branchId = new mongoose.Types.ObjectId().toString();

      const inventoryItems = [
        {
          _id: new mongoose.Types.ObjectId(),
          branchId,
          itemName: 'Frame A',
        },
        {
          _id: new mongoose.Types.ObjectId(),
          branchId,
          itemName: 'Frame B',
        },
      ];

      Branch.exists.mockResolvedValue({ _id: branchId });
      Inventory.find.mockResolvedValue(inventoryItems);

      const result = await getBranchInventory(branchId);

      expect(Branch.exists).toHaveBeenCalledWith({ _id: branchId });
      expect(Inventory.find).toHaveBeenCalledWith({ branchId });
      expect(result).toEqual(inventoryItems);
    });

    it('should reject a malformed branch id', async () => {
      await expect(getBranchInventory('invalid-branch-id')).rejects.toMatchObject({
        statusCode: 422,
        errorCode: INVALID_BRANCH_REFERENCE,
      });

      expect(Branch.exists).not.toHaveBeenCalled();
      expect(Inventory.find).not.toHaveBeenCalled();
    });
  });

  describe('updateInventory', () => {
    it('should update permitted inventory fields', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();

      const updateInput = {
        itemName: 'Updated Frame',
        brand: 'Oakley',
        price: 15000,
      };

      const updatedInventory = {
        _id: inventoryId,
        ...updateInput,
        quantity: 4,
      };

      Inventory.findByIdAndUpdate.mockResolvedValue(updatedInventory);

      const result = await updateInventory(inventoryId, updateInput);

      expect(Inventory.findByIdAndUpdate).toHaveBeenCalledWith(
        inventoryId,
        { $set: updateInput },
        {
          new: true,
          runValidators: true,
          context: 'query',
        }
      );

      expect(result).toEqual(updatedInventory);
    });

    it('should validate a changed branch before updating inventory', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      const branchId = new mongoose.Types.ObjectId().toString();

      Branch.exists.mockResolvedValue({ _id: branchId });
      Inventory.findByIdAndUpdate.mockResolvedValue({
        _id: inventoryId,
        branchId,
      });

      await updateInventory(inventoryId, { branchId });

      expect(Branch.exists).toHaveBeenCalledWith({ _id: branchId });
    });

    it('should reject quantity through the general inventory update', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();

      await expect(
        updateInventory(inventoryId, {
          quantity: 10,
        })
      ).rejects.toMatchObject({
        statusCode: 422,
      });

      expect(Inventory.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('should reject an invalid inventory id', async () => {
      await expect(
        updateInventory('invalid-inventory-id', {
          price: 5000,
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        errorCode: INVALID_INVENTORY_REFERENCE,
      });

      expect(Inventory.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('should return not found when inventory does not exist', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();

      Inventory.findByIdAndUpdate.mockResolvedValue(null);

      await expect(
        updateInventory(inventoryId, {
          price: 5000,
        })
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('should delete previous image only after successfully persisting replacement image (AC15)', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      const existingItem = {
        _id: inventoryId,
        itemName: 'Frame',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/v1/osms/inventory/old.jpg',
        imagePublicId: 'osms/inventory/old',
      };
      const updatedItem = {
        _id: inventoryId,
        itemName: 'Frame',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/v2/osms/inventory/new.jpg',
        imagePublicId: 'osms/inventory/new',
      };

      Inventory.findById.mockResolvedValue(existingItem);
      Inventory.findByIdAndUpdate.mockResolvedValue(updatedItem);

      const result = await updateInventory(inventoryId, {
        imageUrl: updatedItem.imageUrl,
        imagePublicId: updatedItem.imagePublicId,
      });

      expect(result).toEqual(updatedItem);
      expect(deleteImage).toHaveBeenCalledWith('osms/inventory/old');
    });

    it('should not delete old image if replacement update fails, and should compensate new image (AC15, AC17)', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      const existingItem = {
        _id: inventoryId,
        imageUrl: 'https://res.cloudinary.com/test/image/upload/v1/osms/inventory/old.jpg',
        imagePublicId: 'osms/inventory/old',
      };

      Inventory.findById.mockResolvedValue(existingItem);
      Inventory.findByIdAndUpdate.mockRejectedValue(new Error('DB failure during update'));

      await expect(
        updateInventory(inventoryId, {
          imageUrl: 'https://res.cloudinary.com/test/image/upload/v2/osms/inventory/new.jpg',
          imagePublicId: 'osms/inventory/new',
        })
      ).rejects.toThrow('DB failure during update');

      // Old image must NOT have been deleted
      expect(deleteImage).not.toHaveBeenCalledWith('osms/inventory/old');
      // New orphaned image MUST be compensated
      expect(deleteImage).toHaveBeenCalledWith('osms/inventory/new');
    });
  });

  describe('removeInventoryImage', () => {
    it('should clear imageUrl and imagePublicId and delete provider asset (AC16)', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      const mockInventory = {
        _id: inventoryId,
        imageUrl: 'https://res.cloudinary.com/test/image/upload/v1/osms/inventory/item.jpg',
        imagePublicId: 'osms/inventory/item',
        save: jest.fn().mockResolvedValue(true),
      };

      Inventory.findById.mockResolvedValue(mockInventory);

      const result = await removeInventoryImage(inventoryId);

      expect(mockInventory.imageUrl).toBeNull();
      expect(mockInventory.imagePublicId).toBeNull();
      expect(mockInventory.save).toHaveBeenCalled();
      expect(deleteImage).toHaveBeenCalledWith('osms/inventory/item');
      expect(result).toBe(mockInventory);
    });

    it('should throw NotFoundError if item does not exist during removal', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      Inventory.findById.mockResolvedValue(null);

      await expect(removeInventoryImage(inventoryId)).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(deleteImage).not.toHaveBeenCalled();
    });
  });

  describe('updateInventoryQuantity', () => {
    it('should update inventory quantity successfully', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();

      const updatedInventory = {
        _id: inventoryId,
        itemName: 'Classic Frame',
        quantity: 8,
      };

      Inventory.findByIdAndUpdate.mockResolvedValue(updatedInventory);

      const result = await updateInventoryQuantity(inventoryId, 8);

      expect(Inventory.findByIdAndUpdate).toHaveBeenCalledWith(
        inventoryId,
        { $set: { quantity: 8 } },
        {
          new: true,
          runValidators: true,
          context: 'query',
        }
      );

      expect(result).toEqual(updatedInventory);
      expect(reorderAlertService.evaluateReorderAlert).toHaveBeenCalledWith(updatedInventory);
    });

    it('should reject a negative quantity', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();

      await expect(updateInventoryQuantity(inventoryId, -1)).rejects.toMatchObject({
        statusCode: 422,
      });

      expect(Inventory.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('should reject a non-numeric quantity', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();

      await expect(updateInventoryQuantity(inventoryId, '10')).rejects.toMatchObject({
        statusCode: 422,
      });

      expect(Inventory.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('should return not found when inventory does not exist', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();

      Inventory.findByIdAndUpdate.mockResolvedValue(null);

      await expect(updateInventoryQuantity(inventoryId, 5)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('should rollback quantity and rethrow when evaluateReorderAlert fails (recovery fallback)', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      const updatedInventory = {
        _id: inventoryId,
        itemName: 'Classic Frame',
        quantity: 2,
      };

      Inventory.findById.mockResolvedValue({ _id: inventoryId, quantity: 15 });
      Inventory.findByIdAndUpdate.mockResolvedValue(updatedInventory);
      reorderAlertService.evaluateReorderAlert.mockRejectedValueOnce(
        new Error('Alert DB connection error')
      );

      await expect(updateInventoryQuantity(inventoryId, 2)).rejects.toThrow(
        'Alert DB connection error'
      );

      expect(Inventory.findByIdAndUpdate).toHaveBeenCalledWith(
        inventoryId,
        { $set: { quantity: 15 } },
        { new: true, runValidators: true, context: 'query' }
      );
    });
  });

  describe('deductInventoryStock', () => {
    it('should deduct stock successfully and evaluate reorder alert', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      const updatedDoc = { _id: inventoryId, quantity: 3 };

      Inventory.findOneAndUpdate.mockResolvedValue(updatedDoc);

      const result = await deductInventoryStock([{ inventoryId, quantity: 2 }]);

      expect(Inventory.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: inventoryId, quantity: { $gte: 2 } },
        { $inc: { quantity: -2 } },
        { new: true, session: null }
      );
      expect(reorderAlertService.evaluateReorderAlert).toHaveBeenCalledWith(updatedDoc, null, null);
      expect(result).toEqual([updatedDoc]);
    });

    it('should reject invalid deduction quantity', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();

      await expect(deductInventoryStock([{ inventoryId, quantity: 0 }])).rejects.toMatchObject({
        statusCode: 422,
      });
    });

    it('should reject invalid inventory id', async () => {
      await expect(
        deductInventoryStock([{ inventoryId: 'invalid-id', quantity: 1 }])
      ).rejects.toMatchObject({
        statusCode: 422,
      });
    });

    it('should throw ConflictError when inventory stock is insufficient', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      Inventory.findOneAndUpdate.mockResolvedValue(null);
      Inventory.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue({ _id: inventoryId, quantity: 1 }),
      });

      await expect(deductInventoryStock([{ inventoryId, quantity: 5 }])).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('should throw NotFoundError when inventory item does not exist during deduction', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      Inventory.findOneAndUpdate.mockResolvedValue(null);
      Inventory.findById.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      await expect(deductInventoryStock([{ inventoryId, quantity: 2 }])).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('Image provenance, tracking, and compensation regression tests', () => {
    it('should NOT trigger provider deletion when createInventory rejects untrusted imagePublicId', async () => {
      const branchId = new mongoose.Types.ObjectId().toString();
      Branch.exists.mockResolvedValue({ _id: branchId });
      ImageUpload.findOne.mockResolvedValue(null); // Untrusted / not found

      const input = {
        branchId,
        itemName: 'Eyewear Frame',
        category: 'Men',
        brand: 'Ray-Ban',
        price: 15000,
        quantity: 10,
        imagePublicId: 'osms/inventory/untrusted-asset-id',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/sample.jpg',
      };

      await expect(createInventory(input)).rejects.toMatchObject({
        statusCode: 422,
        errorCode: 'UNTRUSTED_IMAGE_METADATA',
      });

      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('should NOT trigger provider deletion when createInventory rejects cross-branch imagePublicId', async () => {
      const branchId = new mongoose.Types.ObjectId().toString();
      const otherBranchId = new mongoose.Types.ObjectId().toString();
      Branch.exists.mockResolvedValue({ _id: branchId });
      ImageUpload.findOne.mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        publicId: 'osms/inventory/cross-branch-asset',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/sample.jpg',
        branchId: otherBranchId,
        status: 'PENDING',
      });

      const input = {
        branchId,
        itemName: 'Eyewear Frame',
        category: 'Men',
        brand: 'Ray-Ban',
        price: 15000,
        quantity: 10,
        imagePublicId: 'osms/inventory/cross-branch-asset',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/sample.jpg',
      };

      await expect(createInventory(input)).rejects.toMatchObject({
        statusCode: 422,
        errorCode: 'UNAUTHORIZED_IMAGE_OWNERSHIP',
      });

      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('should NOT trigger provider deletion when updateInventory rejects untrusted imagePublicId', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      Inventory.findById.mockResolvedValue({
        _id: inventoryId,
        imagePublicId: 'osms/inventory/original-image',
      });
      ImageUpload.findOne.mockResolvedValue(null); // Untrusted

      await expect(
        updateInventory(inventoryId, {
          imagePublicId: 'osms/inventory/malicious-untrusted-target',
          imageUrl: 'https://res.cloudinary.com/test/image/upload/sample.jpg',
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        errorCode: 'UNTRUSTED_IMAGE_METADATA',
      });

      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('should trigger provider deletion ONLY of verified upload when subsequent database creation fails', async () => {
      const branchId = new mongoose.Types.ObjectId().toString();
      const verifiedUpload = {
        _id: new mongoose.Types.ObjectId(),
        publicId: 'osms/inventory/verified-upload-123',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/v1/sample.jpg',
        branchId,
        status: 'PENDING',
      };

      Branch.exists.mockResolvedValue({ _id: branchId });
      ImageUpload.findOne.mockResolvedValue(verifiedUpload);
      Inventory.create.mockRejectedValue(new Error('Mongo connection timed out'));

      const input = {
        branchId,
        itemName: 'Frame',
        category: 'Men',
        brand: 'Ray-Ban',
        price: 1000,
        quantity: 2,
        imagePublicId: verifiedUpload.publicId,
        imageUrl: verifiedUpload.imageUrl,
      };

      await expect(createInventory(input)).rejects.toThrow('Mongo connection timed out');

      expect(deleteImage).toHaveBeenCalledWith(verifiedUpload.publicId);
      expect(ImageUpload.updateOne).toHaveBeenCalledWith(
        { publicId: verifiedUpload.publicId },
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'DELETED' }),
        })
      );
    });

    it('should mark tracking record as FAILED_CLEANUP when deleteImage returns success: false', async () => {
      const branchId = new mongoose.Types.ObjectId().toString();
      const verifiedUpload = {
        _id: new mongoose.Types.ObjectId(),
        publicId: 'osms/inventory/unsuccessful-deletion-asset',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/v1/sample.jpg',
        branchId,
        status: 'PENDING',
      };

      Branch.exists.mockResolvedValue({ _id: branchId });
      ImageUpload.findOne.mockResolvedValue(verifiedUpload);
      Inventory.create.mockRejectedValue(new Error('DB failure'));
      deleteImage.mockResolvedValueOnce({ success: false, result: 'not found on cloud' });

      const input = {
        branchId,
        itemName: 'Frame',
        category: 'Men',
        brand: 'Ray-Ban',
        price: 1000,
        quantity: 2,
        imagePublicId: verifiedUpload.publicId,
        imageUrl: verifiedUpload.imageUrl,
      };

      await expect(createInventory(input)).rejects.toThrow('DB failure');

      expect(deleteImage).toHaveBeenCalledWith(verifiedUpload.publicId);
      expect(ImageUpload.updateOne).toHaveBeenCalledWith(
        { publicId: verifiedUpload.publicId },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'FAILED_CLEANUP',
            lastCleanupError: expect.stringContaining('not found on cloud'),
          }),
          $inc: { cleanupAttempts: 1 },
        })
      );
    });

    it('should reject image metadata if upload status is DELETED or FAILED_CLEANUP', async () => {
      const branchId = new mongoose.Types.ObjectId().toString();
      Branch.exists.mockResolvedValue({ _id: branchId });

      ImageUpload.findOne.mockResolvedValueOnce({
        _id: new mongoose.Types.ObjectId(),
        publicId: 'osms/inventory/deleted-asset',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/sample.jpg',
        branchId,
        status: 'DELETED',
      });

      await expect(
        createInventory({
          branchId,
          itemName: 'Frame',
          category: 'Men',
          brand: 'Ray-Ban',
          price: 1000,
          quantity: 2,
          imagePublicId: 'osms/inventory/deleted-asset',
          imageUrl: 'https://res.cloudinary.com/test/image/upload/sample.jpg',
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        errorCode: 'INVALID_IMAGE_STATUS',
      });

      ImageUpload.findOne.mockResolvedValueOnce({
        _id: new mongoose.Types.ObjectId(),
        publicId: 'osms/inventory/failed-cleanup-asset',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/sample.jpg',
        branchId,
        status: 'FAILED_CLEANUP',
      });

      await expect(
        createInventory({
          branchId,
          itemName: 'Frame',
          category: 'Men',
          brand: 'Ray-Ban',
          price: 1000,
          quantity: 2,
          imagePublicId: 'osms/inventory/failed-cleanup-asset',
          imageUrl: 'https://res.cloudinary.com/test/image/upload/sample.jpg',
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        errorCode: 'INVALID_IMAGE_STATUS',
      });
    });

    it('should throw and rollback inventory if ImageUpload.updateOne fails during createInventory', async () => {
      const branchId = new mongoose.Types.ObjectId().toString();
      const verifiedUpload = {
        _id: new mongoose.Types.ObjectId(),
        publicId: 'osms/inventory/verified-1',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/v1/sample.jpg',
        branchId,
        status: 'PENDING',
      };
      const createdItem = {
        _id: new mongoose.Types.ObjectId(),
        branchId,
        itemName: 'Frame',
      };

      Branch.exists.mockResolvedValue({ _id: branchId });
      ImageUpload.findOne.mockResolvedValue(verifiedUpload);
      Inventory.create.mockResolvedValue(createdItem);
      Inventory.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
      ImageUpload.updateOne.mockRejectedValueOnce(new Error('ImageUpload DB update error'));

      const input = {
        branchId,
        itemName: 'Frame',
        category: 'Men',
        brand: 'Ray-Ban',
        price: 1000,
        quantity: 2,
        imagePublicId: verifiedUpload.publicId,
        imageUrl: verifiedUpload.imageUrl,
      };

      await expect(createInventory(input)).rejects.toThrow('ImageUpload DB update error');
      expect(Inventory.deleteOne).toHaveBeenCalledWith({ _id: createdItem._id });
      expect(deleteImage).toHaveBeenCalledWith(verifiedUpload.publicId);
    });

    it('should reject createInventory when imageUrl is provided without imagePublicId', async () => {
      const branchId = new mongoose.Types.ObjectId().toString();
      Branch.exists.mockResolvedValue({ _id: branchId });

      await expect(
        createInventory({
          branchId,
          itemName: 'Frame',
          category: 'Men',
          brand: 'Ray-Ban',
          price: 1000,
          quantity: 2,
          imageUrl: 'https://res.cloudinary.com/test/image/upload/sample.jpg',
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        errorCode: 'MISSING_IMAGE_PUBLIC_ID',
      });

      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('should reject createInventory when imagePublicId is provided without imageUrl', async () => {
      const branchId = new mongoose.Types.ObjectId().toString();
      Branch.exists.mockResolvedValue({ _id: branchId });

      await expect(
        createInventory({
          branchId,
          itemName: 'Frame',
          category: 'Men',
          brand: 'Ray-Ban',
          price: 1000,
          quantity: 2,
          imagePublicId: 'osms/inventory/sample',
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        errorCode: 'MISSING_IMAGE_URL',
      });

      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('should reject updateInventory when imageUrl is updated without imagePublicId', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      Inventory.findById.mockResolvedValue({
        _id: inventoryId,
        itemName: 'Old Frame',
      });

      await expect(
        updateInventory(inventoryId, {
          imageUrl: 'https://res.cloudinary.com/untrusted/image.jpg',
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        errorCode: 'MISSING_IMAGE_PUBLIC_ID',
      });

      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('should reject updateInventory when imageUrl does not match approved upload record', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      const verifiedUpload = {
        _id: new mongoose.Types.ObjectId(),
        publicId: 'osms/inventory/real-asset',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/v1/real.jpg',
        status: 'PENDING',
      };

      Inventory.findById.mockResolvedValue({
        _id: inventoryId,
        imagePublicId: 'osms/inventory/old-asset',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/v1/old.jpg',
      });
      ImageUpload.findOne.mockResolvedValue(verifiedUpload);

      await expect(
        updateInventory(inventoryId, {
          imagePublicId: verifiedUpload.publicId,
          imageUrl: 'https://res.cloudinary.com/test/image/upload/v1/mismatched.jpg',
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        errorCode: 'IMAGE_METADATA_MISMATCH',
      });

      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('should rollback Inventory metadata and compensate new asset when ImageUpload.updateOne fails during updateInventory', async () => {
      const inventoryId = new mongoose.Types.ObjectId().toString();
      const originalInventory = {
        _id: inventoryId,
        itemName: 'Classic Frame',
        imagePublicId: 'osms/inventory/original-asset',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/v1/original.jpg',
      };
      const newUpload = {
        _id: new mongoose.Types.ObjectId(),
        publicId: 'osms/inventory/new-replacement-asset',
        imageUrl: 'https://res.cloudinary.com/test/image/upload/v2/new.jpg',
        status: 'PENDING',
      };

      Inventory.findById.mockResolvedValue(originalInventory);
      ImageUpload.findOne.mockResolvedValue(newUpload);

      Inventory.findByIdAndUpdate.mockResolvedValueOnce({
        ...originalInventory,
        imagePublicId: newUpload.publicId,
        imageUrl: newUpload.imageUrl,
      });

      ImageUpload.updateOne.mockRejectedValueOnce(new Error('Tracking DB failure'));

      await expect(
        updateInventory(inventoryId, {
          imagePublicId: newUpload.publicId,
          imageUrl: newUpload.imageUrl,
        })
      ).rejects.toThrow('Tracking DB failure');

      expect(Inventory.findByIdAndUpdate).toHaveBeenCalledWith(
        inventoryId,
        expect.objectContaining({
          $set: expect.objectContaining({
            imagePublicId: originalInventory.imagePublicId,
            imageUrl: originalInventory.imageUrl,
          }),
        }),
        expect.anything()
      );

      expect(deleteImage).toHaveBeenCalledWith(newUpload.publicId);
      expect(deleteImage).not.toHaveBeenCalledWith(originalInventory.imagePublicId);
    });
  });
});
