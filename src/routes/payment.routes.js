const express = require('express');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');
const {
  initiatePayment,
  getOwnOrderPaymentStatus,
  receivePayHereNotification,
  listManagementPayments,
  getManagementPayment,
  listManagementPaymentEvents,
  recordManualFullRefund,
  recoverPayment,
  listRetrievalEvidence,
} = require('../controllers/payment.controller');
const {
  validatePaymentInitiation,
  validatePaymentStatusRequest,
} = require('../validations/payment.validation');
const {
  validatePaymentMonitoringList,
  validatePaymentMonitoringDetail,
  validatePaymentMonitoringEvents,
} = require('../validations/paymentMonitoring.validation');
const { validatePaymentRecovery } = require('../validations/paymentRecovery.validation');

const paymentRouter = express.Router();
const paymentNotificationRouter = express.Router();

/**
 * @openapi
 * /payments/{paymentId}/recovery:
 *   post:
 *     summary: Investigate a PayHere attempt; optionally record reconciliation evidence
 *     description: BRANCH_MANAGER only. Defaults to dry-run and performs authenticated server-to-server Retrieval API reads only. Explicit dryRun false appends sanitized retrieval evidence and may flag unresolved financial discrepancies. No Payment/Order status change, IPN fabrication, flag clearing, refund, loyalty, Inventory or Cart effect. ADR-011 requires IPN for completion. Pending, absent and decline-or-error responses do not prove that no capture exists. Network calls precede the transaction. Provider failures return safe 503 errors with no evidence or financial writes.
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { $ref: '#/components/parameters/PaymentMonitoringId' }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             properties:
 *               dryRun: { type: boolean, default: true }
 *     responses:
 *       200:
 *         description: Read-only observation and proposed reason, or committed/replayed retrieval evidence. Never confirms OSMS payment completion.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   oneOf:
 *                     - $ref: '#/components/schemas/PaymentRecoveryPreview'
 *                     - type: object
 *                       properties:
 *                         dryRun: { type: boolean, enum: [false] }
 *                         replay: { type: boolean }
 *                         completionPermitted: { type: boolean, enum: [false] }
 *                         evidence: { $ref: '#/components/schemas/PaymentRetrievalEvidence' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       503:
 *         description: Retrieval not configured, upstream auth/timeout/invalid response/failure or rate limit. Rate-limit details include retryAfterSeconds; no upstream body or credentials.
 * /payments/{paymentId}/retrieval-evidence:
 *   get:
 *     summary: Read separately identified PayHere Retrieval API evidence
 *     description: BRANCH_MANAGER only. Historical retrieval observations, distinct from signed PaymentEvents. Safe metadata only; stable createdAt/ID descending pagination. Unknown query parameters are rejected.
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { $ref: '#/components/parameters/PaymentMonitoringId' }
 *       - { $ref: '#/components/parameters/PaymentMonitoringPage' }
 *       - { $ref: '#/components/parameters/PaymentMonitoringLimit' }
 *     responses:
 *       200:
 *         description: Sanitized retrieval evidence page.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/PaymentRetrievalEvidence' }
 *                     pagination: { $ref: '#/components/schemas/PaymentMonitoringPagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 * components:
 *   schemas:
 *     RetrievedPayment:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         providerTransactionId: { type: string }
 *         providerOrderId: { type: string }
 *         status: { type: string, enum: [RECEIVED, REFUND REQUESTED, REFUND PROCESSING, REFUNDED, CHARGEBACKED] }
 *         amount: { type: string, description: Canonical two-decimal amount. }
 *         currency: { type: string }
 *     PaymentRecoveryPreview:
 *       type: object
 *       properties:
 *         dryRun: { type: boolean, enum: [true] }
 *         paymentId: { type: string }
 *         orderId: { type: string }
 *         paymentStatus: { type: string }
 *         orderStatus: { type: string }
 *         reconciliationRequired: { type: boolean }
 *         source: { type: string, enum: [PAYHERE_RETRIEVAL_API] }
 *         environment: { type: string, enum: [sandbox, live] }
 *         outcome: { type: string, enum: [records, pending, not_found, declined_or_error] }
 *         providerCode: { type: integer, enum: [1, 0, -1, -2] }
 *         records:
 *           type: array
 *           items: { $ref: '#/components/schemas/RetrievedPayment' }
 *         observedAt: { type: string, format: date-time }
 *         proposedReconciliationReason: { type: string, nullable: true }
 *         completionPermitted: { type: boolean, enum: [false] }
 *     PaymentRetrievalEvidence:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         evidenceId: { type: string }
 *         source: { type: string, enum: [PAYHERE_RETRIEVAL_API] }
 *         paymentId: { type: string }
 *         orderId: { type: string }
 *         providerOrderId: { type: string }
 *         environment: { type: string, enum: [sandbox, live] }
 *         outcome: { type: string, enum: [records, pending, not_found, declined_or_error] }
 *         providerCode: { type: integer, enum: [1, 0, -1, -2] }
 *         records:
 *           type: array
 *           items: { $ref: '#/components/schemas/RetrievedPayment' }
 *         reconciliationReason: { type: string, nullable: true }
 *         observedAt: { type: string, format: date-time }
 *         createdAt: { type: string, format: date-time }
 */
