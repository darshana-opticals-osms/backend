const mongoose = require('mongoose');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const {
  INVALID_BRANCH_REFERENCE,
  INVALID_INVENTORY_REFERENCE,
  createInventory,
  getBranchInventory,
  updateInventory,
  updateInventoryQuantity,
} = require('../../src/services/inventory.service');

jest.mock('../../src/models/branch.model', () => ({
  exists: jest.fn(),
}));

jest.mock('../../src/models/inventory.model', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));

describe('Inventory service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });
});
