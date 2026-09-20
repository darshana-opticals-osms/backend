const Inventory = require('../models/inventory.model');
const { NotFoundError } = require('../errors/AppError');

const PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND';

const PUBLIC_PRODUCT_FIELDS = {
  itemName: 1,
  category: 1,
  brand: 1,
  price: 1,
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPublicProduct = (product) => ({
  id: product._id.toString(),
  itemName: product.itemName,
  category: product.category,
  brand: product.brand,
  price: product.price,
});

const buildCatalogFilter = ({ search, category, brand, minPrice, maxPrice } = {}) => {
  const filter = {};

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
  const query = buildCatalogFilter(filters);

  const products = await Inventory.find(query)
    .select(PUBLIC_PRODUCT_FIELDS)
    .sort({ itemName: 1, _id: 1 })
    .lean();

  return products.map(toPublicProduct);
};

const getProductById = async (productId) => {
  const product = await Inventory.findById(productId).select(PUBLIC_PRODUCT_FIELDS).lean();

  if (!product) {
    throw new NotFoundError('Product not found.', null, PRODUCT_NOT_FOUND);
  }

  return toPublicProduct(product);
};

module.exports = {
  PRODUCT_NOT_FOUND,
  PUBLIC_PRODUCT_FIELDS,
  buildCatalogFilter,
  listProducts,
  getProductById,
};