paymentRouter.post(
  '/payments/:paymentId/recovery',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER),
  validate(validatePaymentRecovery),
  recoverPayment
);
paymentRouter.get(
  '/payments/:paymentId/retrieval-evidence',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER),
  listRetrievalEvidence
);

/**
 * @openapi
 * /payments/{paymentId}/refunds:
 *   post:
 *     summary: Record an already executed manual full refund
 *     description: BRANCH_MANAGER only. This does NOT transfer funds. The manager confirms an external full refund through the PayHere portal or corporate bank transfer. Requires matching verified capture and full amount/currency. An existing earning requires a durable compensating reversal; a pre-completion Order with a valid never-COMPLETED status history, no Payment loyalty events and consistent Customer balance needs no reversal. Completed Orders with missing earning history, reconciliation, unsafe balances or conflicting evidence return 409 and roll back all changes. Payment, audit evidence and required loyalty reversal commit atomically; Order status and inventory never change. An identical actor/key/body replay verifies the same durable outcome. Partial refunds and reconciliation resolution are not supported.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { $ref: '#/components/parameters/PaymentMonitoringId' }
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema: { type: string, minLength: 1, maxLength: 120 }
 *         description: Stable nonempty scalar key without control characters, reused for identical retries only.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [amount, currency]
 *             properties:
 *               amount: { type: number, minimum: 0, multipleOf: 0.01, description: Must match the full original captured amount. }
 *               currency: { type: string, enum: [LKR] }
 *               refundChannel: { type: string, enum: [payhere_portal, bank_transfer] }
 *               refundReference: { type: string, minLength: 1, maxLength: 120, description: Optional sanitized external reference; never raw receipts or credentials. }
 *     responses:
 *       200:
 *         description: Recorded full refund or verified identical replay.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     paymentId: { type: string }
 *                     orderId: { type: string }
 *                     status: { type: string, enum: [refunded] }
 *                     amount: { type: number }
 *                     currency: { type: string, enum: [LKR] }
 *                     refundEvidence: { $ref: '#/components/schemas/ManualRefundEvidence' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 */
paymentRouter.post(
  '/payments/:paymentId/refunds',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER),
  validate((req) =>
    Object.keys(req.query).length
      ? [{ field: 'query', message: 'Query parameters are not supported.' }]
      : []
  ),
  recordManualFullRefund
);

