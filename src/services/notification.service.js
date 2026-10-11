const nodemailer = require('nodemailer');

/**
 * Escapes special HTML characters to prevent HTML injection / XSS in email templates.
 *
 * @param {string} str - Raw input string
 * @returns {string} HTML-escaped string
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Creates and returns a Nodemailer transporter based on current environment variables.
 * Returns null if SMTP host/user/pass are not fully configured.
 *
 * @returns {import('nodemailer').Transporter|null}
 */
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user,
      pass,
    },
  });
}

/**
 * Builds the notification message contents (text and HTML) for an order cancellation.
 * Complies with ADR-004 §17:
 * - clearly states the order has been cancelled
 * - instructs the customer to contact the shop/branch directly for refunds
 * - clarifies that refunds are not processed automatically by this notification
 * - HTML-escapes customer-supplied inputs to protect against HTML injection.
 *
 * @param {object} params
 * @param {string} params.customerName
 * @param {string} params.orderId
 * @param {number} [params.orderAmount]
 * @returns {{ subject: string, text: string, html: string }}
 */
function buildCancellationEmailContent({ customerName, orderId, orderAmount }) {
  const rawName = customerName || 'Valued Customer';
  const safeHtmlName = escapeHtml(rawName);
  const formattedAmount =
    typeof orderAmount === 'number' ? ` (Amount: LKR ${orderAmount.toFixed(2)})` : '';

  const subject = `Order Cancelled - Darshana Opticals (#${orderId})`;

  const text = `Dear ${rawName},

Your order #${orderId}${formattedAmount} with Darshana Opticals has been cancelled.

Important Refund & Inquiry Information:
Please contact your relevant Darshana Opticals shop or branch directly to arrange and process any applicable refund. Please note that refunds are not processed automatically by this notification.

If you have any questions or require further assistance, our branch staff will be glad to assist you.

Thank you,
Darshana Opticals`;

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #2d3748; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
  <h2 style="color: #c53030; margin-top: 0;">Order Cancelled</h2>
  <p>Dear <strong>${safeHtmlName}</strong>,</p>
  <p>Your order <strong>#${escapeHtml(orderId)}</strong>${formattedAmount} has been cancelled.</p>
  <div style="background-color: #fff5f5; border-left: 4px solid #e53e3e; padding: 14px 18px; margin: 20px 0; border-radius: 4px;">
    <h4 style="margin: 0 0 6px 0; color: #9b2c2c;">Important Refund Information</h4>
    <p style="margin: 0; font-size: 14px; color: #4a5568;">
      Please contact your relevant <strong>Darshana Opticals</strong> shop or branch directly to arrange and process any applicable refund.
      <em>Please note that refunds are not processed automatically by this cancellation notification.</em>
    </p>
  </div>
  <p style="font-size: 14px; color: #718096; margin-bottom: 0;">
    Thank you,<br/>
    <strong>Darshana Opticals Team</strong>
  </p>
</div>`;

  return { subject, text, html };
}

/**
 * Sends an automated order cancellation notification to the affected customer.
 *
 * Implements ADR-004 §17:
 * - Dispatched when an Order transitions to CANCELLED.
 * - Non-blocking: failures or missing SMTP credentials log safely without
 *   breaking the status update transaction.
 * - Accurately reports whether delivery succeeded vs simulation/failure (Comment 2).
 * - Avoids logging customer PII (email addresses) to server logs (Comment 3).
 *
 * @param {object} params
 * @param {string} params.customerEmail - Recipient email address
 * @param {string} params.customerName  - Recipient display name
 * @param {string} params.orderId       - Cancelled Order ID
 * @param {number} [params.orderAmount] - Total order amount
 * @param {object} [options]
 * @param {import('nodemailer').Transporter} [options.transporter] - Optional injected transporter (for testing)
 * @returns {Promise<{ delivered: boolean, simulated: boolean, messageId?: string, reason?: string, error?: string }>}
 */
async function sendOrderCancellationNotification(
  { customerEmail, customerName, orderId, orderAmount },
  options = {}
) {
  if (!customerEmail) {
    console.warn(
      `[NotificationService] No customer email available for order #${orderId}; notification skipped.`
    );
    return { delivered: false, simulated: false, reason: 'MISSING_EMAIL' };
  }

  const { subject, text, html } = buildCancellationEmailContent({
    customerName,
    orderId,
    orderAmount,
  });

  const from = process.env.EMAIL_FROM || 'Darshana Opticals <noreply@darshanaopticals.com>';
  const activeTransporter = options.transporter || createTransporter();

  // If SMTP is not configured
  if (!activeTransporter) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        `[NotificationService] Production error: Cancellation email failed to dispatch for order #${orderId} because SMTP is unconfigured.`
      );
      return { delivered: false, simulated: false, reason: 'SMTP_UNCONFIGURED' };
    }

    // Local / Test development simulation without logging customer email (PII safe)
    console.info(
      `[NotificationService] [SIMULATED] Cancellation notice for order #${orderId} simulated (email delivery not performed due to unconfigured SMTP).`
    );
    return { delivered: false, simulated: true, reason: 'SMTP_UNCONFIGURED' };
  }

  try {
    const info = await activeTransporter.sendMail({
      from,
      to: customerEmail,
      subject,
      text,
      html,
    });

    return { delivered: true, simulated: false, messageId: info.messageId };
  } catch (err) {
    console.warn(
      `[NotificationService] Failed to send cancellation email for order #${orderId}: ${err.message}`
    );
    return { delivered: false, simulated: false, error: err.message };
  }
}

module.exports = {
  escapeHtml,
  createTransporter,
  buildCancellationEmailContent,
  sendOrderCancellationNotification,
};
