// ─── Centralized Audit Service (ADR-012 / DDP-065) ───────────────────────────
//
// This is the single authoritative path for recording immutable audit events.
// Domain services (Inventory, Payment, Prescription, etc.) MUST call
// auditService.record() instead of constructing AuditEvent documents directly.
//
// Responsibilities (AC7):
//   1. Controlled action taxonomy validation (AC8)
//   2. Trusted actor/source normalization (AC9–AC10)
//   3. Resource/target normalization (AC11)
//   4. Centralized metadata sanitization/redaction (AC36–AC41)
//   5. Backend-generated UTC timestamp (AC12–AC13)
//   6. Event/schema version application (AC15)
//   7. Correlation ID handling (AC14)
//   8. Logical event idempotency (AC48)
//   9. Durable persistence (AC42–AC46)
//
// ADR-012 audit-write strategy: synchronous fail-safe write.
//   - If the domain operation is critical and fail-closed is required, the
//     domain service must pass { session } and wrap both operations in the same
//     MongoDB transaction.
//   - If a session is not provided, audit.service.record() writes independently.
//   - A simple empty catch is prohibited (AC44). Callers receive the error.
//
// Audit reading is handled by a separate read-only path (auditService.query).

const { randomUUID } = require('crypto');
const AuditEvent = require('../models/auditEvent.model');
const {
  AUDIT_ACTION,
  AUDIT_ACTION_VALUES,
  AUDIT_ACTOR_TYPE,
  AUDIT_ACTOR_TYPE_VALUES,
  AUDIT_TARGET_TYPE_VALUES,
  AUDIT_OUTCOME_VALUES,
  AUDIT_SOURCE_VALUES,
  AUDIT_SCHEMA_VERSION,
  AUDIT_PAGE_SIZE_DEFAULT,
  AUDIT_PAGE_SIZE_MAX,
  AUDIT_QUERY_MAX_RANGE_DAYS,
  AUDIT_SOURCE,
} = require('../constants/audit');
const { ValidationError } = require('../errors/AppError');
const { sanitizeAuditMetadata } = require('../utils/auditSanitizer');
const { sanitizeLogMessage } = require('../utils/sanitizer');

// ─── Validation Helpers ───────────────────────────────────────────────────────

/**
 * Validates that `action` is a member of the ADR-012 controlled taxonomy.
 * Throws if the action is absent or unrecognised (AC8).
 *
 * @param {string} action
 */
function validateAction(action) {
  if (!action || !AUDIT_ACTION_VALUES.includes(action)) {
    throw new Error(
      `auditService.record(): 'action' must be one of the controlled AUDIT_ACTION values. ` +
        `Received: ${JSON.stringify(action)}`
    );
  }
}

/**
 * Normalises and validates the actor object.
 * Ensures actorType, actorId, and actorRole come from the trusted ADR-012 model.
 * Clients must never supply these values directly (AC9–AC10).
 *
 * @param {{ actorType: string, actorId: string, actorRole: string }} actor
 * @returns {{ actorType: string, actorId: string, actorRole: string }}
 */
function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object') {
    throw new Error("auditService.record(): 'actor' must be a plain object.");
  }

  const { actorType, actorId, actorRole } = actor;

  if (!AUDIT_ACTOR_TYPE_VALUES.includes(actorType)) {
    throw new Error(
      `auditService.record(): 'actor.actorType' must be one of: ${AUDIT_ACTOR_TYPE_VALUES.join(', ')}. ` +
        `Received: ${JSON.stringify(actorType)}`
    );
  }

  if (!actorId || typeof actorId !== 'string' || actorId.trim() === '') {
    throw new Error("auditService.record(): 'actor.actorId' must be a non-empty string.");
  }

  if (!actorRole || typeof actorRole !== 'string' || actorRole.trim() === '') {
    throw new Error("auditService.record(): 'actor.actorRole' must be a non-empty string.");
  }

  return {
    actorType: actorType.trim(),
    actorId: actorId.trim(),
    actorRole: actorRole.trim(),
  };
}

/**
 * Normalises and validates the target/resource object (AC11).
 *
 * @param {{ targetType: string, targetId: string }} target
 * @returns {{ targetType: string, targetId: string }}
 */
function normalizeTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new Error("auditService.record(): 'target' must be a plain object.");
  }

  const { targetType, targetId } = target;

  if (!AUDIT_TARGET_TYPE_VALUES.includes(targetType)) {
    throw new Error(
      `auditService.record(): 'target.targetType' must be one of: ${AUDIT_TARGET_TYPE_VALUES.join(', ')}. ` +
        `Received: ${JSON.stringify(targetType)}`
    );
  }

  if (!targetId || typeof targetId !== 'string' || targetId.trim() === '') {
    throw new Error("auditService.record(): 'target.targetId' must be a non-empty string.");
  }

  return {
    targetType: targetType.trim(),
    targetId: targetId.trim(),
  };
}

/**
 * Validates outcome value (ADR-012 §Outcome).
 *
 * @param {string} outcome
 */
function validateOutcome(outcome) {
  if (!AUDIT_OUTCOME_VALUES.includes(outcome)) {
    throw new Error(
      `auditService.record(): 'outcome' must be one of: ${AUDIT_OUTCOME_VALUES.join(', ')}. ` +
        `Received: ${JSON.stringify(outcome)}`
    );
  }
}

/**
 * Validates an optional source value (ADR-012 §Source).
 *
 * @param {string|null|undefined} source
 */
function validateSource(source) {
  if (source !== null && source !== undefined && !AUDIT_SOURCE_VALUES.includes(source)) {
    throw new Error(
      `auditService.record(): 'source' must be one of: ${AUDIT_SOURCE_VALUES.join(', ')}, or null. ` +
        `Received: ${JSON.stringify(source)}`
    );
  }
}

// ─── System / External Actor Builders ────────────────────────────────────────

/**
 * Builds the actor descriptor for internal OSMS system operations (e.g. checkout engine).
 * Use when no human user is the actor (AC10).
 *
 * @returns {{ actorType: string, actorId: string, actorRole: string }}
 */
function buildSystemActor() {
  return {
    actorType: AUDIT_ACTOR_TYPE.SYSTEM,
    actorId: AUDIT_SOURCE.OSMS_BACKEND,
    actorRole: AUDIT_SOURCE.OSMS_BACKEND,
  };
}

/**
 * Builds the actor descriptor for verified external provider callbacks (e.g. PayHere).
 * Use for PAYMENT_PROVIDER_CALLBACK_VERIFIED events (AC10, AC24).
 *
 * @param {string} providerSource - One of AUDIT_SOURCE values.
 * @returns {{ actorType: string, actorId: string, actorRole: string }}
 */
function buildExternalProviderActor(providerSource) {
  return {
    actorType: AUDIT_ACTOR_TYPE.EXTERNAL_PROVIDER,
    actorId: providerSource,
    actorRole: providerSource,
  };
}

/**
 * Builds the actor descriptor from a trusted authenticated request context.
 * Call this with the `req.user` object populated by the authentication middleware.
 * Never call this with client-supplied actor data (AC9).
 *
 * @param {{ userId: string, role: string }} authContext - Trusted backend auth context.
 * @returns {{ actorType: string, actorId: string, actorRole: string }}
 */
function buildUserActor(authContext) {
  if (!authContext || !authContext.userId || !authContext.role) {
    throw new Error(
      'auditService.buildUserActor(): authContext must contain userId and role from the trusted backend auth middleware.'
    );
  }
  return {
    actorType: AUDIT_ACTOR_TYPE.USER,
    actorId: String(authContext.userId),
    actorRole: String(authContext.role),
  };
}

// ─── Core Record Function ─────────────────────────────────────────────────────

/**
 * Records a single immutable audit event according to ADR-012.
 *
 * This is the ONLY authoritative audit write path. Domain services must not
 * construct AuditEvent documents independently.
 *
 * @param {object}               params
 * @param {string}               params.action        - Controlled AUDIT_ACTION value.
 * @param {object}               params.actor         - { actorType, actorId, actorRole }
 * @param {object}               params.target        - { targetType, targetId }
 * @param {string}               params.outcome       - AUDIT_OUTCOME value.
 * @param {string}               [params.branchId]    - Optional branch context.
 * @param {string}               [params.correlationId] - Safe request correlation ID.
 * @param {string}               [params.source]      - Optional AUDIT_SOURCE value.
 * @param {object|null}          [params.metadata]    - Safe domain-specific metadata.
 *                                                      Will be centrally sanitized.
 * @param {string}               [params.eventId]     - Optional stable logical event ID for
 *                                                      idempotent re-attempts. Generated if absent.
 * @param {import('mongoose').ClientSession} [params.session] - Optional MongoDB session for
 *                                                      transactional writes (fail-closed).
 * @returns {Promise<import('../models/auditEvent.model')>} The persisted AuditEvent document.
 * @throws {Error} On validation failure or persistence error.
 */