/**
 * @openapi
 * /payments/notify:
 *   post:
 *     summary: Receive a PayHere server-to-server payment notification
 *     description: Public provider callback. Trust is established by PayHere merchant and MD5 signature verification, not JWT authentication. Accepts only allowlisted form-encoded PayHere fields. Optional metadata is not signed financial authority; only documented method labels are retained as providerPaymentMethod, while unknown labels, captured_amount, recurring, card, custom and message fields are discarded. Browser return and cancel URLs are not payment proof. A separate configurable per-IP callback rate limit protects processing and permits provider retries.
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [merchant_id, order_id, payment_id, payhere_amount, payhere_currency, status_code, md5sig]
 *             properties:
 *               merchant_id: { type: string }
 *               order_id: { type: string, description: Unique OSMS Payment-attempt reference. }
 *               payment_id: { type: string }
 *               payhere_amount: { type: string, pattern: '^\\d+\\.\\d{2}$' }
 *               payhere_currency: { type: string, enum: [LKR] }
 *               status_code: { type: string, enum: ['2', '0', '-1', '-2', '-3'] }
 *               md5sig: { type: string, writeOnly: true }
 *               captured_amount: { type: string, pattern: '^\\d+\\.\\d{2}$', description: Optional sandbox provider metadata; not used to determine financial state. }
 *               recurring: { type: string, description: Optional unsigned provider metadata; discarded and does not enable recurring payments. }
 *               custom_1: { type: string }
 *               custom_2: { type: string }
 *               method: { type: string, description: Optional unsigned display metadata. Only documented payment-method labels are retained; unknown labels are accepted but discarded. }
 *               status_message: { type: string }
 *               card_holder_name: { type: string, writeOnly: true }
 *               card_no: { type: string, writeOnly: true, description: Provider-masked card metadata; discarded. }
 *               card_expiry: { type: string, writeOnly: true }
 *     responses:
 *       200: { description: Verified notification acknowledged, including idempotent replay. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       429:
 *         description: Callback rate limit exceeded; no financial state changed. Retry after the indicated interval.
 *         headers:
 *           Retry-After: { schema: { type: integer }, description: Seconds until the rate-limit window resets. }
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       503: { $ref: '#/components/responses/PaymentUnavailable' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 */
paymentNotificationRouter.post('/', receivePayHereNotification);

/**
 * @openapi
 * /payments/initiate:
 *   post:
 *     summary: Initiate or reuse PayHere checkout for the customer's own Order
 *     description: CUSTOMER-only. The backend derives ownership, amount, LKR currency, online_gateway method, expiry and provider attempt identity. Validated billing fields override profile defaults for this checkout request only and do not update the Customer profile. Missing gateway configuration returns 503 PAYMENT_UNAVAILABLE before persistence. Initiation builds a hosted-checkout form locally; it does not probe provider website availability or charge funds. Expired local sessions close with session_expired; this does not extend the original Order deadline or permit payment after reservation expiry.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [orderId, city]
 *             properties:
 *               orderId: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *               city: { type: string, maxLength: 120, description: Billing city for this checkout request. }
 *               firstName: { type: string, maxLength: 120, description: Optional billing override; otherwise defaults from the Customer profile. }
 *               lastName: { type: string, maxLength: 120, description: Optional billing override; otherwise defaults from the Customer profile. }
 *               address: { type: string, maxLength: 120, description: Optional billing override; otherwise defaults from the Customer profile. }
 *     responses:
 *       201: { description: Safe PayHere hosted-checkout fields and Payment status. }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       503: { $ref: '#/components/responses/PaymentUnavailable' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 */
paymentRouter.post(
  '/payments/initiate',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(validatePaymentInitiation),
  initiatePayment
);

/**
 * @openapi
 * /orders/{orderId}/payment-status:
 *   get:
 *     summary: Retrieve authoritative payment status for the customer's own Order
 *     description: CUSTOMER-only and ownership scoped. Provider internals, signatures and secrets are excluded.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *     responses:
 *       200:
 *         description: Safe Order-level payment summary with latest, completed and historical attempt information.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     orderId: { type: string }
 *                     orderStatus: { type: string }
 *                     summary:
 *                       type: object
 *                       properties:
 *                         paid: { type: boolean }
 *                         reconciliationRequired: { type: boolean }
 *                         activeAttempt: { type: boolean }
 *                         attemptCount: { type: integer }
 *                     latestAttempt: { type: object, nullable: true }
 *                     completedAttempt: { type: object, nullable: true }
 *                     attempts:
 *                       type: array
 *                       items: { type: object }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 */
paymentRouter.get(
  '/orders/:orderId/payment-status',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(validatePaymentStatusRequest),
  getOwnOrderPaymentStatus
);

