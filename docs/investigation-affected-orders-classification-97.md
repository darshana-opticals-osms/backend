# Investigation & Recovery Framework: Affected Paid Orders with Classification Defects (Issue #97)

## 1. Executive Summary

- **Issue Reference:** Issue #97 (AC7, AC8)
- **Problem Statement:** Paid Orders currently at status `PICKED_UP` cannot transition to `COMPLETED` by Staff Order Management, failing with HTTP 409 `LOYALTY_ITEM_CLASSIFICATION_REQUIRED`.
- **Root Cause:** Prior to the fix in `src/services/checkout.service.js`, `buildOrderItems()` permitted unclassified or unresolved Inventory items to enter new Orders with an `itemClassification: 'UNKNOWN'` snapshot. While checkout and payment succeeded, `src/services/loyaltyEligibility.service.js` strictly requires immutable snapshots with explicit classification (`MERCHANDISE` or `CLINICAL`) before calculating loyalty points during order finalization.
- **Data Integrity Principle (AC8):** No automatic historical data mutation is permitted. Existing checkout snapshots are immutable facts recorded at the time of checkout. Bypassing validators, inferring categories from free text, or silently backfilling from current Inventory values violates system integrity, auditability (ADR-004, ADR-005), and non-repudiation.

---

## 2. Comprehensive Categorization of Loyalty Eligibility Defects

When investigating an Order encountering `LOYALTY_ITEM_CLASSIFICATION_REQUIRED` or related completion rejection, diagnostic analysis evaluates all conditions enforced by `src/services/loyaltyEligibility.service.js`:

| Defect Category                               | Diagnostic Criteria                                                                 | Root Cause / Origin                                                        | Enforced Impact                                                                            |
| :-------------------------------------------- | :---------------------------------------------------------------------------------- | :------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| **A. Empty Order Items**                      | `!items.length`                                                                     | Order persisted without child OrderItem documents.                         | Blocked at `loyaltyEligibility.service.js:25` (`LOYALTY_ITEM_CLASSIFICATION_REQUIRED`).    |
| **B. Missing Snapshot**                       | `item.classificationSnapshot == null`                                               | Legacy OrderItem created prior to snapshot schema introduction.            | Blocked at `loyaltyEligibility.service.js:33` (`LOYALTY_ITEM_CLASSIFICATION_REQUIRED`).    |
| **C. Invalid Snapshot Source**                | `snapshot.source !== 'Inventory'`                                                   | Untrusted or forged source origin (e.g. `'CLIENT'`).                       | Blocked at `loyaltyEligibility.service.js:34` (`LOYALTY_ITEM_CLASSIFICATION_REQUIRED`).    |
| **D. Missing Inventory Reference**            | `!snapshot.sourceInventoryId` or `!item.inventoryId`                                | Missing database reference linking back to catalog.                        | Blocked at `loyaltyEligibility.service.js:35-36` (`LOYALTY_ITEM_CLASSIFICATION_REQUIRED`). |
| **E. Mismatched Inventory Reference**         | `!snapshot.sourceInventoryId.equals(item.inventoryId)`                              | Snapshot reference does not match the parent item's inventoryId.           | Blocked at `loyaltyEligibility.service.js:37` (`LOYALTY_ITEM_CLASSIFICATION_REQUIRED`).    |
| **F. `UNKNOWN` / Unsupported Classification** | `snapshot.itemClassification === 'UNKNOWN'` or not in `['MERCHANDISE', 'CLINICAL']` | Inventory item unclassified or had unsupported classification at checkout. | Blocked at `loyaltyEligibility.service.js:38` (`LOYALTY_ITEM_CLASSIFICATION_REQUIRED`).    |
| **G. Inconsistent Loyalty Eligibility**       | `snapshot.loyaltyEligibility !== LOYALTY_ELIGIBILITY[snapshot.itemClassification]`  | Stored eligibility does not match authoritative classification mapping.    | Blocked at `loyaltyEligibility.service.js:39` (`LOYALTY_ITEM_CLASSIFICATION_REQUIRED`).    |
| **H. Invalid Stored Quantity**                | `!Number.isSafeInteger(item.quantity)` or `item.quantity < 1`                       | Corrupted or non-positive quantity in persisted line item.                 | Blocked at `loyaltyEligibility.service.js:46` (`LOYALTY_SOURCE_CONFLICT`).                 |
| **I. Order Total Mismatch**                   | `sum(item.price * item.quantity) !== order.orderAmount`                             | Discrepancy between stored order amount and sum of line items.             | Blocked at `loyaltyEligibility.service.js:52` (`LOYALTY_SOURCE_CONFLICT`).                 |

