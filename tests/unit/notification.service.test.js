const {
  createTransporter,
  buildCancellationEmailContent,
  sendOrderCancellationNotification,
} = require('../../src/services/notification.service');

describe('NotificationService (ADR-004 §17)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('createTransporter', () => {
    it('returns null when SMTP environment variables are missing', () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const transporter = createTransporter();
      expect(transporter).toBeNull();
    });

    it('creates a transporter when SMTP host, user, and pass are provided', () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_USER = 'test@example.com';
      process.env.SMTP_PASS = 'secret123';
      process.env.SMTP_PORT = '465';
      process.env.SMTP_SECURE = 'true';

      const transporter = createTransporter();
      expect(transporter).toBeDefined();
      expect(transporter).not.toBeNull();
      expect(typeof transporter.sendMail).toBe('function');
    });
  });

  describe('buildCancellationEmailContent', () => {
    it('generates content conforming to ADR-004 §17 requirements', () => {
      const content = buildCancellationEmailContent({
        customerName: 'Nimal Perera',
        orderId: '60d5ec49f1b2c8b1f8e4e1a1',
        orderAmount: 15500,
      });

      expect(content.subject).toContain('Order Cancelled');
      expect(content.subject).toContain('60d5ec49f1b2c8b1f8e4e1a1');

      // ADR-004 §17 requirements:
      // 1. Clearly state order has been cancelled
      expect(content.text).toMatch(/order #60d5ec49f1b2c8b1f8e4e1a1.*has been cancelled/i);
      expect(content.html).toMatch(/order.*#60d5ec49f1b2c8b1f8e4e1a1.*has been cancelled/i);

      // 2. Instruct customer to contact shop/branch directly for refund
      expect(content.text).toMatch(
        /contact.*branch directly to arrange and process any applicable refund/i
      );
      expect(content.html).toMatch(
        /contact.*branch directly to arrange and process any applicable refund/i
      );

      // 3. Clarify that refunds are not processed automatically by this notification
      expect(content.text).toMatch(/refunds are not processed automatically/i);
      expect(content.html).toMatch(/refunds are not processed automatically/i);
    });

    it('falls back to default customer name when not supplied', () => {
      const content = buildCancellationEmailContent({
        orderId: '60d5ec49f1b2c8b1f8e4e1a1',
      });

      expect(content.text).toContain('Dear Valued Customer');
      expect(content.html).toContain('Valued Customer');
    });
  });

  describe('sendOrderCancellationNotification', () => {
    it('returns missing email result when customerEmail is empty', async () => {
      const result = await sendOrderCancellationNotification({
        customerEmail: null,
        customerName: 'Test Customer',
        orderId: '60d5ec49f1b2c8b1f8e4e1a1',
      });

      expect(result.delivered).toBe(false);
      expect(result.reason).toBe('MISSING_EMAIL');
    });

    it('simulates notification gracefully when SMTP is not configured', async () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const result = await sendOrderCancellationNotification({
        customerEmail: 'customer@example.com',
        customerName: 'Sunil',
        orderId: '60d5ec49f1b2c8b1f8e4e1a1',
        orderAmount: 5000,
      });

      expect(result.delivered).toBe(true);
      expect(result.simulated).toBe(true);
    });

    it('sends email using injected transporter when provided', async () => {
      const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'msg-123' });
      const mockTransporter = { sendMail: mockSendMail };

      const result = await sendOrderCancellationNotification(
        {
          customerEmail: 'customer@example.com',
          customerName: 'Sunil',
          orderId: '60d5ec49f1b2c8b1f8e4e1a1',
          orderAmount: 5000,
        },
        { transporter: mockTransporter }
      );

      expect(result.delivered).toBe(true);
      expect(result.simulated).toBe(false);
      expect(result.messageId).toBe('msg-123');
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const mailCallArgs = mockSendMail.mock.calls[0][0];
      expect(mailCallArgs.to).toBe('customer@example.com');
      expect(mailCallArgs.subject).toContain('Order Cancelled');
    });

    it('handles transporter sendMail rejection gracefully without throwing', async () => {
      const mockSendMail = jest.fn().mockRejectedValue(new Error('SMTP Connection Timeout'));
      const mockTransporter = { sendMail: mockSendMail };

      const result = await sendOrderCancellationNotification(
        {
          customerEmail: 'customer@example.com',
          customerName: 'Sunil',
          orderId: '60d5ec49f1b2c8b1f8e4e1a1',
        },
        { transporter: mockTransporter }
      );

      expect(result.delivered).toBe(false);
      expect(result.simulated).toBe(false);
      expect(result.error).toBe('SMTP Connection Timeout');
    });
  });
});
