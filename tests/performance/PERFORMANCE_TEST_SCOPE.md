# Performance and Reliability Testing Scope & Approved Targets (Issue #92)

## 1. Executive Summary & Context

As part of **Sprint 3 (Release Verification)** for the **Darshana Opticals Optical Shop Management System (OSMS)**, this specification defines the formal performance, reliability, and concurrency testing scope and approved measurable targets.

While unit and integration test suites confirm functional correctness and business-rule enforcement, this evaluation assesses system behavior under concurrent workloads, database round trips, transaction contention, and simulated infrastructure faults in accordance with **SENG 34213 System Development Project Guidelines** (Chapters 5, 6, 7, 8, 10, and Appendix A: Definition of Done).

---

## 2. Traceability Matrix

### 2.1 SRS Non-Functional Requirements (NFRs)

| Requirement ID | Classification  | Title                           | Approved SRS Target / Measurable Criteria                                                                                                                                                                                 | Testing Strategy                                                                                          |
| :------------- | :-------------- | :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------- |
| **NFR-001**    | Performance     | API Latency & Response Times    | Under normal operating load, end-user API endpoints should respond within **≤ 2000 ms** (p95 ≤ 1500 ms for standard indexed catalog/inventory read operations; p95 ≤ 3000 ms for complex analytical report aggregations). | Automated benchmarking across critical endpoints with p50, p95, p99, and average response times recorded. |
| **NFR-001**    | Performance     | Concurrency & Throughput        | System must maintain responsive throughput under representative concurrent virtual user loads (10 to 50 concurrent sessions) without process deadlocks or unhandled request drops.                                        | Controlled step-up load profiles using Artillery / automated concurrency runners.                         |
| **NFR-002**    | Reliability     | Availability & Stability        | System target availability of 99.5% during active operational windows; error rate under bounded concurrent load must remain **< 1.0%** (excluding legitimate client-side 4xx input validation rejections).                | Error rate measurement during multi-user load testing and soak scenarios.                                 |
| **NFR-002**    | Reliability     | Transactional Data Integrity    | Zero data corruption, zero negative inventory, zero duplicate stock allocation during concurrent checkouts, and zero overbooking beyond doctor session slot capacity.                                                     | Multi-threaded / concurrent race-condition integration suites using MongoDB ACID transactions.            |
| **NFR-002**    | Reliability     | Fault Tolerance & Safe Recovery | Graceful degradation under database disconnection, external provider downtime, or malformed payloads without process crashes or secret exposure (passwords, JWT secrets, patient data).                                   | Fault-injection suite simulating network dropouts, transaction aborts, and invalid input payloads.        |
| **NFR-006**    | Maintainability | Reproducibility & Automation    | All test conditions, fixtures, and scripts must be automated, reproducible, non-destructive, and runnable without production credentials.                                                                                 | Standalone `tests/performance/` test harness executable in isolated local and CI environments.            |

### 2.2 Architecture Decision Records (ADRs) Preservation

All performance tests and remediation must strictly adhere to and preserve established architectural boundaries:

- **ADR-002**: Authoritative RBAC role enforcement (`CUSTOMER`, `STAFF`, `OPTOMETRIST`, `DOCTOR`, `ADMIN`).
- **ADR-003**: Shopping Cart persistence, branch-scoped fulfillment, and Checkout transactional boundary.
- **ADR-004**: Order lifecycle state machine (`PENDING`, `CONFIRMED`, `PROCESSING`, `READY_FOR_PICKUP`, `DISPATCHED`, `DELIVERED`, `CANCELLED`).
- **ADR-005**: Loyalty point calculation, eligibility rules, and balance persistence.
- **ADR-006**: Inventory reorder threshold alerts and stock tracking.
- **ADR-007**: Doctor session scheduling, slot capacity, and atomic appointment reservation.
- **ADR-010**: AI Chatbot session limits and knowledge retrieval safety.
- **ADR-011**: Secure PayHere payment webhook verification and manual refund evidence infrastructure.
- **ADR-012**: Append-only, tamper-evident audit logging for sensitive operations.
- **ADR-014**: Sales and Inventory reporting aggregations and data masking.

---

