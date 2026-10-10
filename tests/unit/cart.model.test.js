const mongoose = require('mongoose');
const Cart = require('../../src/models/cart.model');

describe('Cart model', () => {
  const customerId = new mongoose.Types.ObjectId();
  const inventoryId = new mongoose.Types.ObjectId();

  it('should reference Customer and Inventory and enforce unique customer ownership', () => {
    const indexes = Cart.schema.indexes();

    expect(Cart.schema.path('customerId').options.ref).toBe('Customer');
    expect(Cart.schema.path('customerId').options.unique).toBe(true);
    expect(Cart.schema.path('items').schema.path('inventoryId').options.ref).toBe('Inventory');
    expect(indexes).toEqual(
      expect.arrayContaining([
        [expect.objectContaining({ customerId: 1 }), expect.objectContaining({ unique: true })],
      ])
    );
  });

  it('should reject zero, negative and fractional quantities', () => {
    for (const quantity of [0, -1, 1.5]) {
      const cart = new Cart({ customerId, items: [{ inventoryId, quantity }] });
      expect(cart.validateSync().errors['items.0.quantity']).toBeDefined();
    }
  });

  it('should reject duplicate Inventory lines and Cart documents without items', () => {
    const duplicateCart = new Cart({
      customerId,
      items: [
        { inventoryId, quantity: 1 },
        { inventoryId, quantity: 2 },
      ],
    });
    const emptyCart = new Cart({ customerId, items: [] });

    expect(duplicateCart.validateSync().errors.items).toBeDefined();
    expect(emptyCart.validateSync().errors.items).toBeDefined();
  });

  it('should not define authoritative prices, stock, or totals', () => {
    expect(Cart.schema.path('price')).toBeUndefined();
    expect(Cart.schema.path('stock')).toBeUndefined();
    expect(Cart.schema.path('total')).toBeUndefined();
    expect(Cart.schema.path('items').schema.path('price')).toBeUndefined();
  });
});
