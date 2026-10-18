const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Order = require('../../src/models/order.model');
const Payment = require('../../src/models/payment.model');
const OrderItem = require('../../src/models/orderItem.model');
const Branch = require('../../src/models/branch.model');
const Customer = require('../../src/models/customer.model');
const { ORDER_STATUS_VALUES } = require('../../src/constants/orderStatuses');
const { PAYMENT_STATUS, PAYMENT_METHOD } = require('../../src/constants/payment');
const { getSalesReport, getSalesOrdersList } = require('../../src/services/reportSales.service');

describe('reportSales.service (ADR-014 §6, §7, §8)', () => {
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
  });

  describe('Canonical Sale Invariants (AC3, AC4, AC5, AC6, AC7, AC8)', () => {
    it('includes qualifying completed payment with non-cancelled order in recognized sales', async () => {
      const now = new Date();
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 15000,
        status: ORDER_STATUS_VALUES.PROCESSING,
      });

      await Payment.create({
        orderId: order._id,
        amount: 15000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      await OrderItem.create({
        orderId: order._id,
        itemName: 'Ray-Ban Aviator',
        price: 15000,
        quantity: 1,
        classificationSnapshot: {
          category: 'Sunglasses',
          itemClassification: 'MERCHANDISE',
          loyaltyEligibility: 'ELIGIBLE',
          source: 'Inventory',
          sourceInventoryId: branchA._id,
        },
      });

      const report = await getSalesReport({ preset: 'today' });

      expect(report.success).toBe(true);
      expect(report.data.summary.grossRevenue).toBe(15000);
      expect(report.data.summary.netRevenue).toBe(15000);
      expect(report.data.summary.totalOrders).toBe(1);
      expect(report.data.summary.itemsSold).toBe(1);
      expect(report.data.summary.averageOrderValue).toBe(15000);
    });

    it('excludes ORDER_CREATED order even if payment document exists', async () => {
      const now = new Date();
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 5000,
        status: ORDER_STATUS_VALUES.ORDER_CREATED, // Uncommitted reservation
      });

      await Payment.create({
        orderId: order._id,
        amount: 5000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      const report = await getSalesReport({ preset: 'today' });

      expect(report.data.summary.grossRevenue).toBe(0);
      expect(report.data.summary.totalOrders).toBe(0);
      expect(report.data.summary.itemsSold).toBe(0);
    });

    it('excludes FAILED and PENDING payments from recognized revenue (AC6)', async () => {
      const now = new Date();
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 8000,
        status: ORDER_STATUS_VALUES.PROCESSING,
      });

      // Failed attempt
      await Payment.create({
        orderId: order._id,
        amount: 8000,
        status: PAYMENT_STATUS.FAILED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      const report = await getSalesReport({ preset: 'today' });

      expect(report.data.summary.grossRevenue).toBe(0);
      expect(report.data.summary.totalOrders).toBe(0);
    });

    it('excludes CANCELLED orders from recognized revenue and reports them under SM-10 (AC7)', async () => {
      const now = new Date();
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 12000,
        status: ORDER_STATUS_VALUES.CANCELLED,
      });

      await Payment.create({
        orderId: order._id,
        amount: 12000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      const report = await getSalesReport({ preset: 'today' });

      expect(report.data.summary.grossRevenue).toBe(0);
      expect(report.data.summary.totalOrders).toBe(0);
      expect(report.data.summary.cancelledOrdersCount).toBe(1);
      expect(report.data.summary.cancelledOrdersValue).toBe(12000);
    });

    it('deducts refund deductions correctly to produce Net Revenue (AC8, SM-02, SM-03)', async () => {
      const now = new Date();

      // Qualifying order of 20,000
      const order1 = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 20000,
        status: ORDER_STATUS_VALUES.COMPLETED,
      });

      await Payment.create({
        orderId: order1._id,
        amount: 20000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      // Refunded order of 5,000
      const order2 = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 5000,
        status: ORDER_STATUS_VALUES.COMPLETED,
      });

      await Payment.create({
        orderId: order2._id,
        amount: 5000,
        status: PAYMENT_STATUS.REFUNDED,
        refundAmount: 5000,
        method: PAYMENT_METHOD.CARD,
        refundedAt: now,
      });

      const report = await getSalesReport({ preset: 'today' });

      expect(report.data.summary.grossRevenue).toBe(20000);
      expect(report.data.summary.refundDeductions).toBe(5000);
      expect(report.data.summary.netRevenue).toBe(15000);
    });
  });

  describe('Breakdowns & Multi-Branch Scoping (AC11, AC25, AC30)', () => {
    it('groups sales by branch and category correctly', async () => {
      const now = new Date();

      // Branch A order
      const orderA = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 10000,
        status: ORDER_STATUS_VALUES.PROCESSING,
      });

      await Payment.create({
        orderId: orderA._id,
        amount: 10000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CASH,
        paidAt: now,
      });

      await OrderItem.create({
        orderId: orderA._id,
        itemName: 'Titanium Frame',
        price: 10000,
        quantity: 1,
        classificationSnapshot: {
          category: 'Frames',
          itemClassification: 'MERCHANDISE',
          loyaltyEligibility: 'ELIGIBLE',
          source: 'Inventory',
          sourceInventoryId: branchA._id,
        },
      });

      // Branch B order
      const orderB = await Order.create({
        customerId: customerA._id,
        branchId: branchB._id,
        orderDate: now,
        orderAmount: 6000,
        status: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
      });

      await Payment.create({
        orderId: orderB._id,
        amount: 6000,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      await OrderItem.create({
        orderId: orderB._id,
        itemName: 'Cleaning Solution',
        price: 3000,
        quantity: 2,
        classificationSnapshot: {
          category: 'Solutions',
          itemClassification: 'MERCHANDISE',
          loyaltyEligibility: 'ELIGIBLE',
          source: 'Inventory',
          sourceInventoryId: branchB._id,
        },
      });

      // 1. Organization-wide report
      const orgReport = await getSalesReport({ preset: 'today' });
      expect(orgReport.data.summary.grossRevenue).toBe(16000);
      expect(orgReport.data.summary.totalOrders).toBe(2);
      expect(orgReport.data.summary.itemsSold).toBe(3);
      expect(orgReport.data.breakdowns.byBranch.length).toBe(2);
      expect(orgReport.data.breakdowns.byCategory.length).toBe(2);

      // 2. Branch A scoped report
      const branchAReport = await getSalesReport({
        preset: 'today',
        branchId: branchA._id.toString(),
      });
      expect(branchAReport.data.summary.grossRevenue).toBe(10000);
      expect(branchAReport.data.summary.totalOrders).toBe(1);
      expect(branchAReport.data.breakdowns.byBranch.length).toBe(1);
      expect(branchAReport.data.breakdowns.byBranch[0].branchName).toBe('COLOMBO_CENTRAL');
    });
  });

  describe('Empty Results Handling (AC41)', () => {
    it('returns zeroed summary with empty lists when no records match (no 500/404)', async () => {
      const report = await getSalesReport({ startDate: '2020-01-01', endDate: '2020-01-05' });

      expect(report.success).toBe(true);
      expect(report.data.summary).toEqual({
        grossRevenue: 0,
        refundDeductions: 0,
        netRevenue: 0,
        totalOrders: 0,
        itemsSold: 0,
        averageOrderValue: 0,
        cancelledOrdersCount: 0,
        cancelledOrdersValue: 0,
      });
      expect(report.data.breakdowns.byTime).toEqual([]);
      expect(report.data.breakdowns.byBranch).toEqual([]);
      expect(report.data.breakdowns.byCategory).toEqual([]);
      expect(report.data.breakdowns.byPaymentMethod).toEqual([]);
    });
  });

  describe('getSalesOrdersList (Detailed Listing with PII Masking)', () => {
    it('returns paginated orders with masked customer PII and zero clinical data', async () => {
      const now = new Date();
      const order = await Order.create({
        customerId: customerA._id,
        branchId: branchA._id,
        orderDate: now,
        orderAmount: 9500,
        status: ORDER_STATUS_VALUES.PICKED_UP,
      });

      await Payment.create({
        orderId: order._id,
        amount: 9500,
        status: PAYMENT_STATUS.COMPLETED,
        method: PAYMENT_METHOD.CARD,
        paidAt: now,
      });

      await OrderItem.create({
        orderId: order._id,
        itemName: 'Prescription Frame',
        price: 9500,
        quantity: 1,
      });

      const listResult = await getSalesOrdersList({ preset: 'today', page: 1, limit: 10 });

      expect(listResult.success).toBe(true);
      expect(listResult.data.pagination.totalRecords).toBe(1);
      expect(listResult.data.orders.length).toBe(1);

      const orderItem = listResult.data.orders[0];
      expect(orderItem.orderAmount).toBe(9500);
      expect(orderItem.paidAmount).toBe(9500);
      expect(orderItem.customer).toEqual({
        name: 'K*** P***',
        email: 'k***@gmail.com',
        phone: '+94 77 **** 567',
        address: 'Colombo 03',
      });
      // Zero clinical fields
      expect(orderItem.prescription).toBeUndefined();
      expect(orderItem.clinicalNotes).toBeUndefined();
    });
  });
});
