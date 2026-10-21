# Investigation & Recovery Framework: Affected Paid Orders with Classification Defects (Issue #97)

## 1. Executive Summary

- **Issue Reference:** Issue #97 (AC7, AC8)
- **Problem Statement:** Paid Orders currently at status `PICKED_UP` cannot transition to `COMPLETED` by Staff Order Management, failing with HTTP 409 `LOYALTY_ITEM_CLASSIFICATION_REQUIRED`.
- **Root Cause:** Prior to the fix in `src/services/checkout.service.js`, `buildOrderItems()` permitted unclassified or unresolved Inventory items to enter new Orders with an `itemClassification: 'UNKNOWN'` snapshot. While checkout and payment succeeded, `src/services/loyaltyEligibility.service.js` strictly requires immutable snapshots with explicit classification (`MERCHANDISE` or `CLINICAL`) before calculating loyalty points during order finalization.
- **Data Integrity Principle (AC8):** No automatic historical data mutation is permitted. Existing checkout snapshots are immutable facts recorded at the time of checkout. Bypassing validators, inferring categories from free text, or silently backfilling from current Inventory values would violate system integrity, auditability (ADR-004, ADR-005), and non-repudiation.

---

## 2. Categorization of Snapshot Defects

When investigating an Order encountering `LOYALTY_ITEM_CLASSIFICATION_REQUIRED`, diagnostic analysis must differentiate between the following distinct defect types:

| Defect Category | Diagnostic Criteria | Root Cause / Origin | Impact |
| :--- | :--- | :--- | :--- |
| **A. `UNKNOWN` Classification** | `snapshot.itemClassification === 'UNKNOWN'` | Inventory catalog item had missing or `UNKNOWN` classification at checkout time. | Blocked at `loyaltyEligibility.service.js:38`. |
| **B. Missing Snapshot** | `item.classificationSnapshot == null` | Legacy OrderItem created prior to the introduction of snapshot schemas. | Blocked at `loyaltyEligibility.service.js:33`. |
| **C. Inconsistent Inventory Reference** | `!snapshot.sourceInventoryId.equals(item.inventoryId)` or missing reference | Tampered or malformed item reference linking to non-authoritative inventory. | Blocked at `loyaltyEligibility.service.js:37`. |
| **D. Inconsistent Loyalty Eligibility** | `snapshot.loyaltyEligibility !== LOYALTY_ELIGIBILITY[snapshot.itemClassification]` | Mismatch between declared classification and expected eligibility mapping. | Blocked at `loyaltyEligibility.service.js:39`. |
| **E. Item Total vs Order Total Mismatch** | `sum(item.price * item.quantity) !== order.orderAmount` | Discrepancy between stored order amount and line items. | Blocked at `loyaltyEligibility.service.js:52`. |

---

## 3. Read-Only Investigation Procedure (AC7)

To ensure zero risk to live databases and protect Customer PII and payment security, all investigation must execute through sanitized, read-only queries.

### 3.1 Privacy and Security Safeguards
- **Zero Customer PII:** Never output customer names, email addresses, phone numbers, or delivery addresses.
- **Zero Payment Secrets:** Never query or log payment transaction secrets, signatures, card details, or PayHere callback tokens.
- **Strict Read-Only Connection:** Use `.lean()` queries and read-only MongoDB roles without write (`insert`/`update`/`delete`) permissions.

### 3.2 MongoDB Diagnostic Aggregation Query (Read-Only)

