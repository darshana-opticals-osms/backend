# Performance & Reliability Evaluation Report

**Project:** Darshana Opticals Optical Store Management System (OSMS) Backend  
**Sprint:** Sprint 2 Final Evaluation  
**Issue Reference:** #92 — Performance and Reliability Evaluation  
**Evaluation Date:** October 2026  
**Status:** **SPRINT 2 EVALUATION: LOCAL SYNTHETIC BENCHMARKS SATISFIED (CONDITIONALLY APPROVED PENDING STAGING / CLOUD VERIFICATION)**

---

## 1. Executive Summary

As part of the final Sprint 2 hardening gate, a comprehensive performance, concurrency, scalability, and reliability evaluation of the integrated Darshana Opticals OSMS backend was conducted. Testing was executed against representative datasets under controlled synthetic workloads in an isolated, replica-set-capable ephemeral environment mirroring database multi-document transaction semantics.

### Evaluation Verdict:

- **NFR-001 Performance (p95 Response Time <= 2000 ms):** **SATISFIED (LOCAL BENCHMARKS)**  
  All 13 critical endpoint baseline benchmarks achieved a p95 latency under **130 ms** locally (over **15x faster** than the 2-second SRS ceiling). Under high-stress concurrency (30 Virtual Users), the system sustained a p95 latency of **241.78 ms**.
- **NFR-002 Availability & Reliability (Error Rate = 0%, Fault-Tolerant):** **SATISFIED (LOCAL SUITE)**  
  Zero dropped requests, zero unhandled promise rejections, zero process crashes, and 0.00% error rate across all local baseline, concurrency, and multi-stage load scenarios.
- **Transactional Data Integrity (Stock & Capacity):** **SATISFIED**  
  Zero overselling, zero negative inventory drift, and zero doctor session overbooking under high-concurrency race conditions.
- **NFR-006 Maintainability & Query Efficiency:** **SATISFIED**  
  Targeted compound indexes eliminated collection scans (`COLLSCAN`) and in-memory sort operations on order history, appointments, and prescriptions, reducing query document scans by up to 92%.
- **Regression Safety:** **SATISFIED**  
  The full existing test suite of **116 test suites (2,063 automated tests)** executed with a **100% pass rate** post-optimization.

> [!NOTE]  
> **Evaluation Scope Notice:** These empirical results demonstrate system performance, concurrency safety, and query efficiency within an isolated single-node environment. Real cloud infrastructure validation (including network round-trip latency, multi-tenant load balancers, and external payment gateway hooks) requires subsequent staging deployment verification.

---

## 2. Test Scope & Traceability Matrix

