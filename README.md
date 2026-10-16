# backend

Backend API and business logic for Darshana Opticals OSMS

[![Backend CI](https://github.com/darshana-opticals-osms/backend/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/darshana-opticals-osms/backend/actions/workflows/ci.yml)
![Test Coverage](https://img.shields.io/badge/coverage-91.14%25-brightgreen)

## Continuous Integration

Backend changes are automatically validated using GitHub Actions.

The CI pipeline performs:

- ESLint code-quality checks
- Prettier formatting validation
- Automated Jest tests
- Test coverage generation
- Dependency vulnerability scanning

The backend Jest suite and coverage are generated with the commands in the Testing section below.

## Prerequisites

- Node.js 18+ recommended
- npm

## Setup

1. Install dependencies:
   npm install
2. Create your local environment file by copying the example:
   copy .env.example .env
3. Update the values in .env as needed for your environment.

Authentication configuration:

- `JWT_SECRET` is required outside test mode. Set it to a long, random secret
  and never commit the real value.
- `JWT_EXPIRES_IN` controls access-token lifetime and defaults to `24h`.

## Chatbot session budget (issue #77)

The backend shares a fixed 30-minute usage window across tabs, devices and JWTs
for each authenticated Customer. Twenty messages means ten question/reply
exchanges. Each admitted query reserves two slots before retrieval/provider work,
including unsupported and failed requests. Manual retries count again; automatic
adapter retries use the original reservation. Refresh, logout/login, tab close
and clearing browser history do not reset the budget.

Existing widget requests and successful responses remain compatible. Exhaustion
returns `429` with `error.code = CHATBOT_SESSION_EXHAUSTED` and `Retry-After`
seconds until expiry. Per-minute rejection retains `RATE_LIMIT_EXCEEDED`. Usage
storage failure returns safe `503` `CHATBOT_USAGE_UNAVAILABLE` before retrieval
or provider work. The widget should distinguish these error codes. No reset API
exists.

Only a Customer reference, window timestamps and count are retained in
`chatbotusages`. MongoDB TTL cleanup deletes expired records asynchronously;
expiry is enforced independently of cleanup. Customer model deletion removes
usage. Raw database/bulk deletions bypass model hooks and must explicitly remove
matching usage records. No conversation text is stored. Deployment must ensure
the `expiresAt` TTL index exists when automatic index creation is disabled.
See the [approved contract](docs/chatbot-session-budget-proposal.md).

## Development

Start the backend in development mode:

npm run dev

### Development Seed Mechanism

The backend includes a controlled seed-data mechanism for local development and automated non-production testing. Seed data contains only fictional test records and never real customer, staff, or clinical information.

#### Seed Commands

- `npm run seed` — Populates non-production development data idempotently without creating uncontrolled duplicate records.
- `npm run seed:reset` — Destructively clears all local development records across target and dependent collections (`OrderItem` -> `Payment` -> `Order` -> `Appointment` -> `Prescription` -> `Inventory` -> `Staff` -> `Customer` -> `Admin` -> `Branch`) sequentially in strict dependency order (removing both seeded and custom local development records), then repopulates fresh sample data.

#### Development Test Accounts

All seeded development accounts use the default password: **`DevPassword123!`**

- **System Admin:** `admin.dev@darshanaopticals.local` (Role: `SYSTEM_ADMIN`)
- **Branch Manager:** `manager.colombo@darshanaopticals.local` (Role: `BRANCH_MANAGER`, Branch: Colombo)
- **Optometrist:** `optometrist.kandy@darshanaopticals.local` (Role: `OPTOMETRIST`, Branch: Kandy)
- **Gampaha Optometrist:** `optometrist.gampaha@darshanaopticals.local` (Role: `OPTOMETRIST`, Branch: Gampaha)
- **Branch Assistant:** `sales.gampaha@darshanaopticals.local` (Role: `BRANCH_ASSISTANT`, Branch: Gampaha)
- **Gampaha Branch Manager:** `manager.gampaha@darshanaopticals.local` (Role: `BRANCH_MANAGER`, Branch: Gampaha)
- **Customer 1:** `kamal.customer@example.com` (Role: `CUSTOMER`)
- **Customer 2:** `alice.customer@example.com` (Role: `CUSTOMER`)
- **Customer 3:** `nimal.customer@example.com` (Role: `CUSTOMER`)

#### Sample Branches & Product Catalog

The seed script creates fictional branches (`COLOMBO_MAIN`, `KANDY_CITY`, `GAMPAHA_CENTRAL`) and populates 11 representative product inventory items across multiple categories (`Sunglasses`, `Sports`, `Men`, `Women`, `Kids`, `Contact Lenses`), brands (`Ray-Ban`, `Oakley`, `Persol`, `Oliver Peoples`, `Vogue Eyewear`, `Gucci`, `Acuvue`), and price points for testing search and filtering APIs.

#### Sample Clinical Prescriptions (ADR-001)

The seed script populates 3 fictional clinical prescription records adhering to ADR-001 specifications (Distance/Reading parameters for Right & Left eye, VA, Add Power, Near VA, clinical remarks, and soft-archival status). Multiple prescriptions are attached to `kamal.customer@example.com` to support testing prescription history viewing (FR-002) and optometrist traceability (FR-013).

#### Production Safety

Seed operations are strictly prohibited when `NODE_ENV=production`. Attempting to run seed operations in production triggers a safety error.

### MongoDB setup

- Checkout uses MongoDB multi-document transactions. Development and deployed MongoDB
  configurations must therefore support transactions through a replica set or sharded cluster.
- Appointment booking, cancellation, reassignment, and doctor-session writes also require transaction support;
  standalone MongoDB deployments are not supported for these operations.
- For a local MongoDB server, configure the replica set name `osms-dev-rs`, start `mongod`
  with `--replSet osms-dev-rs`, then initialize it once with
  `mongosh --eval "rs.initiate({_id:'osms-dev-rs',members:[{_id:0,host:'127.0.0.1:27017'}]})"`.
- Copy `.env.example` to `.env` and set `MONGODB_URI` to your replica-set URI. For production,
  use the provider's replica-set/sharded-cluster connection URI and provide credentials only
  through deployment secrets; do not commit credentials.
- In test mode, the application starts an in-memory MongoDB instance automatically when `MONGODB_URI` is not set.

### Payment reservation expiry

The server runs a reservation sweep on startup and once per minute, processing at most
100 expired `ORDER_CREATED` Orders per run. The scheduler advances through bounded
pages so held Orders do not prevent later reservations from being examined. The
deadline remains the original checkout `reservationExpiresAt`; the sweep never
extends it or creates a replacement payment window.

Orders without confirmed payment or unresolved reconciliation can expire. Stale
PayHere pending/processing attempts are locally `cancelled` with
`failureReason: session_expired` at the original reservation deadline (ADR-011
sections 12/13). Orders with no Payments or only failed/cancelled attempts are also
eligible. Exact reserved stock and the local session cancellation commit in one
transaction. Unpaid staff cancellation uses the same restoration transaction.
`inventoryRestoredAt` and the conditional Order transition prevent duplicate
restoration. Payment initiation, IPNs and restoration coordinate through a write
to the same Order document, requiring MongoDB replica-set or sharded-cluster support.
Restored quantities also update existing reorder alerts transactionally.

Local cancellation closes checkout; it does not claim PayHere cancelled or refunded
funds. Late verified success is retained for reconciliation, never Order revival
or another stock change. Completed/refunded Payments, confirmed capture evidence
and unresolved reconciliation hold stock. Staff cancellation still holds uncertain
active sessions before expiry. Attempts, provider references and verified events
are retained; expiry creates no fabricated provider event.

An initiation request after the original deadline closes stale local attempts but
returns `409 ORDER_PAYMENT_EXPIRED` without a new checkout. Once the sweep has
cancelled that Order, initiation returns `409 ORDER_NOT_PAYABLE` instead; neither
response permits retry on that expired Order. The team-approved ADR-011 amendment
in [Documents PR #38](https://github.com/darshana-opticals-osms/documents/pull/38)
requires a fresh checkout and new Order after genuine expiry; checkout revalidates
current prices, quantities and Inventory without extending or re-reserving the old
Order. A signed failure or cancellation before the deadline permits a distinct
Payment attempt within the remaining original reservation window. Browser navigation
alone never cancels a Payment.

Missing OrderItem inventory references, deleted Inventory, invalid stock quantities,
or empty item lists block the entire restoration and are reported by the scheduler
using Order IDs and reason codes. Legacy Orders without an original reservation
deadline are excluded from automatic expiry; their deadline or Inventory mapping
must not be guessed. Staff cancellation of an unverifiable unpaid reservation is
also rejected. These holds require manual review; Phase 4 adds no reconciliation API.

Cancellation appends audit history and sends the existing shop-contact/refund-guidance
notification after commit. SMTP failure is logged without undoing cancellation.
As with existing cancellation notifications, delivery is best effort; this phase
does not add a durable notification outbox or automatic email retries.

### Cart recovery after automatic unpaid reservation expiry

Once automatic expiry passes all existing financial/reconciliation and exact
Inventory-reference checks, it restores the expired Order's `inventoryId` and
quantity selections into that Customer's Cart. Existing items are preserved;
matching Inventory IDs have quantities added without duplicate rows. An absent
Cart is created. No historical prices, eligibility snapshots or stock reservation
are copied into the Cart.

Cart recovery, local payment-session expiry, Inventory release/reorder alerts and
Order cancellation share the same MongoDB transaction and Order restoration guard.
Concurrent Cart edits serialize through Cart writes; first-Cart unique-key races
retry the entire aborted transaction. Invalid persisted Cart data, missing
references, quantity overflow or a failed Cart write roll back the whole operation
and are reported for safe retry/review; quantities are never truncated. Repeated
sweeps cannot restore the same Order twice. Staff cancellation, refunds and browser
navigation retain their existing behavior and do not trigger this recovery.

Customers review the recovered selections through `GET /api/cart` and use the
existing `POST /api/checkout`. Checkout revalidates current prices and stock,
creates a **new Order** and fresh 30-minute reservation, then clears the Cart.
Payment must target the new Order. The old Order/Payment history remains intact;
a late verified success remains reconciliation evidence and does not revive the
old Order, deduct stock again or remove recovered Cart selections.

Automatic Cart recovery is a team-approved business rule documented in ADR-003,
"Automatic Cart Recovery After Eligible Unpaid Order Expiry." The amendment was
approved and merged in [Documents PR #38](https://github.com/darshana-opticals-osms/documents/pull/38),
and the implementation above follows that approved rule.

### PayHere callback and availability contracts

The allowlist also accepts the optional scalar `recurring` field observed in a
real one-time Sandbox notification. It is unsigned metadata, discarded just like
custom/card/message fields, and cannot enable recurring billing or prove payment.
Bare empty `custom_1`/`custom_2` form keys are supported; repeated keys are rejected.

`POST /api/payments/notify` accepts only allowlisted scalar form fields. The
optional sandbox `captured_amount` must be a nonnegative decimal with two places;
it is ignored for financial decisions and is not persisted. The official Checkout
signature covers merchant ID, attempt reference, `payhere_amount`, currency and
status; merchant/amount/currency checks, timing-safe verification and idempotency
remain mandatory. Optional custom/card/message fields are discarded; only
documented provider payment-method labels are retained as unsigned display
metadata. Unknown method labels are accepted but discarded; unknown field names
and duplicate fields remain rejected. See the [official PayHere Checkout contract](https://support.payhere.lk/api-%26-mobile-sdk/checkout-api).

A separate per-IP limiter runs before callback form parsing, independently of the
general customer API limiter. Defaults: `PAYHERE_NOTIFY_RATE_LIMIT_MAX=600` and
`PAYHERE_NOTIFY_RATE_LIMIT_WINDOW_MS=60000` (600 requests per 60 seconds), including
retries. Configure these positive integers at startup to fit provider delivery volume.
Excess traffic receives `429 RATE_LIMIT_EXCEEDED` with `Retry-After`, before
financial processing. The existing in-memory limiter applies per application
process; shared deployment limits belong at the trusted proxy/shared limiter layer.

Missing PayHere configuration returns operational `503 PAYMENT_UNAVAILABLE` with
a safe message and no initiation effects. Hosted-checkout parameters are built
locally; the backend does not make a charge request or probe the PayHere website.
Provider website/network failure after successful initiation is therefore not a
backend 503; verified IPNs and reservation expiry determine subsequent state.
Further Sandbox E2E checks must use a fresh Order within its reservation, sandbox
credentials for the registered checkout domain, and a reachable public notify URL.
Never log callback bodies, signatures or credentials as evidence.

### PayHere Retrieval API investigation and missed-callback evidence

An approved payment in the provider dashboard is not automatically an OSMS
completed Payment. A rejected/missed callback can leave no verified PaymentEvent;
normal expiry can then close the local session and restore Inventory/Cart. The
browser return URL never repairs that financial discrepancy.

Optional `PAYHERE_API_APP_ID` and `PAYHERE_API_APP_SECRET` configure the Merchant
Retrieval API, **not** the Checkout Merchant Secret. Obtain these from API Keys in
the same merchant account and environment as checkout. Use the provider's required
API-key permissions/domain allowlist; live Merchant API access additionally needs
PayHere IP approval. Never put credentials in a browser or an online encoder.
`PAYHERE_RETRIEVAL_TIMEOUT_MS` defaults to 8000 (allowed 1000–30000). Credentials are
optional at application startup; missing credentials fail retrieval closed with
`503 PAYHERE_RETRIEVAL_NOT_CONFIGURED`, without affecting hosted checkout or IPN.

The adapter uses only the fixed sandbox/live OAuth token and payment/search
endpoints, Basic client-credentials OAuth, a memory-only expiring token cache, one
refresh after invalid-token responses, request/body timeouts and bounded response
size. No redirect following, raw provider-body persistence or sensitive logging.
The process-local budget permits at most 18 Merchant API requests per 10 seconds
(including OAuth), below PayHere's documented 20; provider 429/Retry-After is
honored with safe 503/retryAfterSeconds details. This is not a shared multi-instance
quota: coordinate deployment-wide usage before adding automatic polling.

BRANCH_MANAGER-only APIs (all other canonical roles are denied):

- `POST /api/payments/:paymentId/recovery`, with omitted body or `{ "dryRun": true }`,
  reads the provider by the stored unique attempt `providerOrderId`, validates and
  returns only financial references/status/amount/currency and a proposed reason.
  Default dry-run makes **no database writes**, including no lock/version writes.
- Explicit `{ "dryRun": false }` records a sanitized append-only
  `PaymentRetrievalEvidence` observation. It may set a reconciliation flag but never
  clears an existing flag/reason or modifies Payment/Order status. Apply only after
  reviewing the dry-run and obtaining authority for the particular transaction.
- `GET /api/payments/:paymentId/retrieval-evidence?page=1&limit=25` reads the complete
  paginated evidence history (page 1–10000, limit 1–100, newest first). Observation
  identity, staff identity, OAuth tokens, signatures and customer/card data are not
  exposed. Existing customer own-Order status and signed-IPN event APIs are unchanged.

Source is explicitly `PAYHERE_RETRIEVAL_API`, stored separately from signed IPNs.
Observation uniqueness prevents identical snapshots being inserted twice. Changed
provider statuses/references append new evidence rather than replacing history.
Distinct provider payment IDs for one merchant reference require review; no row is
silently selected as the canonical capture. Amount, currency, Order reference and
any previously stored provider transaction reference are checked. HTTP/token failures
and malformed/unknown statuses fail closed without creating evidence. The ambiguous
envelope `-2` described below is only an observation, never proof of a financial outcome.
Network I/O finishes before transactions; application re-reads state under the same
Order write lock used by IPN/expiry and atomically appends evidence plus any flag.
Concurrent IPN/expiry outcomes are re-evaluated, not overwritten. Audit insertion
failure rolls back the entire local transaction.

Provider mapping follows the [official Retrieval API](https://support.payhere.lk/api-%26-mobile-sdk/retrieval-api):

- `data[*].status`: `RECEIVED` means received; `REFUND REQUESTED`, `REFUND PROCESSING`,
  `REFUNDED`, `CHARGEBACKED` are separate observations requiring review, not automatic
  OSMS refund/loyalty mutations. Portal `Authorized` is **not** assumed equivalent.
- Envelope `status=0`: pending; `-1`: no records; neither proves no funds exist.
- Envelope `-2` is documented both as declined and authentication error. It is
  reported as `declined_or_error`, never used to cancel or release stock. Unsafe
  HTTP/token/response failures instead return sanitized operational 503 errors.

**ADR boundary:** ADR-011 sections 10/11 explicitly require cryptographically
verified IPN for `completed`. Retrieval-only completion remains inactive, including
on unexpired Orders. One matching `RECEIVED` observation for an active, unexpired
attempt on an `ORDER_CREATED` Order, with no conflicting financial state, records
`RETRIEVAL_SUCCESS_REQUIRES_IPN` as evidence only: it does not set a blocking
reconciliation flag. A later genuine signed IPN can complete normally. The evidence
reason is a historical assessment, not the current Payment reconciliation flag.
Actual mismatches, conflicting attempts/captures, refunds, chargebacks and late
success retain blocking reconciliation protection; existing flags are never cleared.
An IPN reporting a different capture from saved `RECEIVED` evidence is also held,
not treated as the delayed matching notification.
Even an identical observation replay rechecks current state under the Order lock,
so expiry or a new conflict can establish a hold without rewriting old evidence.
Previously stored holds are not automatically cleared by this correction.
For cancelled/expired Orders, evidence records `RETRIEVAL_LATE_SUCCESS` and
flags reconciliation without revival, stock deduction, Cart removal, refund or
loyalty changes. No reconciliation-resolution or flag-clearing API is introduced.

For an existing real transaction: dry-run first; compare the exact merchant
reference, provider transaction ID, amount/currency and provider status against
authenticated provider records. Obtain genuine provider redelivery where possible.
If expired, use authorized financial reconciliation; do not pay again, fabricate an
IPN, replay inspector traffic or manually edit records. Local automated tests use
mock HTTP responses and do not establish real Sandbox synchronization.

**Expiry design requiring review (not implemented):** a bounded pre-expiry verifier
could read candidate versions, retrieve outside MongoDB, then take the shared Order
lock and re-check expiry/payment state before recording evidence. A successful
concurrent IPN or expiry must win/retry safely. Pending, absent, timeout and API
failure results cannot establish unpaid status. Any network grace period, new hold
or automated use of retrieval for completion requires an explicit approved rule.
No automatic provider polling, reservation extension, new grace duration or expiry
policy change is included here; the existing 30-minute sweep remains unchanged.

### Real Sandbox evidence and remaining verification

The operator completed a real hosted Sandbox checkout for Payment
`6ad11a57fe503192fd00fa39`, Order `6ad119ecfe503192fd00fa27`, LKR 37000.00.
A read-only database check on 2026-10-16 confirmed `Payment.status=completed`,
`Order.status=PROCESSING`, `reconciliationRequired=false`, one applied success
PaymentEvent (`statusCode=2`), and no Inventory restoration. This is IPN evidence,
not proof inferred from a browser return. Order completion/loyalty earning was
not exercised by this checkout.

For the earlier missed-callback Payment `6ad10540d8f95641b92ae200`, genuine Sandbox
OAuth/retrieval verification found one matching `RECEIVED` provider transaction,
LKR 37000.00. The operator also reports successful authorized recovery dry-run.
The final read-only database check confirmed Payment `cancelled/session_expired`,
Order `CANCELLED`, restored Inventory marker, no signed PaymentEvents and no saved
retrieval evidence. The cancelled Order was not revived. No callback replay,
replacement charge or manual financial mutation was used for this review.

Real hosted failed/cancelled flows, Order COMPLETED loyalty earning and an
externally confirmed manual full-refund/reversal remain unverified end to end.
Automated tests do not replace those checks. Documents PR #38 resolved the ADR-011
sections 8/12 expiry/retry boundary. The section 13 earning-trigger discrepancy with
ADR-005 section 14 remains documented; earning follows successful Payment **and Order
COMPLETED**. No ADR is edited in this backend repository.

PR #80 closes payment issue #53 and only partially implements loyalty issue #54.
The shared loyalty core/refund-reversal prerequisites remain included; #54 stays
open for customer ownership-scoped loyalty reads, manager read-only loyalty APIs,
their Swagger/security tests and remaining issue acceptance criteria. This is not
a claim that all payment reviewer requirements or all loyalty scope are complete.

### Management payment monitoring

Phase 5A adds three authenticated, read-only endpoints restricted to `BRANCH_MANAGER`:

- `GET /api/payments`: all historical attempts with optional `status`, `orderId`,
  exact `providerTransactionId`, and `reconciliationRequired=true|false` filters.
- `GET /api/payments/:paymentId`: one attempt's approved financial metadata.
- `GET /api/payments/:paymentId/events`: that attempt's stored verified audit evidence,
  optionally filtered by `action`, `statusCode`, and exact `providerTransactionId`.

Both lists accept `page` (1–10000, default 1), `limit` (1–100, default 25), and
`sortOrder=asc|desc`. Payment `sortBy` allows `createdAt` (default), `updatedAt`,
`amount`, or `status`; event sorting allows `verifiedAt` (default) or `createdAt`.
Sorting includes an ID tie-breaker. Lists return
`{ success: true, data: { items, pagination: { page, limit, total, totalPages } } }`;
detail returns `{ success: true, data: payment }`. These are live monitoring reads,
not a frozen accounting report; records and totals may change during callbacks.
Unknown parameters and non-scalar filter values are rejected with 422.

Payment reference search matches the stored Payment reference; event reference
search also reveals distinct provider transactions retained as reconciliation
evidence. Verified event success does not imply that its Payment or Order transition
was applied: inspect event `action`/`reason` and the Payment reconciliation flag.
Absent legacy reconciliation flags are treated as false. Known backend reason codes
are exposed; unknown/free-text legacy reasons are returned as null without modifying
the persisted evidence. DTOs exclude signatures, idempotency/event keys, raw payloads,
card data, merchant credentials, and customer profile information.

Monitoring follows the existing role-wide Order oversight scope. Payment/Order
records do not provide an authoritative branch ownership mapping; branch-restricted
payment oversight requires a separate approved mapping. Other roles, including
`SYSTEM_ADMIN`, cannot access these management endpoints. Customer own-Order payment
status access remains separate. Phase 5A provides no status overrides, reconciliation
clearing, or refund mutations; those require the Phase 5B workflow review.

### Phase 5B Part 1: internal refund evidence infrastructure

`manualRefundEvidence.service` provides an internal append primitive for facts about
an already confirmed external full refund. It is not connected to a route, controller,
scheduler or financial transition. The helper requires trusted `BRANCH_MANAGER`
authentication context and derives Order/capture identity and the recording actor
from backend context. Evidence amount/currency must exactly match the full original
Payment under the existing monetary precision contract. The Payment must already
represent a canonical completed/refunded transaction; late captures on failed or
cancelled attempts remain outside this primitive's supported source mapping.
Unresolved reconciliation on the source Payment or any other attempt on its Order
blocks append/replay with `409 PAYMENT_RECONCILIATION_REQUIRED`; flags are not cleared.

The dedicated audit collection preserves original capture references and records
the full amount/currency, actor and server recording timestamp. A unique Payment
index permits one full-refund evidence record for its canonical capture; a unique
idempotency-key index protects retries. Identical retries return the original DTO;
changed data/actor/Payment or a second key for an existing record conflicts. This
prevents duplicate local recording, not duplicate external transfers. No global
uniqueness assumption is made about external receipt/bank reference formats.

The optional `session` binds all audit/source reads and insertion to the caller's
MongoDB session, with sequential operations and no nested transaction or commit.
Initialize the collection/indexes before starting a caller-owned transaction.
A duplicate-key insertion inside that transaction propagates the original error:
the caller must abort/retry before recovering an identical committed record. The
helper never queries an aborted transaction; nontransactional retries retain recovery.

Only amount, currency, optional `refundChannel` (`payhere_portal` or `bank_transfer`)
and optional scalar `refundReference` are accepted as evidence. Optional references
are metadata, not proof of transfer. ADR-011 does not define mandatory receipt
documents, their verification procedure, external-reference formats or execution-time
proof. Those gaps are intentionally not implemented as mandatory business rules.
The helper does not independently verify an external refund. Raw receipts, credentials,
signatures, client-chosen actors/statuses and arbitrary payloads are not accepted.
Internal keys/hashes and unknown fields are excluded from the explicit response DTO.

Evidence is append-only through application-model save/query/document middleware;
update, replacement, deletion and batch-write operations are rejected. Raw MongoDB
collection access or privileged database administration bypasses model middleware:
this is not database-level tamper-proof storage, and deployment DB permissions remain
an operational boundary. Original Payment, PaymentEvent, Order, inventory, Customer
and reconciliation state is unchanged when evidence is appended. Recording evidence
does not assert that loyalty reversal or other refund side effects have happened.

Payment initiation now rejects an Order containing any `refunded` Payment, including
duplicate-key recovery, so refunded history cannot accidentally enable repeat checkout.
No refund/reconciliation mutation endpoint or automatic flag clearing is enabled.

The accepted loyalty ADRs conflict: ADR-005 §14 requires successful Payment **and
Order COMPLETED** for confirmed earning, while ADR-011 §13 triggers accrual when
Payment becomes completed and Order moves to **PROCESSING**. Neither rule is changed
or selected here. No loyalty award, reversal, Order cancellation or inventory
restoration is performed by this infrastructure.

### Phase 5B Part 2: inactive manual full-refund orchestration (historical)

For activated behavior, see "Final loyalty and manual full-refund integration" below.

`manualRefund.service.recordConfirmedManualFullRefund` is internal only: no refund
controller, route, scheduler, Swagger mutation operation or runtime enable flag is
installed. It accepts trusted manager auth context, a Payment ID, an idempotency key
and the existing Part 1 evidence contract. The caller must have verified that the
external full refund really happened; this code never transfers money or verifies
receipts. No new mandatory proof format is introduced.

The orchestrator locks the Order through the existing transactional `__v` write,
re-reads Payment/Order data, matches full stored totals and LKR currency, and requires
the exact original successful applied PayHere PaymentEvent. Related active/captured
attempts, any reconciliation flag, or reconciliation-required events hold processing.
There is no reconciliation-resolution model yet, so historical reconciliation events
cannot be assumed resolved merely because a flag is absent. It preserves the original
capture reference and provider history, uses the existing unique refund/identity
indexes, and supports identical replay without a second reversal only after durable
loyalty reversal completion is authoritatively verified in the same session. Refund
evidence and refunded Payment status alone are not completion proof. Duplicate-key
recovery restarts the transaction after abort, never queries the aborted transaction.
All session operations are sequential.

Evidence insertion, the conditional `completed -> refunded` update and the loyalty
boundary share one transaction. Phase 6 Part 1 implements the ledger-backed reversal
and verification primitives, but still installs no refund endpoint. Missing earning
history holds the refund with `LOYALTY_EARNING_HISTORY_MISSING`; absence is not proof
of a zero-point award. Missing or mismatched reversal evidence never verifies a replay.
ADR-011 section 15 requires reversal on refund; ADR-005 sections 16 and 18 to 20 require
auditable reversal and balance/history consistency. Their award-trigger contradiction
(section 14 versus section 13,
described above) remains unchanged. Activation requires resolving that actual conflict
and the data/rounding contracts described below. Reversal is now idempotent,
source-linked and session-bound with atomic balance/history writes. Negative balance
or prior-redemption cases needing unspecified policy remain held.
No award formula, zero-point fallback or replacement business rule is selected here.

Transaction/concurrency tests use an explicitly test-only loyalty double to exercise
the prepared orchestration. Passing those tests is **not** evidence that production
refund/loyalty mutation is ready. Tests also prove that the real dependency holds
PROCESSING, COMPLETED and CANCELLED Orders with all provisional writes rolled back.
Already-refunded retries also fail closed without durable verification, preserving
Payment, Order lock metadata, audit evidence and inventory. The minimal future
`verifyFullRefundReversal({ payment, order, refundEvidence, session })` interface will
return exactly `true` only after reading authoritative durable reversal completion
for the same Payment/refund and checking balance/history consistency. It now uses
the real ledger; neither a refunded Payment nor refund evidence alone is proof.
Tests cover both the historical boundary doubles and the real reversal path.
No zero-point fallback is introduced.
Neither this code nor refund evidence changes Order status/history, restores inventory,
clears reconciliation, edits provider events or executes external refunds. Committed
test-double paths change only Payment status, audit evidence and Order lock metadata.

Manager-only `GET /api/payments/:paymentId` now includes sanitized `refundEvidence`
(or null); the list, event-list and customer status contracts are unchanged. Evidence
may predate an operational refund transition and does not imply refunded status or
completed loyalty reversal. Internal keys/hashes, arbitrary fields and raw receipts
are excluded.

Proposed **inactive** API contract for later activation/review:

- `POST /api/payments/:paymentId/refunds`, authenticated `BRANCH_MANAGER` only.
- `Idempotency-Key`: bounded scalar key following the existing internal contract.
- Body: `{ amount, currency, refundChannel?, refundReference? }` using Part 1 validation;
  submitted amount/currency confirm evidence, never determine the financial amount.
- Success/replay: `200 { success: true, data: { paymentId, orderId, status: "refunded",
amount, currency, refundEvidence } }`; identical actor/key/payload returns the same audit DTO
  only after authoritative durable loyalty reversal verification.
- Errors: authentication 401, role 403, missing source 404, unsafe/conflicting state 409,
  invalid evidence 422. Reconciliation always holds, never auto-clears.

This proposed path is deliberately not registered or advertised as an available API.

### Final loyalty and manual full-refund integration (current behavior)

This section supersedes the historical phase descriptions below and the previously
inactive refund proposal above. The approved integration uses ADR-005 section 14:
a verified completed Payment **and** the authorized Order transition to COMPLETED.
ADR-011 section 13 still describes earlier earning at PROCESSING; that discrepancy
is recorded here, not implemented or edited in either accepted ADR.

- Inventory `itemClassification` is explicitly `UNKNOWN` (default), `MERCHANDISE`
  or `CLINICAL`. Existing manager inventory create/update permissions apply;
  SYSTEM_ADMIN remains price-only. Category strings never determine classification.
- Checkout copies this server-owned fact into the immutable OrderItem snapshot
  and derives `loyaltyEligibility` as UNKNOWN, ELIGIBLE or INELIGIBLE respectively.
  No legacy backfill is performed; later Inventory edits cannot reclassify a sale.
  Persisted item price, quantity, Inventory/Order references and the snapshot are
  protected from Mongoose saves, updates, replacements, batch edits and deletion.
  Only the explicit non-production seed reset and disposable test fixtures use raw
  collection cleanup; privileged raw database access remains outside model guards.
- Eligible spend sums snapshotted merchandise prices times quantities using integer
  cents. Clinical eye-test/examination fees are excluded. Unknown, missing or
  inconsistent classification/amounts hold processing rather than substitute totals.
  Divide the aggregate spend by 100, rounding final points once with ROUND_HALF_UP.
- Order completion, verified-source earning ledger and Customer balance commit in
  one transaction. A failure rolls back completion and its audit history as well.
  No points are awarded by payment IPNs or the PROCESSING transition.
- `POST /api/payments/:paymentId/refunds` is now active for BRANCH_MANAGER only.
  Required header: `Idempotency-Key` (1-120 characters, no controls). Body:
  `{ amount, currency: "LKR", refundChannel?, refundReference? }`; the amount must
  equal the full verified capture. Channels remain `payhere_portal`/`bank_transfer`.
  This records a manager-confirmed **already executed external refund**, not a
  transfer, external receipt verification, or a refund-eligibility decision.
- Successful recording/replay returns 200 with the sanitized contract above.
  Capture evidence, immutable refund audit and Payment refunded status must agree.
  Existing earned points require a real compensating reversal in the same transaction.
  Before Order COMPLETED, a valid lifecycle history, no Payment loyalty events and a
  consistent Customer balance establish that no award occurred; no reversal is made.
  Identical replay verifies the same condition. Order status, inventory and provider
  events remain unchanged. Conflicting evidence/idempotency identity is rejected.

Reconciliation, missing awards for completed Orders, incomplete lifecycle history,
legacy uninitialized balances and unsafe negative-balance deductions remain 409 holds.
Missing ledger entries alone never establish a zero-point award. Explicit clinical-only
sales can record a calculated zero award
and its linked compensating reversal. No reconciliation resolution, redemption,
arbitrary adjustment, partial/automatic refund or automatic inventory restoration
is activated. Existing review patches and accepted ADRs are unchanged.

### Phase 6 Part 1: loyalty core and refund reversal infrastructure (historical)

New Customers have a hidden `loyaltyBalance` stored as exact Decimal128 `0.00`.
Existing Customers without the field are **not** silently initialized or backfilled;
loyalty writes hold with `LOYALTY_BALANCE_UNINITIALIZED` pending authoritative migration.
Existing profile/authentication DTOs do not expose this internal field.

`LoyaltyTransaction` stores Customer/Order/Payment IDs, controlled event type,
source-event ID, original earning ID for reversals, capture reference, exact decimal
points delta, resulting balance and creation timestamp. Unique indexes protect
`(sourceEventId, eventType)` and one earning/one full reversal per Payment.
`REDEMPTION_DEDUCTION` is centralized as an architectural event category only: no
redemption operation, partial refund, manual adjustment or loyalty API is installed.

All calculations use integer hundredths (`BigInt`) and validated Decimal128 strings,
not binary floating-point sums. `earnedPoints = eligibleSpend / 100` is implemented
for exact two-place results. Fractional LKR spend requiring more than two point
places holds with `LOYALTY_ROUNDING_CONTRACT_REQUIRED`; no floor, half-up or other
rounding convention is selected. Two-decimal **representation** is not a rounding policy.

`earnPurchasePoints({ paymentId, session? })` accepts source IDs only, re-reads the
verified applied capture and stored Order amount, and atomically updates balance
and earning history. It has no live trigger. Its backend-only contract guards remain
unavailable: ADR-005 section 14 requires Payment success plus Order COMPLETED, while
ADR-011 section 13 specifies completed Payment plus PROCESSING. No status is chosen.
The product catalog is Inventory-backed, with mutable free-text categories;
OrderItems preserve exact inventory references and, since Part 2A, checkout-time
category facts, but no authoritative merchandise/clinical eligibility mapping.
No item name, category string, total Order amount or client
eligible-spend value is used as a substitute. Clinical examination fees cannot leak
into an award: current data remains held with `LOYALTY_ITEM_CLASSIFICATION_REQUIRED`.
An authoritative Order/Checkout eligibility contract is required, including safe
handling for legacy items and the category scope noted in ADR-005 section 6.6.

`reverseFullRefundPoints({ paymentId, refundEvidenceId, session? })` compensates only
an existing, source-linked earning, preserving its original history. It validates the
refunded capture, exact full-refund audit, reconciliation flags and provider evidence.
It never invents a deduction for missing history. Insufficient balances or existing
negative balances hold with `LOYALTY_NEGATIVE_BALANCE_POLICY_REQUIRED`, not clamping,
partial reversal or assumed debt. `verifyFullRefundPoints` requires matching earning,
reversal, capture and refund identities plus consistent Customer balance/history;
later valid earnings do not invalidate an earlier reversal merely by changing balance.

The services use the same Order lock as callbacks/refunds and sequential session
operations. Supplied sessions must already be transactional; the caller must propagate
errors and abort the whole workflow, and the service never commits/ends their session.
Initialize collection/indexes before caller-owned transactions. Owned transactions
retry driver-labelled transient errors; duplicate-key recovery starts a fresh
transaction only after abort. Unique indexes and Customer write conflicts protect
concurrent events, including different Orders belonging to the same Customer.

Profile mutations reject balance changes. Ordinary Customer model saves/queries,
bulk replacements, and aggregation writes cannot adjust balances; direct loyalty
model writes/updates/deletes are rejected. The trusted service validates new history
and uses transaction-bound native collection writes for both balance and ledger.
Raw DB access/privileged administration bypasses ODM protections and remains an
operational security boundary, not a tamper-proof audit claim.

Tests explicitly double only the unresolved earning-contract boundaries to exercise
real balance/ledger writes, precision, concurrency and refund integration. Production
has no runtime contract bypass. No Order status/history change, inventory restoration,
reconciliation clearing, earning callback wiring or refund API activation is added.

### Phase 6 Part 2A: immutable checkout classification context (historical)

Every new checkout OrderItem has an internal `classificationSnapshot` built only
from the Inventory records already read in the checkout transaction:

| Field                | Provenance / meaning                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `source`             | Literal `Inventory`, identifying the backend source model.                                                           |
| `sourceInventoryId`  | Exact Inventory `_id` at checkout, retained independently of later reference edits.                                  |
| `category`           | Verbatim stored Inventory category string; null when unavailable. This is a free-text fact, not an eligibility rule. |
| `loyaltyEligibility` | Always `UNKNOWN`; the only currently supported value.                                                                |

The existing OrderItem creation timestamp records persistence time; no policy version
or approved classification is fabricated. There is no category-to-eligibility mapping,
new catalog administration policy or client-settable eligibility flag. Cart metadata
and purported classification/eligibility fields are not copied. Checkout still accepts
only an empty JSON object, rejecting client classification payloads with 422.

Legacy records have a null or absent snapshot, explicitly treated as unresolved.
Nothing is backfilled from current Inventory on read. The loyalty eligibility reader
uses only stored OrderItem context and holds missing, UNKNOWN and unsupported values
with `LOYALTY_ITEM_CLASSIFICATION_REQUIRED`. It never substitutes the Order total or
consults today's mutable Inventory category to qualify a past purchase.

Snapshots are immutable through ordinary document/query writes. Model guards reject
snapshot updates/unsets/renames, replacement and pipeline updates, bulk edits and
aggregation writes that could overwrite history. Raw collection access/privileged DB
administration bypasses ODM protections and remains an operational boundary.
No migration or snapshot-edit API is added.

The snapshot is persisted with Order creation, stock deduction and Cart removal in
the existing transaction. Inventory ID, unit price, quantity, Order totals, reservation
and restoration logic are unchanged. Checkout and Order-tracking DTOs remain unchanged;
the snapshot is not exposed as a client input or a public response field.

This preserves context only. The earning-trigger conflict, authoritative eligibility
mapping and rounding contract remain unresolved. No automatic earning, refund endpoint,
redemption or manual point adjustment is activated.

## Production-style start

npm start

## Testing

Run the automated tests:

npm test

## Health check

The backend exposes the service health endpoint:

GET /api/health

Example response:

{
"status": "ok",
"service": "osms-backend"
}

## Public customer registration

The backend exposes the public customer registration endpoint:

POST /api/auth/register

Request body:

{
"name": "Alice Customer",
"email": "alice.customer@example.com",
"address": "12 Main Street, Colombo",
"phone": "+94711234567",
"password": "StrongPass123!"
}

Rules:

- Public registration creates a CUSTOMER account only.
- `role` and other privileged account fields are rejected by validation.
- Email is trimmed and normalized to lowercase before duplicate checking and persistence.
- Passwords are hashed with bcrypt before the customer record is saved.
- No JWT is returned on registration.

Example success response:

{
"success": true,
"data": {
"id": "66c5d2a9d7e2b8f2d7c4ff12",
"name": "Alice Customer",
"email": "alice.customer@example.com",
"address": "12 Main Street, Colombo",
"phone": "+94711234567",
"role": "CUSTOMER"
}
}

HTTP status:

- 201 Created for successful customer registration
- 409 Conflict if the email already exists for a customer, staff member, or admin
- 422 Validation failure for missing or invalid registration data

## Customer profile management

The backend exposes self-service customer profile endpoints for authenticated customers:

### Get my profile

GET /api/profile/me

Requires a valid CUSTOMER JWT and returns only the safe customer profile shape.

### Update my profile

PATCH /api/profile/me

Request body may include any subset of the allowed editable fields:

{
"name": "Alice Customer",
"email": "alice.customer@example.com",
"address": "12 Main Street, Colombo",
"phone": "+94711234567"
}

Rules:

- Only `name`, `email`, `address`, and `phone` are allowed.
- `role`, `password`, `passwordHash`, and other restricted fields are rejected with HTTP 422.
- `email` is normalized to lowercase before duplicate checking and persistence.
- Customers may only access their own profile using the authenticated token.
- Prescription history, profile images, and password changes are out of scope for this ticket.

## User login and JWT authentication

The backend exposes stateless login for customer, staff, and admin identities:

POST /api/auth/login

Request body:

{
"email": "alice.customer@example.com",
"password": "StrongPass123!"
}

Successful login returns HTTP 200:

{
"success": true,
"data": {
"token": "<signed-jwt>",
"user": {
"id": "66c5d2a9d7e2b8f2d7c4ff12",
"name": "Alice Customer",
"email": "alice.customer@example.com",
"role": "CUSTOMER"
}
}
}

Use the token on protected requests with:

Authorization: Bearer <signed-jwt>

Missing, malformed, expired, invalid, or incorrectly credentialed requests
return HTTP 401 with a safe error response. Login trims and lowercases email
before lookup and does not apply registration password-strength rules.

The JWT contains only the authenticated MongoDB user ID and canonical role. No
refresh tokens, logout API, or RBAC permission middleware are included in this
issue.

## Authentication vs authorization

This backend separates authentication from authorization.

- Authentication answers: "Who is this user?"
- Authorization answers: "What may this authenticated role do?"

The existing `authenticate` middleware verifies the Bearer token and attaches the
trusted server-generated identity to `req.auth`.

The RBAC middleware uses that existing context only:

```javascript
const authenticate = require('./src/middleware/authenticate');
const { authorizeRoles } = require('./src/middleware/authorizeRoles');
const { ROLE_VALUES } = require('./src/constants/roles');

router.get('/admin-report', authenticate, authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN), getAdminReport);

router.get(
  '/branch-or-admin-report',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER, ROLE_VALUES.SYSTEM_ADMIN),
  getBranchReport
);
```

Rules:

- `authorizeRoles(...)` reads only `req.auth.role`
- it never trusts a role from the request body, query string, or headers
- it never re-verifies JWTs or queries the database
- a missing or invalid authenticated context returns HTTP 401
- an authenticated but disallowed role returns HTTP 403
- the canonical role values are defined centrally by `ROLE_VALUES`

The authorization middleware is reusable and should be configured with canonical
roles only. Example single-role and multi-role checks use:

```javascript
authorizeRoles(ROLE_VALUES.OPTOMETRIST);
authorizeRoles(ROLE_VALUES.BRANCH_MANAGER, ROLE_VALUES.SYSTEM_ADMIN);
```

## Code Quality & Formatting

- Run linter: `npm run lint`
- Check formatting: `npm run format:check`
- Fix formatting: `npm run format`

## Appointment booking and management

Online doctor scheduling is restricted to the approved Gampaha Main Branch, identified by the persisted branch code `GAMPAHA_CENTRAL`. Only currently eligible Gampaha `OPTOMETRIST` staff may be scheduled. Customers choose an available session and submit only its `sessionId`; the server assigns the customer, provider, session time, confirmed status, and queue position. The server requires the session to begin at least 24 hours after its current time (the exact 24-hour boundary is allowed) and rechecks capacity at booking.

### Roles and lifecycle

- A `BRANCH_ASSISTANT` assigned to Gampaha creates and reschedules sessions, and can cancel or reassign appointments.
- A Gampaha Branch Assistant can use `GET /appointments/providers` to discover eligible Optometrists and receive the provider and approved branch IDs needed for session creation. This is not a general Staff or Branch directory.
- Branch Assistant appointment list/detail responses include only customer ID, name, and phone for rescheduling contact. Customers do not receive customer contact data in their appointment response; Branch Managers do not receive customer contact fields.
- A Gampaha `BRANCH_MANAGER` can read Gampaha sessions and appointments only. Managers cannot write appointment or session changes.
- A `CUSTOMER` can view only their own appointments, book available sessions, and cancel their own confirmed appointment before its session begins.
- `SYSTEM_ADMIN` and `OPTOMETRIST` do not have appointment-management access under the implemented API.
- Cancellation preserves the record, releases capacity, and compacts active queue positions. Reassignment atomically updates both sessions and positions.
- Session timestamps must be real ISO-8601 timestamps with `Z` or a numeric `±HH:MM` offset. Date-only, timezone-free, and impossible calendar dates are rejected.
- Legacy appointments remain visible to their owning customer. Staff-wide branch visibility uses a session or persisted branch snapshot; a legacy record without either is deliberately not attributed to a branch based on the staff member's current assignment.

Appointment and doctor-session endpoints reject all query parameters with `422 Unprocessable Entity`. Frontend clients must not append pagination, filtering, or cache-busting query strings to these endpoints.

### Production branch backfill

Do not run `seed:reset` or rely on development seed execution to identify the production branch. Before applying the backfill, compare a candidate's branch ID, exact address, and contact number with the authoritative production branch register. The script never creates branches or changes unrelated branch IDs, defaults to dry-run, and refuses to assign `GAMPAHA_CENTRAL` when another record already owns it.

1. Configure the production MongoDB URI and credentials through deployment secrets, then list existing branch records:

```powershell
node scripts/backfillGampahaBranchCode.js --list
```

2. Identify the correct existing Branch record using the official branch register. Preview the proposed update by passing that exact existing ID and exact address:

```powershell
node scripts/backfillGampahaBranchCode.js --branch-id <existing-branch-id> --confirm-address "<exact verified address>"
```

3. Review the dry-run output and confirm the address and contact number with the production owner. Apply only to that record:

```powershell
node scripts/backfillGampahaBranchCode.js --branch-id <existing-branch-id> --confirm-address "<exact verified address>" --apply
```

4. Rerun `--list` and verify exactly one Branch record has `codeName` equal to `GAMPAHA_CENTRAL`. The operation is idempotent for the same record.

### Swagger Try it out guide

Start the backend with `npm run dev` and open `http://localhost:5000/api-docs`. This section describes a manual workflow; it is not a claim that Swagger Try it out was manually exercised.

1. Obtain a JWT by logging in as the Branch Assistant `sales.gampaha@darshanaopticals.local` with the development password `DevPassword123!`; click **Authorize** and enter the token.
2. Use `node scripts/backfillGampahaBranchCode.js --list` or an approved database inventory to find the verified `GAMPAHA_CENTRAL` Branch ID. The public `GET /branches` endpoint intentionally omits `codeName` and is not available to Branch Assistants.
3. As the Branch Assistant, use `GET /appointments/providers` to obtain an eligible provider ID and the approved branch ID, then use `POST /doctor-sessions` with those IDs, timezone-aware `startAt` and `endAt`, and positive integer `capacity`. Choose a start at least 24 hours ahead.
4. Log in as `kamal.customer@example.com` with the development password, authorize with that JWT, then call `GET /appointments/providers` and `GET /doctor-sessions/available`.
5. Use `POST /appointments` with only `{ "sessionId": "<available-session-id>" }`. The response includes the server-assigned queue position.
6. As the customer, use `GET /appointments` and `PATCH /appointments/{id}/cancel` before the session begins. The cancellation endpoint accepts no body.
7. As the Branch Assistant, use `GET /appointments` and `PATCH /appointments/{id}/reassign` with `{ "sessionId": "<other-available-session-id>" }` when reassignment is needed.
8. Log in as `manager.gampaha@darshanaopticals.local` and verify read-only access to `GET /doctor-sessions`, `GET /appointments`, and `GET /appointments/{id}`. Write operations are rejected.

For repeatable automated verification, run `npx jest tests/integration/appointmentApi.test.js --runInBand` and `npx jest --runInBand --coverage` from `backend`.
