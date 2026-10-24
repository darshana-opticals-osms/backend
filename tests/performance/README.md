# OSMS Performance & Reliability Testing Suite

This directory contains the performance, benchmark, concurrency, and reliability testing infrastructure for the Darshana Opticals OSMS backend, established for **Issue #92**.

## Directory Structure

```
tests/performance/
├── PERFORMANCE_TEST_SCOPE.md     # Formal scope, NFR targets & justifications (AC1, AC2)
├── PERFORMANCE_REPORT.md         # Final Performance & Reliability Evaluation Report (AC18, AC19)
├── README.md                     # Architecture, instructions & execution guide
├── .env.perf.example             # Safe performance testing environment configuration
├── runPerformanceSuite.js        # Master runner executing all benchmarks, concurrency & load tests
├── config/
│   └── artilleryLoadConfig.yml   # Artillery scenario definitions for HTTP load testing
├── setup/
│   ├── perfEnvironment.js       # Ephemeral MongoDB single-node replica set runner (AC3)
│   ├── seedData.js               # Representative domain dataset seeder (AC4)
│   └── verifySeed.js             # Fixture and environment verification script
├── benchmarks/
│   ├── benchmarkEngine.js        # Sub-millisecond latency & throughput measurement engine
│   └── baselineBenchmarks.js     # Latency & throughput benchmarks for 13 critical endpoints (AC5-AC8)
├── concurrency/
│   ├── checkoutConcurrency.js    # Multi-request atomic stock contention suite (AC9)
│   ├── appointmentConcurrency.js # Simultaneous doctor session slot contention suite (AC10)
│   └── runConcurrencySuite.js    # Concurrency and fault recovery automated runner
├── resilience/
│   └── faultRecovery.js          # Adversarial input, auth tampering & failure recovery tests (AC12)
├── load/
│   ├── controlledLoadTest.js     # Multi-stage load test: Light, Peak, Stress (AC11, AC13)
│   └── bottleneckAnalyzer.js     # MongoDB execution plan profiler (explain stats) (AC14, AC15)
└── results/                      # Machine-readable evaluation evidence artifacts (AC17)
    ├── baseline-benchmark-results.json
    ├── concurrency-reliability-results.json
    ├── controlled-load-results.json
    └── bottleneck-analysis-results.json
```

## How to Run

### 1. Execute All Performance Tests (Recommended)

Run the entire suite (Seed Verification, Baseline Benchmarks, Concurrency & Resilience, Load Test, and Bottleneck Profiler):

```bash
npm run test:perf
```

### 2. Run Individual Performance Test Suites

```bash
# Baseline latency benchmarks (13 endpoints)
npm run test:perf:baseline

# Concurrency & atomic race-condition validation
npm run test:perf:concurrency

# Controlled multi-stage load testing (Light, Peak, Stress)
npm run test:perf:load

# Database query execution plan profiling
npm run test:perf:profile
```

### 3. Run Controlled Artillery Load Tests

```bash
npx artillery run tests/performance/config/artilleryLoadConfig.yml
```

### 4. Review Evaluation Report

Refer to [PERFORMANCE_REPORT.md](./PERFORMANCE_REPORT.md) for the comprehensive evaluation, empirical metrics, query optimizations, and release gate sign-off.
