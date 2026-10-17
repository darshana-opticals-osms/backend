# Immutable Audit Trail Architecture (DDP-066 / ADR-012)

## 1. Executive Summary

This document specifies the architectural implementation and operational lifecycle of the immutable audit trail for **Darshana Opticals - Optical Store Management System (OSMS)**, adhering to:

- **System Design Specification (SDS) Section 6.3** (_Data Protection Approach: Secure Audit Trails and 7-Year Retention_).
- **Architecture Decision Record (ADR-012)** (_Authoritative Immutable Audit Trail Architecture_).
- Issue **#57** / Requirement **DDP-066**.

---

## 2. Multi-Layer Immutability Controls

Forensic defensibility is guaranteed across four discrete security layers:

```text
+-------------------------------------------------------------------------+
|                         OSMS Audit Immutability                         |
+-------------------------------------------------------------------------+
| 1. Code Level      | Centralized AuditService exposes ONLY record()     |
|                    | No update(), delete(), or remove() methods exist.  |
+--------------------+----------------------------------------------------+
| 2. Mongoose Schema | Append-only pre-hooks intercept & abort mutations: |
|                    | updateOne, updateMany, findOneAndUpdate, deleteOne |
|                    | deleteMany, findOneAndDelete, and save() on docs.  |
+--------------------+----------------------------------------------------+
| 3. Database Role   | MongoDB application user assigned auditAppendOnly: |
|                    | Custom role grants ONLY insert and find actions.   |
|                    | update, delete, dropCollection, dropDatabase DENIED|
+--------------------+----------------------------------------------------+
| 4. Cryptographic   | SHA-256 Hash Chain:                                |
|    Integrity       | Event[N].eventHash = SHA256(prevHash + payloadStr) |
|                    | Tampering with any historical record breaks chain. |
+--------------------+----------------------------------------------------+
```

### 2.1 Cryptographic SHA-256 Hash Chaining Specification (ADR-012 §10.2)

Each recorded `AuditEvent` document calculates an `integrity` subdocument:

$$\text{payloadString} = \text{auditEventId} + \text{schemaVersion} + \text{timestamp} + \text{actionType} + \text{actor.actorId} + \text{target.targetType} + \text{target.targetId} + \text{JSON.stringify}(\text{safeMetadata})$$

$$\text{eventHash} = \text{SHA256}(\text{prevEventHash} + \text{payloadString})$$

- **Genesis Hash**: For the first event in the system, `prevEventHash` is fixed to the 64-character canonical string:
  `"0000000000000000000000000000000000000000000000000000000000000000"`.
- **Tamper Detection**: An integrity verification utility (`auditService.verifyIntegrityChain()`) iterates through historical events, recalculating digests and asserting linkage continuity. Any altered record or broken pointer immediately flags a security failure.

---

## 3. Database-Level Role Segregation (`auditAppendOnly`)

### 3.1 Operational Enforcement: Production vs. Local/Test Environments

Immutability enforcement is partitioned across operational contexts to ensure uncompromising defense in depth while maintaining developer velocity and test isolation:

- **Production and Staging Environments (Engine-Level Enforcement)**:
  The OSMS application service connects to MongoDB using a dedicated database user (`osms_app_user`) provisioned with the custom `auditAppendOnly` role. This grants solely `insert` and `find` privileges on the `auditevents` collection. At the MongoDB database engine level, any `update`, `delete`, `dropCollection`, or `dropDatabase` commands are rejected outright with an authorization error—guaranteeing immutability even in the catastrophic event of application code vulnerability or root administrative session misuse.

- **Local Development and Automated CI/Test Environments (Middleware Enforcement)**:
  In ephemeral or local test instances (e.g. `MongoMemoryServer` running in single-node/replica-set mode without pre-configured administrative role infrastructure), immutability is deterministically enforced by Mongoose schema pre-hooks (`src/models/auditEvent.model.js`). These hooks intercept mutation and removal operations (`updateOne`, `updateMany`, `findOneAndUpdate`, `deleteOne`, `deleteMany`, `findOneAndDelete`, and document `.save()`) and abort them by throwing an immutable validation error.

### 3.2 Provisioning the Role

Execute the provisioning script:

```bash
node scripts/provision-audit-role.js
```

Or execute within `mongosh`:

```javascript
use darshana_opticals;

db.createRole({
  role: "auditAppendOnly",
  privileges: [
    {
      resource: { db: "darshana_opticals", collection: "auditevents" },
      actions: ["insert", "find"]
    }
  ],
  roles: []
});

db.grantRolesToUser("osms_app_user", ["auditAppendOnly"]);
```

---

## 4. Seven-Year Storage & Archival Retention Lifecycle (ADR-012 §12–13)

Under SDS Section 6.3 and healthcare compliance guidelines, clinical prescriptions, financial transactions, and inventory state movements must be retained for **a minimum of seven (7) years**.

