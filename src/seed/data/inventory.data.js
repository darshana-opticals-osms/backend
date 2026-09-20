/**
 * Fictional Inventory Seed Data (AC6, AC8)
 *
 * All item names, categories, brands, prices, and quantities are fictional test records.
 */

const SEED_INVENTORY_ITEMS = [
  {
    branchCodeName: 'COLOMBO_MAIN',
    itemName: 'Ray-Ban Aviator Classic',
    category: 'Sunglasses',
    brand: 'Ray-Ban',
    price: 28500,
    quantity: 15,
  },
  {
    branchCodeName: 'COLOMBO_MAIN',
    itemName: 'Oakley Holbrook Sports',
    category: 'Sports',
    brand: 'Oakley',
    price: 32000,
    quantity: 8,
  },
  {
    branchCodeName: 'COLOMBO_MAIN',
    itemName: 'Persol Steve McQueen Edition',
    category: 'Men',
    brand: 'Persol',
    price: 45000,
    quantity: 5,
  },
  {
    branchCodeName: 'COLOMBO_MAIN',
    itemName: 'Vogue Eyewear Cat-Eye',
    category: 'Women',
    brand: 'Vogue Eyewear',
    price: 18500,
    quantity: 12,
  },
  {
    branchCodeName: 'KANDY_CITY',
    itemName: 'Ray-Ban Wayfarer Ease',
    category: 'Sunglasses',
    brand: 'Ray-Ban',
    price: 26000,
    quantity: 10,
  },
  {
    branchCodeName: 'KANDY_CITY',
    itemName: 'Oliver Peoples Gregory Peck',
    category: 'Men',
    brand: 'Oliver Peoples',
    price: 48000,
    quantity: 3,
  },
  {
    branchCodeName: 'KANDY_CITY',
    itemName: 'Gucci Oversized Square',
    category: 'Women',
    brand: 'Gucci',
    price: 42000,
    quantity: 0, // Out of stock test item
  },
  {
    branchCodeName: 'KANDY_CITY',
    itemName: 'Junior Flex Frame',
    category: 'Kids',
    brand: 'Vogue Eyewear',
    price: 9500,
    quantity: 20,
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    itemName: 'Oakley Flak 2.0 XL',
    category: 'Sports',
    brand: 'Oakley',
    price: 29500,
    quantity: 6,
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    itemName: 'Acuvue Oasys Daily Contact Lenses',
    category: 'Contact Lenses',
    brand: 'Acuvue',
    price: 4500,
    quantity: 45,
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    itemName: 'Ray-Ban Clubmaster Classic',
    category: 'Men',
    brand: 'Ray-Ban',
    price: 24000,
    quantity: 14,
  },
];

module.exports = {
  SEED_INVENTORY_ITEMS,
};
