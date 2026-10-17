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

In production and staging deployments, the OSMS application service authenticates with a MongoDB role restricted to append-only privileges for the `auditevents` collection.

### Provisioning the Role

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

### Key Archival Requirements

1. **No TTL Indexes**: The `auditevents` collection strictly prohibits MongoDB `expireAfterSeconds` TTL indexes. Records are never deleted automatically.
2. **Scheduled Cold Export**: A scheduled worker compresses events older than 3 years into NDJSON/Parquet format, computes cryptographic manifest checksums, and uploads archives to immutable cloud object storage.
3. **Retention Lock**: Cloud storage policies enforce WORM compliance preventing premature deletion or overwriting even by root/admin accounts until the 7-year retention period lapses.

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
