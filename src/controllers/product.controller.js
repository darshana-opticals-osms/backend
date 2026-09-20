const catchAsync = require('../utils/catchAsync');
const { listProducts, getProductById } = require('../services/product.service');

const getProducts = catchAsync(async (req, res) => {
  const products = await listProducts(req.query);

  return res.status(200).json({
    success: true,
    data: products,
  });
});

const getProduct = catchAsync(async (req, res) => {
  const product = await getProductById(req.params.id);

  return res.status(200).json({
    success: true,
    data: product,
  });
});

module.exports = {
  getProducts,
  getProduct,
};
