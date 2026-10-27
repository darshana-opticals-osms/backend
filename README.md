# Darshana Opticals - Optical Store Management System (OSMS) Backend

[![Backend CI](https://github.com/darshana-opticals-osms/backend/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/darshana-opticals-osms/backend/actions/workflows/ci.yml)
[![Test Coverage](https://img.shields.io/badge/coverage-92.34%25-brightgreen)](docs/security/owasp-assessment.md)
[![SemVer](https://img.shields.io/badge/version-v1.0.0-blue.svg)](package.json)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Backend REST API, business logic services, transactional data management, and secure integration engine for the **Darshana Opticals Optical Store Management System (OSMS)**. This repository houses the server-side architecture developed as part of **SENG 34213: System Development Project** at the Faculty of Science, Software Engineering Teaching Unit, University of Kelaniya.

---

## Table of Contents

- [1. Executive Overview & Objectives](#1-executive-overview--objectives)
- [2. Live API & Evaluation Access](#2-live-api--evaluation-access)
  - [2.1 Hosted Staging Endpoints](#21-hosted-staging-endpoints)
  - [2.2 Academic Evaluation Demo Accounts](#22-academic-evaluation-demo-accounts)
  - [2.3 Local Development Seed Accounts (Distinction Note)](#23-local-development-seed-accounts-distinction-note)
- [3. Technology Stack](#3-technology-stack)
- [4. Backend Architecture & Source Structure](#4-backend-architecture--source-structure)
  - [4.1 Layered Architecture Pattern](#41-layered-architecture-pattern)
  - [4.2 Directory Tree](#42-directory-tree)
- [5. Authentication, Authorization & Security (OWASP Top 10)](#5-authentication-authorization--security-owasp-top-10)
  - [5.1 Authentication Engine & Account Protection](#51-authentication-engine--account-protection)
  - [5.2 Role-Based Access Control (RBAC) & Scope Matrix](#52-role-based-access-control-rbac--scope-matrix)
  - [5.3 Customer Ownership & Branch-Level Scoping](#53-customer-ownership--branch-level-scoping)
  - [5.4 OWASP Top 10 Compliance Implementation](#54-owasp-top-10-compliance-implementation)
- [6. Implemented Core Domain Modules](#6-implemented-core-domain-modules)
  - [6.1 Product Catalog & Multi-Branch Inventory Management](#61-product-catalog--multi-branch-inventory-management)
  - [6.2 Customer Cart, Multi-Document Checkout & Order Lifecycle](#62-customer-cart-multi-document-checkout--order-lifecycle)
  - [6.3 Payment Gateway Integration (PayHere Hosted Checkout & Webhooks)](#63-payment-gateway-integration-payhere-hosted-checkout--webhooks)
  - [6.4 Unpaid Reservation Expiry & Automatic Cart Recovery](#64-unpaid-reservation-expiry--automatic-cart-recovery)
  - [6.5 Doctor Sessions & Branch Appointment Scheduling](#65-doctor-sessions--branch-appointment-scheduling)
  - [6.6 Clinical Prescriptions & Optometrist Records](#66-clinical-prescriptions--optometrist-records)
  - [6.7 AI Customer Support Chatbot (Gemini Integration)](#67-ai-customer-support-chatbot-gemini-integration)
  - [6.8 Customer Loyalty Engine & Manual Full-Refund Reversal](#68-customer-loyalty-engine--manual-full-refund-reversal)
  - [6.9 Sales & Inventory Analytics Reporting](#69-sales--inventory-analytics-reporting)
  - [6.10 Cryptographic Hash-Chained Immutable Audit Trail](#610-cryptographic-hash-chained-immutable-audit-trail)
- [7. REST API Reference & Swagger Documentation](#7-rest-api-reference--swagger-documentation)
  - [7.1 Interactive OpenAPI / Swagger Documentation](#71-interactive-openapi--swagger-documentation)
  - [7.2 Module Route Catalog](#72-module-route-catalog)
- [8. Local Installation & Development Setup](#8-local-installation--development-setup)
  - [8.1 Prerequisites](#81-prerequisites)
  - [8.2 Local MongoDB Replica Set Setup](#82-local-mongodb-replica-set-setup)
  - [8.3 Step-by-Step Installation](#83-step-by-step-installation)
  - [8.4 Environment Variables Configuration](#84-environment-variables-configuration)
  - [8.5 Development Seed Mechanism & Production Safeguards](#85-development-seed-mechanism--production-safeguards)
- [9. Testing Strategy & Evidence](#9-testing-strategy--evidence)
  - [9.1 Test Pyramid Implementation](#91-test-pyramid-implementation)
  - [9.2 Executing Automated Tests](#92-executing-automated-tests)
  - [9.3 Verified Test Evidence (DDP-087 Baseline)](#93-verified-test-evidence-ddp-087-baseline)
  - [9.4 Payment Verification Boundary (Localhost Sandbox vs. Hosted Staging)](#94-payment-verification-boundary-localhost-sandbox-vs-hosted-staging)
- [10. Continuous Integration & Deployment Workflow](#10-continuous-integration--deployment-workflow)
  - [10.1 GitHub Actions CI Pipeline](#101-github-actions-ci-pipeline)
  - [10.2 Render.com Staging Deployment](#102-rendercom-staging-deployment)
  - [10.3 Deployment Health Verification & Troubleshooting](#103-deployment-health-verification--troubleshooting)
- [11. Known Limitations & Outstanding Verification](#11-known-limitations--outstanding-verification)
- [12. Related Project Repositories & Documents](#12-related-project-repositories--documents)

---

## 1. Executive Overview & Objectives

**Darshana Opticals - Optical Store Management System (OSMS)** is an end-to-end enterprise solution designed to modernize operational workflows for a multi-branch optical retail and clinical eyewear provider in Sri Lanka.

The backend service serves as the core authoritative business engine, fulfilling the following functional objectives:

1. **Centralized & Branch-Scoped Operations**: Managing multi-branch inventory across physical stores (`COLOMBO_MAIN`, `KANDY_CITY`, `GAMPAHA_CENTRAL`), while establishing dedicated online fulfillment scoping.
2. **Clinical Eyecare Workflow**: Providing high-fidelity clinical prescription storage (sphere, cylinder, axis, visual acuity, near addition) with optometrist traceability and customer historical viewing.
3. **Doctor Scheduling & Appointment Management**: Facilitating queue-based in-person consultations with branch-level doctor sessions, automated queue allocation, and rescheduling workflows.
4. **E-Commerce & High-Integrity Checkout**: Delivering an atomic shopping cart, checkout inventory reservation, and payment processing backed by MongoDB ACID multi-document transactions.
5. **Secure Payment Lifecycle**: Integrating PayHere hosted checkout, timing-safe IPN signature verification, automatic reservation sweeps, and tamper-resistant payment retrieval evidence.
6. **Regulatory Compliance & Forensic Defensibility**: Enforcing a four-tier immutable audit trail protected by SHA-256 cryptographic hash chaining, strict role-based access control (RBAC), and OWASP Top 10 mitigations.
7. **AI-Driven Customer Experience**: Grounded domain customer support chatbot powered by Google Gemini, enforced by a strict 30-minute rolling budget to eliminate resource exhaustion.

---

## 2. Live API & Evaluation Access

### 2.1 Hosted Staging Endpoints

The backend application is continuously integrated and deployed to an active staging environment on Render.com, paired with the Vercel-hosted frontend application.

| Service Component             | Environment      | Uniform Resource Locator (URL)                                                                               | Status |
| :---------------------------- | :--------------- | :----------------------------------------------------------------------------------------------------------- | :----- |
| **Live Frontend Application** | Staging (Vercel) | [https://darshana-opticals.vercel.app](https://darshana-opticals.vercel.app/)                                | Active |
| **Backend REST API Root**     | Staging (Render) | [https://osms-backend-staging.onrender.com](https://osms-backend-staging.onrender.com/)                      | Active |
| **API Health Check**          | Staging (Render) | [https://osms-backend-staging.onrender.com/api/health](https://osms-backend-staging.onrender.com/api/health) | Active |
| **Interactive Swagger UI**    | Staging (Render) | [https://osms-backend-staging.onrender.com/api-docs](https://osms-backend-staging.onrender.com/api-docs)     | Active |

> [!NOTE]
> The hosted staging backend on Render runs on a managed container tier that enters sleep mode during periods of inactivity. If the service is idle, the initial HTTP request or health check may take 20–50 seconds to complete while the container boots up. Subsequent requests execute with normal sub-second latency.

### 2.2 Academic Evaluation Demo Accounts

For assessment, panel demonstration, and external evaluation, the team has provisioned isolated demonstration accounts on the hosted staging environment. These accounts represent fictional test personas populated with safe, non-sensitive mock data.

| Role                     | Demo Email Address          | Demo Password     | Primary Operational Scope                                                                                             |
| :----------------------- | :-------------------------- | :---------------- | :-------------------------------------------------------------------------------------------------------------------- |
| **System Administrator** | `admin.dev@gmail.com`       | `DevPassword123!` | System-wide configuration, staff/doctor onboarding, immutable audit inspection, admin analytics.                      |
| **Branch Manager**       | `brachmanager@gmail.com`    | `DevPassword123!` | Branch inventory management, payment monitoring, retrieval evidence, manual full-refund recording, sales analytics.   |
| **Branch Assistant**     | `branchassistant@gmail.com` | `DevPassword123!` | In-store POS operations, stock receipts, doctor session setup, appointment queue management/reassignment.             |
| **Optometrist**          | `optometrist@gmail.com`     | `DevPassword123!` | Customer clinical record lookup, refraction testing, optical prescription creation and history viewing.               |
| **Customer**             | `kavindueka@gmail.com`      | `Amalka@123`      | Product browsing, cart & checkout, PayHere payment initiation, prescription viewing, appointment booking, AI chatbot. |

> [!IMPORTANT]
> **Evaluation Account Safety Guarantee**: All evaluation accounts listed above are isolated demo identities populated with synthetic records. They contain zero Personal Identifiable Information (PII), zero real patient eye prescriptions, and zero live payment credentials. Never attempt to use or input live commercial credentials or banking information into evaluation environments.

### 2.3 Local Development Seed Accounts (Distinction Note)

The hosted evaluation accounts above must not be confused with the local development seed accounts generated on developer machines during `npm run seed`:

- **Hosted Demonstration Accounts**: Provisioned in the hosted cloud database for evaluation and assessment.
- **Local Seed Accounts**: Use local RFC test domains (e.g., `manager.colombo@darshanaopticals.local`, `sales.gampaha@darshanaopticals.local`, `kamal.customer@example.com`) and are intended strictly for offline local debugging with `mongodb-memory-server` or local MongoDB.
- Do not assume local seed accounts exist in the hosted staging database or vice-versa.

---

## 3. Technology Stack

The backend application is engineered using Node.js and Express in strict alignment with the SENG 34213 industrial coding standards:

```text
+---------------------------------------------------------------------------------+
|                               OSMS Technology Stack                             |
+---------------------------------------------------------------------------------+
| Runtime & Language     | Node.js 20 LTS (ES6+ CommonJS modules)                |
| HTTP Framework         | Express.js v4.19.2                                     |
| Database & Modeling    | MongoDB Atlas / Community 7.0+, Mongoose v8.8.4        |
| Security & Protection  | Helmet v8.3.0, CORS v2.8.6, express-rate-limit v8.7.0  |
| Authentication & Crypto| jsonwebtoken v9.0.3, bcrypt v6.0.0, crypto (SHA-256)  |
| Asset Storage          | Cloudinary SDK v2.11.0, Multer v2.4.0 (Memory Storage) |
| Reporting & Export     | ExcelJS v4.4.0 (Spreadsheet generation)                |
| Email & Notifications  | Nodemailer v10.1.0 (SMTP / Console fallback)           |
| External AI Engine     | Google Gemini API (@google/genai, REST adapter)        |
| Payment Integration    | PayHere Hosted Checkout & Merchant Retrieval API       |
| API Documentation      | Swagger UI Express v5.0.1, swagger-jsdoc v6.3.0        |
| Testing & Quality      | Jest v30.5.2, Supertest v7.0.0, mongodb-memory-server  |
| Linting & Formatting   | ESLint v9.39.5, Prettier v3.9.6                        |
| Containerization       | Docker Alpine (node:20-alpine)                         |
+---------------------------------------------------------------------------------+
```

---

## 4. Backend Architecture & Source Structure

### 4.1 Layered Architecture Pattern

The codebase adheres strictly to a 4-tier Layered Architecture adhering to SOLID, DRY, and Clean Code principles:

```text
   +-------------------------------------------------------------+
   |                Client (Web / Mobile / Swagger)              |
   +-------------------------------------------------------------+
                                  |
                                  v
   +-------------------------------------------------------------+
   |                   Express Router & Routes                   |
   +-------------------------------------------------------------+
                                  |
                                  v
   +-------------------------------------------------------------+
   |                      Middleware Stack                       |
   |   [Helmet] -> [CORS] -> [RateLimiter] -> [SanitizeInput]    |
   |   -> [Authenticate (JWT)] -> [AuthorizeRoles (RBAC)]        |
   |   -> [Validate (Joi/Custom Rules)]                          |
   +-------------------------------------------------------------+
                                  |
                                  v
   +-------------------------------------------------------------+
   |                        Controllers                          |
   |   - Unpack & normalize request parameters/body              |
   |   - Delegate to domain service layer                        |
   |   - Format HTTP response (consistent { success, data } DTO) |
   +-------------------------------------------------------------+
                                  |
                                  v
   +-------------------------------------------------------------+
   |                       Domain Services                       |
   |   - Core business logic & business rule enforcement         |
   |   - Orchestrate multi-document transactions (session)       |
   |   - Audit event dispatching & third-party integrations      |
   +-------------------------------------------------------------+
                                  |
                                  v
   +-------------------------------------------------------------+
   |                   Mongoose Data Access Layer                |
   |   - Data models & validation schemas                        |
   |   - Pre/post lifecycle hooks & immutability guards          |
   |   - Database indexes & multi-document ACID transactions     |
   +-------------------------------------------------------------+
                                  |
                                  v
   +-------------------------------------------------------------+
   |                   MongoDB (Replica Set / Atlas)             |
   +-------------------------------------------------------------+
```

### 4.2 Directory Tree

```text
backend/
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions 5-stage automated CI/CD pipeline
├── .standards/
│   └── STANDARDS.md             # SENG 34213 coding, testing, and review standards
├── docs/
│   ├── audit-trail-architecture.md         # Forensic immutability & SHA-256 specification
│   ├── chatbot-session-budget-proposal.md  # 30-min AI budget contract & state machine
│   ├── investigation-affected-orders-...   # OrderItem classification resolution notes
│   └── security/
│       └── owasp-assessment.md  # Full OWASP Top 10 compliance audit & evidence
├── scripts/
│   ├── backfillGampahaBranchCode.js        # Production branch code migration utility
│   └── run-concurrency-tests.ps1           # High-concurrency test automation script
├── src/
│   ├── app.js                   # Express application factory & middleware composition
│   ├── server.js                # HTTP server bootstrap & graceful shutdown handler
│   ├── config/                  # Database, environment, security, swagger, cloudinary
│   ├── constants/               # System roles, order statuses, appointment statuses
│   ├── controllers/             # HTTP endpoint request/response handlers
│   ├── errors/                  # AppError class hierarchy & operational error types
│   ├── jobs/                    # Schedulers (reservation sweep, image & reminder cleanup)
│   ├── middleware/              # Auth, RBAC, input sanitization, error & rate limiters
│   ├── models/                  # 25+ Mongoose domain schemas with immutability guards
│   ├── routes/                  # Express route definitions & OpenAPI specifications
│   ├── seed/                    # Controlled idempotent non-production database seeder
│   ├── services/                # Authoritative domain business logic & transactions
│   ├── utils/                   # Sanitizers, crypto helpers, date utilities, excel builders
│   └── validations/             # Request payload and query parameter validators
├── tests/
│   ├── integration/             # 118 test suites covering all REST endpoints
│   ├── performance/             # Load tests, baseline benchmarks & concurrency suites
│   └── unit/                    # Unit tests for domain services, tokens & utilities
├── Dockerfile                   # Alpine production container specification
├── package.json                 # Dependencies, npm scripts & metadata
└── README.md                    # System documentation and operational guide
```

---

## 5. Authentication, Authorization & Security (OWASP Top 10)

### 5.1 Authentication Engine & Account Protection

The backend uses a stateless JSON Web Token (JWT) architecture paired with industry-standard cryptographic protections:

- **Password Storage**: Passwords are cryptographically hashed using `bcrypt` with a minimum cost factor of 12 (exceeding standard CPU/memory hardness recommendations).
- **Access Tokens**: High-entropy tokens signed via `HMAC-SHA256` containing the user ID and canonical role, configured with a 24-hour expiration (`JWT_EXPIRES_IN`).
- **Account Lockout (Brute-Force Mitigation)**: Enforced via `ACCOUNT_LOCKOUT_MAX_ATTEMPTS=5`. Five consecutive failed authentication attempts automatically lock the user account for 15 minutes (`ACCOUNT_LOCKOUT_DURATION_MS=900000`). Concurrency-safe state transitions ensure zero-state race conditions cannot bypass lockout.
- **Secure Password Reset**: Implements a two-phase token flow (`POST /api/auth/forgot-password` and `POST /api/auth/reset-password`). Reset tokens are generated via `crypto.randomBytes(32)`, stored only as SHA-256 hashes in MongoDB, and expire after 1 hour. System administrators are strictly excluded by policy from self-service reset issuance.

### 5.2 Role-Based Access Control (RBAC) & Scope Matrix

Every protected endpoint is guarded by the reusable `authorizeRoles(...allowedRoles)` middleware, which evaluates `req.auth.role` extracted directly from the verified JWT. Roles are defined centrally in `src/constants/roles.js`:

| Role Key           | Name                 | Access Level & Description                                                                                                                           |
| :----------------- | :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SYSTEM_ADMIN`     | System Administrator | Superuser privileges. Manages system users, branches, doctors, views full audit logs, and system analytics. Excluded from clinical/order operations. |
| `BRANCH_MANAGER`   | Branch Manager       | Oversees branch inventory, payment monitoring, retrieval recovery, manual full-refund recording, branch loyalty audit, and sales reports.            |
| `BRANCH_ASSISTANT` | Branch Assistant     | In-store POS cashiering, inventory receiving, doctor session scheduling, and appointment queue management/reassignment.                              |
| `OPTOMETRIST`      | Optometrist          | Clinical refractionist. Customer profile lookup, recording eye exam prescriptions, and reviewing customer clinical history.                          |
| `CUSTOMER`         | Customer             | Self-service end user. Manages own profile, shopping cart, checkout, payment initiation, order tracking, appointments, and chatbot.                  |

### 5.3 Customer Ownership & Branch-Level Scoping

To prevent Insecure Direct Object References (IDOR):

- **Customer Ownership Verification**: Endpoints querying personal data (e.g., `GET /api/profile/me`, `GET /api/cart`, `GET /api/loyalty/me`, `GET /api/orders/:orderId/payment-status`, `PATCH /api/appointments/:id/cancel`) derive the customer identifier exclusively from `req.auth.userId`. Request body/query customer IDs are strictly ignored or rejected.
- **Branch-Scoped Inventory & Scheduling**: Branch Assistants and Managers are strictly bound to their assigned branch (`req.auth.branchId`). Cross-branch inventory edits or appointments are rejected with HTTP 403 Forbidden.
- **Online Fulfillment Isolation**: Public catalog availability and online orders are tied to the configured fulfillment hub (`ONLINE_FULFILLMENT_BRANCH_CODE=GAMPAHA_CENTRAL`).

### 5.4 OWASP Top 10 Compliance Implementation

The backend architecture is audited and verified against the OWASP Top 10 (2021) security framework. Complete documentation is maintained in [docs/security/owasp-assessment.md](docs/security/owasp-assessment.md):

| OWASP Risk   | Category                    | Implemented Defensive Control in Codebase                                                                                              |
| :----------- | :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| **A01:2021** | Broken Access Control       | Reusable RBAC middleware (`authorizeRoles`), customer ownership checks, branch scoping, and non-enumerable object identifiers.         |
| **A02:2021** | Cryptographic Failures      | `bcrypt` (cost $\ge 12$), SHA-256 hash chaining on audit logs, SHA-256 hashed password reset tokens, and enforced TLS.                 |
| **A03:2021** | Injection                   | Mongoose schema type-casting, input sanitization (`sanitizeInput` removes Mongo operators `$` and `.`), and regex boundary escapes.    |
| **A04:2021** | Insecure Design             | Threat models documented in SDS/ADRs, multi-document transactions on checkout, and immutable order classification snapshots.           |
| **A05:2021** | Security Misconfiguration   | `helmet()` security headers, strict CORS origin allowlist (`FRONTEND_ORIGIN`), and stack-trace stripping in non-development modes.     |
| **A06:2021** | Vulnerable Components       | Automated `npm audit --audit-level=high` gate in CI, strict lockfile commitment, and Dependabot automated updates.                     |
| **A07:2021** | Auth & Identification       | Account lockout after 5 failed attempts, 24-hour token expiry, timing-safe string comparison on tokens and Webhook signatures.         |
| **A08:2021** | Software & Data Integrity   | Exact package version pinning in `package-lock.json`, immutable Mongoose schema hooks, and PayHere MD5 checksum validation.            |
| **A09:2021** | Security Logging Failures   | Centralized `AuditEvent` model with actor, IP, action, timestamp, and target tracking. Strict redaction of passwords, tokens, and PII. |
| **A10:2021** | Server-Side Request Forgery | Outbound webhooks/APIs restricted to trusted domains (Cloudinary, PayHere, Gemini). No user-supplied URL fetching.                     |

---

## 6. Implemented Core Domain Modules

### 6.1 Product Catalog & Multi-Branch Inventory Management

- **Catalog Browsing**: Public endpoints (`GET /api/products`, `GET /api/products/:id`) allow customers to browse optical frames, sunglasses, lenses, and accessories. Scoped to the active online fulfillment branch (`GAMPAHA_CENTRAL`).
- **Branch Inventory Control**: Branch Managers and Assistants manage branch-level quantities (`GET /api/inventory`, `POST /api/inventory`, `PATCH /api/inventory/:id`).
- **Item Classification**: Every inventory record is categorized into `MERCHANDISE` (eligible for loyalty) or `CLINICAL` (ineligible exam fees), which freezes upon checkout.
- **Low-Stock Alerts**: Automated threshold monitoring triggers `ReorderAlert` records and email notifications when inventory drops below configured minimums.
- **Cloudinary Asset Storage**: Multipart image uploads (`POST /api/inventory/:id/image`) validate MIME types, resize images in memory, and persist secure URLs to Cloudinary with orphaned-image cleanup jobs.

### 6.2 Customer Cart, Multi-Document Checkout & Order Lifecycle

- **Persistent Shopping Cart**: Authenticated customers manage items via `GET /api/cart`, `POST /api/cart`, `PATCH /api/cart/:itemId`, and `DELETE /api/cart/:itemId`.
- **Atomic Checkout**: Checkout (`POST /api/checkout`) executes inside a MongoDB ACID transaction:
  1. Validates real-time inventory quantity and active price.
  2. Decrements branch inventory stock immediately.
  3. Creates an immutable `OrderItem` snapshot capturing classification (`MERCHANDISE` vs `CLINICAL`).
  4. Generates an `Order` in `ORDER_CREATED` status with a 30-minute reservation deadline (`reservationExpiresAt`).
  5. Clears the customer's shopping cart atomically.
- **Order State Machine**: Enforces strict linear progression: `ORDER_CREATED` $\rightarrow$ `PROCESSING` $\rightarrow$ `SHIPPED` $\rightarrow$ `DELIVERED` $\rightarrow$ `COMPLETED`, or `CANCELLED`.

### 6.3 Payment Gateway Integration (PayHere Hosted Checkout & Webhooks)

- **Hosted Payment Initiation**: `POST /api/payments/initiate` generates secure checkout parameters (merchant ID, order ID, amount formatted to 2 decimals, currency LKR, and pre-computed MD5 signature).
- **Server-to-Server IPN Webhook**: `POST /api/payments/notify` processes asynchronous notifications directly from PayHere:
  - Validates `merchant_id` and calculates expected MD5 signature (`strtoupper(md5(merchant_id + order_id + amount + currency + status_code + strtoupper(md5(merchant_secret))))`).
  - Utilizes `crypto.timingSafeEqual` to eliminate timing attack vectors.
  - Idempotent processing ensures duplicate webhooks do not double-process transitions.
  - Upon successful verification (`status_code = 2`), transitions Payment to `completed` and Order to `PROCESSING`.
- **Management Payment Monitoring**: Restricted to `BRANCH_MANAGER` (`GET /api/payments`, `GET /api/payments/:paymentId`, `GET /api/payments/:paymentId/events`) for safe financial audit without exposing raw cardholder data.
- **Retrieval API Investigation**: `POST /api/payments/:paymentId/recovery` queries PayHere's server-to-server Order Retrieval API to investigate missed callbacks. Defaults to dry-run; explicit non-dry-run logs append-only `PaymentRetrievalEvidence`.

### 6.4 Unpaid Reservation Expiry & Automatic Cart Recovery

- **Background Sweep Scheduler**: Runs every 60 seconds (`src/jobs/reservationExpirySweep.js`), scanning for `ORDER_CREATED` orders exceeding `reservationExpiresAt`.
- **Atomic Stock Restoration**: Transactions restore inventory quantities and update reorder alerts atomically.
- **Automatic Cart Recovery (ADR-003)**: Selections from expired orders are automatically restored into the customer's active shopping cart, allowing seamless re-checkout without manual re-selection.

### 6.5 Doctor Sessions & Branch Appointment Scheduling

- **Branch-Restricted Scheduling**: In-person clinical appointments are anchored to `GAMPAHA_CENTRAL`.
- **Session Provisioning**: Branch Assistants create doctor consultation windows (`POST /api/doctor-sessions`) specifying start/end timestamps ($\ge 24\text{ hours}$ in advance) and capacity limits.
- **Customer Booking**: Customers book available sessions (`POST /api/appointments`), receiving an automatically calculated, deterministic queue number.
- **Atomic Reassignment & Cancellation**: Cancellations compact queue numbers and restore session capacity inside a transaction.

### 6.6 Clinical Prescriptions & Optometrist Records

- **Clinical Recording**: Optometrists record comprehensive eye examinations (`POST /api/prescriptions`) capturing sphere (SPH), cylinder (CYL), axis, near addition (ADD), visual acuity (VA), and pupillary distance (PD).
- **Optometrist Traceability**: Records maintain immutable references to the examining optometrist.
- **Customer Self-Service**: Customers review historical prescriptions via `GET /api/prescriptions/my-prescriptions`.
- **Soft-Archival**: Clinical records adhere to medical record retention rules; records can be archived (`isArchived: true`) but are never deleted from storage.

### 6.7 AI Customer Support Chatbot (Gemini Integration)

- **Knowledge-Grounded Assistance**: Powered by Google Gemini (`gemini-flash-lite-latest`), grounded using optical store `KnowledgeArea` domain articles (store hours, frame care, lens types, branch locations).
- **Session Budget Enforcement (Issue #77)**: Each customer is allocated a rolling 30-minute usage budget enforced via the `ChatbotUsage` model. Customers are limited to 20 messages (10 question/reply exchanges) per window.
- **Fail-Safe Operation**: If the Gemini API is unreachable, the system gracefully falls back to structured FAQ recommendations without breaking user experience.

### 6.8 Customer Loyalty Engine & Manual Full-Refund Reversal

- **Spend-Based Points Accrual (ADR-005 §14)**: Upon an Order transitioning to `COMPLETED`, the system calculates points based on eligible merchandise spend:
  $$\text{Points Earned} = \left\lfloor \frac{\text{Eligible Merchandise Spend (LKR)}}{100} + 0.5 \right\rfloor \quad (\text{ROUND\_HALF\_UP})$$
- **Decimal128 Ledger**: Customer balances and append-only `LoyaltyTransaction` ledgers maintain exact two-decimal monetary precision.
- **Customer Self-Service**: `GET /api/loyalty/me` provides customer point balances and historical ledger statements.
- **Manual Full-Refund Reversal**: When a Branch Manager records a confirmed external refund (`POST /api/payments/:paymentId/refunds`), the exact points originally awarded are atomically deducted via a compensating ledger reversal.

### 6.9 Sales & Inventory Analytics Reporting

- **Analytical Endpoints**: Provide Branch Managers and System Admins with daily, weekly, and monthly sales volume, revenue breakdown, inventory turnover, and reorder alerts (`/api/reports/*`).
- **Excel Export**: Streams server-generated `.xlsx` workbooks built dynamically using `exceljs`.

### 6.10 Cryptographic Hash-Chained Immutable Audit Trail

- **Forensic Immutability**: All security, administrative, and clinical actions dispatch events to the `AuditEvent` collection.
- **SHA-256 Hash Chaining**: Every audit entry computes:
  $$\text{eventHash} = \text{SHA256}(\text{prevEventHash} + \text{payloadString})$$
  Genesis hash is fixed to 64 zeros. Any external attempt to alter historical records breaks chain validation.
- **Four-Layer Immutability**: Enforced via (1) Service-level absence of update/delete methods, (2) Mongoose schema pre-hooks blocking mutations, (3) MongoDB custom `auditAppendOnly` role, and (4) Cryptographic chain verification.

---

## 7. REST API Reference & Swagger Documentation

### 7.1 Interactive OpenAPI / Swagger Documentation

The backend includes interactive OpenAPI 3.0 documentation. When running locally or on staging, navigate to `/api-docs`:

- **Staging Swagger UI**: [https://osms-backend-staging.onrender.com/api-docs](https://osms-backend-staging.onrender.com/api-docs)
- **Local Swagger UI**: `http://localhost:5000/api-docs`

### 7.2 Module Route Catalog

| HTTP Method                         | Route Endpoint                        | Required Role                        | Summary & Purpose                                               |
| :---------------------------------- | :------------------------------------ | :----------------------------------- | :-------------------------------------------------------------- |
| **System Health**                   |                                       |                                      |                                                                 |
| `GET`                               | `/api/health`                         | Public                               | System liveness probe and database connectivity status          |
| **Authentication & Profile**        |                                       |                                      |                                                                 |
| `POST`                              | `/api/auth/register`                  | Public                               | Customer self-registration (CUSTOMER role only)                 |
| `POST`                              | `/api/auth/login`                     | Public                               | Stateless authentication; returns signed Bearer JWT             |
| `POST`                              | `/api/auth/forgot-password`           | Public                               | Requests 1-hour secure password reset token                     |
| `POST`                              | `/api/auth/reset-password`            | Public                               | Resets password using valid unexpired SHA-256 token             |
| `GET`                               | `/api/profile/me`                     | `CUSTOMER`                           | Retrieves authenticated customer's own profile                  |
| `PATCH`                             | `/api/profile/me`                     | `CUSTOMER`                           | Updates customer's own contact information                      |
| **User & Staff Administration**     |                                       |                                      |                                                                 |
| `POST`                              | `/api/admin/staff`                    | `SYSTEM_ADMIN`                       | Creates branch staff (Manager, Assistant, Optometrist)          |
| `GET`                               | `/api/admin/staff`                    | `SYSTEM_ADMIN`                       | Lists all staff across all branches                             |
| `GET`                               | `/api/admin/staff/:id`                | `SYSTEM_ADMIN`                       | Retrieves specific staff details                                |
| `PATCH`                             | `/api/admin/staff/:id`                | `SYSTEM_ADMIN`                       | Updates staff assignment, contact info, or active status        |
| `POST`                              | `/api/doctors`                        | `SYSTEM_ADMIN`                       | Registers consulting ophthalmologist / doctor                   |
| `GET`                               | `/api/doctors`                        | Authenticated                        | Lists consulting doctors directory                              |
| `GET`                               | `/api/branches`                       | Public / Staff                       | Lists active branch locations                                   |
| **Product Catalog & Inventory**     |                                       |                                      |                                                                 |
| `GET`                               | `/api/products`                       | Public                               | Browses active online catalog (Gampaha fulfillment)             |
| `GET`                               | `/api/products/:id`                   | Public                               | Retrieves specific product catalog item                         |
| `GET`                               | `/api/inventory`                      | `BRANCH_MANAGER`, `BRANCH_ASSISTANT` | Lists branch inventory items                                    |
| `POST`                              | `/api/inventory`                      | `BRANCH_MANAGER`                     | Creates new inventory item at branch                            |
| `PATCH`                             | `/api/inventory/:id`                  | `BRANCH_MANAGER`, `BRANCH_ASSISTANT` | Updates inventory stock / reorder thresholds                    |
| `DELETE`                            | `/api/inventory/:id`                  | `BRANCH_MANAGER`                     | Soft-deletes or archives branch inventory item                  |
| `POST`                              | `/api/inventory/:id/image`            | `BRANCH_MANAGER`                     | Uploads product image to Cloudinary CDN                         |
| `GET`                               | `/api/inventory/alerts`               | `BRANCH_MANAGER`                     | Lists active low-stock reorder alerts                           |
| **Customer Lookup & Prescriptions** |                                       |                                      |                                                                 |
| `GET`                               | `/api/customer-lookup`                | `OPTOMETRIST`                        | Searches customer clinical profile by phone/NIC                 |
| `POST`                              | `/api/prescriptions`                  | `OPTOMETRIST`                        | Records comprehensive optical clinical refraction               |
| `GET`                               | `/api/prescriptions/customer/:id`     | `OPTOMETRIST`                        | Reviews customer's clinical prescription history                |
| `GET`                               | `/api/prescriptions/my-prescriptions` | `CUSTOMER`                           | Customer views their own prescription records                   |
| **Doctor Sessions & Appointments**  |                                       |                                      |                                                                 |
| `GET`                               | `/api/appointments/providers`         | Staff / Customer                     | Discovers eligible optometrists & approved branch IDs           |
| `POST`                              | `/api/doctor-sessions`                | `BRANCH_ASSISTANT`                   | Creates scheduled consultation session ($\ge 24\text{h}$ ahead) |
| `GET`                               | `/api/doctor-sessions/available`      | Public / Customer                    | Lists upcoming bookable doctor sessions                         |
| `POST`                              | `/api/appointments`                   | `CUSTOMER`                           | Books appointment session; assigns queue position               |
| `GET`                               | `/api/appointments`                   | Customer / Assistant / Manager       | Views appointments (ownership or branch-scoped)                 |
| `PATCH`                             | `/api/appointments/:id/cancel`        | `CUSTOMER`, `BRANCH_ASSISTANT`       | Cancels appointment; releases session capacity                  |
| `PATCH`                             | `/api/appointments/:id/reassign`      | `BRANCH_ASSISTANT`                   | Atomically reassigns appointment to new session                 |
| **Cart, Checkout & Orders**         |                                       |                                      |                                                                 |
| `GET`                               | `/api/cart`                           | `CUSTOMER`                           | Retrieves customer's current shopping cart                      |
| `POST`                              | `/api/cart`                           | `CUSTOMER`                           | Adds product item to shopping cart                              |
| `PATCH`                             | `/api/cart/:itemId`                   | `CUSTOMER`                           | Modifies item quantity in cart                                  |
| `DELETE`                            | `/api/cart/:itemId`                   | `CUSTOMER`                           | Removes product item from cart                                  |
| `POST`                              | `/api/checkout`                       | `CUSTOMER`                           | Executes transactional checkout & stock reservation             |
| `GET`                               | `/api/orders`                         | Customer / Staff / Admin             | Lists orders (ownership or branch-scoped)                       |
| `GET`                               | `/api/orders/:id`                     | Customer / Staff / Admin             | Retrieves specific order details and tracking                   |
| `PATCH`                             | `/api/orders/:id/status`              | `BRANCH_ASSISTANT`, `BRANCH_MANAGER` | Updates order progression status                                |
| `POST`                              | `/api/orders/:id/cancel`              | `BRANCH_MANAGER`, `BRANCH_ASSISTANT` | Staff cancellation of eligible unpaid orders                    |
| **Payments & Refunds**              |                                       |                                      |                                                                 |
| `POST`                              | `/api/payments/initiate`              | `CUSTOMER`                           | Initiates PayHere checkout attempt for own order                |
| `GET`                               | `/api/orders/:orderId/payment-status` | `CUSTOMER`                           | Retrieves payment status for own order                          |
| `POST`                              | `/api/payments/notify`                | Public Webhook (PayHere IPN)         | Server-to-server callback; verifies MD5 signature               |
| `GET`                               | `/api/payments`                       | `BRANCH_MANAGER`                     | Management payment monitoring & search                          |
| `GET`                               | `/api/payments/:paymentId`            | `BRANCH_MANAGER`                     | Detailed financial inspection & refund evidence                 |
| `GET`                               | `/api/payments/:paymentId/events`     | `BRANCH_MANAGER`                     | Audited payment webhook event history                           |
| `POST`                              | `/api/payments/:paymentId/recovery`   | `BRANCH_MANAGER`                     | Queries PayHere Retrieval API; logs reconciliation              |
| `POST`                              | `/api/payments/:paymentId/refunds`    | `BRANCH_MANAGER`                     | Records external full refund & reverses loyalty points          |
| **Customer Loyalty**                |                                       |                                      |                                                                 |
| `GET`                               | `/api/loyalty/me`                     | `CUSTOMER`                           | Retrieves customer point balance & ledger history               |
| `GET`                               | `/api/loyalty`                        | `BRANCH_MANAGER`                     | Read-only loyalty ledger audit and monitoring                   |
| **AI Support Chatbot**              |                                       |                                      |                                                                 |
| `POST`                              | `/api/chatbot/message`                | `CUSTOMER`                           | Sends message to Gemini AI (30-min budget enforced)             |
| **Reporting & Audit Trail**         |                                       |                                      |                                                                 |
| `GET`                               | `/api/reports/sales`                  | `BRANCH_MANAGER`, `SYSTEM_ADMIN`     | Aggregated sales revenue and volume analytics                   |
| `GET`                               | `/api/reports/inventory`              | `BRANCH_MANAGER`, `SYSTEM_ADMIN`     | Inventory turnover and low-stock analysis                       |
| `GET`                               | `/api/reports/export`                 | `BRANCH_MANAGER`, `SYSTEM_ADMIN`     | Exports formatted `.xlsx` spreadsheet report                    |
| `GET`                               | `/api/audit-events`                   | `SYSTEM_ADMIN`                       | Inspects SHA-256 hash-chained immutable audit log               |

---

## 8. Local Installation & Development Setup

### 8.1 Prerequisites

Ensure your local development workstation satisfies the following requirements:

- **Node.js**: Version `20.x` LTS or higher (`node -v`)
- **Package Manager**: npm version `10.x` or higher (`npm -v`)
- **MongoDB**: Community or Enterprise Server version `7.0+` with **Replica Set** enabled (required for multi-document ACID transactions).
- **Git**: Installed and configured.

### 8.2 Local MongoDB Replica Set Setup

Because Checkout, Payment initiation, Reservation Expiry, Cart Recovery, and Loyalty Reversals utilize multi-document ACID transactions, MongoDB **must** run as a replica set.

1. Start your local MongoDB daemon with the replica set name `osms-dev-rs`:
   ```bash
   mongod --replSet osms-dev-rs --dbpath /path/to/data/directory
   ```
2. In a separate terminal, initiate the replica set using `mongosh`:
   ```bash
   mongosh --eval "rs.initiate({ _id: 'osms-dev-rs', members: [{ _id: 0, host: '127.0.0.1:27017' }] })"
   ```
3. Verify status:
   ```bash
   mongosh --eval "rs.status().ok"
   # Output should return 1
   ```

### 8.3 Step-by-Step Installation

```bash
# 1. Clone the repository
git clone https://github.com/darshana-opticals-osms/backend.git
cd backend

# 2. Check out the development branch
git checkout develop

# 3. Install dependencies using the exact lockfile
npm ci

# 4. Create your local environment file
cp .env.example .env

# 5. Populate local development seed data
npm run seed

# 6. Start the server in development mode (with hot-reload)
npm run dev
```

The server will initialize on port 5000:

- REST API: `http://localhost:5000/api`
- Swagger Documentation: `http://localhost:5000/api-docs`
- Health Probe: `http://localhost:5000/api/health`

### 8.4 Environment Variables Configuration

Copy `.env.example` to `.env`. Configure the variables according to your local environment:

| Variable Name                    | Required | Default Value                                               | Purpose & Architectural Guidance                           |
| :------------------------------- | :------: | :---------------------------------------------------------- | :--------------------------------------------------------- |
| `NODE_ENV`                       |   Yes    | `development`                                               | Runtime mode: `development`, `test`, or `production`.      |
| `PORT`                           |   Yes    | `5000`                                                      | Local HTTP binding port.                                   |
| `MONGODB_URI`                    |   Yes    | `mongodb://127.0.0.1:27017/osms-dev?replicaSet=osms-dev-rs` | MongoDB connection string. Must point to a replica set.    |
| `JWT_SECRET`                     |   Yes    | _Required Secret_                                           | High-entropy random key for signing JWTs.                  |
| `JWT_EXPIRES_IN`                 |    No    | `24h`                                                       | Token lifetime for stateless sessions.                     |
| `FRONTEND_ORIGIN`                |   Yes    | `http://localhost:3000`                                     | Allowed CORS origins (comma-separated list for multiples). |
| `FRONTEND_URL`                   |   Yes    | `http://localhost:3000`                                     | Base URL used to build customer email notification links.  |
| `RATE_LIMIT_WINDOW_MS`           |    No    | `900000`                                                    | General API rate-limit window in milliseconds (15 min).    |
| `RATE_LIMIT_MAX`                 |    No    | `100`                                                       | Maximum general requests allowed per IP per window.        |
| `AUTH_RATE_LIMIT_WINDOW_MS`      |    No    | `900000`                                                    | Auth rate-limit window in milliseconds.                    |
| `AUTH_RATE_LIMIT_MAX`            |    No    | `10`                                                        | Maximum failed auth attempts per IP per window.            |
| `ACCOUNT_LOCKOUT_MAX_ATTEMPTS`   |    No    | `5`                                                         | Failed logins before account is temporarily locked.        |
| `ACCOUNT_LOCKOUT_DURATION_MS`    |    No    | `900000`                                                    | Account lockout duration (15 minutes).                     |
| `REQUEST_BODY_LIMIT`             |    No    | `10kb`                                                      | Maximum allowed JSON request body size.                    |
| `GEMINI_API_KEY`                 |    No    | _Optional Secret_                                           | Google Gemini API key for AI support chatbot.              |
| `GEMINI_MODEL`                   |    No    | `gemini-flash-lite-latest`                                  | Model version for AI chatbot assistance.                   |
| `CHATBOT_RATE_LIMIT_MAX`         |    No    | `10`                                                        | Maximum customer chatbot prompts per minute.               |
| `SMTP_HOST`                      |    No    | _Unset_                                                     | SMTP server host. If blank, emails log to console.         |
| `SMTP_PORT`                      |    No    | `587`                                                       | SMTP communication port.                                   |
| `SMTP_USER` / `SMTP_PASS`        |    No    | _Unset_                                                     | SMTP credentials.                                          |
| `DEV_ADMIN_EMAIL`                |    No    | `admin.dev@gmail.com`                                       | Email assigned to the default System Administrator.        |
| `CLOUDINARY_CLOUD_NAME`          |    No    | _Optional_                                                  | Cloudinary cloud identifier for inventory images.          |
| `CLOUDINARY_API_KEY`             |    No    | _Optional_                                                  | Cloudinary API access key.                                 |
| `CLOUDINARY_API_SECRET`          |    No    | _Optional Secret_                                           | Cloudinary API secret.                                     |
| `PAYMENT_CURRENCY`               |    No    | `LKR`                                                       | Currency code for payment gateway transactions.            |
| `PAYHERE_MODE`                   |    No    | `sandbox`                                                   | Gateway mode: `sandbox` or `live`.                         |
| `PAYHERE_MERCHANT_ID`            |    No    | _Sandbox ID_                                                | PayHere merchant account identifier.                       |
| `PAYHERE_MERCHANT_SECRET`        |    No    | _Sandbox Secret_                                            | PayHere merchant secret used for MD5 signatures.           |
| `ONLINE_FULFILLMENT_BRANCH_CODE` |    No    | `GAMPAHA_CENTRAL`                                           | Branch designated for online catalog and delivery.         |

> [!CAUTION]
> **Secrets Management Rule**: NEVER commit the `.env` file or any real API keys, merchant secrets, database passwords, or JWT secrets to the repository. The `.gitignore` file enforces exclusion of `.env`. In CI/CD and production environments, configure secrets exclusively via GitHub Secrets and Render Environment Variables.

### 8.5 Development Seed Mechanism & Production Safeguards

The repository provides an automated, idempotent seeder (`src/seed/index.js`) for rapid onboarding and repeatable integration testing:

```bash
# Populate development database with fresh sample records
npm run seed

# Destructively reset and re-seed all collections in strict dependency order
npm run seed:reset
```

#### Production Safety Guard

The seeder includes a hard environmental guard:

```javascript
if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'Production safety check triggered: Seeding database is prohibited in production environment.'
  );
}
```

Attempting to execute `npm run seed` or `npm run seed:reset` when `NODE_ENV=production` triggers immediate process termination, preventing data destruction on live systems.

---

## 9. Testing Strategy & Evidence

### 9.1 Test Pyramid Implementation

In adherence to Chapter 6 of the University Development Guideline, the repository implements a balanced Test Pyramid:

```text
               / \
              /   \      End-to-End (E2E) Flow Tests
             / E2E \     - Critical checkout & appointment journeys
            /-------\
           /         \   Integration Tests (Supertest + mongodb-memory-server)
          / Integrat. \  - 100% of REST API routes covered
         /-------------\ - Real DB queries, schema hooks, and rollbacks
        /               \
       /   Unit Tests    \ Unit Tests (Jest AAA Pattern)
      /                   \ - Domain services, calculation algorithms,
     /---------------------\   token rotation, validators, error classes
```

- **Unit Tests**: Follow the **Arrange-Act-Assert (AAA)** pattern using descriptive Given-When-Then specifications. Test domain logic, token signing, price calculations, and input sanitizers in strict isolation.
- **Integration Tests**: Leverage `supertest` executing against isolated `mongodb-memory-server` in-memory database instances. Tests verify status codes, payload structures, schema hooks, index constraints, and transaction rollbacks.
- **Performance Benchmarks**: Dedicated suites in `tests/performance/` validate response latency under concurrency and burst load.

### 9.2 Executing Automated Tests

```bash
# Run full automated test suite sequentially (in-band)
npm test

# Run tests and generate comprehensive code coverage report
npm test -- --coverage

# Run code style and syntax checks
npm run lint

# Check formatting compliance across codebase
npm run format:check

# Automatically fix code formatting
npm run format

# Run performance benchmarking suites
npm run test:perf
npm run test:perf:load
npm run test:perf:concurrency
```

### 9.3 Verified Test Evidence (DDP-087 Baseline)

The backend automated test suite was executed and validated across the entire development sprint lifecycle. Evidence recorded from final verification (CI Run #501 baseline and subsequent regression CI Run #517) confirms:

| Test Metric Dimension        | Required University Standard |  Final Documented & Verified Result  | Compliance Status |
| :--------------------------- | :--------------------------: | :----------------------------------: | :---------------: |
| **Total Test Suites**        |         All domains          |     **118 / 118 Suites Passing**     |    Met (100%)     |
| **Total Test Cases**         |        All scenarios         |   **2,075 / 2,075 Passing Tests**    |    Met (100%)     |
| **Statement Coverage**       |        $\ge 80.00\%$         |              **92.34%**              |   Met (+12.34%)   |
| **Branch Coverage**          |        $\ge 80.00\%$         |              **81.68%**              |   Met (+1.68%)    |
| **Function Coverage**        |        $\ge 80.00\%$         |              **97.86%**              |   Met (+17.86%)   |
| **Line Coverage**            |        $\ge 80.00\%$         |              **93.00%**              |   Met (+13.00%)   |
| **Linting & Code Style**     |         Zero errors          | **0 ESLint Errors / Clean Prettier** |        Met        |
| **Dependency Security Gate** |     0 High / 0 Critical      |   **0 Critical / 0 High Findings**   |        Met        |

### 9.4 Payment Verification Boundary (Localhost Sandbox vs. Hosted Staging)

To maintain absolute technical transparency:

- **Localhost Sandbox Verification**: Completed successfully. The operator executed authentic PayHere Sandbox transactions (Payment `6ad11a57fe503192fd00fa39`), confirming MD5 webhook verification, order transition to `PROCESSING`, timing-safe signature calculation, and reservation release.
- **Hosted Staging Verification**: Hosted PayHere payment completion in the live staging environment remains **unverified** due to external banking gateway callback URL resolution constraints on public test networks. End-to-end payment testing on hosted staging remains an outstanding verification task.

---

## 10. Continuous Integration & Deployment Workflow

### 10.1 GitHub Actions CI Pipeline

All commits pushed to branches and pull requests targeting `develop` or `main` trigger the automated GitHub Actions CI workflow (`.github/workflows/ci.yml`). The workflow enforces five sequential quality gates:

```text
+-----------------------------------------------------------------------------------+
|                        GitHub Actions CI Pipeline Stages                          |
+-----------------------------------------------------------------------------------+
| 1. Lint & Format Check | npm run lint && npm run format:check                    |
|                        | Fails if any lint error or unformatted file exists.      |
+------------------------+----------------------------------------------------------+
| 2. Dependency Audit    | npm audit --audit-level=high                             |
|                        | Blocks build if High or Critical vulnerabilities exist.  |
+------------------------+----------------------------------------------------------+
| 3. Test & Coverage Run | npm test -- --coverage                                   |
|                        | Executes 118 suites (2,075 tests) against in-memory DB.  |
+------------------------+----------------------------------------------------------+
| 4. Artifact Archival   | Uploads Jest coverage reports to GitHub Actions artifacts|
+------------------------+----------------------------------------------------------+
| 5. Staging Dispatch    | Dispatches deployment webhook to darshana-opticals-osms/ |
|                        | infra repository upon successful merge into develop.     |
+------------------------+----------------------------------------------------------+
```

### 10.2 Render.com Staging Deployment

The backend service is containerized via a multi-stage Docker build (`Dockerfile`) running `node:20-alpine`:

1. Render monitors the `develop` branch for merged code updates.
2. The Docker engine builds the container from source, instantiating production dependencies (`npm install`).
3. Port 5000 is bound and proxied through Render's reverse proxy with automatic TLS termination.
4. The service initializes background cron workers (reservation expiry sweep, image cleanup, reminder dispatch).

### 10.3 Deployment Health Verification & Troubleshooting

#### Health Probe

Check the live service status at any time:

```bash
curl -i https://osms-backend-staging.onrender.com/api/health
```

Expected HTTP 200 Response:

```json
{
  "status": "ok",
  "service": "osms-backend"
}
```

#### Common Troubleshooting Scenarios

| Observed Symptom                   | Probable Cause              | Diagnostic & Remediation Procedure                                                                                                                            |
| :--------------------------------- | :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **HTTP 503 on Checkout / Booking** | MongoDB Standalone Mode     | Transactions require a replica set. Ensure `MONGODB_URI` points to a replica set (`?replicaSet=...`) and not a standalone `mongod`.                           |
| **CORS Error in Browser**          | Mismatched Frontend Origin  | Verify `FRONTEND_ORIGIN` in Render environment settings matches the exact scheme and hostname of the frontend (e.g., `https://darshana-opticals.vercel.app`). |
| **HTTP 503 on Payment Initiate**   | Missing PayHere Variables   | Ensure `PAYHERE_MERCHANT_ID` and `PAYHERE_MERCHANT_SECRET` are configured in environment variables.                                                           |
| **First Request Takes ~40s**       | Render Free-Tier Cold Start | Expected behavior for sleeping container instances. Subsequent requests will execute in <150ms.                                                               |
| **HTTP 429 on Chatbot Request**    | 30-Minute Budget Exceeded   | The user has submitted 20 messages in their rolling 30-minute window. Inspect `Retry-After` header for cooldown seconds.                                      |

---

## 11. Known Limitations & Outstanding Verification

1. **Hosted PayHere Payment Completion**: While verified in local sandbox environments with simulated and captured webhook payloads, hosted end-to-end payment settlement via live commercial payment methods has not been verified in the hosted staging deployment.
2. **Loyalty Partial Refunds & Redemptions**: The loyalty system currently supports spend-based point accrual and full-refund compensating reversals. Partial refund point deductions and point redemption at checkout are designated for future sprint milestones.
3. **SMS Notification Gateway**: Order and appointment notifications currently use SMTP email and console dispatch fallback; integration with a Sri Lankan telecom SMS gateway (e.g., Dialog/Mobitel SMS API) is planned for future releases.
4. **Multi-Branch Online Fulfillment**: Online order fulfillment is currently centralized through the `GAMPAHA_CENTRAL` hub. Multi-branch distributed order routing will be introduced in subsequent architectural phases.

---

## 12. Related Project Repositories & Documents

This backend repository is part of the integrated Darshana Opticals OSMS project ecosystem:

- **Frontend Repository**: [darshana-opticals-osms/frontend](https://github.com/darshana-opticals-osms/frontend) — Client web application built with React, Vite, and Tailwind CSS.
- **Infrastructure Repository**: [darshana-opticals-osms/infra](https://github.com/darshana-opticals-osms/infra) — Docker Compose definitions, reverse-proxy configurations, and CI/CD deployment scripts.
- **Test Automation Repository**: [darshana-opticals-osms/tests](https://github.com/darshana-opticals-osms/tests) — End-to-end test suites, Cypress scenarios, and system-level test documentation.
- **Documents Repository**: [darshana-opticals-osms/documents](https://github.com/darshana-opticals-osms/documents) — System Requirements Specification (SRS), System Design Specification (SDS), and Architectural Decision Records (ADRs).

---

_Authored by the Darshana Opticals OSMS Engineering Team for SENG 34213: System Development Project, Software Engineering Teaching Unit, Faculty of Science, University of Kelaniya._
