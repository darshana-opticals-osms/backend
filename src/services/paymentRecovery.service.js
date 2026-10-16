const crypto = require('crypto');
const mongoose = require('mongoose');
const Payment = require('../models/payment.model');
const Order = require('../models/order.model');
const PaymentEvent = require('../models/paymentEvent.model');
const Evidence = require('../models/paymentRetrievalEvidence.model');
const { PayHereRetrievalAdapter } = require('./adapters/PayHereRetrievalAdapter');
const { formatAmount } = require('./adapters/PayHerePaymentAdapter');
const { loadConfig } = require('../config/env');
const { ROLE_VALUES } = require('../constants/roles');
const {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
} = require('../errors/AppError');
const { validatePaymentRecovery } = require('../validations/paymentRecovery.validation');
let cachedConfig;
let cachedAdapter;
function getAdapter(config) {
  const key = JSON.stringify([
    config.nodeEnv,
    config.payhereMode,
    config.payhereMerchantId,
    config.payhereApiAppId,
    config.payhereApiAppSecret,
    config.payhereRetrievalTimeoutMs,
  ]);
  if (key !== cachedConfig) {
    cachedAdapter = new PayHereRetrievalAdapter(config);
    cachedConfig = key;
  }
  return cachedAdapter;
}
function assertManager(auth, paymentId) {
  if (auth?.role !== ROLE_VALUES.BRANCH_MANAGER)
    throw new ForbiddenError('Payment recovery requires BRANCH_MANAGER.');
  if (!mongoose.isValidObjectId(auth.userId) || !mongoose.isValidObjectId(paymentId))
    throw new ValidationError('Invalid recovery identifiers.');
}
function shapeEvidence(evidence) {
  return {
    evidenceId: evidence._id.toString(),
    source: evidence.source,
    paymentId: evidence.paymentId.toString(),
    orderId: evidence.orderId.toString(),
    providerOrderId: evidence.providerOrderId,
    environment: evidence.environment,
    outcome: evidence.outcome,
    providerCode: evidence.providerCode,
    records: evidence.records.map((row) => ({
      providerTransactionId: row.providerTransactionId,
      providerOrderId: row.providerOrderId,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
    })),
    reconciliationReason: evidence.reconciliationReason || null,
    observedAt: evidence.observedAt,
    createdAt: evidence.createdAt,
  };
}
async function assess(payment, order, observation, session = null) {
  const records = observation.records;
  if (!records.length) return null; // Absence/pending/decline-or-error cannot prove no funds exist.
  if (
    records.some(
      (row) =>
        row.providerOrderId !== payment.providerOrderId ||
        row.amount !== formatAmount(payment.amount) ||
        row.currency !== payment.currency
    ) ||
    payment.amount !== order.orderAmount ||
    payment.currency !== 'LKR' ||
    (payment.providerTransactionId &&
      !records.some((row) => row.providerTransactionId === payment.providerTransactionId))
  )
    return 'RETRIEVAL_CONTEXT_MISMATCH';
  if (records.length > 1) return 'RETRIEVAL_MULTIPLE_PROVIDER_PAYMENTS';
  if (records[0].status === 'CHARGEBACKED') return 'RETRIEVAL_CHARGEBACK_REVIEW';
  if (records[0].status !== 'RECEIVED') return 'RETRIEVAL_REFUND_REVIEW';
  const proof = PaymentEvent.exists({
    paymentId: payment._id,
    statusCode: '2',
    action: 'applied',
    providerTransactionId: records[0].providerTransactionId,
  });
  if (session) proof.session(session);
  if (
    payment.status === 'completed' &&
    payment.providerTransactionId === records[0].providerTransactionId &&
    (await proof)
  )
    return null;
  if (
    ['failed', 'cancelled', 'refunded'].includes(payment.status) ||
    order.status !== 'ORDER_CREATED' ||
    !order.reservationExpiresAt ||
    order.reservationExpiresAt <= new Date()
  )
    return 'RETRIEVAL_LATE_SUCCESS';
  const otherConflict = Payment.exists({
    orderId: payment.orderId,
    _id: { $ne: payment._id },
    $or: [{ reconciliationRequired: true }, { status: { $in: ['completed', 'refunded'] } }],
  });
  if (session) otherConflict.session(session);
  if (await otherConflict) return 'RETRIEVAL_CONTEXT_MISMATCH';
  // ADR-011 sections 10/11 require verified IPN for completion. Do not synthesize one.
  return 'RETRIEVAL_SUCCESS_REQUIRES_IPN';
}
async function recoverPayment({ auth, paymentId, dryRun = true }) {
  assertManager(auth, paymentId);
  if (typeof dryRun !== 'boolean') throw new ValidationError('dryRun must be boolean.');
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) throw new NotFoundError('Payment attempt not found.', null, 'PAYMENT_NOT_FOUND');
  if (
    !payment.providerOrderId ||
    payment.provider !== 'payhere' ||
    payment.method !== 'online_gateway'
  )
    throw new ConflictError('Attempt cannot be retrieved.', null, 'PAYMENT_NOT_RETRIEVABLE');
  const config = loadConfig();
  // Network I/O always finishes before opening the MongoDB transaction.
  const observation = await getAdapter(config).searchPayments(payment.providerOrderId);
  const observedAt = new Date();
  const latestPayment = await Payment.findById(paymentId).lean();
  if (
    !latestPayment ||
    latestPayment.providerOrderId !== payment.providerOrderId ||
    !latestPayment.orderId.equals(payment.orderId)
  )
    throw new ConflictError('Payment context changed during verification.');
  const order = await Order.findById(payment.orderId).lean();
  if (!order) throw new NotFoundError('Order not found.', null, 'ORDER_NOT_FOUND');
  if (dryRun)
    return {
      dryRun: true,
      paymentId,
      orderId: order._id.toString(),
      paymentStatus: latestPayment.status,
      orderStatus: order.status,
      reconciliationRequired: latestPayment.reconciliationRequired === true,
      source: 'PAYHERE_RETRIEVAL_API',
      environment: config.payhereMode,
      ...observation,
      observedAt,
      proposedReconciliationReason: await assess(latestPayment, order, observation),
      completionPermitted: false,
    };
  const observationKey = crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        config.payhereMode,
        config.payhereMerchantId,
        payment.providerOrderId,
        observation,
      ])
    )
    .digest('hex');
  const session = await mongoose.startSession();
  let saved;
  let replay = false;
  try {
    await session.withTransaction(async () => {
      replay = false;
      const lockedOrder = await Order.findOneAndUpdate(
        { _id: payment.orderId },
        { $inc: { __v: 1 } },
        { session, new: true }
      );
      if (!lockedOrder) throw new NotFoundError('Order not found.');
      const current = await Payment.findById(paymentId).session(session);
      if (
        !current ||
        !current.orderId.equals(lockedOrder._id) ||
        current.providerOrderId !== payment.providerOrderId ||
        current.provider !== 'payhere' ||
        current.method !== 'online_gateway'
      )
        throw new ConflictError('Payment context changed during verification.');
      saved = await Evidence.findOne({ paymentId, observationKey }).session(session);
      const reason = await assess(current, lockedOrder, observation, session);
      // A matching capture still awaiting its authoritative IPN is evidence,
      // not a conflict. Never clear an existing hold or exempt terminal attempts.
      const awaitingIpn =
        reason === 'RETRIEVAL_SUCCESS_REQUIRES_IPN' &&
        ['pending', 'processing'].includes(current.status);
      if (reason && !awaitingIpn && !current.reconciliationRequired) {
        await Payment.updateOne(
          { _id: paymentId },
          { $set: { reconciliationRequired: true, reconciliationReason: reason } },
          { session }
        );
      }
      // Reassess even identical provider observations: expiry or a financial
      // conflict may have committed since this append-only snapshot was saved.
      if (saved) {
        replay = true;
        return;
      }
      [saved] = await Evidence.create(
        [
          {
            observationKey,
            paymentId,
            orderId: lockedOrder._id,
            providerOrderId: current.providerOrderId,
            environment: config.payhereMode,
            ...observation,
            observedAt,
            recordedBy: auth.userId,
            reconciliationReason: reason,
          },
        ],
        { session }
      );
    });
  } catch (error) {
    // Duplicate-key recovery runs only after withTransaction aborted; no operations
    // are attempted inside an already-aborted caller session.
    if (error.code !== 11000) throw error;
    saved = await Evidence.findOne({ paymentId, observationKey });
    if (!saved) throw error;
    replay = true;
  } finally {
    await session.endSession();
  }
  return { dryRun: false, replay, completionPermitted: false, evidence: shapeEvidence(saved) };
}
async function listRetrievalEvidence({ auth, paymentId, query = {} }) {
  assertManager(auth, paymentId);
  const errors = validatePaymentRecovery({ params: { paymentId }, query: {}, body: {} });
  for (const field of Object.keys(query))
    if (!['page', 'limit'].includes(field))
      errors.push({ field, message: 'Unsupported evidence query.' });
  for (const [field, max] of [
    ['page', 10000],
    ['limit', 100],
  ])
    if (
      query[field] !== undefined &&
      (typeof query[field] !== 'string' ||
        !/^[1-9]\d{0,4}$/.test(query[field]) ||
        Number(query[field]) > max)
    )
      errors.push({ field, message: 'Invalid pagination.' });
  if (errors.length) throw new ValidationError('Invalid evidence query.', errors);
  if (!(await Payment.exists({ _id: paymentId })))
    throw new NotFoundError('Payment attempt not found.');
  const page = Number(query.page || 1),
    limit = Number(query.limit || 25);
  const items = await Evidence.find({ paymentId })
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .maxTimeMS(5000)
    .lean();
  const total = await Evidence.countDocuments({ paymentId }).maxTimeMS(5000);
  return {
    items: items.map(shapeEvidence),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
module.exports = { recoverPayment, listRetrievalEvidence };
