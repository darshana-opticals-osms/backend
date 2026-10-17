const Order = require('../models/order.model');
const Customer = require('../models/customer.model');
const OrderNotification = require('../models/orderNotification.model');
const {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PROVIDERS,
  DELIVERY_STATUS,
  NOTIFICATION_ERROR_CODES,
  getNotificationMilestone,
  generateNotificationIdempotencyKey,
} = require('../constants/orderNotification');
const { buildOrderNotificationEmail } = require('./orderNotificationTemplate.service');
const { createTransporter } = require('./notification.service');
const { domainEvents, ORDER_EVENTS } = require('../utils/domainEvents');

/**
 * Masks an email address for privacy-safe logging (ADR-013 Section 17, AC53).
 * Example: 'john.doe@example.com' -> 'j***@example.com'
 *
 * @param {string} [email]
 * @returns {string}
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '***';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const [name, domain] = parts;
  const maskedName = name.length > 1 ? `${name[0]}***` : '*';
  return `${maskedName}@${domain}`;
}

/**
 * Processes an order status change event and dispatches transactional notification if notifiable.
 *
 * Implements ADR-013:
 * - Section 5.1: Evaluates trigger matrix eligibility.
 * - Section 6: Derives Customer recipient from Order ownership (Order.customerId -> Customer.email).
 * - Section 9: Zero failure coupling (notification failures never roll back Order status).
 * - Section 10: Deterministic idempotency key to suppress duplicate dispatches.
 * - Section 11: Persists delivery outcome in `order_notifications` collection.
 * - Section 12: Bounded retry behavior for transient errors.
 * - Section 16 & 17: Safe environment-aware logging and simulation.
 *
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.orderId
 * @param {string} params.previousStatus
 * @param {string} params.targetStatus
 * @param {object} [options]
 * @param {import('nodemailer').Transporter} [options.transporter] - Optional injected transporter
 * @param {boolean} [options.skipBackoff=false] - For test speed
 * @returns {Promise<object>} Processing outcome
 */
