const { ORDER_NOTIFICATION_MILESTONES } = require('../constants/orderNotification');

/**
 * Escapes special HTML characters to prevent HTML injection / XSS attacks.
 *
 * @param {string} str - Raw input string
 * @returns {string} Sanitized string
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
 * Extracts a friendly first name from the customer's full name.
 *
 * @param {string} [fullName]
 * @returns {string}
 */
function getCustomerFirstName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return 'Valued Customer';
  }
  const trimmed = fullName.trim();
  if (!trimmed) return 'Valued Customer';
  const parts = trimmed.split(/\s+/);
  return parts[0] || 'Valued Customer';
}

/**
 * Masks a delivery shipping address for privacy preservation (ADR-013 Section 13.1, 13.2).
 * Retains city/locality while masking sensitive house/building numbers.
 *
 * @param {string} [address]
 * @returns {string|null}
 */
function maskShippingAddress(address) {
  if (!address || typeof address !== 'string') return null;
  const trimmed = address.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(',').map((p) => p.trim());
  if (parts.length > 1) {
    // Mask first part (house/street number) and keep general locality/city
    const locality = parts.slice(1).join(', ');
    return `***, ${locality}`;
  }

  // Single segment address - mask first word and preserve remaining locality
  const words = trimmed.split(/\s+/);
  if (words.length > 1) {
    return `*** ${words.slice(1).join(' ')}`;
  }

  return '***';
}

/**
 * Builds the secure, canonical customer order tracking URL (ADR-013 Section 13.1).
 *
 * @param {string} orderId
 * @returns {string}
 */
function buildTrackingUrl(orderId) {
  const base = (process.env.TRACKING_PORTAL_BASE_URL || 'https://darshanaopticals.lk').replace(
    /\/$/,
    ''
  );
  return `${base}/orders/${encodeURIComponent(orderId)}/track`;
}

/**
 * Generates transactional email content (subject, text, html) for an approved order milestone.
 *
 * Implements ADR-013 Section 13 (Message Content, Minimization, and Privacy Boundaries):
 * - Centralized template ownership (AC31).
 * - Permitted content: customer friendly name, order reference, milestone update, masked shipping address, tracking portal URL.
 * - Strictly Prohibited (AC33, AC34, AC35, AC36):
 *   Zero clinical measurements, zero payment secrets, zero auth credentials, zero promotional bloat.
 *
 * @param {object} params
 * @param {string} params.milestone     - Canonical milestone from ORDER_NOTIFICATION_MILESTONES
 * @param {string} params.orderId       - Authoritative Order ID
 * @param {string} [params.customerName] - Customer display name
 * @param {string} [params.shippingAddress] - Optional raw delivery shipping address
 * @param {number} [params.orderAmount] - Optional total order amount in LKR
 * @returns {{ subject: string, text: string, html: string }}
 */