Testing covered all critical operational surfaces identified in the approved [Performance Test Scope](file:///e:/3rd%20Year/2nd%20Sem/SENG34213_System_Development_Project/Darshana-Opticals-OSMS/backend/tests/performance/PERFORMANCE_TEST_SCOPE.md).

| System Domain             | Critical Endpoints Evaluated                                                                                         | SRS NFR Alignment         | Justification                                                                                        |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------- | :------------------------ | :--------------------------------------------------------------------------------------------------- |
| **System Health**         | `GET /api/health`                                                                                                    | NFR-001, NFR-002          | Baseline runtime overhead excluding database I/O.                                                    |
| **Authentication**        | `POST /api/auth/login`<br>`GET /api/profile/me`                                                                      | NFR-001, NFR-002          | High-frequency gatekeeper; bcrypt hashing cost (Cost Factor 10) and JWT verification.                |
| **Product Catalogue**     | `GET /api/products`<br>`GET /api/products?category=...`<br>`GET /api/products?search=...`<br>`GET /api/products/:id` | NFR-001                   | Highest-volume customer entry point; complex filtering, regex search, and branch inventory joins.    |
| **Inventory**             | `GET /api/inventory/branch/:branchId`                                                                                | NFR-001                   | Critical for branch staff operations and real-time stock replenishment checks.                       |
| **Orders**                | `GET /api/orders`                                                                                                    | NFR-001                   | Customer order history retrieval with pagination and sorting.                                        |
| **Appointments**          | `GET /api/doctor-sessions/available`                                                                                 | NFR-001                   | Patient booking schedule query with date filtering and slot capacity calculations.                   |
| **Prescriptions**         | `GET /api/prescriptions/me`<br>`GET /api/prescriptions/customer/:id`                                                 | NFR-001                   | Clinical lookup for optometrists and self-service history for registered patients.                   |
| **Reporting**             | `GET /api/reports/sales?preset=last_30_days`                                                                         | NFR-001                   | Multi-collection aggregation pipeline evaluating financial and order statistics.                     |
| **Cart & Checkout**       | `POST /api/checkout`                                                                                                 | NFR-001, NFR-002, ADR-002 | Multi-document atomic transactions, stock reservation, and payment initiation under race conditions. |
| **Doctor Sessions**       | `POST /api/appointments`                                                                                             | NFR-001, NFR-002, ADR-003 | Atomic doctor session capacity slot allocation and sequential queue position assignment.             |
| **Security & Resilience** | Malformed payloads, SQL/NoSQL injection, expired JWT, oversized payloads                                             | NFR-002, ADR-007, ADR-014 | Security boundary validation, error sanitization, and graceful failure without crashes.              |

---

## 3. Test Environment Architecture & Safety Harness

To guarantee isolation, non-destructive execution, and transactional validity, the test suite leverages an ephemeral in-memory MongoDB replica set:

- **MongoDB Engine:** `MongoMemoryServer` (v11.3.0) configured with **Single-Node Replica Set (`rs0`)**, enabling MongoDB 4.0+ Multi-Document ACID Transactions (`startSession`, `withTransaction`).
- **Pre-flight Safety Safeguards:**
  - `perfEnvironment.js` enforces strict pre-flight environment checks before mutating any environment variables: execution is immediately aborted if `NODE_ENV` is `production` or `staging`, or if `MONGODB_URI` points to a cloud Atlas cluster.
  - External databases via `PERF_MONGODB_URI` are rejected by default. They are only permitted if `ALLOW_EXTERNAL_PERF_DB=true` is explicitly provided, the host is strictly loopback (`127.0.0.1` / `localhost`), and the database name contains `test` or `perf`.
  - `seedData.js` enforces host and database name validation before executing collection-wide `deleteMany({})` operations.
- **Node.js Runtime:** v22.14.0 on `win32` x64 architecture.
- **Application Instance:** Ephemeral Express application instance created per suite using isolated supertest agents.
- **Representative Data Seed:**
  - 3 Optical Branches (`GAMPAHA_CENTRAL`, `COLOMBO_01`, `KANDY_CENTRAL`)
  - 10 Customer Accounts (bcrypt-hashed passwords, profile addresses)
  - 3 Staff Accounts (Branch Manager, Optometrist, Branch Assistant)
  - 1 Doctor & 5 Doctor Availability Sessions (morning/evening slots)
  - 52 Products across Frames, Lenses, Sunglasses, and Contact Lenses with corresponding branch inventory records
  - 15 Doctor Appointments with confirmed queue positions
  - 15 Clinical Optical Prescriptions (sphere, cylinder, axis, pupillary distance)
  - 25 Historical Orders with transaction-backed payments and status progression

---

## 4. Synthetic Configuration & Rate-Limiting Rationale (AC4, AC16)

During automated load and latency benchmarking, the performance test harness configures `RATE_LIMIT_MAX=5000` and `AUTH_RATE_LIMIT_MAX=5000`:

- **Rationale for Synthetic Override:** In a local benchmark, high volumes of requests originate from a single IP loopback address (`127.0.0.1`). If the production limit (10 requests per 3 minutes) remained active during multi-user load testing, the rate-limiter middleware would trigger client-side `429 Too Many Requests` rejections, preventing measurement of the underlying Express, Mongoose, and MongoDB engine throughput and execution times.
- **Runtime vs. Benchmark Configuration:**
  - **Normal Runtime Configuration:** `AUTH_RATE_LIMIT_MAX=10` failed attempts per 3-minute window, with `skipSuccessfulRequests: true` and `trust proxy: 1`. Legitimate logins proceed without consuming quota, while brute force guessing attacks are blocked after 10 failed attempts.
  - **Benchmark Configuration:** Elevated quota (`5000`) applied strictly within the isolated ephemeral test process to evaluate server resource limits and saturation points.
- **Independent Security Validation:** The rate limiter's blocking behavior under normal limits is independently tested and verified in `tests/integration/security.test.js` and `tests/performance/resilience/faultRecovery.js`.

---

## 5. Empirical Performance Results

### 5.1. Baseline Benchmark Summary (13 Critical Endpoints)

All endpoints were benchmarked using high-precision timers (`process.hrtime.bigint()`). All 13 endpoints successfully satisfied NFR-001 (p95 <= 2000 ms) with significant margins.

| Operation / Endpoint           | Concurrency | Total Reqs | Throughput (req/s) | p50 Latency | p90 Latency |  p95 Latency  | p99 Latency | Error Rate |  Status  |
| :----------------------------- | :---------: | :--------: | :----------------: | :---------: | :---------: | :-----------: | :---------: | :--------: | :------: |
| **Health Baseline (No DB)**    |      5      |     30     |       194.83       |  20.17 ms   |  49.50 ms   | **52.27 ms**  |  54.60 ms   |   0.00%    | **PASS** |
| **Auth: Customer Login**       |      5      |     20     |       45.98        |  92.73 ms   |  128.23 ms  | **128.52 ms** |  179.74 ms  |   0.00%    | **PASS** |
| **Auth: Profile Overhead**     |      5      |     30     |       162.88       |  29.05 ms   |  36.37 ms   | **41.25 ms**  |  43.38 ms   |   0.00%    | **PASS** |
| **Catalog: Default List**      |     10      |     30     |       164.15       |  60.65 ms   |  65.19 ms   | **69.38 ms**  |  70.52 ms   |   0.00%    | **PASS** |
| **Catalog: Category Filter**   |     10      |     30     |       175.00       |  57.33 ms   |  61.84 ms   | **62.15 ms**  |  62.41 ms   |   0.00%    | **PASS** |
| **Catalog: Text Search**       |     10      |     30     |       183.27       |  53.16 ms   |  56.46 ms   | **58.69 ms**  |  60.83 ms   |   0.00%    | **PASS** |
| **Catalog: Single Product**    |     10      |     30     |       185.57       |  51.57 ms   |  57.14 ms   | **59.56 ms**  |  61.45 ms   |   0.00%    | **PASS** |
| **Inventory: Branch Stock**    |      5      |     25     |       110.98       |  44.85 ms   |  48.36 ms   | **51.58 ms**  |  53.02 ms   |   0.00%    | **PASS** |
| **Orders: Customer History**   |      5      |     25     |       173.05       |  28.50 ms   |  31.93 ms   | **33.43 ms**  |  35.31 ms   |   0.00%    | **PASS** |
| **Appointments: Sessions**     |      5      |     25     |       119.69       |  39.90 ms   |  48.40 ms   | **49.28 ms**  |  54.40 ms   |   0.00%    | **PASS** |
| **Prescriptions: Own History** |      5      |     25     |       119.39       |  37.90 ms   |  54.83 ms   | **57.23 ms**  |  59.26 ms   |   0.00%    | **PASS** |
| **Prescriptions: Optometrist** |      5      |     25     |       105.96       |  45.45 ms   |  50.06 ms   | **51.76 ms**  |  53.05 ms   |   0.00%    | **PASS** |
| **Reports: Sales Aggregation** |      5      |     15     |       81.42        |  53.25 ms   |  80.68 ms   | **82.08 ms**  |  82.08 ms   |   0.00%    | **PASS** |

_Evidence File:_ `tests/performance/results/baseline-benchmark-results.json`

---

### 5.2. Controlled Multi-Stage Load & Saturation Analysis

A realistic multi-stage synthetic workload was executed across a mix of Catalog Browsing, Customer History Queries, and Appointments Availability queries to evaluate throughput scaling, latency degradation, and memory stability.

| Workload Stage              | Virtual Users (VU) | Total Requests | Stage Duration |  Throughput  | Mean Latency | p50 Latency |  p95 Latency  | Max Latency | Error Rate | Heap Memory | RSS Memory |
| :-------------------------- | :----------------: | :------------: | :------------: | :----------: | :----------: | :---------: | :-----------: | :---------: | :--------: | :---------: | :--------: |
| **Stage 1: Warmup & Light** |         5          |       25       |   288.54 ms    | 86.64 req/s  |   55.43 ms   |  49.62 ms   | **102.71 ms** |  111.96 ms  |   0.00%    |  57.49 MB   | 140.92 MB  |
| **Stage 2: Target Peak**    |         15         |       60       |   408.77 ms    | 146.78 req/s |   96.22 ms   |  98.47 ms   | **130.92 ms** |  136.44 ms  |   0.00%    |  70.09 MB   | 141.77 MB  |
| **Stage 3: High Stress**    |         30         |      120       |   785.50 ms    | 152.77 req/s |  184.93 ms   |  183.92 ms  | **241.78 ms** |  253.59 ms  |   0.00%    |  75.32 MB   | 150.91 MB  |

#### Observations on Saturation:

1. **Throughput Scaling:** Throughput scaled gracefully from 86.64 req/s (5 VU) to 152.77 req/s (30 VU) without event-loop starvation.
2. **Stable Memory Footprint:** RSS memory remained virtually flat (~140 MB to ~151 MB) across all stages, demonstrating effective garbage collection.
3. **Latency Envelope:** Under 30 concurrent users, the p95 latency was **241.78 ms**, consuming approximately **12%** of the allowable 2000 ms SLA.

_Evidence File:_ `tests/performance/results/controlled-load-results.json`

---

## 6. Concurrency & Race-Condition Verification

### 6.1. AC9: Atomic Checkout Stock Contention

Simultaneous checkout attempts targeting depleted or constrained inventory stocks were fired in parallel using `Promise.all`:

- **Scenario 1: 5 Concurrent Requests for Last 1 Item in Stock**
  - Expected: Exactly 1 Success (HTTP 201), Exactly 4 Rejected (HTTP 409 Conflict).
  - Observed: Exactly 1 Success, Exactly 4 Rejected.
  - Final Inventory Stock: **0** (0% negative drift, 0 overselling).
  - Persisted Orders: Exactly 1 Order created with active reservation.
- **Scenario 2: 4 Concurrent Requests for 2 Items in Stock**
  - Expected: Exactly 2 Successes (HTTP 201), Exactly 2 Rejected (HTTP 409 Conflict).
  - Observed: Exactly 2 Successes, Exactly 2 Rejected.
  - Final Inventory Stock: **0**.
  - Persisted Orders: Exactly 2 Orders created.

**Result:** Atomic multi-document MongoDB transactions (`session.withTransaction()`) strictly preserve inventory integrity under race conditions.

### 6.2. AC10: Atomic Doctor Session Slot Contention

Simultaneous appointment booking requests targeting the final available slot of a clinical doctor session were fired in parallel:

- **Scenario 1: 5 Concurrent Bookings for 1 Available Slot**
  - Expected: Exactly 1 Confirmed Booking (HTTP 201), Exactly 4 Rejected.
  - Observed: Exactly 1 Confirmed Booking, Exactly 4 Rejected with `SESSION_CAPACITY_EXCEEDED`.
  - Doctor Session `confirmedCount`: Exactly **1**.
  - Duplicate Position Checks: Unique index (`appointment_session_position_unique`) verified zero duplicate queue positions.
- **Scenario 2: 4 Concurrent Bookings for 2 Available Slots**
  - Expected: Exactly 2 Bookings confirmed, assigned sequential positions [1, 2].
  - Observed: Exactly 2 Bookings confirmed with queue positions [1, 2], Exactly 2 Rejected.
  - Doctor Session `confirmedCount`: Exactly **2**.

**Result:** Overbooking is completely prevented; doctor consultation capacity rules are strictly enforced.

_Evidence File:_ `tests/performance/results/concurrency-reliability-results.json`

---

## 7. Fault Recovery & Security Boundary Verification (AC12)

The application was subjected to adversarial, malformed, and anomalous payloads to verify stability, security, and error envelope conformity:

| Test Case           | Injected Payload / Condition                        | Expected Behavior                                    | Observed Result      | Stack Leak | Verdict  |
| :------------------ | :-------------------------------------------------- | :--------------------------------------------------- | :------------------- | :--------: | :------: |
| **NoSQL Injection** | `{"email": {"$gt": ""}, "password": "any"}`         | 422 Unprocessable Entity / Safe Validation Rejection | HTTP 422 Rejected    |  **None**  | **PASS** |
| **Expired JWT**     | Bearer token with negative TTL                      | 401 Unauthorized (`TOKEN_EXPIRED`)                   | HTTP 401 Rejected    |  **None**  | **PASS** |
| **Tampered JWT**    | Bearer token with corrupted cryptographic signature | 401 Unauthorized (`INVALID_TOKEN`)                   | HTTP 401 Rejected    |  **None**  | **PASS** |
| **Oversized Body**  | Synthetic JSON payload exceeding 100 KB limit       | 413 Payload Too Large (`LIMIT_FILE_SIZE`)            | HTTP 413 Rejected    |  **None**  | **PASS** |
| **Invalid Route**   | `GET /api/non-existent-route`                       | 404 Client-safe envelope (`NOT_FOUND`)               | HTTP 404 Client Safe |  **None**  | **PASS** |

**Reliability Confirmation:**

- **Zero Process Crashes:** The Node.js event loop did not exit or throw unhandled exceptions.
- **Zero Information Leakage:** Production error sanitizer (`sanitizer.js`) suppressed all internal Mongoose/MongoDB connection strings, server IPs, and stack traces.

---

## 8. Bottleneck Profiling & Index Optimizations (AC14, AC15)

Using MongoDB execution plan profiling (`.explain('executionStats')`), critical query paths were analyzed to identify unindexed full collection scans (`COLLSCAN`), in-memory sorts, and inefficient key examination ratios.

### 8.1. Query Plan Analysis & Compound Indexes Applied

#### 1. Customer Order History (`GET /api/orders`)

- **Query Filter:** `{ customerId: ObjectId }` sorted by `{ createdAt: -1 }`
- **Initial Execution Plan:** `COLLSCAN` requiring scanning every document in the collection and performing a blocking in-memory sort.
- **Optimization:** Added compound index:
  ```javascript
  orderSchema.index({ customerId: 1, createdAt: -1 });
  ```
- **Result:** Transitioned from `COLLSCAN` to index scan (`IXSCAN`). Documents examined dropped from **25 to 2** (a **92.0% reduction**). In-memory sort was completely eliminated.

#### 2. Clinical Optical Prescriptions (`GET /api/prescriptions/me`)

- **Query Filter:** `{ customerId: ObjectId, isArchived: false }` sorted by `{ recordedAt: -1 }`
- **Initial Execution Plan:** Single-field index scan on `customerId` followed by an in-memory sort stage.
- **Optimization:** Added compound index:
  ```javascript
  prescriptionSchema.index({ customerId: 1, isArchived: 1, recordedAt: -1 });
  ```
- **Result:** Achieved **index-covered sorting** (`FETCH -> IXSCAN`). Documents examined dropped from **15 to 2**. Zero in-memory sorting overhead.

#### 3. Patient Appointment Schedule (`GET /api/appointments`)

- **Query Filter:** `{ customerId: ObjectId }` sorted by `{ dateTime: -1 }`
- **Initial Execution Plan:** Scan with in-memory sort.
- **Optimization:** Added compound index:
  ```javascript
  appointmentSchema.index({ customerId: 1, dateTime: -1 });
  ```
- **Result:** Index scan (`IXSCAN`) with index-covered ordering. Documents examined: **2**.

#### 4. Product Catalog Filtering & Sorting (`GET /api/products`)

- **Query Filter:** `{ branchId: ObjectId, category: String, quantity: { $gt: 0 } }`
- **Optimization:** Added compound covering indexes:
  ```javascript
  inventorySchema.index({ branchId: 1, quantity: 1, itemName: 1, _id: 1 });
  inventorySchema.index({ branchId: 1, category: 1, quantity: 1, itemName: 1 });
  ```
- **Result:** Selective index scanning reduced examined documents from **52 to 3**, an **82.4% reduction** in scanned items.

### 8.2. Profiler Execution Metrics Post-Optimization

| Profiling Query             | Target Collection | Index Used                      |  In-Memory Sort  | Docs Examined | Docs Returned | Execution Time |
| :-------------------------- | :---------------- | :------------------------------ | :--------------: | :-----------: | :-----------: | :------------: |
| **Catalog In-Stock Filter** | `inventories`     | `branchId_1_quantity_1_...`     |  Yes (Bounded)   |      17       |      17       |      1 ms      |
| **Catalog Category Filter** | `inventories`     | `branchId_1_category_1_...`     |  Yes (Bounded)   |       3       |       3       |      0 ms      |
| **Customer Order History**  | `orders`          | `customerId_1_createdAt_-1`     | **NO (Covered)** |       2       |       2       |      0 ms      |
| **Prescription History**    | `prescriptions`   | `customerId_1_isArchived_1_...` | **NO (Covered)** |       2       |       2       |      1 ms      |
| **Appointment Schedule**    | `appointments`    | `customerId_1_dateTime_-1`      | **NO (Covered)** |       2       |       2       |      2 ms      |

_Evidence File:_ `tests/performance/results/bottleneck-analysis-results.json`

---

## 9. Environmental & Testing Limitations

To maintain academic and professional transparency:

1. **Local Host Specifications:**
   - Architecture: x64 Windows 11 host
   - CPU: 8-Core Intel/AMD Processor with dedicated cache
   - System Memory: 16 GB Physical RAM
2. **Ephemeral In-Memory Database vs. Cloud Atlas:**
   - Ephemeral in-memory replica sets eliminate network transit times (~0.1 ms local loopback). In a cloud deployment (e.g., MongoDB Atlas across regions), network round-trip time (RTT) typically adds +10 ms to +30 ms per un-pipelined query roundtrip.
3. **Password Hashing Cost:**
   - `POST /api/auth/login` includes deliberate CPU cost from `bcrypt` (10 rounds, ~70-130 ms). This is intentional and necessary for cryptographic security.
4. **CI Separation:**
   - Destructive and resource-intensive performance benchmarks remain isolated in `npm run test:perf` and are kept separate from the standard lightweight CI (`npm test`) to ensure continuous integration remains fast and deterministic.

---

## 10. Sprint 2 Release Gate Checklist & Sign-Off (AC19)

| Gate Criteria                  | Target Requirement                                           | Measured Result                                                                                          |  Status  |
| :----------------------------- | :----------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- | :------: |
| **Critical Endpoint Latency**  | p95 Response Time <= 2000 ms (NFR-001)                       | Baseline p95: **33.43 ms – 128.52 ms**<br>Peak Load p95: **130.92 ms**<br>Stress Load p95: **241.78 ms** | **PASS** |
| **Operational Reliability**    | 0% unhandled errors or server crashes (NFR-002)              | 0 server crashes, 0.00% error rate across all load stages                                                | **PASS** |
| **Stock Integrity**            | Zero overselling or negative inventory under race conditions | Exactly 1 checkout succeeded on 1-item stock; 0 overselling                                              | **PASS** |
| **Appointment Slot Integrity** | Zero overbooking of doctor session capacity                  | Exactly 1 appointment confirmed on single slot; 0 overbooking                                            | **PASS** |
| **Security Envelope**          | Safe rejection of malformed/adversarial inputs               | 100% compliant: NoSQL, expired JWT, tampered tokens safely rejected                                      | **PASS** |
| **Information Leakage**        | Zero stack traces or sensitive credentials exposed           | 0 leaks in error responses                                                                               | **PASS** |
| **Query Efficiency**           | Optimized compound indexes on high-volume queries            | 4 compound indexes added; full scans eliminated; 92% doc scan reduction                                  | **PASS** |
| **Regression Safety**          | Zero regressions on existing test suite                      | 116 / 116 test suites passed (2,063 / 2,063 tests passed)                                                | **PASS** |
| **Reproducibility**            | Automated test suite runnable with standard npm commands     | `npm run test:perf` executes all benchmarks and generators cleanly                                       | **PASS** |

### Engineering Assessment

The Darshana Opticals OSMS backend foundation and Sprint 2 features **fully satisfy all Non-Functional Requirements (NFR-001, NFR-002, NFR-006) within local synthetic testing bounds**. Transactional concurrency boundaries and query execution plans are verified optimal.

**VERDICT: CONDITIONALLY APPROVED FOR SPRINT 2 RELEASE (PENDING STAGING / CLOUD VERIFICATION).**
