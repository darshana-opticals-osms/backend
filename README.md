# backend

Backend API and business logic for Darshana Opticals OSMS

[![Backend CI](https://github.com/darshana-opticals-osms/backend/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/darshana-opticals-osms/backend/actions/workflows/ci.yml)
![Test Coverage](https://img.shields.io/badge/coverage-85.05%25-brightgreen)

## Continuous Integration

Backend changes are automatically validated using GitHub Actions.

The CI pipeline performs:

- ESLint code-quality checks
- Prettier formatting validation
- Automated Jest tests
- Test coverage generation
- Dependency vulnerability scanning

The current backend test suite contains 21 passing tests with approximately 85.05% line coverage.

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
- `npm run seed:reset` — Resets development seed collections and populates fresh sample data.

#### Development Test Accounts

All seeded development accounts use the default password: **`DevPassword123!`**

- **System Admin:** `admin.dev@darshanaopticals.local` (Role: `SYSTEM_ADMIN`)
- **Branch Manager:** `manager.colombo@darshanaopticals.local` (Role: `BRANCH_MANAGER`, Branch: Colombo)
- **Inventory Manager:** `inventory.colombo@darshanaopticals.local` (Role: `INVENTORY_MANAGER`, Branch: Colombo)
- **Optometrist:** `optometrist.kandy@darshanaopticals.local` (Role: `OPTOMETRIST`, Branch: Kandy)
- **Cashier:** `sales.gampaha@darshanaopticals.local` (Role: `SALES_ASSISTANT_CASHIER`, Branch: Gampaha)
- **Customer 1:** `kamal.customer@example.com` (Role: `CUSTOMER`)
- **Customer 2:** `alice.customer@example.com` (Role: `CUSTOMER`)
- **Customer 3:** `nimal.customer@example.com` (Role: `CUSTOMER`)

#### Sample Branches & Product Catalog

The seed script creates fictional branches (`COLOMBO_MAIN`, `KANDY_CITY`, `GAMPAHA_CENTRAL`) and populates 11 representative product inventory items across multiple categories (`Sunglasses`, `Sports`, `Men`, `Women`, `Kids`, `Contact Lenses`), brands (`Ray-Ban`, `Oakley`, `Persol`, `Oliver Peoples`, `Vogue Eyewear`, `Gucci`, `Acuvue`), and price points for testing search and filtering APIs.

#### Production Safety

Seed operations are strictly prohibited when `NODE_ENV=production`. Attempting to run seed operations in production triggers a safety error.

### MongoDB setup

- Ensure MongoDB is running locally or provide a MongoDB Atlas connection string.
- Copy `.env.example` to `.env` and set `MONGODB_URI` for your environment.
- In test mode, the application starts an in-memory MongoDB instance automatically when `MONGODB_URI` is not set.

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
  '/branch-or-management-report',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_MANAGER, ROLE_VALUES.MANAGEMENT),
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
authorizeRoles(ROLE_VALUES.BRANCH_MANAGER, ROLE_VALUES.MANAGEMENT);
```

## Code Quality & Formatting

- Run linter: `npm run lint`
- Check formatting: `npm run format:check`
- Fix formatting: `npm run format`
