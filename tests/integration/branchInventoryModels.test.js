const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const {
  createInventory,
  INVALID_BRANCH_REFERENCE,
} = require('../../src/services/inventory.service');

describe('Branch and Inventory models (Integration tests)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;

    await connectDatabase();
    await Promise.all([Inventory.deleteMany({}), Branch.deleteMany({})]);
  });

  afterEach(async () => {
    await Promise.all([Inventory.deleteMany({}), Branch.deleteMany({})]);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('should create and persist a valid Branch record (AC1)', async () => {
    const branch = await Branch.create({
      address: '50 Airport Road, Minuwangoda',
      contactNumber: '+94 77 758 7695',
    });

    expect(branch._id).toBeDefined();
    expect(branch.address).toBe('50 Airport Road, Minuwangoda');
    expect(branch.contactNumber).toBe('+94 77 758 7695');
  });

  it('should create valid Inventory for an existing Branch (AC2, AC3, AC6)', async () => {
    const branch = await Branch.create({
      address: 'Gampaha Branch',
      contactNumber: '+94 33 200 0000',
    });

    const inventory = await createInventory({
      branchId: branch._id,
      itemName: 'Austen Classic',
      category: 'Men',
      brand: 'Oliver Peoples',
      price: 12500,
      quantity: 5,
    });

    expect(inventory._id).toBeDefined();
    expect(inventory.branchId.toString()).toBe(branch._id.toString());
    expect(inventory.itemName).toBe('Austen Classic');
    expect(inventory.price).toBe(12500);
    expect(inventory.quantity).toBe(5);
  });

  it('should populate the Branch referenced by Inventory (AC3, AC7)', async () => {
    const branch = await Branch.create({
      address: 'Weyangoda Branch',
      contactNumber: '+94 33 210 0000',
    });

    const inventory = await createInventory({
      branchId: branch._id,
      itemName: 'Coastal Pilot',
      category: 'Sunglasses',
      brand: 'Ray-Ban',
      price: 12290,
      quantity: 2,
    });

    const populated = await Inventory.findById(inventory._id).populate('branchId');

    expect(populated.branchId._id.toString()).toBe(branch._id.toString());
    expect(populated.branchId.address).toBe('Weyangoda Branch');
  });

  it('should reject Inventory creation for a non-existent Branch (AC6)', async () => {
    const missingBranchId = new mongoose.Types.ObjectId();

    await expect(
      createInventory({
        branchId: missingBranchId,
        itemName: 'Invalid Branch Frame',
        category: 'Men',
        brand: 'Test Brand',
        price: 5000,
        quantity: 1,
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      errorCode: INVALID_BRANCH_REFERENCE,
    });

    expect(await Inventory.countDocuments({})).toBe(0);
  });

  it('should reject Inventory creation for a malformed Branch reference (AC6)', async () => {
    await expect(
      createInventory({
        branchId: 'not-a-valid-object-id',
        itemName: 'Invalid Branch Frame',
        category: 'Men',
        brand: 'Test Brand',
        price: 5000,
        quantity: 1,
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      errorCode: INVALID_BRANCH_REFERENCE,
    });

    expect(await Inventory.countDocuments({})).toBe(0);
  });

  it('should enforce required Inventory fields when persisted (AC4)', async () => {
    await expect(Inventory.create({})).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should reject negative price when persisted (AC5)', async () => {
    const branch = await Branch.create({
      address: 'Price Test Branch',
      contactNumber: '+94 11 200 0000',
    });

    await expect(
      createInventory({
        branchId: branch._id,
        itemName: 'Negative Price Frame',
        category: 'Women',
        brand: 'Test Brand',
        price: -100,
        quantity: 1,
      })
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should reject negative quantity when persisted (AC5)', async () => {
    const branch = await Branch.create({
      address: 'Quantity Test Branch',
      contactNumber: '+94 11 210 0000',
    });

    await expect(
      createInventory({
        branchId: branch._id,
        itemName: 'Negative Quantity Frame',
        category: 'Kids',
        brand: 'Test Brand',
        price: 1000,
        quantity: -1,
      })
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });
});
