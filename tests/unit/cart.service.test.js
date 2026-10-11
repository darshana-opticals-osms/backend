const mongoose = require('mongoose');
const Cart = require('../../src/models/cart.model');
const Customer = require('../../src/models/customer.model');
const Inventory = require('../../src/models/inventory.model');
const {
  addCartItem,
  getCustomerCart,
  updateCartItemQuantity,
  removeCartItem,
} = require('../../src/services/cart.service');

jest.mock('../../src/models/cart.model', () => ({
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../../src/models/customer.model', () => ({ exists: jest.fn() }));
jest.mock('../../src/models/inventory.model', () => ({ exists: jest.fn() }));

describe('Cart service', () => {
  const customerId = new mongoose.Types.ObjectId().toString();
  const inventoryId = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    jest.clearAllMocks();
    Customer.exists.mockResolvedValue({ _id: customerId });
    Inventory.exists.mockResolvedValue({ _id: inventoryId });
  });

  it('should atomically add or increment the authenticated customer Cart item', async () => {
    Cart.findOneAndUpdate.mockResolvedValue({
      items: [{ inventoryId: new mongoose.Types.ObjectId(inventoryId), quantity: 3 }],
    });

    const result = await addCartItem(customerId, inventoryId, 2);
    const [filter, pipeline, options] = Cart.findOneAndUpdate.mock.calls[0];

    expect(Customer.exists).toHaveBeenCalledWith({ _id: customerId });
    expect(Inventory.exists).toHaveBeenCalledWith({ _id: inventoryId });
    expect(filter.$expr.$let.in.$or[1].$lte[1]).toBe(Number.MAX_SAFE_INTEGER);
    expect(pipeline[0].$set.items.$cond[0].$in).toBeDefined();
    expect(pipeline[0].$set.items.$cond[1].$map).toBeDefined();
    expect(options).toMatchObject({ new: true });
    expect(options.upsert).toBeUndefined();
    expect(result.items).toEqual([{ inventoryId, quantity: 3 }]);
    expect(result.items[0]).not.toHaveProperty('price');
  });

  it('should return an empty Cart without creating a document', async () => {
    Cart.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });

    await expect(getCustomerCart(customerId)).resolves.toEqual({ items: [] });
    expect(Cart.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('should use an absolute atomic quantity replacement', async () => {
    Cart.findOneAndUpdate.mockResolvedValue({
      items: [{ inventoryId: new mongoose.Types.ObjectId(inventoryId), quantity: 4 }],
    });

    const result = await updateCartItemQuantity(customerId, inventoryId, 4);
    const [, pipeline] = Cart.findOneAndUpdate.mock.calls[0];

    expect(pipeline[0].$set.items.$map.in.$cond[1].$mergeObjects[1]).toEqual({ quantity: 4 });
    expect(result.items[0].quantity).toBe(4);
  });

  it('should reject invalid quantities and missing Inventory references before mutation', async () => {
    await expect(addCartItem(customerId, inventoryId, 0)).rejects.toMatchObject({
      statusCode: 422,
    });
    await expect(addCartItem(customerId, inventoryId, 1.5)).rejects.toMatchObject({
      statusCode: 422,
    });

    Inventory.exists.mockResolvedValue(null);
    await expect(addCartItem(customerId, inventoryId, 1)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(Cart.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('should reject an atomic add that exceeds the maximum safe integer', async () => {
    Cart.findOneAndUpdate.mockResolvedValue(null);
    Cart.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          items: [
            {
              inventoryId: new mongoose.Types.ObjectId(inventoryId),
              quantity: Number.MAX_SAFE_INTEGER - 1,
            },
          ],
        }),
      }),
    });

    await expect(
      addCartItem(customerId, inventoryId, Number.MAX_SAFE_INTEGER)
    ).rejects.toMatchObject({ statusCode: 422, errorCode: 'CART_QUANTITY_OVERFLOW' });

    const [filter] = Cart.findOneAndUpdate.mock.calls[0];
    expect(filter.$expr.$let.in.$or[1].$lte[1]).toBe(Number.MAX_SAFE_INTEGER);
    expect(Cart.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(Cart.create).not.toHaveBeenCalled();
  });

  it('should retry duplicate Cart creation after a concurrent Cart deletion', async () => {
    const persistedCart = {
      items: [{ inventoryId: new mongoose.Types.ObjectId(inventoryId), quantity: 2 }],
    };
    Cart.findOneAndUpdate.mockResolvedValue(null);
    Cart.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });
    Cart.create.mockRejectedValueOnce({ code: 11000 }).mockResolvedValueOnce(persistedCart);

    await expect(addCartItem(customerId, inventoryId, 1)).resolves.toEqual({
      items: [{ inventoryId, quantity: 2 }],
    });

    expect(Cart.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(Cart.create).toHaveBeenCalledTimes(2);
    for (const [, , options] of Cart.findOneAndUpdate.mock.calls) {
      expect(options.upsert).toBeUndefined();
    }
  });

  it('should fail with a conflict when duplicate Cart creation remains contended', async () => {
    Cart.findOneAndUpdate.mockResolvedValue(null);
    Cart.create.mockRejectedValue({ code: 11000 });
    Cart.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });

    await expect(addCartItem(customerId, inventoryId, 1)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(Cart.findOneAndUpdate).toHaveBeenCalledTimes(3);
    expect(Cart.create).toHaveBeenCalledTimes(3);
  });

  it('should reject a Customer identity that no longer exists', async () => {
    Customer.exists.mockResolvedValue(null);

    await expect(getCustomerCart(customerId)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'CUSTOMER_NOT_FOUND',
    });
    expect(Cart.findOne).not.toHaveBeenCalled();
  });

  it('should delete the Cart when its final item is removed', async () => {
    Cart.findOneAndDelete.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

    await expect(removeCartItem(customerId, inventoryId)).resolves.toEqual({ items: [] });
    expect(Cart.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
