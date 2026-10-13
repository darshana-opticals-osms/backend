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
});