function buildOrderNotificationEmail({
  milestone,
  orderId,
  customerName,
  shippingAddress,
  orderAmount,
}) {
  const firstName = getCustomerFirstName(customerName);
  const safeName = escapeHtml(firstName);
  const safeOrderId = escapeHtml(orderId);
  const maskedAddress = maskShippingAddress(shippingAddress);
  const trackingUrl = buildTrackingUrl(orderId);
  const safeTrackingUrl = escapeHtml(trackingUrl);

  const formattedAmount =
    typeof orderAmount === 'number' && !Number.isNaN(orderAmount)
      ? `LKR ${orderAmount.toFixed(2)}`
      : null;

  let subject = '';
  let headline = '';
  let statusExplanation = '';
  let alertBoxHtml = '';
  let alertBoxText = '';

  switch (milestone) {
    case ORDER_NOTIFICATION_MILESTONES.MILESTONE_1_CONFIRMATION:
      subject = `Order Confirmed - Darshana Opticals (#${orderId})`;
      headline = 'Your Order Has Been Confirmed!';
      statusExplanation =
        'Thank you for your order. We have verified your payment and our optical laboratory has begun processing your order.';
      break;

    case ORDER_NOTIFICATION_MILESTONES.MILESTONE_2_DISPATCHED:
      subject = `Order Dispatched - Darshana Opticals (#${orderId})`;
      headline = 'Your Order is on the Way!';
      statusExplanation =
        'Your eyewear order has been assembled, quality inspected, and handed over to our delivery courier partner for delivery.';
      break;

    case ORDER_NOTIFICATION_MILESTONES.MILESTONE_3_FULFILLED:
      subject = `Order Delivered - Darshana Opticals (#${orderId})`;
      headline = 'Your Order Has Been Delivered!';
      statusExplanation =
        'Your order has been successfully delivered and completed. Thank you for choosing Darshana Opticals for your vision care needs.';
      alertBoxHtml = `
  <div style="background-color: #f7fafc; border-left: 4px solid #4299e1; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
    <h4 style="margin: 0 0 6px 0; color: #2b6cb0;">Eyewear Care Tips</h4>
    <p style="margin: 0; font-size: 14px; color: #4a5568;">
      Always clean your lenses with a microfiber cloth and lens solution. Keep your glasses stored safely in their case when not in use.
    </p>
  </div>`;
      alertBoxText =
        '\nEyewear Care Tips: Clean your lenses with a microfiber cloth and lens solution. Keep your glasses stored in their protective case when not in use.\n';
      break;

    case ORDER_NOTIFICATION_MILESTONES.MILESTONE_4_CANCELLED_UNPAID:
      subject = `Order Cancelled - Darshana Opticals (#${orderId})`;
      headline = 'Order Cancelled';
      statusExplanation =
        'Your pending order has been cancelled due to reservation expiry or explicit cancellation. Any reserved stock has been returned to inventory.';
      break;

    case ORDER_NOTIFICATION_MILESTONES.MILESTONE_5_CANCELLED_PAID:
    default:
      subject = `Order Cancelled - Darshana Opticals (#${orderId})`;
      headline = 'Order Cancelled';
      statusExplanation =
        'Your order has been cancelled by branch management due to a stock or technical exception.';
      alertBoxHtml = `
  <div style="background-color: #fff5f5; border-left: 4px solid #e53e3e; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
    <h4 style="margin: 0 0 6px 0; color: #9b2c2c;">Important Refund Information</h4>
    <p style="margin: 0; font-size: 14px; color: #4a5568;">
      Please contact your relevant Darshana Opticals branch directly to arrange offline refund reconciliation.
      <em>Refunds are not processed automatically by this notification.</em>
    </p>
  </div>`;
      alertBoxText =
        '\nImportant Refund Information: Please contact your relevant Darshana Opticals branch directly to arrange offline refund reconciliation. Refunds are not processed automatically by this notification.\n';
      break;
  }

  // ── Plain Text Content ────────────────────────────────────────────────────────
  let text = `Dear ${firstName},

${statusExplanation}

Order Reference: #${orderId}${formattedAmount ? `\nTotal Amount: ${formattedAmount}` : ''}${
    maskedAddress ? `\nDelivery Address: ${maskedAddress}` : ''
  }

Track your order in real time anytime at:
${trackingUrl}
${alertBoxText}
Thank you,
Darshana Opticals Team`;

  // ── HTML Content ─────────────────────────────────────────────────────────────
  let html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #2d3748; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
  <h2 style="color: #2b6cb0; margin-top: 0;">${escapeHtml(headline)}</h2>
  <p>Dear <strong>${safeName}</strong>,</p>
  <p>${escapeHtml(statusExplanation)}</p>

  <div style="background-color: #edf2f7; border-radius: 6px; padding: 14px 18px; margin: 18px 0;">
    <p style="margin: 4px 0; font-size: 14px;"><strong>Order Reference:</strong> #${safeOrderId}</p>
    ${formattedAmount ? `<p style="margin: 4px 0; font-size: 14px;"><strong>Total Amount:</strong> ${escapeHtml(formattedAmount)}</p>` : ''}
    ${maskedAddress ? `<p style="margin: 4px 0; font-size: 14px;"><strong>Delivery Destination:</strong> ${escapeHtml(maskedAddress)}</p>` : ''}
  </div>

  <div style="text-align: center; margin: 24px 0;">
    <a href="${safeTrackingUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #3182ce; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; display: inline-block;">
      View Real-Time Order Tracking
    </a>
  </div>
  ${alertBoxHtml}
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
  <p style="font-size: 13px; color: #a0aec0; margin-bottom: 0;">
    Thank you,<br/>
    <strong>Darshana Opticals Team</strong>
  </p>
</div>`;

  return { subject, text, html };
}

module.exports = {
  escapeHtml,
  getCustomerFirstName,
  maskShippingAddress,
  buildTrackingUrl,
  buildOrderNotificationEmail,
};
