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

## Development

Start the backend in development mode:

npm run dev

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

## Code Quality & Formatting

- Run linter: `npm run lint`
- Check formatting: `npm run format:check`
- Fix formatting: `npm run format`