```javascript
// Run in mongosh or through the diagnostic CLI tool (scripts/diagnose-affected-orders-97.js)
db.orders.aggregate([
  {
    $match: {
      status: 'PICKED_UP'
    }
  },
  {
    $lookup: {
      from: 'orderitems',
      localField: '_id',
      foreignField: 'orderId',
      as: 'items'
    }
  },
  {
    $match: {
      $or: [
        { 'items.classificationSnapshot': { $exists: false } },
        { 'items.classificationSnapshot': null },
        { 'items.classificationSnapshot.itemClassification': 'UNKNOWN' },
        { 'items.classificationSnapshot.itemClassification': { $nin: ['MERCHANDISE', 'CLINICAL'] } }
      ]
    }
  },
  {
    $project: {
      _id: 1,
      orderDate: 1,
      orderAmount: 1,
      status: 1,
      defectiveItemCount: {
        $size: {
          $filter: {
            input: '$items',
            as: 'it',
            cond: {
              $or: [
                { $eq: [{ $ifNull: ['$$it.classificationSnapshot', null] }, null] },
                { $eq: ['$$it.classificationSnapshot.itemClassification', 'UNKNOWN'] },
                { $not: { $in: ['$$it.classificationSnapshot.itemClassification', ['MERCHANDISE', 'CLINICAL']] } }
              ]
            }
          }
        }
      },
      itemClassifications: '$items.classificationSnapshot.itemClassification'
    }
  }
]);
```

---

## 4. Why Automatic Historical Mutation is Prohibited (AC8)

Under Acceptance Criteria 8, automatic script-based mutation of historical OrderItems is strictly forbidden:

1. **Snapshot Immutability Contract:** `classificationSnapshot` in `orderItem.model.js` is defined with `immutable: true` and strict Mongoose mutation interceptors. Disabling these guards introduces severe security and architectural regression risks.
2. **Catalog Time-Travel Fallacy:** Current Inventory classification cannot be presumed identical to historical intent. An item could have changed classification, pricing, or catalog placement since the customer checked out.
3. **No Free-Text Inference:** System standards explicitly forbid guessing classification from item names or unstructured text categories.
4. **Audit Trail Integrity:** Silently mutating historical records compromises non-repudiation and falsifies historical transaction records.

---

## 5. Controlled Safe Remediation Options

If already-paid affected Orders exist in staging or production environments, the following three options are available. Any remediation requires prior written sign-off from the Lead Architect, Product Owner, and Security Officer.

### Option 1: Standard Customer Service Exception Flow (Recommended)
- **Mechanism:** Treat the affected Order through existing staff customer service protocols. Since physical merchandise has already been picked up (`PICKED_UP`), verify physical fulfillment with the customer.
- **Loyalty Resolution:** If loyalty eligibility cannot be verified automatically, a Customer Service supervisor grants a manual customer goodwill point adjustment via the authorized Loyalty Management API, logging full audit context (`SYSTEM_CUSTOMER_SERVICE_ADJUSTMENT`).
- **Order Lifecycle:** Transition the order through an authorized administrative maintenance operation with explicit audit recording rather than modifying underlying item history.

### Option 2: Business-Approved Audit Correction Migration
- **Mechanism:** A dedicated migration script executed in an isolated maintenance window under two-person control.
- **Requirements:**
  1. Complete export and hashing of pre-migration collections (`orders`, `orderitems`).
  2. Inventory catalog history verification to verify the original classification at the timestamp of the order.
  3. Controlled update utilizing atomic session transactions, updating only verified `UNKNOWN` items to their historically verified classification.
  4. Audit trail logging recording the migration script execution, operator identity, ticket approval ID, and affected document IDs.
- **Risks:** High operational complexity; requires schema immutability bypass during migration window.

### Option 3: Manual Store Settlement
- **Mechanism:** In cases where fewer than 5 orders are affected, store administrators manually finalize order records with store operations, leaving database records intact to preserve audit history.

---

## 6. Preventive Verification

With the completion of Issue #97:
- New checkouts validate `itemClassification` prior to order persistence.
- Any cart item lacking valid `MERCHANDISE` or `CLINICAL` classification immediately fails checkout with HTTP 422 `CHECKOUT_ITEM_CLASSIFICATION_INVALID`.
- No new Orders with `UNKNOWN` snapshots can ever be created.