async function processOrderNotification(params, options = {}) {
  const { orderId, previousStatus, targetStatus } = params || {};

  if (!orderId || !targetStatus) {
    return { handled: false, reason: 'INVALID_PAYLOAD' };
  }

  // 1. Evaluate Trigger Matrix (ADR-013 Section 5.1, AC3, AC5, AC6)
  const milestone = getNotificationMilestone(previousStatus, targetStatus);
  if (!milestone) {
    // Non-notifiable transition (e.g. PROCESSING -> READY_FOR_PICKUP) or invalid transition
    return { handled: false, reason: 'NOT_NOTIFIABLE' };
  }

  // 2. Resolve Authoritative Order & Customer (ADR-013 Section 6.1, AC8, AC9)
  const order = await Order.findById(orderId).lean();
  if (!order) {
    console.warn(`[OrderNotification] Order #${orderId} not found; notification skipped.`);
    return { handled: false, reason: 'ORDER_NOT_FOUND' };
  }

  const customer = await Customer.findById(order.customerId).lean();

  // 3. Compute Deterministic Idempotency Key (ADR-013 Section 10.1, AC19, AC20)
  const idempotencyKey = generateNotificationIdempotencyKey(orderId, targetStatus);

  // 4. Duplicate Check (ADR-013 Section 10.2, AC21, AC22)
  const existing = await OrderNotification.findOne({ idempotencyKey }).lean();
  if (
    existing &&
    [DELIVERY_STATUS.SENT, DELIVERY_STATUS.PENDING].includes(existing.deliveryStatus)
  ) {
    console.info(`[OrderNotification] Duplicate notification suppressed for ${idempotencyKey}`);
    return {
      handled: true,
      duplicate: true,
      idempotencyKey,
      deliveryStatus: existing.deliveryStatus,
    };
  }

  // 5. Missing / Invalid Contact Data Handling (ADR-013 Section 6.2, AC10)
  if (!customer || !customer.email || !customer.email.includes('@')) {
    console.warn(
      `[OrderNotification] Customer missing email for order #${orderId}; marked as FAILED.`
    );
    try {
      await OrderNotification.create({
        orderId: order._id,
        customerId: order.customerId,
        recipientEmail: 'missing-email@darshanaopticals.lk',
        triggerStatus: targetStatus,
        idempotencyKey,
        channel: NOTIFICATION_CHANNELS.EMAIL,
        deliveryStatus: DELIVERY_STATUS.FAILED,
        provider: NOTIFICATION_PROVIDERS.AWS_SES,
        attempts: 1,
        lastAttemptAt: new Date(),
        errorCode: NOTIFICATION_ERROR_CODES.MISSING_RECIPIENT_EMAIL,
      });
    } catch (err) {
      if (err.code === 11000) {
        console.info(`[OrderNotification] Duplicate notification suppressed for ${idempotencyKey}`);
      } else {
        throw err;
      }
    }
    return {
      handled: true,
      delivered: false,
      reason: NOTIFICATION_ERROR_CODES.MISSING_RECIPIENT_EMAIL,
    };
  }

  // Determine Effective Recipient based on environment (ADR-013 Section 16)
  const isStaging = process.env.NODE_ENV === 'staging';
  const effectiveRecipient = isStaging
    ? process.env.STAGING_NOTIFICATION_RECIPIENT || 'qa-test@darshanaopticals.lk'
    : customer.email;

  // 6. Record Initial PENDING State atomically (Review Point 2: Unique Constraint Claim)
  let notifRecord;
  try {
    notifRecord = await OrderNotification.create({
      orderId: order._id,
      customerId: order.customerId,
      recipientEmail: effectiveRecipient,
      triggerStatus: targetStatus,
      idempotencyKey,
      channel: NOTIFICATION_CHANNELS.EMAIL,
      provider: NOTIFICATION_PROVIDERS.AWS_SES,
      deliveryStatus: DELIVERY_STATUS.PENDING,
      attempts: 1,
      lastAttemptAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000) {
      console.info(`[OrderNotification] Duplicate notification suppressed for ${idempotencyKey}`);
      const existingDoc = await OrderNotification.findOne({ idempotencyKey }).lean();
      return {
        handled: true,
        duplicate: true,
        idempotencyKey,
        deliveryStatus: existingDoc?.deliveryStatus || DELIVERY_STATUS.PENDING,
      };
    }
    throw err;
  }

  // 7. Assemble Content via Centralized Template Service (ADR-013 Section 13, AC31-AC36)
  const { subject, text, html } = buildOrderNotificationEmail({
    milestone,
    orderId: order._id.toString(),
    customerName: customer.name,
    shippingAddress: customer.address,
    orderAmount: order.orderAmount,
  });

  const from =
    process.env.EMAIL_FROM ||
    process.env.SES_FROM_EMAIL ||
    'Darshana Opticals <noreply@darshanaopticals.lk>';

  // 8. Handle Missing Transporter / Environment Simulation (ADR-013 Section 16, AC50, AC51)
  const isNonProduction = ['development', 'test'].includes(process.env.NODE_ENV);
  let transporter = options.transporter || null;

  if (!transporter && isNonProduction) {
    // Non-production strictly defaults to simulated delivery unless explicit transporter was injected
    const simulatedMsgId = `simulated-${Date.now()}`;
    await OrderNotification.updateOne(
      { _id: notifRecord._id },
      {
        $set: {
          deliveryStatus: DELIVERY_STATUS.SENT,
          providerMessageId: simulatedMsgId,
          lastAttemptAt: new Date(),
          errorCode: null,
        },
      }
    );
    console.info(
      `[OrderNotification] [SIMULATED] Order #${orderId} milestone notification to ${maskEmail(effectiveRecipient)} simulated.`
    );
    return {
      handled: true,
      delivered: true,
      simulated: true,
      messageId: simulatedMsgId,
    };
  }

  if (!transporter) {
    transporter = createTransporter();
  }

  if (!transporter) {
    await OrderNotification.updateOne(
      { _id: notifRecord._id },
      {
        $set: {
          deliveryStatus: DELIVERY_STATUS.FAILED,
          errorCode: NOTIFICATION_ERROR_CODES.SMTP_UNCONFIGURED,
          lastAttemptAt: new Date(),
        },
      }
    );
    console.error(
      `[OrderNotification] ${process.env.NODE_ENV || 'Production'} error: Notification for order #${orderId} failed (SMTP unconfigured).`
    );
    return {
      handled: true,
      delivered: false,
      reason: NOTIFICATION_ERROR_CODES.SMTP_UNCONFIGURED,
    };
  }

  // 9. Dispatch with Bounded Retries (ADR-013 Section 12, AC27, AC28)
  const MAX_ATTEMPTS = 3;
  let attempt = 0;
  let sentInfo = null;
  let lastError = null;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    try {
      sentInfo = await transporter.sendMail({
        from,
        to: effectiveRecipient,
        subject,
        text,
        html,
      });
      break;
    } catch (err) {
      lastError = err;
      const isPermanent =
        err.code === 'INVALID_EMAIL' ||
        err.responseCode === 550 ||
        err.name === 'InvalidParameterException';
      if (isPermanent || attempt >= MAX_ATTEMPTS) {
        break;
      }
      if (process.env.NODE_ENV !== 'test' && !options.skipBackoff) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 100));
      }
    }
  }

  // 10. Persist Terminal Delivery Outcome (ADR-013 Section 11, AC29, AC30)
  if (sentInfo) {
    await OrderNotification.updateOne(
      { _id: notifRecord._id },
      {
        $set: {
          deliveryStatus: DELIVERY_STATUS.SENT,
          providerMessageId: sentInfo.messageId || 'sent',
          attempts: attempt,
          errorCode: null,
          lastAttemptAt: new Date(),
        },
      }
    );
    console.info(
      `[OrderNotification] Notification sent for order #${orderId} to ${maskEmail(effectiveRecipient)}`
    );
    return {
      handled: true,
      delivered: true,
      messageId: sentInfo.messageId,
      attempts: attempt,
    };
  }

  const safeErrorCode = lastError?.code || NOTIFICATION_ERROR_CODES.TRANSPORT_ERROR;
  await OrderNotification.updateOne(
    { _id: notifRecord._id },
    {
      $set: {
        deliveryStatus: DELIVERY_STATUS.FAILED,
        attempts: attempt,
        errorCode: safeErrorCode,
        lastAttemptAt: new Date(),
      },
    }
  );
  console.warn(`[OrderNotification] Notification failed for order #${orderId} (${safeErrorCode})`);
  return {
    handled: true,
    delivered: false,
    error: safeErrorCode,
    attempts: attempt,
  };
}

let isListenerRegistered = false;

/**
 * Initializes the asynchronous in-process listener for order status events.
 * Idempotent: will only attach one listener per process lifetime.
 */
function initOrderNotificationListener() {
  if (isListenerRegistered) return;

  domainEvents.on(ORDER_EVENTS.STATUS_CHANGED, async (eventPayload) => {
    try {
      await processOrderNotification(eventPayload);
    } catch (err) {
      // Non-blocking: Catch unexpected processing errors to prevent crashing process
      console.warn('[OrderNotificationListener] Unexpected listener error:', err.message);
    }
  });

  isListenerRegistered = true;
}

// Auto-register listener on module load
initOrderNotificationListener();

module.exports = {
  maskEmail,
  processOrderNotification,
  initOrderNotificationListener,
};
