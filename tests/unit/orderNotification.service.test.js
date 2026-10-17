const mongoose = require('mongoose');
const Order = require('../../src/models/order.model');
const Customer = require('../../src/models/customer.model');
const OrderNotification = require('../../src/models/orderNotification.model');
const {
  isNotifiableStatusTransition,
  getNotificationMilestone,
  generateNotificationIdempotencyKey,
  ORDER_NOTIFICATION_MILESTONES,
  DELIVERY_STATUS,
  NOTIFICATION_ERROR_CODES,
} = require('../../src/constants/orderNotification');
const { ORDER_STATUS_VALUES } = require('../../src/constants/orderStatuses');
const {
  maskEmail,
  processOrderNotification,
} = require('../../src/services/orderNotification.service');

describe('OrderNotificationService (ADR-013, Issue #60 AC1-AC30)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, NODE_ENV: 'test' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Trigger Matrix (ADR-013 Section 5.1, AC2, AC3, AC5, AC6)', () => {
    it('approves Milestone 1: ORDER_CREATED -> PROCESSING', () => {
      expect(
        isNotifiableStatusTransition(
          ORDER_STATUS_VALUES.ORDER_CREATED,
          ORDER_STATUS_VALUES.PROCESSING
        )
      ).toBe(true);
      expect(
        getNotificationMilestone(ORDER_STATUS_VALUES.ORDER_CREATED, ORDER_STATUS_VALUES.PROCESSING)
      ).toBe(ORDER_NOTIFICATION_MILESTONES.MILESTONE_1_CONFIRMATION);
    });

    it('rejects internal packaging transition: PROCESSING -> READY_FOR_PICKUP', () => {
      expect(
        isNotifiableStatusTransition(
          ORDER_STATUS_VALUES.PROCESSING,
          ORDER_STATUS_VALUES.READY_FOR_PICKUP
        )
      ).toBe(false);
      expect(
        getNotificationMilestone(
          ORDER_STATUS_VALUES.PROCESSING,
          ORDER_STATUS_VALUES.READY_FOR_PICKUP
        )
      ).toBeNull();
    });

    it('approves Milestone 2: READY_FOR_PICKUP -> PICKED_UP', () => {
      expect(
        isNotifiableStatusTransition(
          ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          ORDER_STATUS_VALUES.PICKED_UP
        )
      ).toBe(true);
      expect(
        getNotificationMilestone(
          ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          ORDER_STATUS_VALUES.PICKED_UP
        )
      ).toBe(ORDER_NOTIFICATION_MILESTONES.MILESTONE_2_DISPATCHED);
    });

    it('approves Milestone 3: PICKED_UP -> COMPLETED', () => {
      expect(
        isNotifiableStatusTransition(ORDER_STATUS_VALUES.PICKED_UP, ORDER_STATUS_VALUES.COMPLETED)
      ).toBe(true);
      expect(
        getNotificationMilestone(ORDER_STATUS_VALUES.PICKED_UP, ORDER_STATUS_VALUES.COMPLETED)
      ).toBe(ORDER_NOTIFICATION_MILESTONES.MILESTONE_3_FULFILLED);
    });

    it('approves Milestone 4: ORDER_CREATED -> CANCELLED', () => {
      expect(
        isNotifiableStatusTransition(
          ORDER_STATUS_VALUES.ORDER_CREATED,
          ORDER_STATUS_VALUES.CANCELLED
        )
      ).toBe(true);
      expect(
        getNotificationMilestone(ORDER_STATUS_VALUES.ORDER_CREATED, ORDER_STATUS_VALUES.CANCELLED)
      ).toBe(ORDER_NOTIFICATION_MILESTONES.MILESTONE_4_CANCELLED_UNPAID);
    });

    it('approves Milestone 5: PROCESSING -> CANCELLED', () => {
      expect(
        isNotifiableStatusTransition(ORDER_STATUS_VALUES.PROCESSING, ORDER_STATUS_VALUES.CANCELLED)
      ).toBe(true);
      expect(
        getNotificationMilestone(ORDER_STATUS_VALUES.PROCESSING, ORDER_STATUS_VALUES.CANCELLED)
      ).toBe(ORDER_NOTIFICATION_MILESTONES.MILESTONE_5_CANCELLED_PAID);
    });

    it('rejects invalid or terminal transitions (AC6)', () => {
      expect(
        isNotifiableStatusTransition(
          ORDER_STATUS_VALUES.ORDER_CREATED,
          ORDER_STATUS_VALUES.COMPLETED
        )
      ).toBe(false);
      expect(
        isNotifiableStatusTransition(ORDER_STATUS_VALUES.COMPLETED, ORDER_STATUS_VALUES.PROCESSING)
      ).toBe(false);
      expect(
        isNotifiableStatusTransition(ORDER_STATUS_VALUES.CANCELLED, ORDER_STATUS_VALUES.PROCESSING)
      ).toBe(false);
    });
  });

  describe('Deterministic Idempotency Key (ADR-013 Section 10.1, AC19, AC20)', () => {
    it('computes ORDER_NOTIF_{orderId}_{targetStatus}', () => {
      const orderId = new mongoose.Types.ObjectId();
      const key = generateNotificationIdempotencyKey(orderId, ORDER_STATUS_VALUES.PICKED_UP);
      expect(key).toBe(`ORDER_NOTIF_${orderId.toString()}_${ORDER_STATUS_VALUES.PICKED_UP}`);
    });
  });

  describe('maskEmail() Safe Logging (ADR-013 Section 17, AC53)', () => {
    it('masks the username portion of an email', () => {
      expect(maskEmail('customer@example.com')).toBe('c***@example.com');
      expect(maskEmail('a@b.com')).toBe('*@b.com');
      expect(maskEmail(null)).toBe('***');
      expect(maskEmail('')).toBe('***');
    });
  });

  describe('processOrderNotification() Orchestration Flow', () => {
    const mockOrderId = new mongoose.Types.ObjectId();
    const mockCustomerId = new mongoose.Types.ObjectId();

    beforeEach(() => {
      jest.spyOn(Order, 'findById').mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: mockOrderId,
          customerId: mockCustomerId,
          orderAmount: 9500,
          status: ORDER_STATUS_VALUES.PICKED_UP,
        }),
      });

      jest.spyOn(Customer, 'findById').mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: mockCustomerId,
          name: 'Nimali Jayawardena',
          email: 'nimali@example.com',
          address: '88 Kandy Road, Colombo',
        }),
      });

      jest.spyOn(OrderNotification, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      jest.spyOn(OrderNotification, 'create').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        idempotencyKey: `ORDER_NOTIF_${mockOrderId}_${ORDER_STATUS_VALUES.PICKED_UP}`,
      });

      jest.spyOn(OrderNotification, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    });

    it('skips non-notifiable status transitions without calling DB or transporter (AC3, AC5)', async () => {
      const mockTransporter = { sendMail: jest.fn() };
      const outcome = await processOrderNotification(
        {
          orderId: mockOrderId,
          previousStatus: ORDER_STATUS_VALUES.PROCESSING,
          targetStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
        },
        { transporter: mockTransporter }
      );

      expect(outcome.handled).toBe(false);
      expect(outcome.reason).toBe('NOT_NOTIFIABLE');
      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });

    it('successfully delivers notification through mock transporter and records SENT (AC11, AC12, AC26)', async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'msg-abc-123' }),
      };

      const outcome = await processOrderNotification(
        {
          orderId: mockOrderId,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        },
        { transporter: mockTransporter }
      );

      expect(outcome.handled).toBe(true);
      expect(outcome.delivered).toBe(true);
      expect(outcome.messageId).toBe('msg-abc-123');
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);

      expect(OrderNotification.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            deliveryStatus: DELIVERY_STATUS.SENT,
            providerMessageId: 'msg-abc-123',
            attempts: 1,
            errorCode: null,
          }),
        })
      );
    });

    it('suppresses duplicate notifications if already SENT (AC19, AC21, AC22)', async () => {
      jest.spyOn(OrderNotification, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          idempotencyKey: `ORDER_NOTIF_${mockOrderId}_${ORDER_STATUS_VALUES.PICKED_UP}`,
          deliveryStatus: DELIVERY_STATUS.SENT,
        }),
      });

      const mockTransporter = { sendMail: jest.fn() };
      const outcome = await processOrderNotification(
        {
          orderId: mockOrderId,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        },
        { transporter: mockTransporter }
      );

      expect(outcome.handled).toBe(true);
      expect(outcome.duplicate).toBe(true);
      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });

    it('atomically suppresses duplicate when concurrent OrderNotification.create throws E11000 (Review Point 2)', async () => {
      const dupError = new Error('E11000 duplicate key error');
      dupError.code = 11000;
      jest.spyOn(OrderNotification, 'create').mockRejectedValue(dupError);

      const mockTransporter = { sendMail: jest.fn() };
      const outcome = await processOrderNotification(
        {
          orderId: mockOrderId,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        },
        { transporter: mockTransporter }
      );

      expect(outcome.handled).toBe(true);
      expect(outcome.duplicate).toBe(true);
      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });

    it('redirects recipient strictly to staging inbox in staging environment (Review Point 3)', async () => {
      process.env.NODE_ENV = 'staging';
      process.env.STAGING_NOTIFICATION_RECIPIENT = 'qa-staging@darshanaopticals.lk';

      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'staging-msg-1' }),
      };

      const outcome = await processOrderNotification(
        {
          orderId: mockOrderId,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        },
        { transporter: mockTransporter }
      );

      expect(outcome.handled).toBe(true);
      expect(outcome.delivered).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'qa-staging@darshanaopticals.lk',
        })
      );
    });

    it('handles missing customer contact without failing or corrupting order (AC8, AC10)', async () => {
      jest.spyOn(Customer, 'findById').mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: mockCustomerId,
          name: 'Nimali Jayawardena',
          email: null,
        }),
      });

      const mockTransporter = { sendMail: jest.fn() };
      const outcome = await processOrderNotification(
        {
          orderId: mockOrderId,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        },
        { transporter: mockTransporter }
      );

      expect(outcome.handled).toBe(true);
      expect(outcome.delivered).toBe(false);
      expect(outcome.reason).toBe(NOTIFICATION_ERROR_CODES.MISSING_RECIPIENT_EMAIL);
      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });

    it('retries on transient provider failure and records FAILED without false positive (AC16, AC27, AC28, AC29)', async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockRejectedValue(new Error('SES Network Throttling')),
      };

      const outcome = await processOrderNotification(
        {
          orderId: mockOrderId,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        },
        { transporter: mockTransporter, skipBackoff: true }
      );

      expect(outcome.handled).toBe(true);
      expect(outcome.delivered).toBe(false);
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(3);

      expect(OrderNotification.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            deliveryStatus: DELIVERY_STATUS.FAILED,
            attempts: 3,
            errorCode: expect.any(String),
          }),
        })
      );
    });

    it('does not retry permanently failed emails infinitely (AC28)', async () => {
      const permanentError = new Error('Invalid email address');
      permanentError.code = 'INVALID_EMAIL';

      const mockTransporter = {
        sendMail: jest.fn().mockRejectedValue(permanentError),
      };

      const outcome = await processOrderNotification(
        {
          orderId: mockOrderId,
          previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
          targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
        },
        { transporter: mockTransporter, skipBackoff: true }
      );

      expect(outcome.handled).toBe(true);
      expect(outcome.delivered).toBe(false);
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);
    });

    it('safely simulates notification in development when transporter is unconfigured (AC50)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.SMTP_HOST;

      const outcome = await processOrderNotification({
        orderId: mockOrderId,
        previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
        targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
      });

      expect(outcome.handled).toBe(true);
      expect(outcome.delivered).toBe(true);
      expect(outcome.simulated).toBe(true);
    });

    it('marks as FAILED when SMTP is unconfigured in production (AC48)', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SMTP_HOST;

      const outcome = await processOrderNotification({
        orderId: mockOrderId,
        previousStatus: ORDER_STATUS_VALUES.READY_FOR_PICKUP,
        targetStatus: ORDER_STATUS_VALUES.PICKED_UP,
      });

      expect(outcome.handled).toBe(true);
      expect(outcome.delivered).toBe(false);
      expect(outcome.reason).toBe(NOTIFICATION_ERROR_CODES.SMTP_UNCONFIGURED);
    });
  });
});