## 3. Prioritized Critical Operations (AC1)

The following 8 critical operational workflows have been identified and prioritized based on user impact, database overhead, and business criticality:

### 1. Authentication (`POST /api/auth/login`)

- **Justification**: The primary entry gateway for all user roles. Involves CPU-bound cryptographic operations (`bcrypt.compare` with salt rounds = 10–12) and JWT token generation. High concurrent demand occurs during store opening, shift changes, and peak customer browsing.
- **Critical Risk**: CPU starvation blocking the Node.js single-threaded event loop if concurrent logins surge.

### 2. Product Catalogue Retrieval (`GET /api/products`, `GET /api/products/search`)

- **Justification**: The most frequently accessed public-facing endpoint by online customers. Involves dynamic query filtering (by category, price range, brand, prescriptions/frames classification), text regex search, and cursor/page pagination.
- **Critical Risk**: Slow unbounded MongoDB collection scans causing excessive latency and database I/O bottlenecks.

### 3. Inventory Retrieval & Branch Filtering (`GET /api/inventory`, `GET /api/inventory/branch/:branchId`)

- **Justification**: Core staff and optometrist operational workflow to check real-time stock across physical branches (Colombo, Gampaha, Kandy).
- **Critical Risk**: Excessive query latency when joined across branch allocations, impacting customer counter service speed.

### 4. Cart & Checkout (`POST /api/checkout`)

- **Justification**: High-value financial and transactional boundary. Atomically validates customer cart, decrements multi-item inventory across branch stock, calculates loyalty eligibility, initializes order state, and establishes payment intent within a MongoDB multi-document ACID transaction.
- **Critical Risk**: Concurrency deadlocks, write conflicts, race conditions causing overselling / negative stock, or orphaned order items.

### 5. Order Creation & Retrieval (`GET /api/orders/my-orders`, `GET /api/orders/:id`, `GET /api/orders/tracking/:orderNumber`)

- **Justification**: Critical post-purchase workflow. Customers track lens fitting and dispatch stages; staff manage fulfillment statuses.
- **Critical Risk**: Heavy document population (customer details, item snapshots, delivery addresses) causing high memory allocation and slow response times.

### 6. Appointment Availability & Booking (`GET /api/appointments/available-slots`, `POST /api/appointments`)

- **Justification**: Real-time eye clinic workflow. Evaluates doctor session availability, slot schedules, and atomic appointment bookings.
- **Critical Risk**: Simultaneous booking attempts by multiple patients targeting the final available slot in a session causing double bookings beyond capacity.

### 7. Prescription History Retrieval (`GET /api/prescriptions/customer/:customerId`, `GET /api/prescriptions/my-prescriptions`)

- **Justification**: Clinical workflow where optometrists and consulting ophthalmologists need immediate access to patient visual acuity, sphere/cylinder measurements, and lens recommendations during consultations.
- **Critical Risk**: Sub-optimal querying or index misses delaying consultation workflow.

### 8. Sales & Inventory Reporting (`GET /api/reports/sales/summary`, `GET /api/reports/inventory/summary`)

- **Justification**: Administrative analytical endpoints executing multi-stage MongoDB aggregation pipelines (`$match`, `$group`, `$lookup`, `$project`) across large historical collections.
- **Critical Risk**: Long-running aggregation queries locking database resources or degrading online transactional throughput.

---

## 4. Approved Measurable Performance & Reliability Targets (AC2)

### 4.1 Latency & Throughput Targets (NFR-001)

