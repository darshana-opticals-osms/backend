const Inventory = require('../models/inventory.model');
const { NotFoundError } = require('../errors/AppError');
const { getOnlineFulfillmentBranch } = require('./fulfillmentBranch.service');

const PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND';

const PUBLIC_PRODUCT_FIELDS = {
  itemName: 1,
  category: 1,
  brand: 1,
  price: 1,
  imageUrl: 1,
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPublicProduct = (product) => ({
  id: product._id.toString(),
  itemName: product.itemName,
  category: product.category,
  brand: product.brand,
  price: product.price,
  imageUrl: product.imageUrl || null,
});

const buildCatalogFilter = ({
  search,
  category,
  brand,
  minPrice,
  maxPrice,
  branchId,
  includeOutOfStock = false,
} = {}) => {
  const filter = {};

  if (branchId) {
    filter.branchId = branchId;
  }

  if (!includeOutOfStock) {
    filter.quantity = { $gt: 0 };
  }

  if (category) {
    filter.category = new RegExp(`^${escapeRegex(category)}$`, 'i');
  }

  if (brand) {
    filter.brand = new RegExp(`^${escapeRegex(brand)}$`, 'i');
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};

    if (minPrice !== undefined) {
      filter.price.$gte = minPrice;
    }

    if (maxPrice !== undefined) {
      filter.price.$lte = maxPrice;
    }
  }

  if (search) {
    const safeSearch = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ itemName: safeSearch }, { brand: safeSearch }];
  }

  return filter;
};

const listProducts = async (filters = {}) => {
  const branch = await getOnlineFulfillmentBranch();

  if (!branch) {
    return [];
  }

  const query = buildCatalogFilter({ ...filters, branchId: branch._id });

  const products = await Inventory.find(query)
    .select(PUBLIC_PRODUCT_FIELDS)
    .sort({ itemName: 1, _id: 1 })
    .lean();

  return products.map(toPublicProduct);
};

const getProductById = async (productId) => {
  const branch = await getOnlineFulfillmentBranch();

  if (!branch) {
    throw new NotFoundError('Product not found.', null, PRODUCT_NOT_FOUND);
  }

  const query = {
    _id: productId,
    branchId: branch._id,
    quantity: { $gt: 0 },
  };

  const product = await Inventory.findOne(query).select(PUBLIC_PRODUCT_FIELDS).lean();

  if (!product) {
    throw new NotFoundError('Product not found.', null, PRODUCT_NOT_FOUND);
  }

  return toPublicProduct(product);
};

module.exports = {
  PRODUCT_NOT_FOUND,
  PUBLIC_PRODUCT_FIELDS,
  getOnlineFulfillmentBranch,
  buildCatalogFilter,
  listProducts,
  getProductById,
};
