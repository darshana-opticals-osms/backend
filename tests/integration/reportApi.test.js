const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Order = require('../../src/models/order.model');
const Payment = require('../../src/models/payment.model');
const OrderItem = require('../../src/models/orderItem.model');
const Branch = require('../../src/models/branch.model');
const Customer = require('../../src/models/customer.model');
const Inventory = require('../../src/models/inventory.model');
const ReorderAlert = require('../../src/models/reorderAlert.model');
const { evaluateReorderAlert } = require('../../src/services/reorderAlert.service');
const AuditEvent = require('../../src/models/auditEvent.model');
const ExcelJS = require('exceljs');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { PAYMENT_STATUS, PAYMENT_METHOD } = require('../../src/constants/payment');
const { AUDIT_ACTION, AUDIT_TARGET_TYPE } = require('../../src/constants/audit');

const { createAccessToken } = require('../../src/utils/jwt');

const JWT_SECRET = 'reporting-api-integration-test-secret';
const JWT_EXPIRES_IN = '1h';

const createToken = ({
  userId = new mongoose.Types.ObjectId().toString(),
  role = ROLE_VALUES.SYSTEM_ADMIN,
  branchId = null,
} = {}) =>
  createAccessToken({
    userId,
    role,
    ...(branchId ? { branchId: branchId.toString() } : {}),
  });

