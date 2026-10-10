const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../../src/app');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Branch = require('../../src/models/branch.model');
const Cart = require('../../src/models/cart.model');
const Customer = require('../../src/models/customer.model');
const Inventory = require('../../src/models/inventory.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

const JWT_SECRET = 'cart-api-test-secret';
const PASSWORD_HASH = `$2b$12$${'a'.repeat(53)}`;

const createToken = ({ userId, role = ROLE_VALUES.CUSTOMER } = {}) =>
  jwt.sign({ userId, role }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

const createCustomer = (email) =>
  Customer.create({
    name: 'Cart Customer',
    email,
    address: '12 Main Street',
    phone: '+94711234567',
    passwordHash: PASSWORD_HASH,
  });

const createInventory = async (branchId, overrides = {}) =>
  Inventory.create({
    branchId,
    itemName: 'Classic Frame',
    category: 'Frames',
    brand: 'Optical Co',
    price: 12000,
    quantity: 7,
    ...overrides,
  });

describe('Authenticated Cart API', () => {
  let app;
  let originalEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '1h';
    delete process.env.MONGODB_URI;
    await connectDatabase();
    await Cart.init();
    app = createApp();
  });

  beforeEach(async () => {
    await Promise.all([
      Cart.deleteMany({}),
      Customer.deleteMany({}),
      Inventory.deleteMany({}),
      Branch.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      Cart.deleteMany({}),
      Customer.deleteMany({}),
      Inventory.deleteMany({}),
      Branch.deleteMany({}),
    ]);
    await disconnectDatabase();
    process.env = originalEnv;
  });

  const createBranch = () =>
    Branch.create({
      address: 'Gampaha Branch',
      contactNumber: '+94 33 200 0000',
    });

  it('should persist add, merge, get, absolute update, and remove operations without changing stock', async () => {
    const customer = await createCustomer('cart.flow@example.com');
    const branch = await createBranch();
    const inventory = await createInventory(branch._id);
    const secondInventory = await createInventory(branch._id, { itemName: 'Reading Glasses' });
    const token = createToken({ userId: customer._id.toString() });

    const firstAdd = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ inventoryId: inventory._id.toString(), quantity: 2 });
    const duplicateAdd = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ inventoryId: inventory._id.toString(), quantity: 1 });
    const secondAdd = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ inventoryId: secondInventory._id.toString(), quantity: 1 });

    expect(firstAdd.status).toBe(200);
    expect(firstAdd.body.data.items).toEqual([
      { inventoryId: inventory._id.toString(), quantity: 2 },
    ]);
    expect(duplicateAdd.body.data.items).toHaveLength(1);
    expect(duplicateAdd.body.data.items[0].quantity).toBe(3);
    expect(secondAdd.body.data.items).toHaveLength(2);

    const getResponse = await request(app).get('/api/cart').set('Authorization', `Bearer ${token}`);
    const updateResponse = await request(app)
      .patch(`/api/cart/items/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 4 });
    const removeResponse = await request(app)
      .delete(`/api/cart/items/${secondInventory._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getResponse.body.data.items).toHaveLength(2);
    expect(
      updateResponse.body.data.items.find((item) => item.inventoryId === inventory._id.toString())
        .quantity
    ).toBe(4);
    expect(removeResponse.body.data.items).toEqual([
      { inventoryId: inventory._id.toString(), quantity: 4 },
    ]);
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(1);
    expect((await Inventory.findById(inventory._id)).quantity).toBe(7);
    expect((await Inventory.findById(secondInventory._id)).quantity).toBe(7);

    const finalRemoval = await request(app)
      .delete(`/api/cart/items/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`);
    const emptyResponse = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${token}`);

    expect(finalRemoval.body.data).toEqual({ items: [] });
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(0);
    expect(emptyResponse.status).toBe(200);
    expect(emptyResponse.body.data).toEqual({ items: [] });
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(0);
  });

  it('should isolate Cart ownership and reject non-CUSTOMER and unauthenticated requests', async () => {
    const customerA = await createCustomer('cart.owner.a@example.com');
    const customerB = await createCustomer('cart.owner.b@example.com');
    const branch = await createBranch();
    const inventory = await createInventory(branch._id);
    const tokenA = createToken({ userId: customerA._id.toString() });
    const tokenB = createToken({ userId: customerB._id.toString() });

    await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ inventoryId: inventory._id.toString(), quantity: 1 });

    const anonymousResponse = await request(app).get('/api/cart');
    const staffResponse = await request(app)
      .get('/api/cart')
      .set(
        'Authorization',
        `Bearer ${createToken({ userId: customerA._id.toString(), role: ROLE_VALUES.BRANCH_MANAGER })}`
      );
    const customerBGet = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${tokenB}`);
    const customerBUpdate = await request(app)
      .patch(`/api/cart/items/${inventory._id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ quantity: 9 });
    const customerBDelete = await request(app)
      .delete(`/api/cart/items/${inventory._id}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(anonymousResponse.status).toBe(401);
    expect(staffResponse.status).toBe(403);
    expect(customerBGet.body.data).toEqual({ items: [] });
    expect(customerBUpdate.status).toBe(404);
    expect(customerBDelete.status).toBe(404);
    expect((await Cart.findOne({ customerId: customerA._id })).items[0].quantity).toBe(1);
    expect(await Cart.countDocuments({ customerId: customerB._id })).toBe(0);
  });

  it('should reject invalid ids, quantities, unsupported fields, and missing Inventory', async () => {
    const customer = await createCustomer('cart.validation@example.com');
    const token = createToken({ userId: customer._id.toString() });
    const branch = await createBranch();
    const inventory = await createInventory(branch._id);
    const missingInventoryId = new mongoose.Types.ObjectId().toString();

    const invalidRequests = await Promise.all([
      request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ inventoryId: inventory._id.toString() }),
      request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ inventoryId: inventory._id.toString(), quantity: 0 }),
      request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ inventoryId: inventory._id.toString(), quantity: 1.5 }),
      request(app).post('/api/cart/items').set('Authorization', `Bearer ${token}`).send({
        inventoryId: inventory._id.toString(),
        quantity: 1,
        customerId: new mongoose.Types.ObjectId().toString(),
      }),
      request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ inventoryId: 'bad-id', quantity: 1 }),
      request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ inventoryId: missingInventoryId, quantity: 1 }),
      request(app)
        .patch(`/api/cart/items/${inventory._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: -2 }),
      request(app)
        .patch(`/api/cart/items/${inventory._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 1, role: ROLE_VALUES.SYSTEM_ADMIN }),
      request(app)
        .delete(`/api/cart/items/${inventory._id}?customerId=${new mongoose.Types.ObjectId()}`)
        .set('Authorization', `Bearer ${token}`),
    ]);

    expect(invalidRequests.slice(0, 5).map((response) => response.status)).toEqual([
      422, 422, 422, 422, 422,
    ]);
    expect(invalidRequests[5].status).toBe(404);
    expect(invalidRequests[6].status).toBe(422);
    expect(invalidRequests[7].status).toBe(422);
    expect(invalidRequests[8].status).toBe(422);
    expect(await Cart.countDocuments({})).toBe(0);
  });

  it('should reject quantity overflow without changing the persisted Cart', async () => {
    const customer = await createCustomer('cart.overflow@example.com');
    const branch = await createBranch();
    const inventory = await createInventory(branch._id);
    const token = createToken({ userId: customer._id.toString() });
    await Cart.create({
      customerId: customer._id,
      items: [{ inventoryId: inventory._id, quantity: Number.MAX_SAFE_INTEGER - 1 }],
    });
    const originalCart = await Cart.findOne({ customerId: customer._id }).lean();

    const response = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ inventoryId: inventory._id.toString(), quantity: 2 });
    const persistedCart = await Cart.findOne({ customerId: customer._id }).lean();

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('CART_QUANTITY_OVERFLOW');
    expect(persistedCart.items).toEqual(originalCart.items);
    expect(persistedCart.updatedAt).toEqual(originalCart.updatedAt);
  });

  it('should reject an invalid JWT and a Customer identity that no longer exists', async () => {
    const customer = await createCustomer('cart.deleted-customer@example.com');
    const token = createToken({ userId: customer._id.toString() });

    const invalidJwtResponse = await request(app)
      .get('/api/cart')
      .set('Authorization', 'Bearer invalid-token');

    await Customer.deleteOne({ _id: customer._id });
    const deletedCustomerResponse = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${token}`);

    expect(invalidJwtResponse.status).toBe(401);
    expect(deletedCustomerResponse.status).toBe(404);
    expect(deletedCustomerResponse.body.error.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('should reject an empty JSON array as a DELETE body', async () => {
    const customer = await createCustomer('cart.delete-array@example.com');
    const branch = await createBranch();
    const inventory = await createInventory(branch._id);
    const token = createToken({ userId: customer._id.toString() });

    const response = await request(app)
      .delete(`/api/cart/items/${inventory._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send([]);

    expect(response.status).toBe(422);
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(0);
  });

  it('should preserve all quantities and one Cart line during concurrent adds', async () => {
    const customer = await createCustomer('cart.concurrent@example.com');
    const branch = await createBranch();
    const inventory = await createInventory(branch._id);
    const token = createToken({ userId: customer._id.toString() });

    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        request(app)
          .post('/api/cart/items')
          .set('Authorization', `Bearer ${token}`)
          .send({ inventoryId: inventory._id.toString(), quantity: 1 })
      )
    );

    const cart = await Cart.findOne({ customerId: customer._id });

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(1);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(12);
  });

  it('should safely remove different final items in concurrent requests', async () => {
    const customer = await createCustomer('cart.concurrent-delete@example.com');
    const branch = await createBranch();
    const inventoryA = await createInventory(branch._id);
    const inventoryB = await createInventory(branch._id, { itemName: 'Reading Glasses' });
    const token = createToken({ userId: customer._id.toString() });

    await Cart.create({
      customerId: customer._id,
      items: [
        { inventoryId: inventoryA._id, quantity: 1 },
        { inventoryId: inventoryB._id, quantity: 1 },
      ],
    });

    const responses = await Promise.all([
      request(app)
        .delete(`/api/cart/items/${inventoryA._id}`)
        .set('Authorization', `Bearer ${token}`),
      request(app)
        .delete(`/api/cart/items/${inventoryB._id}`)
        .set('Authorization', `Bearer ${token}`),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await Cart.countDocuments({ customerId: customer._id })).toBe(0);
  });

  it('should persist a concurrent add when another request deletes the prior final item', async () => {
    const customer = await createCustomer('cart.concurrent-add-delete@example.com');
    const branch = await createBranch();
    const existingInventory = await createInventory(branch._id);
    const addedInventory = await createInventory(branch._id, { itemName: 'New Frame' });
    const token = createToken({ userId: customer._id.toString() });
    await Cart.create({
      customerId: customer._id,
      items: [{ inventoryId: existingInventory._id, quantity: 1 }],
    });

    const [deleteResponse, addResponse] = await Promise.all([
      request(app)
        .delete(`/api/cart/items/${existingInventory._id}`)
        .set('Authorization', `Bearer ${token}`),
      request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ inventoryId: addedInventory._id.toString(), quantity: 1 }),
    ]);

    const persistedCart = await Cart.findOne({ customerId: customer._id });

    expect(deleteResponse.status).toBe(200);
    expect(addResponse.status).toBe(200);
    expect(addResponse.body.data.items).toContainEqual({
      inventoryId: addedInventory._id.toString(),
      quantity: 1,
    });
    expect(persistedCart.items).toEqual([
      expect.objectContaining({ inventoryId: addedInventory._id, quantity: 1 }),
    ]);
  });
});