---

## 3. Read-Only Investigation Procedure (AC7)

To ensure zero risk to live databases and protect Customer PII and payment security, all investigation must execute through sanitized, read-only queries.

### 3.1 Privacy and Security Safeguards

- **Zero Customer PII:** Never output customer names, email addresses, phone numbers, or delivery addresses.
- **Zero Payment Secrets:** Never query or log payment transaction secrets, signatures, card details, or PayHere callback tokens.
- **Strict Read-Only Connection:** Use `.lean()` queries and read-only MongoDB connections (e.g., secondary replica nodes) without write (`insert`/`update`/`delete`) permissions.

### 3.2 Automated Diagnostic Execution

Run the sanitized diagnostic tool provided in `scripts/diagnose-affected-orders-97.js`:

```bash
# Set secondaryPreferred or read-only connection in .env or CLI
node scripts/diagnose-affected-orders-97.js
```

---

## 4. Why Automatic Historical Mutation is Prohibited (AC8)

Under Acceptance Criteria 8, automatic script-based mutation of historical OrderItems is strictly forbidden:

1. **Snapshot Immutability Contract:** `classificationSnapshot` in `orderItem.model.js` is defined with `immutable: true` and strict Mongoose mutation interceptors. Disabling these guards introduces severe security and architectural regression risks.
2. **Catalog Time-Travel Fallacy:** Current Inventory classification cannot be presumed identical to historical intent. An item could have changed classification, pricing, or catalog placement since the customer checked out.
3. **No Free-Text Inference:** System standards explicitly forbid guessing classification from item names or unstructured text categories.
4. **Audit Trail Integrity:** Silently mutating historical records compromises non-repudiation and falsifies historical transaction records.

---

## 5. Proposed Controlled Remediation Options (Subject to Governance Approval)

> **IMPORTANT GOVERNANCE NOTICE:**
> The following remediation approaches are **proposals requiring formal review and prior written approval** from the Lead Architect, Product Owner, and Security Officer. None of these options are automatically enabled, executed, or available in the application runtime. Any manual data intervention must be handled on a case-by-case basis under change control.

### Proposed Option 1: Customer Service Exception Flow (Recommended)

- **Status:** Proposed Exception Protocol (Requires Business & Security Sign-Off).
- **Mechanism:** For verified historical orders where physical goods were already collected (`PICKED_UP`), customer fulfillment is manually verified by staff.
- **Loyalty Resolution:** Rather than altering historical database records, an authorized customer service supervisor issues an audited goodwill loyalty point adjustment using the existing Loyalty Management API (`SYSTEM_CUSTOMER_SERVICE_ADJUSTMENT`).
- **Order Lifecycle:** Transition the order through an authorized administrative maintenance operation with explicit audit recording rather than modifying underlying item history.

### Proposed Option 2: Business-Approved Audit Correction Migration

- **Status:** Proposed Maintenance Window Procedure (Requires Dual-Control Authorization).
- **Mechanism:** A controlled migration script executed in an isolated maintenance window under two-person authorization.
- **Requirements:**
  1. Complete export and cryptographic hashing of pre-migration collections (`orders`, `orderitems`).
  2. Inventory catalog audit trail verification to prove historical classification intent at the exact time of checkout.
  3. Controlled update utilizing atomic session transactions, updating only verified `UNKNOWN` items to their historically proven classification.
  4. Comprehensive audit trail logging recording script execution, operator identity, ticket approval ID, and affected document IDs.
- **Risks:** High operational complexity; temporarily requires schema immutability bypass during migration window.

### Proposed Option 3: Manual Store Settlement

- **Status:** Proposed Operational Exception.
- **Mechanism:** In cases where fewer than 5 orders are affected, store administrators manually finalize order records with store operations, leaving database records intact to preserve audit history.

---

## 6. Preventive Verification

With the completion of Issue #97:

- New checkouts validate `itemClassification` prior to order persistence.
- Any cart item lacking valid `MERCHANDISE` or `CLINICAL` classification immediately fails checkout with HTTP 422 `CHECKOUT_ITEM_CLASSIFICATION_INVALID`.
- No new Orders with `UNKNOWN` snapshots can ever be created.
