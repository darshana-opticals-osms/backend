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

## Code Quality & Formatting

- Run linter: `npm run lint`
- Check formatting: `npm run format:check`
- Fix formatting: `npm run format`
