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

Orders with no Payments, or only failed/cancelled attempts without unresolved
reconciliation, can be cancelled and their exact reserved stock restored in one
transaction. Unpaid staff cancellation uses the same restoration transaction.
`inventoryRestoredAt` and the conditional Order transition prevent duplicate
restoration. Payment initiation, IPNs and restoration coordinate through a write
to the same Order document, requiring MongoDB replica-set or sharded-cluster support.
Restored quantities also update existing reorder alerts transactionally.

Approved Phase 4 conservative policy: pending/processing attempts and unresolved
reconciliation hold the Order and stock for manual provider-outcome resolution.
Local expiry does not assert that PayHere cancelled a transaction. Completed or
refunded Payments also prevent automatic inventory release. No Payment or verified
event history is rewritten by expiry.

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
