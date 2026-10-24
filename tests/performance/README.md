# OSMS Performance & Reliability Testing Suite

This directory contains the performance, benchmark, concurrency, and reliability testing infrastructure for the Darshana Opticals OSMS backend, established for **Issue #92**.

## Directory Structure

```
tests/performance/
├── PERFORMANCE_TEST_SCOPE.md     # Formal scope, NFR targets & justification (AC1, AC2)
├── README.md                     # Architecture, instructions & execution guide
├── .env.perf.example             # Safe performance testing environment configuration
├── config/
│   └── artillery.config.yml      # Declarative Artillery scenarios for load testing
├── setup/
│   └── seedData.js               # Safe representative data seeder (AC4)
├── benchmarks/                   # Automated API benchmarks (AC5-AC8)
│   ├── auth.benchmark.js
│   ├── catalog.benchmark.js
│   └── reports.benchmark.js
├── concurrency/                  # Race-condition & ACID transaction tests (AC9, AC10)
│   ├── checkoutConcurrency.js
│   └── appointmentConcurrency.js
├── resilience/                   # Fault injection & error recovery tests (AC12)
│   └── faultRecovery.js
└── results/                      # Reproducible benchmark metrics and evidence (AC17)
```

## Prerequisites

- Node.js v20+ / v22+
- NPM
- Isolated test database (provided automatically via `MongoMemoryServer` with replica set or local test MongoDB)

## How to Run

### 1. Run Automated Performance & Concurrency Benchmarks

```bash
node tests/performance/run-all.js
```

### 2. Run Controlled Artillery Load Tests

```bash
npx artillery run tests/performance/config/artillery.config.yml
```