async function record({
  action,
  actor,
  target,
  outcome,
  branchId = null,
  correlationId = null,
  source = null,
  metadata = null,
  eventId = null,
  session = null,
} = {}) {
  // 1. Validate controlled action taxonomy (AC8).
  validateAction(action);

  // 2. Normalize actor from trusted context (AC9–AC10).
  const normalizedActor = normalizeActor(actor);

  // 3. Normalize target/resource (AC11).
  const normalizedTarget = normalizeTarget(target);

  // 4. Validate outcome.
  validateOutcome(outcome);

  // 5. Validate optional source.
  validateSource(source);

  // 6. Backend-generated UTC timestamp — never trust client input (AC12–AC13).
  const occurredAt = new Date();

  // 7. Apply schema version centrally (AC15).
  const schemaVersion = AUDIT_SCHEMA_VERSION;

  // 8. Resolve eventId — use supplied value for idempotent retries, otherwise generate (AC48).
  //    Callers must supply a stable eventId when retrying the same logical action.
  const resolvedEventId = eventId || randomUUID();

  // 9. Safe correlation ID — must never be a JWT or credential (AC14).
  //    We accept whatever the caller provides and do not generate one automatically,
  //    since the caller owns the request context. Validate it is not a JWT.
  let safeCorrelationId = null;
  if (correlationId !== null && correlationId !== undefined) {
    const id = String(correlationId).trim();
    // Rudimentary JWT detection: three dot-separated base64url segments.
    if (/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(id)) {
      throw new Error(
        'auditService.record(): correlationId must not be a JWT or credential token (ADR-012 AC14).'
      );
    }
    safeCorrelationId = id;
  }

  // 10. Centralized metadata sanitization/redaction (AC36–AC41).
  const safeMetadata = sanitizeAuditMetadata(metadata);

  // 11. Persist the AuditEvent.
  //     Idempotency: if a record with the same eventId already exists (from a prior
  //     successful write on a retry), the unique index on eventId will produce a
  //     duplicate-key error. Callers must handle this case as a no-op (AC48).
  const eventData = {
    eventId: resolvedEventId,
    schemaVersion,
    action,
    occurredAt,
    actorType: normalizedActor.actorType,
    actorId: normalizedActor.actorId,
    actorRole: normalizedActor.actorRole,
    targetType: normalizedTarget.targetType,
    targetId: normalizedTarget.targetId,
    branchId: branchId ? String(branchId).trim() : null,
    outcome,
    correlationId: safeCorrelationId,
    source: source || null,
    metadata: safeMetadata,
  };

  const createOptions = session ? { session } : {};
  const [persisted] = await AuditEvent.create([eventData], createOptions);

  return persisted;
}

// ─── Audit Read (ADR-012 §AC53–AC58) ─────────────────────────────────────────
//
// ADR-012 approves a limited application-level read API restricted to
// SYSTEM_ADMIN and BRANCH_MANAGER roles.
// All queries use approved filters and deterministic ordering only.

/**
 * Queries audit events using approved ADR-012 filters with bounded pagination
 * and deterministic ordering.
 *
 * @param {object}  filters
 * @param {string}  [filters.action]       - Filter by AUDIT_ACTION value.
 * @param {string}  [filters.actorId]      - Filter by actorId.
 * @param {string}  [filters.targetType]   - Filter by AUDIT_TARGET_TYPE value.
 * @param {string}  [filters.targetId]     - Filter by targetId.
 * @param {string}  [filters.branchId]     - Filter by branchId.
 * @param {Date}    [filters.fromDate]     - Start of date range (inclusive).
 * @param {Date}    [filters.toDate]       - End of date range (inclusive).
 * @param {number}  [filters.page=1]       - 1-indexed page number.
 * @param {number}  [filters.limit]        - Page size (capped at AUDIT_PAGE_SIZE_MAX).
 * @returns {Promise<{ events: object[], total: number, page: number, pages: number }>}
 */
