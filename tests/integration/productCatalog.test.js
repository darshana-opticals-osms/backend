const mongoose = require('mongoose');
const request = require('supertest');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const Branch = require('../../src/models/branch.model');
const Inventory = require('../../src/models/inventory.model');
const { createInventory } = require('../../src/services/inventory.service');

describe('Product catalog API (Integration tests)', () => {
  let app;
  let branch;
  let products;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;

    await connectDatabase();
    app = createApp();
  });

  beforeEach(async () => {
    await Promise.all([Inventory.deleteMany({}), Branch.deleteMany({})]);

    branch = await Branch.create({
      address: 'Catalog Test Branch',
      contactNumber: '+94 11 234 5678',
    });

    products = await Promise.all([
      createInventory({
        branchId: branch._id,
        itemName: 'Austen Classic',
        category: 'Men',
        brand: 'Oliver Peoples',
        price: 12500,
        quantity: 4,
      }),
      createInventory({
        branchId: branch._id,
        itemName: 'Blue Shield',
        category: 'Sunglasses',
        brand: 'Oakley',
        price: 18000,
        quantity: 7,
      }),
      createInventory({
        branchId: branch._id,
        itemName: 'Lumi Round',
        category: 'Women',
        brand: 'Persol',
        price: 23500,
        quantity: 2,
      }),
    ]);
  });

  afterAll(async () => {
    await Promise.all([Inventory.deleteMany({}), Branch.deleteMany({})]);
    await disconnectDatabase();
  });

  it('should return the available catalog products (AC1)', async () => {
    const response = await request(app).get('/api/products');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.data.map((product) => product.itemName)).toEqual([
      'Austen Classic',
      'Blue Shield',
      'Lumi Round',
    ]);
  });

  it('should return product details for a valid product id (AC2)', async () => {
    const response = await request(app).get(`/api/products/${products[0]._id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        id: products[0]._id.toString(),
        itemName: 'Austen Classic',
        category: 'Men',
        brand: 'Oliver Peoples',
        price: 12500,
      },
    });
  });

  it('should return 404 for an unknown valid product id (AC2)', async () => {
    const unknownId = new mongoose.Types.ObjectId();

    const response = await request(app).get(`/api/products/${unknownId}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('should reject a malformed product id safely (AC8)', async () => {
    const response = await request(app).get('/api/products/not-a-valid-id');

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should filter products by category case-insensitively (AC3)', async () => {
    const response = await request(app).get('/api/products?category=sunglasses');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].itemName).toBe('Blue Shield');
  });

  it('should filter products by brand case-insensitively (AC4)', async () => {
    const response = await request(app).get('/api/products?brand=persol');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].itemName).toBe('Lumi Round');
  });

  it('should filter products using both minimum and maximum price (AC5)', async () => {
    const response = await request(app).get('/api/products?minPrice=13000&maxPrice=20000');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].itemName).toBe('Blue Shield');
  });

  it('should support minimum-only price filtering (AC5)', async () => {
    const response = await request(app).get('/api/products?minPrice=18000');

    expect(response.status).toBe(200);
    expect(response.body.data.map((product) => product.itemName)).toEqual([
      'Blue Shield',
      'Lumi Round',
    ]);
  });

  it('should support maximum-only price filtering (AC5)', async () => {
    const response = await request(app).get('/api/products?maxPrice=12500');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].itemName).toBe('Austen Classic');
  });

  it('should search product item names case-insensitively (AC6)', async () => {
    const response = await request(app).get('/api/products?search=austen');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].itemName).toBe('Austen Classic');
  });

  it('should search product brands case-insensitively (AC6)', async () => {
    const response = await request(app).get('/api/products?search=oak');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].brand).toBe('Oakley');
  });

  it('should return an empty result set when valid criteria have no matches (AC7)', async () => {
    const response = await request(app).get('/api/products?brand=NoSuchBrand');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [],
    });
  });

  it.each([
    ['/api/products?minPrice=-1', 'minPrice'],
    ['/api/products?maxPrice=abc', 'maxPrice'],
    ['/api/products?minPrice=20000&maxPrice=10000', 'price'],
    ['/api/products?unknown=value', 'unknown'],
  ])('should reject invalid filter parameters safely (AC8): %s', async (url, field) => {
    const response = await request(app).get(url);

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.some((detail) => detail.field === field)).toBe(true);
  });

  it('should treat regular-expression characters as literal search text (AC6, AC8)', async () => {
    const response = await request(app).get('/api/products?search=.*');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('should expose only public discovery fields and hide inventory internals (AC9)', async () => {
    const response = await request(app).get('/api/products');

    expect(response.status).toBe(200);

    for (const product of response.body.data) {
      expect(Object.keys(product).sort()).toEqual(
        ['brand', 'category', 'id', 'itemName', 'price'].sort()
      );
      expect(product.branchId).toBeUndefined();
      expect(product.quantity).toBeUndefined();
      expect(product.createdAt).toBeUndefined();
      expect(product.updatedAt).toBeUndefined();
      expect(product.__v).toBeUndefined();
    }
  });
});
