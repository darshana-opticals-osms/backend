const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const {
  AUDIT_ACTION_VALUES,
  AUDIT_ACTOR_TYPE_VALUES,
  AUDIT_TARGET_TYPE_VALUES,
  AUDIT_OUTCOME_VALUES,
  AUDIT_SOURCE_VALUES,
  AUDIT_SCHEMA_VERSION,
} = require('../constants/audit');

// ─── AuditEvent Schema (ADR-012 / DDP-065) ───────────────────────────────────
//
// Canonical immutable audit record for critical Inventory, Financial, and
// Clinical operations. Every field is either immutable: true or enforced by the
// append-only middleware hooks below.
//
// Storage rule: records must be retained for a minimum of seven years.
// DO NOT add a TTL index to this collection.
//
// Tamper-evidence: ADR-012 selects application-level append-only controls for
// the current scope. Cryptographic hash chaining is explicitly excluded from v1
// scope by ADR-012 and must not be invented independently.

const auditEventSchema = new mongoose.Schema(
  {
    // ── Event Identity ───────────────────────────────────────────────────────

    /**
     * Stable logical event ID (UUID v4).
     * Used for idempotency — prevents duplicate immutable records for the same
     * logical action (ADR-012 §Duplicate/Idempotency).
     * Immutable once written.
     */
    eventId: {
      type: String,
      required: [true, 'eventId is required.'],
      default: () => randomUUID(),
      immutable: true,
    },

    /**
     * AuditEvent schema version (ADR-012 §Schema Versioning).
     * Centralised in AUDIT_SCHEMA_VERSION; do NOT hard-code elsewhere.
     */
    schemaVersion: {
      type: String,
      required: [true, 'schemaVersion is required.'],
      default: AUDIT_SCHEMA_VERSION,
      immutable: true,
    },

    // ── Action ───────────────────────────────────────────────────────────────

    /**
     * The canonical action type from the ADR-012 controlled taxonomy.
     * Must be one of AUDIT_ACTION_VALUES — free-text is rejected.
     */
    action: {
      type: String,
      required: [true, 'action is required.'],
      enum: {
        values: AUDIT_ACTION_VALUES,
        message: `action must be one of: ${AUDIT_ACTION_VALUES.join(', ')}.`,
      },
      immutable: true,
    },

    // ── Timestamp ────────────────────────────────────────────────────────────

    /**
     * Backend-generated UTC timestamp of the event (ADR-012 §Timestamp / AC12–AC13).
     * Never trust a client-submitted timestamp; always set this server-side.
     */
    occurredAt: {
      type: Date,
      required: [true, 'occurredAt is required.'],
      default: () => new Date(),
      immutable: true,
    },

    // ── Actor ────────────────────────────────────────────────────────────────

    /**
     * Who performed the action (ADR-012 §Actor/Source Model / AC9–AC10).
     * actorType distinguishes human users, internal systems, and external providers.
     * actorId and actorRole are derived from trusted backend context — never
     * trusted from client payloads.
     */
    actorType: {
      type: String,
      required: [true, 'actorType is required.'],
      enum: {
        values: AUDIT_ACTOR_TYPE_VALUES,
        message: `actorType must be one of: ${AUDIT_ACTOR_TYPE_VALUES.join(', ')}.`,
      },
      immutable: true,
    },

    /** Trusted actor identifier (user ObjectId string, or system/provider identifier). */
    actorId: {
      type: String,
      required: [true, 'actorId is required.'],
      immutable: true,
    },

    /**
     * Canonical RBAC role of the actor at the time of the action.
     * For SYSTEM and EXTERNAL_PROVIDER actors, this contains the source identifier.
     */
    actorRole: {
      type: String,
      required: [true, 'actorRole is required.'],
      immutable: true,
    },

    // ── Target / Resource ────────────────────────────────────────────────────

    /**
     * The domain resource affected by the action (ADR-012 §Resource/Target Model / AC11).
     * Must use controlled AUDIT_TARGET_TYPE values.
     */
    targetType: {
      type: String,
      required: [true, 'targetType is required.'],
      enum: {
        values: AUDIT_TARGET_TYPE_VALUES,
        message: `targetType must be one of: ${AUDIT_TARGET_TYPE_VALUES.join(', ')}.`,
      },
      immutable: true,
    },

    /** Stable identifier of the affected resource (e.g. MongoDB ObjectId string). */
    targetId: {
      type: String,
      required: [true, 'targetId is required.'],
      immutable: true,
    },

    // ── Branch / Context ─────────────────────────────────────────────────────

    /** Branch identifier associated with the event, where applicable. */
    branchId: {
      type: String,
      default: null,
      immutable: true,
    },

    // ── Outcome ──────────────────────────────────────────────────────────────

    /** Whether the auditable business operation succeeded or failed. */
    outcome: {
      type: String,
      required: [true, 'outcome is required.'],
      enum: {
        values: AUDIT_OUTCOME_VALUES,
        message: `outcome must be one of: ${AUDIT_OUTCOME_VALUES.join(', ')}.`,
      },
      immutable: true,
    },

    // ── Correlation ──────────────────────────────────────────────────────────

    /**
     * Safe request/correlation identifier for tracing related events
     * (ADR-012 §Correlation / AC14).
     * Must never be a JWT, token, or credential.
     */
    correlationId: {
      type: String,
      default: null,
      immutable: true,
    },

    // ── Source ───────────────────────────────────────────────────────────────

    /**
     * System component that generated the event (ADR-012 §Actor/Source Model).
     * Required when actorType is SYSTEM or EXTERNAL_PROVIDER.
     */
    source: {
      type: String,
      enum: {
        values: AUDIT_SOURCE_VALUES,
        message: `source must be one of: ${AUDIT_SOURCE_VALUES.join(', ')}.`,
      },
      default: null,
      immutable: true,
    },

    // ── Safe Metadata ────────────────────────────────────────────────────────

    /**
     * Approved safe metadata for the event (ADR-012 §Safe Metadata Policy / AC36–AC41).
     *
     * Must be pre-sanitized by auditSanitizer.sanitize() before persistence.
     * Prohibited sensitive fields are stripped centrally in auditService.record().
     *
     * Examples of safe metadata:
     *   - Inventory: { previousQuantity, newQuantity, changeAmount, reason }
     *   - Payment:   { providerOrderId, providerTransactionId, statusFrom, statusTo }
     *   - Clinical:  { prescriptionId, customerId }
     *
     * NEVER store: password, token, cardNumber, CVV, full request bodies,
     * raw provider payloads, or unnecessary Customer / clinical PII.
     */
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      immutable: true,
    },
  },
  {
    // Disable automatic updatedAt — AuditEvents must never be updated.
    // createdAt is equivalent to the persistence timestamp.
    timestamps: { createdAt: 'createdAt', updatedAt: false },

    // Prevent arbitrary fields being added outside the schema.
    strict: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Unique event identity index for idempotency enforcement (ADR-012 §AC48).
auditEventSchema.index({ eventId: 1 }, { unique: true });

// Compound index supporting ADR-012-approved audit retrieval queries (AC56).
auditEventSchema.index({ action: 1, occurredAt: -1 });
auditEventSchema.index({ targetType: 1, targetId: 1, occurredAt: -1 });
auditEventSchema.index({ actorId: 1, occurredAt: -1 });
auditEventSchema.index({ branchId: 1, occurredAt: -1 });

// ─── Append-Only Middleware (ADR-012 §AC4–AC5) ───────────────────────────────
//
// These pre-hooks intercept all mutation operations on AuditEvent documents that
// normal application code could call. Any attempt to update, replace, or delete
// an existing AuditEvent will throw an error at the application layer.
//
// This is the application-level immutability control selected by ADR-012.
// The hooks apply to both static and query methods.

const IMMUTABILITY_ERROR =
  'AuditEvent records are immutable and append-only. Update and delete operations are prohibited (ADR-012).';

function throwImmutabilityError() {
  throw new Error(IMMUTABILITY_ERROR);
}

// Block all update-style operations.
auditEventSchema.pre('updateOne', throwImmutabilityError);
auditEventSchema.pre('updateMany', throwImmutabilityError);
auditEventSchema.pre('findOneAndUpdate', throwImmutabilityError);
auditEventSchema.pre('replaceOne', throwImmutabilityError);

// Block all delete-style operations.
auditEventSchema.pre('deleteOne', throwImmutabilityError);
auditEventSchema.pre('deleteMany', throwImmutabilityError);
auditEventSchema.pre('findOneAndDelete', throwImmutabilityError);

// Block save() on existing documents (new documents are always permitted).
auditEventSchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(new Error(IMMUTABILITY_ERROR));
  }
  next();
});

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = mongoose.model('AuditEvent', auditEventSchema);
