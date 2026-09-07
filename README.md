# backend

Backend API and business logic for Darshana Opticals OSMS

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

## Code Quality & Formatting

- Run linter: `npm run lint`
- Check formatting: `npm run format:check`
- Fix formatting: `npm run format`