async function query({
  action,
  actorId,
  targetType,
  targetId,
  branchId,
  fromDate,
  toDate,
  page = 1,
  limit = AUDIT_PAGE_SIZE_DEFAULT,
} = {}) {
  const filter = {};

  // Only approved filter fields are supported (AC56).
  if (action) {
    if (!AUDIT_ACTION_VALUES.includes(action)) {
      throw new Error(
        `auditService.query(): unsupported action filter value: ${JSON.stringify(action)}`
      );
    }
    filter.action = action;
  }

  if (actorId) filter.actorId = String(actorId);
  if (targetType) {
    if (!AUDIT_TARGET_TYPE_VALUES.includes(targetType)) {
      throw new Error(
        `auditService.query(): unsupported targetType filter value: ${JSON.stringify(targetType)}`
      );
    }
    filter.targetType = targetType;
  }
  if (targetId) filter.targetId = String(targetId);
  if (branchId) filter.branchId = String(branchId);

  if (fromDate || toDate) {
    let parsedFrom = null;
    let parsedTo = null;

    if (fromDate) {
      parsedFrom = new Date(fromDate);
      if (Number.isNaN(parsedFrom.getTime())) {
        throw new ValidationError(
          'auditService.query(): invalid fromDate format. Expected ISO 8601 date string.'
        );
      }
    }

    if (toDate) {
      parsedTo = new Date(toDate);
      if (Number.isNaN(parsedTo.getTime())) {
        throw new ValidationError(
          'auditService.query(): invalid toDate format. Expected ISO 8601 date string.'
        );
      }
    }

    if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
      throw new ValidationError('auditService.query(): fromDate cannot be after toDate.');
    }

    const MAX_RANGE_MS = AUDIT_QUERY_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;
    if (parsedFrom && parsedTo) {
      if (parsedTo.getTime() - parsedFrom.getTime() > MAX_RANGE_MS) {
        throw new ValidationError(
          `auditService.query(): date range exceeds maximum allowed limit of ${AUDIT_QUERY_MAX_RANGE_DAYS} days (ADR-012 §14.3).`
        );
      }
    } else if (parsedFrom && !parsedTo) {
      const now = Date.now();
      if (now - parsedFrom.getTime() > MAX_RANGE_MS) {
        throw new ValidationError(
          `auditService.query(): date range exceeds maximum allowed limit of ${AUDIT_QUERY_MAX_RANGE_DAYS} days (ADR-012 §14.3).`
        );
      }
    }

    filter.occurredAt = {};
    if (parsedFrom) filter.occurredAt.$gte = parsedFrom;
    if (parsedTo) filter.occurredAt.$lte = parsedTo;
  }

  // Bounded pagination (AC57).
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(
    AUDIT_PAGE_SIZE_MAX,
    Math.max(1, parseInt(limit, 10) || AUDIT_PAGE_SIZE_DEFAULT)
  );
  const skip = (safePage - 1) * safeLimit;

  // Deterministic ordering: newest first (AC58).
  const [events, total] = await Promise.all([
    AuditEvent.find(filter).sort({ occurredAt: -1, _id: -1 }).skip(skip).limit(safeLimit).lean(),
    AuditEvent.countDocuments(filter),
  ]);

  return {
    events,
    total,
    page: safePage,
    pages: Math.ceil(total / safeLimit),
  };
}

// ─── Audit-Write Failure Logging Helper ──────────────────────────────────────

/**
 * Logs an audit-write failure safely without exposing sensitive event content (AC60).
 * Domain services should call this in their audit failure handler.
 *
 * @param {string} action       - The AUDIT_ACTION that failed to persist.
 * @param {string} targetId     - The targetId of the failed event.
 * @param {Error}  error        - The persistence error.
 */
function logAuditWriteFailure(action, targetId, error) {
  const safeMessage = sanitizeLogMessage(error?.message || 'unknown error');
  console.error(`[AUDIT WRITE FAILURE] action=${action} targetId=${targetId} error=${safeMessage}`);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  record,
  query,
  buildUserActor,
  buildSystemActor,
  buildExternalProviderActor,
  logAuditWriteFailure,
  // Expose action constants for convenience in domain service callers.
  AUDIT_ACTION,
};
