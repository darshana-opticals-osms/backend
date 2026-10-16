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

/**
 * Builds the notification message contents (text and HTML) for a password reset request.
 * Complies with Issue #83 AC21 & AC24:
 * - includes Darshana Opticals password-reset subject
 * - includes the reset link
 * - includes 15-minute expiry notice
 * - includes instruction to ignore if not requested
 * - does not include passwords, hashes, JWTs, or unnecessary internal IDs.
 *
 * @param {object} params
 * @param {string} params.resetUrl - Full reset URL with single-use raw token
 * @param {number} [params.minutesValid=15] - Expiry duration in minutes
 * @returns {{ subject: string, text: string, html: string }}
 */
function buildPasswordResetEmailContent({ resetUrl, minutesValid = 15 }) {
  const safeResetUrl = escapeHtml(resetUrl);
  const subject = 'Password Reset Request - Darshana Opticals';

  const text = `Dear User,

We received a request to reset your password for your Darshana Opticals OSMS account.

You can reset your password by opening the following link in your web browser:
${resetUrl}

This link is valid for ${minutesValid} minutes from the time of issue.

If you did not request a password reset, you can safely ignore this email. Your account password will remain unchanged.

Thank you,
Darshana Opticals Team`;

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #2d3748; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
  <h2 style="color: #2b6cb0; margin-top: 0;">Password Reset Request</h2>
  <p>Dear User,</p>
  <p>We received a request to reset your password for your <strong>Darshana Opticals OSMS</strong> account.</p>
  <div style="text-align: center; margin: 28px 0;">
    <a href="${safeResetUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #3182ce; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">
      Reset Your Password
    </a>
  </div>
  <p style="font-size: 14px; color: #4a5568;">
    Or copy and paste the following URL into your browser:<br/>
    <a href="${safeResetUrl}" style="color: #3182ce; word-break: break-all;">${safeResetUrl}</a>
  </p>
  <div style="background-color: #ebf8ff; border-left: 4px solid #3182ce; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
    <p style="margin: 0; font-size: 14px; color: #2c5282;">
      <strong>Note:</strong> This link will expire in <strong>${minutesValid} minutes</strong>.
    </p>
  </div>
  <p style="font-size: 14px; color: #718096;">
    If you did not request a password reset, you can safely ignore this email. Your account remains secure and no changes have been made.
  </p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
  <p style="font-size: 13px; color: #a0aec0; margin-bottom: 0;">
    Thank you,<br/>
    <strong>Darshana Opticals Team</strong>
  </p>
</div>`;

  return { subject, text, html };
}

/**
 * Sends a password reset notification email.
 * Complies with Issue #83 AC20, AC21, AC23, AC24:
 * - reuses existing Nodemailer/SMTP transporter
 * - non-blocking safe operational logging (never logs raw token, reset URL, or passwords)
 * - safe fallback simulation when SMTP is not configured.
 *
 * @param {object} params
 * @param {string} params.to - Recipient email address
 * @param {string} params.resetUrl - Password reset URL
 * @param {number} [params.minutesValid=15] - Expiry minutes
 * @param {object} [options]
 * @param {import('nodemailer').Transporter} [options.transporter] - Optional injected transporter
 * @returns {Promise<{ delivered: boolean, simulated: boolean, messageId?: string, reason?: string, error?: string }>}
 */
async function sendPasswordResetNotification({ to, resetUrl, minutesValid = 15 }, options = {}) {
  if (!to || !resetUrl) {
    console.warn('[NotificationService] Missing recipient or resetUrl; notification skipped.');
    return { delivered: false, simulated: false, reason: 'MISSING_RECIPIENT_OR_URL' };
  }

  const { subject, text, html } = buildPasswordResetEmailContent({
    resetUrl,
    minutesValid,
  });

  const from = process.env.EMAIL_FROM || 'Darshana Opticals <noreply@darshanaopticals.com>';
  const activeTransporter = options.transporter || createTransporter();

  if (!activeTransporter) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[NotificationService] Production error: Password reset email failed to dispatch because SMTP is unconfigured.'
      );
      return { delivered: false, simulated: false, reason: 'SMTP_UNCONFIGURED' };
    }

    console.info(
      '[NotificationService] [SIMULATED] Password reset email simulated (email delivery not performed due to unconfigured SMTP).'
    );
    return { delivered: false, simulated: true, reason: 'SMTP_UNCONFIGURED' };
  }

  try {
    const info = await activeTransporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });

    return { delivered: true, simulated: false, messageId: info.messageId };
  } catch (err) {
    // AC24: Log only safe operational failure info. Never log raw token or reset URL.
    console.warn(`[NotificationService] Failed to send password reset email: ${err.message}`);
    return { delivered: false, simulated: false, error: err.message };
  }
}

module.exports = {
  escapeHtml,
  createTransporter,
  buildCancellationEmailContent,
  sendOrderCancellationNotification,
  buildPasswordResetEmailContent,
  sendPasswordResetNotification,
};
