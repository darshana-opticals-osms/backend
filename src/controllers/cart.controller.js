const catchAsync = require('../utils/catchAsync');
const {
  addCartItem,
  getCustomerCart,
  updateCartItemQuantity,
  removeCartItem,
} = require('../services/cart.service');

const getCart = catchAsync(async (req, res) => {
  const cart = await getCustomerCart(req.auth.userId);

  return res.status(200).json({ success: true, data: cart });
});

const addCartItemController = catchAsync(async (req, res) => {
  const cart = await addCartItem(req.auth.userId, req.body.inventoryId, req.body.quantity);

  return res.status(200).json({ success: true, data: cart });
});

const updateCartItemController = catchAsync(async (req, res) => {
  const cart = await updateCartItemQuantity(
    req.auth.userId,
    req.params.inventoryId,
    req.body.quantity
  );

  return res.status(200).json({ success: true, data: cart });
});

const removeCartItemController = catchAsync(async (req, res) => {
  const cart = await removeCartItem(req.auth.userId, req.params.inventoryId);

  return res.status(200).json({ success: true, data: cart });
});

module.exports = {
  getCart,
  addCartItemController,
  updateCartItemController,
  removeCartItemController,
};
