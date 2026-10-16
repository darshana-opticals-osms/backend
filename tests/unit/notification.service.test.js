const {
  createTransporter,
  buildCancellationEmailContent,
  sendOrderCancellationNotification,
  buildPasswordResetEmailContent,
  sendPasswordResetNotification,
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

    it('escapes customer name in HTML to prevent HTML injection (Comment 3)', () => {
      const content = buildCancellationEmailContent({
        customerName: '<script>alert("xss")</script>',
        orderId: '60d5ec49f1b2c8b1f8e4e1a1',
      });

      expect(content.html).not.toContain('<script>');
      expect(content.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
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

    it('simulates notification gracefully when SMTP is not configured in development (Comment 2)', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const result = await sendOrderCancellationNotification({
        customerEmail: 'customer@example.com',
        customerName: 'Sunil',
        orderId: '60d5ec49f1b2c8b1f8e4e1a1',
        orderAmount: 5000,
      });

      expect(result.delivered).toBe(false);
      expect(result.simulated).toBe(true);
      expect(result.reason).toBe('SMTP_UNCONFIGURED');
    });

    it('returns delivered: false and simulated: false in production when SMTP is unconfigured (Comment 2)', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const result = await sendOrderCancellationNotification({
        customerEmail: 'customer@example.com',
        customerName: 'Sunil',
        orderId: '60d5ec49f1b2c8b1f8e4e1a1',
      });

      expect(result.delivered).toBe(false);
      expect(result.simulated).toBe(false);
      expect(result.reason).toBe('SMTP_UNCONFIGURED');
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

  describe('buildPasswordResetEmailContent (Issue #83 AC21)', () => {
    it('generates content conforming to Issue #83 AC21 requirements', () => {
      const resetUrl = 'https://app.darshanaopticals.com/reset-password?token=abcdef123456';
      const content = buildPasswordResetEmailContent({
        resetUrl,
        minutesValid: 15,
      });

      // 1. Darshana Opticals password-reset subject
      expect(content.subject).toContain('Password Reset Request - Darshana Opticals');

      // 2. Contains reset link
      expect(content.text).toContain(resetUrl);
      expect(content.html).toContain(resetUrl);

      // 3. 15-minute expiry notice
      expect(content.text).toMatch(/15 minutes/i);
      expect(content.html).toMatch(/15 minutes/i);

      // 4. Instruction to ignore if not requested
      expect(content.text).toMatch(/ignore this email/i);
      expect(content.html).toMatch(/ignore this email/i);

      // 5. Does not include password, hashes, JWTs, or internal database IDs
      expect(content.text).not.toMatch(/passwordHash/i);
      expect(content.text).not.toMatch(/jwt/i);
      expect(content.html).not.toMatch(/passwordHash/i);
      expect(content.html).not.toMatch(/jwt/i);
    });

    it('escapes reset URL to prevent HTML injection', () => {
      const dangerousUrl =
        'https://app.darshanaopticals.com/reset?token="><script>alert(1)</script>';
      const content = buildPasswordResetEmailContent({ resetUrl: dangerousUrl });

      expect(content.html).not.toContain('<script>');
      expect(content.html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  describe('sendPasswordResetNotification (Issue #83 AC20, AC23, AC24)', () => {
    it('returns missing recipient/url result when required fields are missing', async () => {
      const resultNoTo = await sendPasswordResetNotification({
        to: null,
        resetUrl: 'https://app.example.com/reset',
      });
      expect(resultNoTo.delivered).toBe(false);
      expect(resultNoTo.reason).toBe('MISSING_RECIPIENT_OR_URL');

      const resultNoUrl = await sendPasswordResetNotification({
        to: 'user@example.com',
        resetUrl: '',
      });
      expect(resultNoUrl.delivered).toBe(false);
      expect(resultNoUrl.reason).toBe('MISSING_RECIPIENT_OR_URL');
    });

    it('simulates notification when SMTP is unconfigured in development/test', async () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const result = await sendPasswordResetNotification({
        to: 'user@example.com',
        resetUrl: 'https://app.example.com/reset?token=123',
      });

      expect(result.delivered).toBe(false);
      expect(result.simulated).toBe(true);
      expect(result.reason).toBe('SMTP_UNCONFIGURED');
    });

    it('returns error result when SMTP is unconfigured in production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const result = await sendPasswordResetNotification({
        to: 'user@example.com',
        resetUrl: 'https://app.example.com/reset?token=123',
      });

      expect(result.delivered).toBe(false);
      expect(result.simulated).toBe(false);
      expect(result.reason).toBe('SMTP_UNCONFIGURED');
    });

    it('dispatches email through active transporter when configured', async () => {
      const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'reset-msg-1' });
      const mockTransporter = { sendMail: mockSendMail };

      const result = await sendPasswordResetNotification(
        {
          to: 'customer@example.com',
          resetUrl: 'https://app.example.com/reset-password?token=secrettoken',
        },
        { transporter: mockTransporter }
      );

      expect(result.delivered).toBe(true);
      expect(result.simulated).toBe(false);
      expect(result.messageId).toBe('reset-msg-1');
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const mailCallArgs = mockSendMail.mock.calls[0][0];
      expect(mailCallArgs.to).toBe('customer@example.com');
      expect(mailCallArgs.subject).toContain('Password Reset Request');
    });

    it('handles transporter rejection gracefully without leaking token or throwing', async () => {
      const mockSendMail = jest.fn().mockRejectedValue(new Error('SMTP Connection Refused'));
      const mockTransporter = { sendMail: mockSendMail };

      const result = await sendPasswordResetNotification(
        {
          to: 'customer@example.com',
          resetUrl: 'https://app.example.com/reset-password?token=secrettoken',
        },
        { transporter: mockTransporter }
      );

      expect(result.delivered).toBe(false);
      expect(result.simulated).toBe(false);
      expect(result.error).toBe('TRANSPORT_ERROR');
    });

    it('does not log untrusted error messages containing sensitive tokens or reset URLs (Review Finding 2)', async () => {
      const sensitiveToken = 'leak_candidate_token_123456';
      const sensitiveUrl = `https://app.example.com/reset?token=${sensitiveToken}`;
      const untrustedError = new Error(
        `Failed to deliver to user@example.com with reset link ${sensitiveUrl}`
      );
      untrustedError.code = 'ECONNRESET';
      const mockSendMail = jest.fn().mockRejectedValue(untrustedError);
      const mockTransporter = { sendMail: mockSendMail };

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await sendPasswordResetNotification(
        {
          to: 'user@example.com',
          resetUrl: sensitiveUrl,
        },
        { transporter: mockTransporter }
      );

      expect(result.delivered).toBe(false);
      expect(result.error).toBe('ECONNRESET');

      // Verify that console.warn did NOT leak the sensitive token, recipient email, or raw error message
      expect(warnSpy).toHaveBeenCalled();
      const loggedMessage = warnSpy.mock.calls.map((c) => c.join(' ')).join(' ');
      expect(loggedMessage).not.toContain(sensitiveToken);
      expect(loggedMessage).not.toContain('user@example.com');
      expect(loggedMessage).not.toContain('Failed to deliver');
      expect(loggedMessage).toContain('ECONNRESET');

      warnSpy.mockRestore();
    });
  });
});
