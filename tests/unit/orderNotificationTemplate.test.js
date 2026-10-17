const {
  escapeHtml,
  getCustomerFirstName,
  maskShippingAddress,
  buildTrackingUrl,
  buildOrderNotificationEmail,
} = require('../../src/services/orderNotificationTemplate.service');
const { ORDER_NOTIFICATION_MILESTONES } = require('../../src/constants/orderNotification');

describe('OrderNotificationTemplateService (ADR-013 Section 13, AC31-AC36)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getCustomerFirstName()', () => {
    it('extracts the first word of a full name', () => {
      expect(getCustomerFirstName('Kasun Perera')).toBe('Kasun');
      expect(getCustomerFirstName('Nimal')).toBe('Nimal');
    });

    it('falls back gracefully to Valued Customer if null or whitespace', () => {
      expect(getCustomerFirstName(null)).toBe('Valued Customer');
      expect(getCustomerFirstName(undefined)).toBe('Valued Customer');
      expect(getCustomerFirstName('   ')).toBe('Valued Customer');
      expect(getCustomerFirstName(123)).toBe('Valued Customer');
    });
  });

  describe('maskShippingAddress() (ADR-013 Section 13.1, 13.2)', () => {
    it('masks the first street segment while retaining locality and city', () => {
      const masked = maskShippingAddress('45/2 Peradeniya Road, Kandy, Sri Lanka');
      expect(masked).toBe('***, Kandy, Sri Lanka');
    });

    it('masks short single-segment addresses safely', () => {
      expect(maskShippingAddress('Colombo')).toBe('***');
      expect(maskShippingAddress('Negombo Sri Lanka')).toBe('*** Sri Lanka');
    });

    it('returns null when address is not provided', () => {
      expect(maskShippingAddress(null)).toBeNull();
      expect(maskShippingAddress('')).toBeNull();
      expect(maskShippingAddress('   ')).toBeNull();
    });
  });

  describe('buildTrackingUrl()', () => {
    it('builds canonical order tracking link using env base URL', () => {
      process.env.TRACKING_PORTAL_BASE_URL = 'https://tracking.darshanaopticals.lk';
      const url = buildTrackingUrl('670c538f9b1e2a001f3e4b11');
      expect(url).toBe('https://tracking.darshanaopticals.lk/orders/670c538f9b1e2a001f3e4b11/track');
    });

    it('handles trailing slash in environment URL gracefully', () => {
      process.env.TRACKING_PORTAL_BASE_URL = 'https://darshanaopticals.lk/';
      const url = buildTrackingUrl('ORD-123');
      expect(url).toBe('https://darshanaopticals.lk/orders/ORD-123/track');
    });
  });

  describe('escapeHtml() (XSS Prevention)', () => {
    it('escapes dangerous HTML special characters', () => {
      const input = '<script>alert("XSS")</script> & \'hello\'';
      const escaped = escapeHtml(input);
      expect(escaped).toBe(
        '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt; &amp; &#39;hello&#39;'
      );
      expect(escaped).not.toContain('<script>');
    });
  });

  describe('buildOrderNotificationEmail() (Milestones 1–5)', () => {
    const defaultParams = {
      orderId: '670c538f9b1e2a001f3e4b11',
      customerName: 'Saman Kumara',
      shippingAddress: '12 Galle Road, Colombo 03',
      orderAmount: 14500,
    };

    it('generates Milestone 1: Order Confirmation & Receipt', () => {
      const email = buildOrderNotificationEmail({
        ...defaultParams,
        milestone: ORDER_NOTIFICATION_MILESTONES.MILESTONE_1_CONFIRMATION,
      });

      expect(email.subject).toContain('Order Confirmed');
      expect(email.subject).toContain(defaultParams.orderId);
      expect(email.text).toContain('Dear Saman');
      expect(email.text).toContain('verified your payment');
      expect(email.text).toContain('LKR 14500.00');
      expect(email.text).toContain('***, Colombo 03');
      expect(email.html).toContain('Your Order Has Been Confirmed!');
      expect(email.html).toContain('View Real-Time Order Tracking');
    });

    it('generates Milestone 2: Order Dispatched / On the Way', () => {
      const email = buildOrderNotificationEmail({
        ...defaultParams,
        milestone: ORDER_NOTIFICATION_MILESTONES.MILESTONE_2_DISPATCHED,
      });

      expect(email.subject).toContain('Order Dispatched');
      expect(email.text).toContain('handed over to our delivery courier partner');
      expect(email.html).toContain('Your Order is on the Way!');
    });

    it('generates Milestone 3: Fulfillment Complete with Care Instructions', () => {
      const email = buildOrderNotificationEmail({
        ...defaultParams,
        milestone: ORDER_NOTIFICATION_MILESTONES.MILESTONE_3_FULFILLED,
      });

      expect(email.subject).toContain('Order Delivered');
      expect(email.text).toContain('Eyewear Care Tips');
      expect(email.html).toContain('Eyewear Care Tips');
      expect(email.html).toContain('microfiber cloth');
    });

    it('generates Milestone 4: Order Cancelled (Unpaid / Reservation Expiry)', () => {
      const email = buildOrderNotificationEmail({
        ...defaultParams,
        milestone: ORDER_NOTIFICATION_MILESTONES.MILESTONE_4_CANCELLED_UNPAID,
      });

      expect(email.subject).toContain('Order Cancelled');
      expect(email.text).toContain('reservation expiry');
      expect(email.html).toContain('Order Cancelled');
    });

    it('generates Milestone 5: Order Cancelled (Paid / Managerial Exception)', () => {
      const email = buildOrderNotificationEmail({
        ...defaultParams,
        milestone: ORDER_NOTIFICATION_MILESTONES.MILESTONE_5_CANCELLED_PAID,
      });

      expect(email.subject).toContain('Order Cancelled');
      expect(email.text).toContain('Important Refund Information');
      expect(email.text).toContain('contact your relevant Darshana Opticals branch directly');
      expect(email.html).toContain('Important Refund Information');
    });
  });

  describe('Data Privacy and Prohibited Content Boundaries (AC33, AC34, AC35, AC36)', () => {
    it('strictly excludes clinical measurements, payment secrets, and auth credentials', () => {
      const email = buildOrderNotificationEmail({
        milestone: ORDER_NOTIFICATION_MILESTONES.MILESTONE_1_CONFIRMATION,
        orderId: '670c538f9b1e2a001f3e4b11',
        customerName: 'Anura Fernando',
        shippingAddress: '44 Kandy Road, Kiribathgoda',
        orderAmount: 8500,
      });

      const fullOutput = `${email.subject} ${email.text} ${email.html}`;

      // AC34 - Zero Clinical Measurements
      expect(fullOutput).not.toMatch(/SPH/i);
      expect(fullOutput).not.toMatch(/CYL/i);
      expect(fullOutput).not.toMatch(/Axis/i);
      expect(fullOutput).not.toMatch(/Visual Acuity/i);
      expect(fullOutput).not.toMatch(/Diopter/i);
      expect(fullOutput).not.toMatch(/Prescription/i);

      // AC33 - Zero Payment Secrets
      expect(fullOutput).not.toMatch(/card_number/i);
      expect(fullOutput).not.toMatch(/cvv/i);
      expect(fullOutput).not.toMatch(/merchant_secret/i);
      expect(fullOutput).not.toMatch(/md5sig/i);

      // AC35 - Zero Auth Credentials
      expect(fullOutput).not.toMatch(/password/i);
      expect(fullOutput).not.toMatch(/jwt/i);
      expect(fullOutput).not.toMatch(/bearer/i);

      // AC59 - Zero Promotional Bloat
      expect(fullOutput).not.toMatch(/discount/i);
      expect(fullOutput).not.toMatch(/promo/i);
      expect(fullOutput).not.toMatch(/loyalty points earned/i);
    });
  });
});
