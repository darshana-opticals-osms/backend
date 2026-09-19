const mongoose = require('mongoose');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');

describe('Branch and Inventory models (Unit tests)', () => {
  const validBranchId = new mongoose.Types.ObjectId();

  it('should validate a valid Branch record (AC1)', async () => {
    const branch = new Branch({
      address: '50 Airport Road, Minuwangoda',
      contactNumber: '+94 77 758 7695',
    });

    await expect(branch.validate()).resolves.toBeUndefined();
    expect(branch._id).toBeDefined();
    expect(branch.address).toBe('50 Airport Road, Minuwangoda');
    expect(branch.contactNumber).toBe('+94 77 758 7695');
  });

  it('should enforce required Branch fields (AC4)', () => {
    const branch = new Branch({});
    const validationError = branch.validateSync();

    expect(validationError.errors.address).toBeDefined();
    expect(validationError.errors.contactNumber).toBeDefined();
  });

  it('should validate a complete Inventory record and Branch reference (AC2, AC3)', async () => {
    const inventory = new Inventory({
      branchId: validBranchId,
      itemName: '  Austen Classic  ',
      category: '  Men  ',
      brand: '  Oliver Peoples  ',
      price: 12500,
      quantity: 4,
    });

    await expect(inventory.validate()).resolves.toBeUndefined();
    expect(inventory._id).toBeDefined();
    expect(inventory.branchId).toEqual(validBranchId);
    expect(inventory.itemName).toBe('Austen Classic');
    expect(inventory.category).toBe('Men');
    expect(inventory.brand).toBe('Oliver Peoples');
    expect(inventory.price).toBe(12500);
    expect(inventory.quantity).toBe(4);
    expect(Inventory.schema.path('branchId').options.ref).toBe('Branch');
  });

  it('should enforce required Inventory fields (AC4)', () => {
    const inventory = new Inventory({});
    const validationError = inventory.validateSync();

    expect(validationError.errors.branchId).toBeDefined();
    expect(validationError.errors.itemName).toBeDefined();
    expect(validationError.errors.category).toBeDefined();
    expect(validationError.errors.brand).toBeDefined();
    expect(validationError.errors.price).toBeDefined();
    expect(validationError.errors.quantity).toBeDefined();
  });

  it('should reject a negative Inventory price (AC5)', async () => {
    const inventory = new Inventory({
      branchId: validBranchId,
      itemName: 'Test Frame',
      category: 'Men',
      brand: 'Test Brand',
      price: -1,
      quantity: 1,
    });

    await expect(inventory.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should reject a negative Inventory quantity (AC5)', async () => {
    const inventory = new Inventory({
      branchId: validBranchId,
      itemName: 'Test Frame',
      category: 'Men',
      brand: 'Test Brand',
      price: 1000,
      quantity: -1,
    });

    await expect(inventory.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should allow zero price and zero quantity (AC5)', async () => {
    const inventory = new Inventory({
      branchId: validBranchId,
      itemName: 'Sample Frame',
      category: 'Kids',
      brand: 'Sample Brand',
      price: 0,
      quantity: 0,
    });

    await expect(inventory.validate()).resolves.toBeUndefined();
  });
});
