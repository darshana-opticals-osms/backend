const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Inventory = require('../../src/models/inventory.model');
const Branch = require('../../src/models/branch.model');
const InventoryConfig = require('../../src/models/inventoryConfig.model');
const ReorderAlert = require('../../src/models/reorderAlert.model');
const { evaluateReorderAlert } = require('../../src/services/reorderAlert.service');
const { ROLE_VALUES } = require('../../src/constants/roles');
const {
  getInventoryReport,
  getInventoryItemsList,
} = require('../../src/services/reportInventory.service');

describe('reportInventory.service (ADR-014 §9 - IM-01 to IM-06)', () => {
  let branchA;
  let branchB;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Promise.all([
      Inventory.deleteMany({}),
      Branch.deleteMany({}),
      InventoryConfig.deleteMany({}),
      ReorderAlert.deleteMany({}),
    ]);

    branchA = await Branch.create({
      codeName: 'COLOMBO_CENTRAL',
      address: '10 Main St, Colombo 01',
      contactNumber: '+94 11 234 5678',
    });

    branchB = await Branch.create({
      codeName: 'KANDY_CITY',
      address: '50 Dalada St, Kandy',
      contactNumber: '+94 81 234 5678',
    });

    // Set a known global reorder threshold of 5 for deterministic assertions
    await InventoryConfig.create({
      key: 'REORDER_THRESHOLD',
      value: 5,
    });
  });

  async function createInventoryItem(data) {
    const item = await Inventory.create(data);
    await evaluateReorderAlert(item, 5);
    return item;
  }

  describe('Current Snapshot Inventory Metrics (IM-01 to IM-06)', () => {
    it('calculates total stock, retail valuation, low-stock, and reorder-triggered counts accurately', async () => {
      // 1. OK stock: quantity 20 > 5, price 10000 -> val 200,000
      await createInventoryItem({
        branchId: branchA._id,
        itemName: 'Ray-Ban Aviator',
        category: 'Sunglasses',
        brand: 'Ray-Ban',
        price: 10000,
        quantity: 20,
      });

      // 2. LOW_STOCK: 0 < quantity 3 <= 5, price 5000 -> val 15,000
      await createInventoryItem({
        branchId: branchA._id,
        itemName: 'Titanium Frame',
        category: 'Frames',
        brand: 'Oakley',
        price: 5000,
        quantity: 3,
      });

      // 3. REORDER_TRIGGERED: quantity 0 == 0, price 2000 -> val 0
      await createInventoryItem({
        branchId: branchB._id,
        itemName: 'Contact Lens Solution',
        category: 'Solutions',
        brand: 'Bausch & Lomb',
        price: 2000,
        quantity: 0,
      });

      const report = await getInventoryReport();

      expect(report.success).toBe(true);
      expect(report.data.reorderThresholdUsed).toBe(5);
      expect(report.data.currency).toBe('LKR');

      // IM-01: Total Stock on Hand (20 + 3 + 0 = 23)
      expect(report.data.summary.totalStockOnHand).toBe(23);

      // IM-06: Total Retail Inventory Valuation (200,000 + 15,000 = 215,000)
      expect(report.data.summary.totalRetailValuation).toBe(215000);

      // IM-04: Low-Stock Items Count
      expect(report.data.summary.lowStockCount).toBe(1);

      // IM-05: Reorder-Triggered Items Count
      expect(report.data.summary.reorderTriggeredCount).toBe(1);

      // OK stock count
      expect(report.data.summary.okStockCount).toBe(1);

      // Total unique products
      expect(report.data.summary.totalUniqueProducts).toBe(3);
    });

    it('groups inventory by branch and category correctly (IM-02, IM-03)', async () => {
      await createInventoryItem({
        branchId: branchA._id,
        itemName: 'Item A',
        category: 'Frames',
        brand: 'BrandX',
        price: 4000,
        quantity: 10,
      });

      await createInventoryItem({
        branchId: branchB._id,
        itemName: 'Item B',
        category: 'Lenses',
        brand: 'BrandY',
        price: 6000,
        quantity: 5,
      });

      const report = await getInventoryReport();

      // IM-02: Branch breakdown
      expect(report.data.breakdowns.byBranch.length).toBe(2);
      const bA = report.data.breakdowns.byBranch.find((b) => b.branchId === branchA._id.toString());
      expect(bA.branchName).toBe('COLOMBO_CENTRAL');
      expect(bA.totalStock).toBe(10);
      expect(bA.totalRetailValuation).toBe(40000);

      // IM-03: Category breakdown
      expect(report.data.breakdowns.byCategory.length).toBe(2);
      const catFrames = report.data.breakdowns.byCategory.find((c) => c.category === 'Frames');
      expect(catFrames.totalStock).toBe(10);
      expect(catFrames.totalRetailValuation).toBe(40000);
    });

    it('filters inventory by branchId for Branch Manager scope (AC28, AC30)', async () => {
      await createInventoryItem({
        branchId: branchA._id,
        itemName: 'Branch A Only Item',
        category: 'Frames',
        brand: 'BrandA',
        price: 5000,
        quantity: 12,
      });

      await createInventoryItem({
        branchId: branchB._id,
        itemName: 'Branch B Only Item',
        category: 'Frames',
        brand: 'BrandB',
        price: 8000,
        quantity: 25,
      });

      const branchReport = await getInventoryReport({
        branchId: branchA._id.toString(),
      });

      expect(branchReport.data.summary.totalStockOnHand).toBe(12);
      expect(branchReport.data.summary.totalRetailValuation).toBe(60000);
      expect(branchReport.data.breakdowns.byBranch.length).toBe(1);
      expect(branchReport.data.breakdowns.byBranch[0].branchName).toBe('COLOMBO_CENTRAL');
    });

    it('fails closed with ForbiddenError when invalid branchId is provided', async () => {
      await expect(getInventoryReport({ branchId: 'invalid-id' })).rejects.toThrow(
        'Invalid branch identifier.'
      );
      await expect(getInventoryItemsList({ branchId: 'malformed-123' })).rejects.toThrow(
        'Invalid branch identifier.'
      );
    });

    it('returns valid empty snapshot report when no items exist (AC41)', async () => {
      const report = await getInventoryReport();

      expect(report.success).toBe(true);
      expect(report.data.summary).toEqual({
        totalStockOnHand: 0,
        totalRetailValuation: 0,
        totalUniqueProducts: 0,
        lowStockCount: 0,
        reorderTriggeredCount: 0,
        okStockCount: 0,
      });
      expect(report.data.breakdowns.byBranch).toEqual([]);
      expect(report.data.breakdowns.byCategory).toEqual([]);
    });
  });

  describe('Detailed Inventory Items Listing (getInventoryItemsList)', () => {
    it('returns paginated items with dynamic reorderStatus and retailValuation', async () => {
      await createInventoryItem({
        branchId: branchA._id,
        itemName: 'Premium Sunglasses',
        category: 'Sunglasses',
        brand: 'Prada',
        price: 45000,
        quantity: 2, // Low stock since <= 5
      });

      await createInventoryItem({
        branchId: branchA._id,
        itemName: 'Daily Disposable Lenses',
        category: 'Lenses',
        brand: 'Acuvue',
        price: 3500,
        quantity: 50, // OK stock
      });

      const listResult = await getInventoryItemsList({ page: 1, limit: 10 });

      expect(listResult.success).toBe(true);
      expect(listResult.data.pagination.totalRecords).toBe(2);
      expect(listResult.data.items.length).toBe(2);

      const lowStockItem = listResult.data.items.find((i) => i.name === 'Premium Sunglasses');
      expect(lowStockItem.reorderStatus).toBe('LOW_STOCK');
      expect(lowStockItem.unitPrice).toBe(45000);
      expect(lowStockItem.quantity).toBe(2);
      expect(lowStockItem.retailValuation).toBe(90000);
      expect(lowStockItem.branchName).toBe('COLOMBO_CENTRAL');
    });

    it('filters items by reorderStatus', async () => {
      await createInventoryItem({
        branchId: branchA._id,
        itemName: 'Out of Stock Frame',
        category: 'Frames',
        brand: 'Gucci',
        price: 60000,
        quantity: 0,
      });

      await createInventoryItem({
        branchId: branchA._id,
        itemName: 'Abundant Lens Cleaner',
        category: 'Solutions',
        brand: 'ClearCare',
        price: 1500,
        quantity: 100,
      });

      const reorderList = await getInventoryItemsList({ reorderStatus: 'REORDER_TRIGGERED' });

      expect(reorderList.data.pagination.totalRecords).toBe(1);
      expect(reorderList.data.items[0].name).toBe('Out of Stock Frame');
      expect(reorderList.data.items[0].reorderStatus).toBe('REORDER_TRIGGERED');
    });
  });

  describe('Role-based Inventory Valuation Restrictions (DDP-064)', () => {
    beforeEach(async () => {
      await createInventoryItem({
        branchId: branchA._id,
        itemName: 'Designer Frame',
        category: 'Frames',
        brand: 'Gucci',
        price: 50000,
        quantity: 10,
      });
    });

    it('omits totalRetailValuation in summary and breakdowns for BRANCH_MANAGER', async () => {
      const report = await getInventoryReport({
        branchId: branchA._id.toString(),
        userRole: ROLE_VALUES.BRANCH_MANAGER,
      });

      expect(report.success).toBe(true);
      expect(report.data.summary.totalStockOnHand).toBe(10);
      expect(report.data.summary.totalRetailValuation).toBeUndefined();

      expect(report.data.breakdowns.byBranch[0].totalStock).toBe(10);
      expect(report.data.breakdowns.byBranch[0].totalRetailValuation).toBeUndefined();

      expect(report.data.breakdowns.byCategory[0].totalStock).toBe(10);
      expect(report.data.breakdowns.byCategory[0].totalRetailValuation).toBeUndefined();
    });

    it('omits retailValuation in getInventoryItemsList for BRANCH_MANAGER', async () => {
      const list = await getInventoryItemsList({
        branchId: branchA._id.toString(),
        userRole: ROLE_VALUES.BRANCH_MANAGER,
      });

      expect(list.success).toBe(true);
      expect(list.data.items[0].name).toBe('Designer Frame');
      expect(list.data.items[0].quantity).toBe(10);
      expect(list.data.items[0].unitPrice).toBe(50000);
      expect(list.data.items[0].retailValuation).toBeUndefined();
    });

    it('preserves retail valuation fields for SYSTEM_ADMIN', async () => {
      const report = await getInventoryReport({
        branchId: branchA._id.toString(),
        userRole: ROLE_VALUES.SYSTEM_ADMIN,
      });

      expect(report.success).toBe(true);
      expect(report.data.summary.totalRetailValuation).toBe(500000);
      expect(report.data.breakdowns.byBranch[0].totalRetailValuation).toBe(500000);
      expect(report.data.breakdowns.byCategory[0].totalRetailValuation).toBe(500000);

      const list = await getInventoryItemsList({
        branchId: branchA._id.toString(),
        userRole: ROLE_VALUES.SYSTEM_ADMIN,
      });
      expect(list.data.items[0].retailValuation).toBe(500000);
    });
  });
});