describe('Sales & Inventory Reporting APIs (Issue #56 / ADR-014)', () => {
  let mongoServer;
  let app;
  let branchA;
  let branchB;
  let customerA;

  let adminToken;
  let branchManagerAToken;
  let branchManagerBToken;
  let branchAssistantToken;
  let customerToken;
  let optometristToken;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = JWT_EXPIRES_IN;

    mongoServer = await MongoMemoryServer.create({ instance: { replSet: 'rs0' } });
    const uri = mongoServer.getUri();
    await mongoose.connect(uri, { directConnection: true });
    await mongoose.connection.db.admin().command({
      replSetInitiate: {
        _id: 'rs0',
        members: [{ _id: 0, host: new URL(uri).host }],
      },
    });
    await mongoose.disconnect();
    await mongoose.connect(`${uri}?replicaSet=rs0`, { serverSelectionTimeoutMS: 15000 });

    await Promise.all([
      Order.init(),
      Payment.init(),
      OrderItem.init(),
      Branch.init(),
      Customer.init(),
      Inventory.init(),
      AuditEvent.init(),
    ]);

    app = createApp();
  }, 60000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      try {
        await mongoServer.stop();
      } catch {
        // cleanup error ignored
      }
    }
  });

  beforeEach(async () => {
    await Promise.all([
      Order.collection.deleteMany({}),
      Payment.collection.deleteMany({}),
      OrderItem.collection.deleteMany({}),
      Branch.collection.deleteMany({}),
      Customer.collection.deleteMany({}),
      Inventory.collection.deleteMany({}),
      ReorderAlert.collection.deleteMany({}),
      AuditEvent.collection.deleteMany({}),
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

    customerA = await Customer.create({
      name: 'Kasun Perera',
      email: 'kasun.p@gmail.com',
      phone: '+94771234567',
      address: '123 Galle Road, Colombo 03',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456789012345678901234567890',
    });

    adminToken = createToken({
      userId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.SYSTEM_ADMIN,
    });

    branchManagerAToken = createToken({
      userId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.BRANCH_MANAGER,
      branchId: branchA._id.toString(),
    });

    branchManagerBToken = createToken({
      userId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.BRANCH_MANAGER,
      branchId: branchB._id.toString(),
    });

    branchAssistantToken = createToken({
      userId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.BRANCH_ASSISTANT,
      branchId: branchA._id.toString(),
    });

    customerToken = createToken({
      userId: customerA._id.toString(),
      role: ROLE_VALUES.CUSTOMER,
    });

    optometristToken = createToken({
      userId: new mongoose.Types.ObjectId().toString(),
      role: ROLE_VALUES.OPTOMETRIST,
    });
  });

  describe('Authentication & RBAC Matrix', () => {
    it('returns 401 Unauthorized when no token is provided', async () => {
      const res = await request(app).get('/api/reports/sales');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 403 Forbidden when CUSTOMER attempts sales report', async () => {
      const res = await request(app)
        .get('/api/reports/sales')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
    });

    it('returns 403 Forbidden when OPTOMETRIST attempts sales report', async () => {
      const res = await request(app)
        .get('/api/reports/sales')
        .set('Authorization', `Bearer ${optometristToken}`);
      expect(res.status).toBe(403);
    });

    it('returns 403 Forbidden when BRANCH_ASSISTANT attempts sales report', async () => {
      const res = await request(app)
        .get('/api/reports/sales')
        .set('Authorization', `Bearer ${branchAssistantToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('Access forbidden');
    });

    it('returns 403 Forbidden when BRANCH_ASSISTANT attempts inventory report', async () => {
      const res = await request(app)
        .get('/api/reports/inventory')
        .set('Authorization', `Bearer ${branchAssistantToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('Access forbidden');
    });

    it('allows SYSTEM_ADMIN to access sales and inventory reports with optional branch scoping', async () => {
      const salesRes = await request(app)
        .get('/api/reports/sales')
        .query({ branchId: branchA._id.toString() })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(salesRes.status).toBe(200);
      expect(salesRes.body.success).toBe(true);

      const invRes = await request(app)
        .get('/api/reports/inventory')
        .query({ branchId: branchB._id.toString() })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(invRes.status).toBe(200);
      expect(invRes.body.success).toBe(true);
    });

    it('returns 403 Forbidden when BRANCH_MANAGER attempts IDOR on another branch sales report', async () => {
      const res = await request(app)
        .get('/api/reports/sales')
        .query({ branchId: branchB._id.toString() })
        .set('Authorization', `Bearer ${branchManagerAToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('cannot query branch data outside assigned scope');
    });

    it('returns 403 Forbidden when BRANCH_MANAGER attempts IDOR on another branch inventory report', async () => {
      const res = await request(app)
        .get('/api/reports/inventory')
        .query({ branchId: branchB._id.toString() })
        .set('Authorization', `Bearer ${branchManagerAToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('cannot query branch data outside assigned scope');
    });

    it('allows BRANCH_MANAGER to access their assigned branch sales and inventory reports', async () => {
      const salesRes = await request(app)
        .get('/api/reports/sales')
        .query({ branchId: branchA._id.toString() })
        .set('Authorization', `Bearer ${branchManagerAToken}`);
      expect(salesRes.status).toBe(200);
      expect(salesRes.body.success).toBe(true);

      const invRes = await request(app)
        .get('/api/reports/inventory')
        .query({ branchId: branchA._id.toString() })
        .set('Authorization', `Bearer ${branchManagerAToken}`);
      expect(invRes.status).toBe(200);
      expect(invRes.body.success).toBe(true);
    });
  });

  describe('Input Validation Constraints', () => {
    it('returns 422 Unprocessable Entity when date range exceeds 365 days', async () => {
      const res = await request(app)
        .get('/api/reports/sales')
        .query({
          startDate: '2024-01-01',
          endDate: '2025-06-01',
        })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('exceed');
    });

    it('returns 422 Unprocessable Entity when only startDate is provided without endDate', async () => {
      const res = await request(app)
        .get('/api/reports/sales')
        .query({ startDate: '2026-01-01' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
    });

    it('returns 422 Unprocessable Entity when unsupported query param is passed', async () => {
      const res = await request(app)
        .get('/api/reports/sales')
        .query({ maliciousParam: 'hack' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('Unsupported sales report query parameter');
    });

    it('returns 422 Unprocessable Entity when body is sent on GET request', async () => {
      const res = await request(app)
        .get('/api/reports/sales')
        .send({ illegalBody: 'data' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('does not accept request body');
    });
  });

  describe('GET /api/reports/sales - Financial & Operational Accounting', () => {
    it('returns HTTP 200 with zero metrics when no sales exist in range', async () => {
      const res = await request(app)
        .get('/api/reports/sales')
        .query({ preset: 'today' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary).toEqual({
        grossRevenue: 0,
        refundDeductions: 0,
        netRevenue: 0,
        totalOrders: 0,
        itemsSold: 0,
        averageOrderValue: 0,
        cancelledOrdersCount: 0,
        cancelledOrdersValue: 0,
      });
      expect(res.body.data.currency).toBe('LKR');
      expect(res.body.data.timezone).toBe('Asia/Colombo');
    });

    it('calculates canonical revenue, refunds, items sold, and cancelled orders accurately', async () => {
      const now = new Date();

      // Qualifying Order 1: Branch A, 15,000 LKR
      const order1 = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 15000,
        status: 'COMPLETED',
      });
      await Payment.create({
        orderId: order1._id,
        amount: 15000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });
      await OrderItem.create({
        orderId: order1._id,
        itemName: 'Eyeglass Frame',
        price: 7500,
        quantity: 2,
      });

      // Qualifying Order 2: Branch B, 10,000 LKR with partial refund of 2,000 LKR
      const order2 = await Order.create({
        customerId: customerA._id,
        branchId: branchB._id,
        orderDate: now,
        orderAmount: 10000,
        status: 'PROCESSING',
      });
      await Payment.create({
        orderId: order2._id,
        amount: 10000,
        status: PAYMENT_STATUS.COMPLETED,
        refundAmount: 2000,
        refundedAt: now,
        method: PAYMENT_METHOD.CASH,
        paidAt: now,
      });
      await OrderItem.create({
        orderId: order2._id,
        itemName: 'Prescription Lens',
        price: 10000,
        quantity: 1,
      });

      // Non-qualifying Order 3: Cancelled order (4,000 LKR)
      await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 4000,
        status: 'CANCELLED',
      });

      // Non-qualifying Order 4: Pending payment
      const order4 = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 9000,
        status: 'PROCESSING',
      });
      await Payment.create({
        orderId: order4._id,
        amount: 9000,
        status: PAYMENT_STATUS.PENDING,
        method: PAYMENT_METHOD.CARD,
      });

      const res = await request(app)
        .get('/api/reports/sales')
        .query({ preset: 'today', groupBy: 'branch' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const summary = res.body.data.summary;
      // SM-01 Gross Revenue = 15,000 + 10,000 = 25,000
      expect(summary.grossRevenue).toBe(25000);
      // SM-02 Refund Deductions = 2,000
      expect(summary.refundDeductions).toBe(2000);
      // SM-03 Net Revenue = 25,000 - 2,000 = 23,000
      expect(summary.netRevenue).toBe(23000);
      // SM-04 Total Qualifying Orders = 2
      expect(summary.totalOrders).toBe(2);
      // SM-05 AOV = 25,000 / 2 = 12,500
      expect(summary.averageOrderValue).toBe(12500);
      // SM-06 Items Sold = 2 + 1 = 3
      expect(summary.itemsSold).toBe(3);
      // SM-10 Cancelled Orders = 1 count, 4,000 value
      expect(summary.cancelledOrdersCount).toBe(1);
      expect(summary.cancelledOrdersValue).toBe(4000);

      // Breakdowns
      expect(res.body.data.breakdowns.byBranch).toHaveLength(2);
      expect(res.body.data.breakdowns.byPaymentMethod).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'card', count: 1, volume: 15000 }),
          expect.objectContaining({ method: 'cash', count: 1, volume: 10000 }),
        ])
      );
    });

    it('enforces branch scoping for BRANCH_MANAGER', async () => {
      const now = new Date();
      // Order in Branch A
      const orderA = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 5000,
        status: 'COMPLETED',
      });
      await Payment.create({
        orderId: orderA._id,
        amount: 5000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CASH,
        paidAt: now,
      });

      // Order in Branch B
      const orderB = await Order.create({
        customerId: customerA._id,
        branchId: branchB._id,
        orderDate: now,
        orderAmount: 9000,
        status: 'COMPLETED',
      });
      await Payment.create({
        orderId: orderB._id,
        amount: 9000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      const res = await request(app)
        .get('/api/reports/sales')
        .query({ preset: 'today' })
        .set('Authorization', `Bearer ${branchManagerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.summary.grossRevenue).toBe(5000);
      expect(res.body.data.summary.netRevenue).toBe(5000);
      expect(res.body.data.summary.totalOrders).toBe(1);
      // ADR-014 restricted financial fields omitted for BRANCH_MANAGER
      expect(res.body.data.summary.refundDeductions).toBeUndefined();
      expect(res.body.data.summary.averageOrderValue).toBeUndefined();
      expect(res.body.data.breakdowns.byBranch[0].refundDeductions).toBeUndefined();
      // Period-wise net revenue present
      expect(res.body.data.breakdowns.byTime[0].netRevenue).toBe(5000);

      const resB = await request(app)
        .get('/api/reports/sales')
        .query({ preset: 'today' })
        .set('Authorization', `Bearer ${branchManagerBToken}`);

      expect(resB.status).toBe(200);
      expect(resB.body.data.summary.grossRevenue).toBe(9000);
      expect(resB.body.data.summary.netRevenue).toBe(9000);
      expect(resB.body.data.summary.totalOrders).toBe(1);
      expect(resB.body.data.summary.refundDeductions).toBeUndefined();
      expect(resB.body.data.summary.averageOrderValue).toBeUndefined();
      expect(resB.body.data.breakdowns.byTime[0].netRevenue).toBe(9000);
    });
  });

  describe('GET /api/reports/sales/orders - Detailed Listing & Privacy Masking', () => {
    it('returns masked customer PII and omits all clinical fields', async () => {
      const now = new Date();
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 18000,
        status: 'COMPLETED',
      });
      await Payment.create({
        orderId: order._id,
        amount: 18000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      const res = await request(app)
        .get('/api/reports/sales/orders')
        .query({ preset: 'today' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.orders).toHaveLength(1);
      const orderRecord = res.body.data.orders[0];

      // Privacy Masking Verification (ADR-014 §11.2)
      expect(orderRecord.customer.name).toBe('K*** P***');
      expect(orderRecord.customer.email).toBe('k***@gmail.com');
      expect(orderRecord.customer.phone).toBe('+94 77 **** 567');
      expect(orderRecord.customer.address).toBe('Colombo 03');

      // Clinical Data Elimination Verification (ADR-014 §11.1)
      expect(orderRecord).not.toHaveProperty('prescriptionId');
      expect(orderRecord).not.toHaveProperty('prescription');
      expect(orderRecord).not.toHaveProperty('sphere');
      expect(orderRecord).not.toHaveProperty('cylinder');
      expect(orderRecord).not.toHaveProperty('axis');
    });
  });

  describe('GET /api/reports/inventory & /api/reports/inventory/items', () => {
    beforeEach(async () => {
      const seeded = await Inventory.create([
        {
          itemName: 'RayBan Aviator Classic',
          category: 'Frames',
          brand: 'RayBan',
          price: 25000,
          quantity: 12, // OK
          branchId: branchA._id,
        },
        {
          itemName: 'Designer Acetate Frame',
          category: 'Frames',
          brand: 'Gucci',
          price: 45000,
          quantity: 3, // LOW_STOCK (threshold is 5)
          branchId: branchA._id,
        },
        {
          itemName: 'Contact Lens Solution',
          category: 'Accessories',
          brand: 'Bausch & Lomb',
          price: 3500,
          quantity: 0, // REORDER_TRIGGERED
          branchId: branchB._id,
        },
      ]);
      for (const item of seeded) {
        await evaluateReorderAlert(item, 5);
      }
    });

    it('returns inventory summary metrics and breakdowns', async () => {
      const res = await request(app)
        .get('/api/reports/inventory')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const summary = res.body.data.summary;
      // Total Stock on Hand = 12 + 3 + 0 = 15
      expect(summary.totalStockOnHand).toBe(15);
      // Retail Valuation = (12 * 25000) + (3 * 45000) + (0 * 3500) = 300,000 + 135,000 = 435,000
      expect(summary.totalRetailValuation).toBe(435000);
      expect(summary.lowStockCount).toBe(1);
      expect(summary.reorderTriggeredCount).toBe(1);
      expect(summary.okStockCount).toBe(1);

      // Category breakdown
      expect(res.body.data.breakdowns.byCategory).toHaveLength(2);
    });

    it('returns paginated items with live reorder states', async () => {
      const res = await request(app)
        .get('/api/reports/inventory/items')
        .query({ reorderStatus: 'REORDER_TRIGGERED' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].name).toBe('Contact Lens Solution');
      expect(res.body.data.items[0].reorderStatus).toBe('REORDER_TRIGGERED');
    });

    it('filters inventory by branch for BRANCH_MANAGER and omits totalRetailValuation', async () => {
      const res = await request(app)
        .get('/api/reports/inventory')
        .set('Authorization', `Bearer ${branchManagerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.summary.totalStockOnHand).toBe(15); // Items in Branch A
      expect(res.body.data.summary.reorderTriggeredCount).toBe(0); // Solution in Branch B excluded
      // ADR-014 restricted field totalRetailValuation omitted for BRANCH_MANAGER
      expect(res.body.data.summary.totalRetailValuation).toBeUndefined();
      expect(res.body.data.breakdowns.byBranch[0].totalRetailValuation).toBeUndefined();
      expect(res.body.data.breakdowns.byCategory[0].totalRetailValuation).toBeUndefined();
    });

    it('omits retailValuation in inventory items listing for BRANCH_MANAGER', async () => {
      const res = await request(app)
        .get('/api/reports/inventory/items')
        .set('Authorization', `Bearer ${branchManagerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
      expect(res.body.data.items[0].retailValuation).toBeUndefined();
    });
  });

  describe('CSV Exports & Audit Trail Integration', () => {
    it('exports sales report as CSV with audit log emission', async () => {
      const now = new Date();
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 12000,
        status: 'COMPLETED',
      });
      await Payment.create({
        orderId: order._id,
        amount: 12000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      const res = await request(app)
        .get('/api/reports/sales/export')
        .query({ preset: 'today', format: 'csv' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-correlation-id', 'test-export-sales-corr-123');

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('text/csv');
      expect(res.header['content-disposition']).toMatch(
        /attachment; filename="sales-report-.*\.csv"/
      );
      expect(res.text).toContain('Order ID,Payment ID,Order Date');
      expect(res.text).toContain('K*** P***');
      expect(res.text).toContain('Colombo 03');

      // Verify Audit Event was recorded in DB
      const auditEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.REPORT_EXPORT_GENERATED,
        correlationId: 'test-export-sales-corr-123',
      });
      expect(auditEvent).not.toBeNull();
      expect(auditEvent.targetType).toBe(AUDIT_TARGET_TYPE.REPORT);
      expect(auditEvent.targetId).toBe('SALES_REPORT');
      expect(auditEvent.actorRole).toBe(ROLE_VALUES.SYSTEM_ADMIN);
      expect(auditEvent.metadata.reportType).toBe('sales');
      expect(auditEvent.metadata.rowCount).toBe(1);
    });

    it('exports inventory report as CSV with audit log emission', async () => {
      await Inventory.create({
        itemName: 'Zeiss Anti-Reflective Lens',
        category: 'Lenses',
        brand: 'Zeiss',
        price: 18000,
        quantity: 10,
        branchId: branchA._id,
      });

      const res = await request(app)
        .get('/api/reports/inventory/export')
        .query({ format: 'csv' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-correlation-id', 'test-export-inv-corr-456');

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('text/csv');
      expect(res.header['content-disposition']).toMatch(
        /attachment; filename="inventory-report-.*\.csv"/
      );
      expect(res.text).toContain('SKU,Item Name,Category,Brand,Quantity,Unit Price (LKR)');
      expect(res.text).toContain('Zeiss Anti-Reflective Lens');

      // Verify Audit Event was recorded in DB
      const auditEvent = await AuditEvent.findOne({
        action: AUDIT_ACTION.REPORT_EXPORT_GENERATED,
        correlationId: 'test-export-inv-corr-456',
      });
      expect(auditEvent).not.toBeNull();
      expect(auditEvent.targetType).toBe(AUDIT_TARGET_TYPE.REPORT);
      expect(auditEvent.targetId).toBe('INVENTORY_REPORT');
      expect(auditEvent.actorRole).toBe(ROLE_VALUES.SYSTEM_ADMIN);
      expect(auditEvent.metadata.reportType).toBe('inventory');
      expect(auditEvent.metadata.rowCount).toBe(1);
    });

    it('exports sales report as multi-sheet Excel (.xlsx) by default with branch sheets', async () => {
      const now = new Date();

      // Order for Branch A
      const orderA = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderAmount: 8500,
        status: 'COMPLETED',
        orderDate: now,
      });
      await Payment.create({
        orderId: orderA._id,
        amount: 8500,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CASH,
        paidAt: now,
      });

      // Order for Branch B
      const orderB = await Order.create({
        customerId: customerA._id,
        branchId: branchB._id,
        orderAmount: 14000,
        status: 'COMPLETED',
        orderDate: now,
      });
      await Payment.create({
        orderId: orderB._id,
        amount: 14000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      const res = await request(app)
        .get('/api/reports/sales/export')
        .query({ preset: 'today' })
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((resBody, callback) => {
          const chunks = [];
          resBody.on('data', (chunk) => chunks.push(chunk));
          resBody.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(res.header['content-disposition']).toMatch(
        /attachment; filename="sales-report-.*\.xlsx"/
      );

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);

      const sheetNames = wb.worksheets.map((s) => s.name);
      expect(sheetNames).toContain('Executive Summary');
      expect(sheetNames).toContain('Branch Breakdowns');
      expect(sheetNames).toContain('Inventory Snapshot');
      expect(sheetNames).toContain('Orders Breakdown');
    });

    it('exports inventory report as multi-sheet Excel (.xlsx) with branch sheets', async () => {
      await Inventory.create([
        {
          itemName: 'RayBan Aviator Frame',
          category: 'Frames',
          brand: 'RayBan',
          price: 28000,
          quantity: 5,
          branchId: branchA._id,
        },
        {
          itemName: 'Crizal Sapphire Lens',
          category: 'Lenses',
          brand: 'Essilor',
          price: 15000,
          quantity: 8,
          branchId: branchB._id,
        },
      ]);

      const res = await request(app)
        .get('/api/reports/inventory/export')
        .query({ format: 'xlsx' })
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((resBody, callback) => {
          const chunks = [];
          resBody.on('data', (chunk) => chunks.push(chunk));
          resBody.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(res.header['content-disposition']).toMatch(
        /attachment; filename="inventory-report-.*\.xlsx"/
      );

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);

      const sheetNames = wb.worksheets.map((s) => s.name);
      expect(sheetNames).toContain('All Branches');
      expect(sheetNames).toContain(branchA.codeName);
      expect(sheetNames).toContain(branchB.codeName);
    });

    it('Finding 1: fails closed with 403 Forbidden when Branch Manager has malformed or invalid branch claim', async () => {
      const invalidBranchToken = createToken({
        role: ROLE_VALUES.BRANCH_MANAGER,
        branchId: 'invalid-not-an-objectid',
      });

      const resSales = await request(app)
        .get('/api/reports/sales')
        .query({ preset: 'today' })
        .set('Authorization', `Bearer ${invalidBranchToken}`);
      expect(resSales.status).toBe(403);
      expect(resSales.body.error?.message || resSales.body.message).toMatch(
        /invalid or missing branch assignment/i
      );

      const resInv = await request(app)
        .get('/api/reports/inventory')
        .set('Authorization', `Bearer ${invalidBranchToken}`);
      expect(resInv.status).toBe(403);
    });

    it('Finding 8: attributes refund strictly by Payment.refundedAt and excludes non-refunded updates', async () => {
      const today = new Date();
      const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

      const order = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: today,
        orderAmount: 10000,
        status: 'PROCESSING',
      });

      // Payment refunded today
      await Payment.create({
        orderId: order._id,
        amount: 10000,
        status: PAYMENT_STATUS.REFUNDED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        paidAt: today,
        refundedAt: today,
      });

      // Legacy payment without refundedAt (only updatedAt is today) - MUST NOT be counted as refunded today
      const legacyOrder = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: pastDate,
        orderAmount: 5000,
        status: 'CANCELLED',
      });
      await Payment.create({
        orderId: legacyOrder._id,
        amount: 5000,
        status: PAYMENT_STATUS.REFUNDED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        paidAt: pastDate,
        refundedAt: pastDate, // refunded in past period
      });

      const res = await request(app)
        .get('/api/reports/sales')
        .query({ preset: 'today' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // SM-02 should reflect ONLY the refund with refundedAt = today (10,000)
      expect(res.body.data.summary.refundDeductions).toBe(10000);
    });

    it('Finding 9: rejects orderStatus=CANCELLED with 422 on qualifying sales orders endpoint', async () => {
      const res = await request(app)
        .get('/api/reports/sales/orders')
        .query({ preset: 'today', orderStatus: 'CANCELLED' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      const errorField =
        res.body.error?.details?.[0]?.field ||
        res.body.errors?.[0]?.field ||
        res.body.error?.message;
      expect(errorField).toMatch(/orderStatus/i);
    });

    it('Second Re-Review Finding 6: SM-04 attributes operational volume to Order.createdAt while revenue follows Payment.paidAt', async () => {
      const orderDate = new Date('2024-05-01T10:00:00.000Z');
      const paymentDate = new Date('2024-05-15T10:00:00.000Z');

      const order = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate,
        createdAt: orderDate,
        orderAmount: 25000,
        status: 'PROCESSING',
      });

      await Payment.create({
        orderId: order._id,
        amount: 25000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        paidAt: paymentDate,
        createdAt: paymentDate,
      });

      // Window 1: Covers order creation date (May 01 - May 05)
      const resPeriod1 = await request(app)
        .get('/api/reports/sales')
        .query({ preset: 'custom', startDate: '2024-05-01', endDate: '2024-05-05' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resPeriod1.status).toBe(200);
      expect(resPeriod1.body.data.summary.totalOrders).toBe(1); // SM-04 operational order created
      expect(resPeriod1.body.data.summary.grossRevenue).toBe(0); // Paid in later period
      expect(resPeriod1.body.data.summary.averageOrderValue).toBe(0);

      // Window 2: Covers payment date (May 14 - May 16)
      const resPeriod2 = await request(app)
        .get('/api/reports/sales')
        .query({ preset: 'custom', startDate: '2024-05-14', endDate: '2024-05-16' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resPeriod2.status).toBe(200);
      expect(resPeriod2.body.data.summary.totalOrders).toBe(0); // Created in earlier period
      expect(resPeriod2.body.data.summary.grossRevenue).toBe(25000); // Financial revenue realized
      expect(resPeriod2.body.data.summary.averageOrderValue).toBe(0);

      // Window 3: Covers both dates (May 01 - May 20)
      const resFullPeriod = await request(app)
        .get('/api/reports/sales')
        .query({ preset: 'custom', startDate: '2024-05-01', endDate: '2024-05-20' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resFullPeriod.status).toBe(200);
      expect(resFullPeriod.body.data.summary.totalOrders).toBe(1);
      expect(resFullPeriod.body.data.summary.grossRevenue).toBe(25000);
      expect(resFullPeriod.body.data.summary.averageOrderValue).toBe(25000);
    });

    it('Third Re-Review Finding 3 & 4: populates accurate branch breakdown metrics (revenue, refunds, net, items sold) and exports them to Excel without zero fallbacks', async () => {
      const orderDate = new Date('2024-06-02T10:00:00.000Z');
      const paymentDate = new Date('2024-06-03T14:00:00.000Z');
      const refundDate = new Date('2024-06-04T16:00:00.000Z');

      const invItem = await Inventory.create({
        branchId: branchA._id,
        itemName: 'Branch A Frame',
        category: 'Frames',
        brand: 'Darshana',
        price: 7500,
        quantity: 10,
      });

      const order = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate,
        createdAt: orderDate,
        orderAmount: 15000,
        status: 'COMPLETED',
      });

      await OrderItem.create({
        orderId: order._id,
        inventoryId: invItem._id,
        fulfilledInventoryId: invItem._id,
        itemName: 'Branch A Frame',
        price: 7500,
        quantity: 2,
      });

      await Payment.create({
        orderId: order._id,
        amount: 15000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.ONLINE_GATEWAY,
        paidAt: paymentDate,
        createdAt: paymentDate,
        refundAmount: 3000,
        refundedAt: refundDate,
      });

      // 1. JSON Report Verification
      const resJson = await request(app)
        .get('/api/reports/sales')
        .query({ preset: 'custom', startDate: '2024-06-01', endDate: '2024-06-05', groupBy: 'day' })
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resJson.status).toBe(200);
      const summary = resJson.body.data.summary;
      expect(summary.grossRevenue).toBe(15000);
      expect(summary.refundDeductions).toBe(3000);
      expect(summary.netRevenue).toBe(12000);
      expect(summary.totalOrders).toBe(1);
      expect(summary.itemsSold).toBe(2);

      // Verify branch breakdown has non-zero calculated values
      const branchEntry = resJson.body.data.breakdowns.byBranch.find(
        (b) => b.branchId === branchA._id.toString()
      );
      expect(branchEntry).toBeDefined();
      expect(branchEntry.grossRevenue).toBe(15000);
      expect(branchEntry.refundDeductions).toBe(3000);
      expect(branchEntry.netRevenue).toBe(12000);
      expect(branchEntry.orderCount).toBe(1);
      expect(branchEntry.itemCount).toBe(2);

      // Verify SM-04 time series consistency:
      // Order was created on 2024-06-02 (orderCount: 1, grossRevenue: 0)
      // Payment was made on 2024-06-03 (orderCount: 0, grossRevenue: 15000)
      const day2Entry = resJson.body.data.breakdowns.byTime.find((t) => t.period === '2024-06-02');
      const day3Entry = resJson.body.data.breakdowns.byTime.find((t) => t.period === '2024-06-03');
      expect(day2Entry).toBeDefined();
      expect(day2Entry.orderCount).toBe(1);
      expect(day2Entry.grossRevenue).toBe(0);
      expect(day3Entry).toBeDefined();
      expect(day3Entry.orderCount).toBe(0);
      expect(day3Entry.grossRevenue).toBe(15000);

      // 2. Excel Export Verification
      const resExcel = await request(app)
        .get('/api/reports/sales/export')
        .query({ preset: 'custom', startDate: '2024-06-01', endDate: '2024-06-05' })
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((resBody, callback) => {
          const chunks = [];
          resBody.on('data', (chunk) => chunks.push(chunk));
          resBody.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(resExcel.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(resExcel.body);

      const branchSheet = wb.getWorksheet('Branch Breakdowns');
      expect(branchSheet).toBeDefined();

      let targetRow = null;
      branchSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1 && row.getCell(1).value === (branchA.codeName || branchA.name)) {
          targetRow = row;
        }
      });

      expect(targetRow).not.toBeNull();
      expect(targetRow.getCell(2).value).toBe('15000.00'); // Gross Revenue
      expect(targetRow.getCell(3).value).toBe('3000.00'); // Refund Deductions
      expect(targetRow.getCell(4).value).toBe('12000.00'); // Net Revenue
      expect(targetRow.getCell(5).value).toBe(1); // Total Orders
      expect(targetRow.getCell(6).value).toBe(2); // Items Sold
    });
  });
});
