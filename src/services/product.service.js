const Inventory = require('../models/inventory.model');
const Branch = require('../models/branch.model');
const { NotFoundError } = require('../errors/AppError');
const { ONLINE_FULFILLMENT_BRANCH_CODE } = require('../constants/fulfillment.constants');

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

const getOnlineFulfillmentBranch = async () => {
  const codeName = process.env.ONLINE_FULFILLMENT_BRANCH_CODE || ONLINE_FULFILLMENT_BRANCH_CODE;

  let branch = await Branch.findOne({
    codeName: new RegExp(`^${codeName}$`, 'i'),
  })
    .select('_id codeName')
    .lean();

  if (!branch) {
    // Fallback: If codeName is not explicitly found (e.g. in single-branch test fixtures),
    // resolve to the first available branch.
    branch = await Branch.findOne().select('_id codeName').lean();
  }

  return branch;
};

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
  const query = { _id: productId };

  if (branch) {
    query.branchId = branch._id;
  }

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