/**
 * @openapi
 * components:
 *   schemas:
 *     ManagementPayment:
 *       type: object
 *       additionalProperties: false
 *       description: Approved financial metadata only. Known backend reason codes are returned; unknown or free-text legacy reasons are null. No customer profile, credentials, signatures, raw callback bodies, or idempotency keys.
 *       properties:
 *         paymentId: { type: string }
 *         orderId: { type: string }
 *         amount: { type: number }
 *         currency: { type: string, enum: [LKR] }
 *         method: { type: string, enum: [card, cash, bank_transfer, online_gateway] }
 *         status: { type: string, enum: [pending, processing, completed, failed, cancelled, refunded] }
 *         provider: { type: string, enum: [payhere] }
 *         providerOrderId: { type: string, nullable: true }
 *         providerTransactionId: { type: string, nullable: true }
 *         providerPaymentMethod: { type: string, nullable: true }
 *         failureReason: { type: string, nullable: true }
 *         expiresAt: { type: string, format: date-time, nullable: true }
 *         reconciliationRequired: { type: boolean }
 *         reconciliationReason: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *         refundEvidence:
 *           $ref: '#/components/schemas/ManualRefundEvidence'
 *     ManualRefundEvidence:
 *       type: object
 *       nullable: true
 *       additionalProperties: false
 *       description: Present only on single-Payment detail; null when absent. Sanitized append-only external full-refund metadata, BRANCH_MANAGER only. Evidence does not itself imply refunded status or completed loyalty reversal. Never includes internal keys, hashes, or raw receipts.
 *       properties:
 *         evidenceId: { type: string }
 *         paymentId: { type: string }
 *         orderId: { type: string }
 *         providerOrderId: { type: string, nullable: true }
 *         providerTransactionId: { type: string, nullable: true }
 *         amount: { type: number }
 *         currency: { type: string, enum: [LKR] }
 *         refundChannel: { type: string, enum: [payhere_portal, bank_transfer], nullable: true }
 *         refundReference: { type: string, nullable: true }
 *         recordedBy: { type: string }
 *         createdAt: { type: string, format: date-time }
 *     ManagementPaymentEvent:
 *       type: object
 *       additionalProperties: false
 *       description: Stored verified evidence; not every event applies a Payment state transition. Event amount and currency are provider observations, including mismatches. Unknown/free-text reasons are null. Signatures, event keys and raw payloads are never returned.
 *       properties:
 *         eventId: { type: string }
 *         paymentId: { type: string }
 *         orderId: { type: string }
 *         provider: { type: string, enum: [payhere] }
 *         providerOrderId: { type: string }
 *         providerTransactionId: { type: string, nullable: true }
 *         statusCode: { type: string, enum: ['2', '0', '-1', '-2', '-3'] }
 *         amount: { type: string }
 *         currency: { type: string, description: Observed provider currency; may differ from expected LKR. }
 *         action: { type: string, enum: [applied, duplicate, reconciliation_required] }
 *         reason: { type: string, nullable: true }
 *         verifiedAt: { type: string, format: date-time }
 *         createdAt: { type: string, format: date-time }
 *     PaymentMonitoringPagination:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         page: { type: integer, minimum: 1, maximum: 10000 }
 *         limit: { type: integer, minimum: 1, maximum: 100 }
 *         total: { type: integer, minimum: 0 }
 *         totalPages: { type: integer, minimum: 0 }
 *     ManagementPaymentListResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         data:
 *           type: object
 *           properties:
 *             items:
 *               type: array
 *               items: { $ref: '#/components/schemas/ManagementPayment' }
 *             pagination: { $ref: '#/components/schemas/PaymentMonitoringPagination' }
 *     ManagementPaymentEventListResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         data:
 *           type: object
 *           properties:
 *             items:
 *               type: array
 *               items: { $ref: '#/components/schemas/ManagementPaymentEvent' }
 *             pagination: { $ref: '#/components/schemas/PaymentMonitoringPagination' }
 *   parameters:
 *     PaymentMonitoringPage:
 *       in: query
 *       name: page
 *       schema: { type: integer, minimum: 1, maximum: 10000, default: 1 }
 *     PaymentMonitoringLimit:
 *       in: query
 *       name: limit
 *       schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     PaymentMonitoringSortOrder:
 *       in: query
 *       name: sortOrder
 *       schema: { type: string, enum: [asc, desc], default: desc }
 *     PaymentMonitoringProviderReference:
 *       in: query
 *       name: providerTransactionId
 *       description: Exact, case-sensitive scalar reference; no regex matching. At most 120 characters and no control characters.
 *       schema: { type: string, minLength: 1, maxLength: 120 }
 *     PaymentMonitoringId:
 *       in: path
 *       name: paymentId
 *       required: true
 *       schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 * /payments:
 *   get:
 *     summary: Monitor historical Payment attempts
 *     description: BRANCH_MANAGER only; role-wide oversight matching existing Order tracking. Read-only. Filters combine with AND and include every historical attempt, not just the latest. Provider reference filters the stored Payment reference, not event-only references. Unknown parameters and array/object values are rejected. Live pagination uses a stable ID tie-breaker; concurrent callbacks may change totals between reads. Default order is createdAt descending.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { $ref: '#/components/parameters/PaymentMonitoringPage' }
 *       - { $ref: '#/components/parameters/PaymentMonitoringLimit' }
 *       - { $ref: '#/components/parameters/PaymentMonitoringSortOrder' }
 *       - { $ref: '#/components/parameters/PaymentMonitoringProviderReference' }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, updatedAt, amount, status], default: createdAt }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, processing, completed, failed, cancelled, refunded] }
 *       - in: query
 *         name: orderId
 *         schema: { type: string, pattern: '^[a-fA-F0-9]{24}$' }
 *       - in: query
 *         name: reconciliationRequired
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: Safe historical Payment page, including reconciliation flags.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ManagementPaymentListResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 * /payments/{paymentId}:
 *   get:
 *     summary: Inspect one Payment attempt
 *     description: BRANCH_MANAGER only. Read-only safe financial metadata, including sanitized refundEvidence or null. Evidence alone does not imply Payment refunded or loyalty reversal. No query parameters accepted; no automatic reconciliation clearing or status mutation.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { $ref: '#/components/parameters/PaymentMonitoringId' }
 *     responses:
 *       200:
 *         description: Safe Payment attempt detail.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/ManagementPayment' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 * /payments/{paymentId}/events:
 *   get:
 *     summary: Inspect verified Payment audit evidence
 *     description: BRANCH_MANAGER only. Read-only and scoped to this attempt. All stored event actions are included by default. Known Payment with no events returns an empty page; missing Payment returns 404. Provider reference filters event references, including distinct captured transactions recorded for reconciliation. Live pagination uses a stable ID tie-breaker. Unknown parameters and array/object values are rejected. Default order is verifiedAt descending.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { $ref: '#/components/parameters/PaymentMonitoringId' }
 *       - { $ref: '#/components/parameters/PaymentMonitoringPage' }
 *       - { $ref: '#/components/parameters/PaymentMonitoringLimit' }
 *       - { $ref: '#/components/parameters/PaymentMonitoringSortOrder' }
 *       - { $ref: '#/components/parameters/PaymentMonitoringProviderReference' }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [verifiedAt, createdAt], default: verifiedAt }
 *       - in: query
 *         name: action
 *         schema: { type: string, enum: [applied, duplicate, reconciliation_required] }
 *       - in: query
 *         name: statusCode
 *         schema: { type: string, enum: ['2', '0', '-1', '-2', '-3'] }
 *     responses:
 *       200:
 *         description: Safe verified-event page. An observed success does not necessarily mean its financial state was applied.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ManagementPaymentEventListResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       500: { $ref: '#/components/responses/InternalServerError' }
 */
paymentRouter.get(
  '/payments',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER),
  validate(validatePaymentMonitoringList),
  listManagementPayments
);
paymentRouter.get(
  '/payments/:paymentId',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER),
  validate(validatePaymentMonitoringDetail),
  getManagementPayment
);
paymentRouter.get(
  '/payments/:paymentId/events',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER),
  validate(validatePaymentMonitoringEvents),
  listManagementPaymentEvents
);

module.exports = { paymentRouter, paymentNotificationRouter };