```text
+-------------------+--------------------+------------------------------------+
| Tier              | Retention Window   | Storage Infrastructure & Controls  |
+-------------------+--------------------+------------------------------------+
| 1. Hot Tier       | Days 0 - 90        | MongoDB with active index scans.   |
|                   |                    | Direct query API for SYSTEM_ADMIN. |
+-------------------+--------------------+------------------------------------+
| 2. Warm Tier      | Day 91 - Year 3    | MongoDB cold collection slice.     |
|                   |                    | Queryable on-demand for audits.    |
+-------------------+--------------------+------------------------------------+
| 3. Cold WORM Tier | Year 3 - Year 7+   | Cloud Object Storage with WORM lock|
|                   |                    | (AWS S3 Object Lock / GCS Bucket   |
|                   |                    | Lock in Compliance Mode).          |
+-------------------+--------------------+------------------------------------+
```

### 4.1 Phase 1 vs. Phase 2 Implementation Scope

To maintain high software delivery rigor, the 7-year retention lifecycle is phased as approved in ADR-012:

- **Phase 1 (In Scope — Implemented in PR #85)**:
  - Append-only MongoDB storage model with database-level `auditAppendOnly` role and Mongoose schema mutation guards.
  - Linear SHA-256 cryptographic hash chaining (`prevEventHash` linking to previous event digest) with zero branching under concurrency.
  - Automated cryptographic integrity verification utility (`auditService.verifyIntegrityChain()`).
  - Strict prohibition of TTL indexes (`expireAfterSeconds` is prohibited to prevent automated deletion).
  - Bounded 90-day query API restricted to `SYSTEM_ADMIN` with meta-auditing (`AUDIT_TRAIL_ACCESSED`) and automatic 90-day fallback bounding when dates are omitted.
- **Phase 2 (Deferred Roadmap — Post-Launch Operational Milestones)**:
  - Scheduled batch archival worker activating when historical records exceed the 3-year threshold.
  - Automated conversion and cryptographic compression to NDJSON/Parquet archives with SHA-256 manifest signing.
  - Automated transmission to cloud object storage with WORM lock (e.g. AWS S3 Glacier with Object Lock in Compliance Mode or Google Cloud Storage Bucket Lock) enforcing the remaining 4+ years of the 7-year regulatory hold.

---

## 5. Canonical Audit Schema & Action Taxonomy

### 5.1 Controlled Action Taxonomy

| Domain               | Action                              | Description                                       |
| -------------------- | ----------------------------------- | ------------------------------------------------- |
| **Inventory**        | `INVENTORY_QUANTITY_ADJUSTED`       | Manual stock level modification                   |
|                      | `INVENTORY_PRICE_UPDATED`           | Retail unit price adjustment                      |
|                      | `INVENTORY_CHECKOUT_STOCK_DEDUCTED` | Order checkout inventory deduction                |
|                      | `INVENTORY_REORDER_CONFIG_CHANGED`  | Global or branch reorder threshold update         |
| **Financial**        | `PAYMENT_SESSION_INITIATED`         | Online payment session creation                   |
|                      | `PAYMENT_IPN_VERIFIED`              | External provider (PayHere) callback verified     |
|                      | `PAYMENT_COMPLETED`                 | Successful financial settlement                   |
|                      | `PAYMENT_FAILED`                    | Gateway transaction failure                       |
|                      | `PAYMENT_CANCELLED`                 | Customer or system checkout cancellation          |
|                      | `PAYMENT_REFUNDED`                  | Authorised transaction refund / reversal          |
| **Clinical**         | `PRESCRIPTION_RECORDED`             | Authorised optometrist clinical record creation   |
| **Security / Admin** | `STAFF_USER_PROVISIONED`            | New staff user account provisioned                |
|                      | `USER_ROLE_PERMISSIONS_MODIFIED`    | RBAC role assignment changes                      |
|                      | `USER_ACCOUNT_STATUS_TOGGLED`       | Staff or customer account activation/deactivation |
|                      | `AUDIT_TRAIL_ACCESSED`              | Meta-audit event on `GET /api/audit-events` query |

### 5.2 Access & Meta-Auditing (ADR-012 §14.2)

- Access to the audit query endpoint (`GET /api/audit-events`) is restricted strictly to the **`SYSTEM_ADMIN`** role.
- Every audit retrieval request is subject to meta-auditing: an `AUDIT_TRAIL_ACCESSED` event is automatically persisted recording the querying administrator, filter criteria, and record counts.
- Date range filtering is bounded to a maximum of **90 days** per query to prevent uncontrolled database load.
- When `fromDate` and `toDate` are omitted, `fromDate` defaults to 90 days ago, guaranteeing that unbounded table scans cannot occur by default.