| Workflow / Endpoint          | HTTP Method                               | Target Concurrency     | Target p50 (Median) | Target p95 | Target Max Response | Target Min Throughput |
| :--------------------------- | :---------------------------------------- | :--------------------- | :------------------ | :--------- | :------------------ | :-------------------- |
| **Authentication (Login)**   | `POST /api/auth/login`                    | 10–20 concurrent users | ≤ 250 ms            | ≤ 500 ms   | ≤ 1200 ms           | ≥ 20 req/sec          |
| **Product Catalogue (List)** | `GET /api/products`                       | 20–50 concurrent users | ≤ 80 ms             | ≤ 250 ms   | ≤ 800 ms            | ≥ 50 req/sec          |
| **Product Search & Filter**  | `GET /api/products/search`                | 20–50 concurrent users | ≤ 120 ms            | ≤ 350 ms   | ≤ 1000 ms           | ≥ 40 req/sec          |
| **Inventory Branch Lookup**  | `GET /api/inventory/branch/:id`           | 10–25 concurrent users | ≤ 90 ms             | ≤ 250 ms   | ≤ 800 ms            | ≥ 30 req/sec          |
| **Order History Retrieval**  | `GET /api/orders/my-orders`               | 10–25 concurrent users | ≤ 100 ms            | ≤ 300 ms   | ≤ 1000 ms           | ≥ 25 req/sec          |
| **Appointment Slot Query**   | `GET /api/appointments/available-slots`   | 10–25 concurrent users | ≤ 90 ms             | ≤ 250 ms   | ≤ 800 ms            | ≥ 30 req/sec          |
| **Prescription History**     | `GET /api/prescriptions/my-prescriptions` | 10–25 concurrent users | ≤ 90 ms             | ≤ 250 ms   | ≤ 800 ms            | ≥ 30 req/sec          |
| **Reporting Aggregation**    | `GET /api/reports/sales/summary`          | 5–10 concurrent users  | ≤ 300 ms            | ≤ 900 ms   | ≤ 2500 ms           | ≥ 5 req/sec           |

_Note on bcrypt performance_: Bcrypt hashing intentionally introduces ~60–120ms computational delay per hash verification to resist brute-force attacks. Therefore, login latency targets are bounded by algorithmic security constraints.

### 4.2 Reliability & Data Integrity Targets (NFR-002)

1. **Transactional Stock Integrity**:
   - Under 10 simultaneous checkout requests attempting to purchase a product with only 1 item remaining in stock:
     - Exactly **1 request** must succeed (HTTP 201).
     - Exactly **9 requests** must be safely rejected with `INSUFFICIENT_STOCK` (HTTP 400).
     - Ending stock count must be exactly **0** (0% negative inventory drift).
2. **Appointment Slot Overbooking Protection**:
   - Under simultaneous booking requests exceeding doctor session maximum capacity:
     - No more than session `maxCapacity` bookings are accepted.
     - Conflicting concurrent requests receive HTTP 409 Conflict or HTTP 400 with a clean business error.
3. **HTTP Error Rate Budget**:
   - Total 5xx server-side errors across all controlled load runs must be **< 0.1%** (zero unexpected server crashes).
4. **Information Disclosure & Failure Handling**:
   - In simulated database connection loss or invalid schema inputs, the API must return standardized JSON errors without exposing:
     - Raw database connection strings or credentials.
     - Internal stack traces.
     - Schema internals.

### 4.3 Documentation of Unmeasurable / Abstract SRS Requirements

- **Global 99.9% Cloud Uptime over 1 Year**: Cannot be empirically proven during local Sprint 3 testing; evaluated through local fault-tolerance simulations and health check responsiveness.
- **PayHere Real-Time Bank Settlement Latency**: Third-party external banking network latency is outside application control; verified via mocked webhook processing benchmarks.

---

## 5. Safe Test Environment Principles (AC3)

1. **Zero Production Contamination**: All performance evaluations execute exclusively against isolated, non-production environments (ephemeral in-memory MongoDB replica sets or isolated local test MongoDB containers).
2. **Synthetic Data Exclusively**: Zero real customer names, real medical prescriptions, or live payment credentials.
3. **Bounded Load Profiles**: Concurrency and duration are capped to protect developer workstation resources and prevent quota exhaustion.

---

## 6. Execution Methodology & Tooling

- **Testing Frameworks**:
  1. **Artillery CLI (`artillery`)**: Scenario-based HTTP load testing for sustained concurrency, latency percentiles (p50, p95, p99), and throughput.
  2. **Automated Node.js Benchmark Suite (`tests/performance/harness.js`)**: Direct programmatic execution for continuous integration, deterministic reproducibility, and automated assertion checking.
  3. **Concurrency Race-Condition Suite (`tests/performance/concurrency.test.js`)**: Parallel asynchronous promise dispatching verifying atomic MongoDB transactions.
