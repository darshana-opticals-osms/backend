const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Order = require('../../src/models/order.model');
const Payment = require('../../src/models/payment.model');
const OrderItem = require('../../src/models/orderItem.model');
const Branch = require('../../src/models/branch.model');
const Customer = require('../../src/models/customer.model');
const Inventory = require('../../src/models/inventory.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { PAYMENT_STATUS, PAYMENT_METHOD } = require('../../src/constants/payment');
const { AUDIT_ACTION, AUDIT_TARGET_TYPE, AUDIT_OUTCOME } = require('../../src/constants/audit');
const auditService = require('../../src/services/audit.service');
const {
  escapeCsvCell,
  buildCsvString,
  exportSalesReportCsv,
  exportInventoryReportCsv,
} = require('../../src/services/reportExport.service');

describe('reportExport.service (ADR-014 §11, §14.2 & RFC-4180)', () => {
  let branchA;
  let branchB;
  let customerA;

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
      Order.deleteMany({}),
      Payment.deleteMany({}),
      OrderItem.collection.deleteMany({}),
      Branch.deleteMany({}),
      Customer.deleteMany({}),
      Inventory.deleteMany({}),
    ]);

    branchA = await Branch.create({
      codeName: 'COLOMBO_CENTRAL',
      address: '10 Main St, Colombo 01',
      contactNumber: '0112345678',
    });

    branchB = await Branch.create({
      codeName: 'KANDY_BRANCH',
      address: '20 Hill St, Kandy',
      contactNumber: '0812345678',
    });

    customerA = await Customer.create({
      name: 'Kasun Perera',
      email: 'kasun.p@example.com',
      phone: '+94771234567',
      address: '123 Galle Road, Colombo 03',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456789012345678901234567890',
    });
  });

  describe('escapeCsvCell utility', () => {
    it('returns empty string for null or undefined', () => {
      expect(escapeCsvCell(null)).toBe('');
      expect(escapeCsvCell(undefined)).toBe('');
    });

    it('returns plain string without quotes when safe', () => {
      expect(escapeCsvCell('SimpleText')).toBe('SimpleText');
      expect(escapeCsvCell(1234.56)).toBe('1234.56');
    });

    it('wraps string in quotes if it contains commas', () => {
      expect(escapeCsvCell('Colombo 03, Western')).toBe('"Colombo 03, Western"');
    });

    it('escapes internal quotes and wraps in quotes', () => {
      expect(escapeCsvCell('Lens "Pro"')).toBe('"Lens ""Pro"""');
    });

    it('wraps string in quotes if it contains newline or carriage return', () => {
      expect(escapeCsvCell('Line1\nLine2')).toBe('"Line1\nLine2"');
      expect(escapeCsvCell('Line1\r\nLine2')).toBe('"Line1\r\nLine2"');
    });

    it('neutralizes formula injection characters (=, +, -, @, \\t, \\r)', () => {
      expect(escapeCsvCell('=1+1')).toBe("'=1+1");
      expect(escapeCsvCell('+SUM(A1:A5)')).toBe("'+SUM(A1:A5)");
      expect(escapeCsvCell('-cmd|calc')).toBe("'-cmd|calc");
      expect(escapeCsvCell('@evil')).toBe("'@evil");
    });
  });

  describe('buildCsvString utility', () => {
    it('combines headers and rows with CRLF endings', () => {
      const headers = ['ColA', 'ColB'];
      const rows = [
        ['Val1', 'Val2'],
        ['Val3,with,comma', 'Val4'],
      ];
      const csv = buildCsvString(headers, rows);
      expect(csv).toBe('ColA,ColB\r\nVal1,Val2\r\n"Val3,with,comma",Val4\r\n');
    });
  });

  describe('exportSalesReportCsv', () => {
    it('throws ForbiddenError when accessed by INVENTORY_MANAGER role', async () => {
      const user = { userId: 'u1', role: ROLE_VALUES.INVENTORY_MANAGER };
      await expect(
        exportSalesReportCsv({ preset: 'today', user })
      ).rejects.toThrow('Inventory Managers do not have access to sales reports.');
    });

    it('throws ForbiddenError when BRANCH_MANAGER attempts IDOR export on another branch', async () => {
      const user = {
        userId: 'u1',
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branchA._id.toString(),
      };
      await expect(
        exportSalesReportCsv({
          preset: 'today',
          branchId: branchB._id.toString(),
          user,
        })
      ).rejects.toThrow('cannot query branch data outside assigned scope');
    });

    it('successfully exports sales report with masked PII and records audit event for MANAGEMENT', async () => {
      const recordSpy = jest.spyOn(auditService, 'record');

      const now = new Date();
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderAmount: 15000,
        status: 'COMPLETED',
        orderDate: now,
      });

      await Payment.create({
        orderId: order._id,
        amount: 15000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      const user = {
        userId: 'mgr-101',
        role: ROLE_VALUES.MANAGEMENT,
      };

      const result = await exportSalesReportCsv({
        preset: 'today',
        user,
      });

      expect(result.rowCount).toBe(1);
      expect(result.filename).toMatch(/^sales-report-.*\.csv$/);
      expect(result.csvContent).toContain('Order ID,Payment ID,Order Date,Paid At,Order Status');
      // PII masking verification
      expect(result.csvContent).toContain('K*** P***');
      expect(result.csvContent).toContain('k***@example.com');
      expect(result.csvContent).toContain('+94 77 **** 567');
      expect(result.csvContent).toContain('Colombo 03');
      // Verify clinical absence
      expect(result.csvContent).not.toContain('sphere');
      expect(result.csvContent).not.toContain('cylinder');

      // Audit event verification
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.REPORT_EXPORT_GENERATED,
          actor: {
            actorType: 'USER',
            actorId: 'mgr-101',
            actorRole: ROLE_VALUES.MANAGEMENT,
          },
          target: {
            targetType: AUDIT_TARGET_TYPE.REPORT,
            targetId: 'SALES_REPORT',
          },
          outcome: AUDIT_OUTCOME.SUCCESS,
          metadata: expect.objectContaining({
            reportType: 'sales',
            rowCount: 1,
          }),
        })
      );

      recordSpy.mockRestore();
    });

    it('scopes export to assigned branch for BRANCH_MANAGER', async () => {
      const now = new Date();
      // Order in Branch A
      const orderA = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderAmount: 8000,
        status: 'COMPLETED',
        orderDate: now,
      });
      await Payment.create({
        orderId: orderA._id,
        amount: 8000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CASH,
        paidAt: now,
      });

      // Order in Branch B
      const orderB = await Order.create({
        customerId: customerA._id,
        branchId: branchB._id,
        orderAmount: 12000,
        status: 'COMPLETED',
        orderDate: now,
      });
      await Payment.create({
        orderId: orderB._id,
        amount: 12000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      const user = {
        userId: 'bm-branch-a',
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branchA._id.toString(),
      };

      const result = await exportSalesReportCsv({
        preset: 'today',
        user,
      });

      expect(result.rowCount).toBe(1);
      expect(result.csvContent).toContain(orderA._id.toString());
      expect(result.csvContent).not.toContain(orderB._id.toString());
    });
  });

  describe('exportInventoryReportCsv', () => {
    it('throws ForbiddenError when accessed by unauthorized role (OPTOMETRIST)', async () => {
      const user = { userId: 'op-1', role: ROLE_VALUES.OPTOMETRIST };
      await expect(
        exportInventoryReportCsv({ user })
      ).rejects.toThrow('Access forbidden: insufficient role permissions.');
    });

    it('successfully exports inventory report and records audit event for INVENTORY_MANAGER', async () => {
      const recordSpy = jest.spyOn(auditService, 'record');

      await Inventory.create({
        itemName: 'Titanium Frame Classic',
        category: 'Frames',
        brand: 'RayBan',
        price: 25000,
        quantity: 8,
        branchId: branchA._id,
      });

      await Inventory.create({
        itemName: 'Anti-Glare Lens',
        category: 'Lenses',
        brand: 'Essilor',
        price: 12000,
        quantity: 0,
        branchId: branchB._id,
      });

      const user = {
        userId: 'inv-mgr-1',
        role: ROLE_VALUES.INVENTORY_MANAGER,
      };

      const result = await exportInventoryReportCsv({
        user,
      });

      expect(result.rowCount).toBe(2);
      expect(result.filename).toMatch(/^inventory-report-.*\.csv$/);
      expect(result.csvContent).toContain('SKU,Item Name,Category,Brand,Quantity,Unit Price (LKR)');
      expect(result.csvContent).toContain('Titanium Frame Classic');
      expect(result.csvContent).toContain('Anti-Glare Lens');
      expect(result.csvContent).toContain('REORDER_TRIGGERED');

      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTION.REPORT_EXPORT_GENERATED,
          actor: {
            actorType: 'USER',
            actorId: 'inv-mgr-1',
            actorRole: ROLE_VALUES.INVENTORY_MANAGER,
          },
          target: {
            targetType: AUDIT_TARGET_TYPE.REPORT,
            targetId: 'INVENTORY_REPORT',
          },
          outcome: AUDIT_OUTCOME.SUCCESS,
          metadata: expect.objectContaining({
            reportType: 'inventory',
            rowCount: 2,
          }),
        })
      );

      recordSpy.mockRestore();
    });

    it('filters inventory by category and branch scope for BRANCH_MANAGER', async () => {
      await Inventory.create({
        itemName: 'Branch A Frame',
        category: 'Frames',
        brand: 'Oakley',
        price: 18000,
        quantity: 15,
        branchId: branchA._id,
      });

      await Inventory.create({
        itemName: 'Branch B Frame',
        category: 'Frames',
        brand: 'Oakley',
        price: 18000,
        quantity: 20,
        branchId: branchB._id,
      });

      const user = {
        userId: 'bm-branch-a',
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: branchA._id.toString(),
      };

      const result = await exportInventoryReportCsv({
        category: 'Frames',
        user,
      });

      expect(result.rowCount).toBe(1);
      expect(result.csvContent).toContain('Branch A Frame');
      expect(result.csvContent).not.toContain('Branch B Frame');
    });
  });
});
