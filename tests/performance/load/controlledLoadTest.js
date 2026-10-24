/**
 * Controlled Step-Up Load Testing Suite (AC11, AC13)
 *
 * Evaluates system stability, throughput, and resource consumption
 * under a documented, gradually increasing concurrent request load:
 * - Stage 1: Light Concurrency (5 virtual users, 25 requests)
 * - Stage 2: Operational Peak Load (15 virtual users, 60 requests)
 * - Stage 3: High Stress Load (30 virtual users, 120 requests)
 *
 * Records: Concurrency, Requests, Duration, Latencies (p50, p90, p95, max),
 * Throughput (req/s), Error Rate, Heap & RSS Memory, and CPU usage.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { setupPerfEnvironment, teardownPerfEnvironment } = require('../setup/perfEnvironment');
const { seedPerformanceData } = require('../setup/seedData');
const { calculatePercentile } = require('../benchmarks/benchmarkEngine');

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const RESULTS_FILE = path.join(RESULTS_DIR, 'controlled-load-results.json');

/**
 * Dispatches a mixed-traffic request representing realistic customer/staff activity.
 */
async function dispatchMixedTraffic(app, context) {
  const { tokens, testBranchId } = context;
  const rand = Math.random();

  if (rand < 0.35) {
    // 35% Catalog Listing / Search
    const searchTypes = [
      '/api/products',
      '/api/products?category=Frames',
      '/api/products?search=Ray-Ban',
    ];
    const p = searchTypes[Math.floor(Math.random() * searchTypes.length)];
    return request(app).get(p);
  } else if (rand < 0.55) {
    // 20% Branch Inventory Query (Staff)
    return request(app)
      .get(`/api/inventory/branch/${testBranchId}`)
      .set('Authorization', `Bearer ${tokens.staffColomboToken}`);
  } else if (rand < 0.75) {
    // 20% Customer Order History
    return request(app).get('/api/orders').set('Authorization', `Bearer ${tokens.customer1Token}`);
  } else if (rand < 0.9) {
    // 15% Customer Prescription View
    return request(app)
      .get('/api/prescriptions/me')
      .set('Authorization', `Bearer ${tokens.customer1Token}`);
  } else {
    // 10% Sales Report Aggregation (Admin)
    return request(app)
      .get('/api/reports/sales?preset=last_30_days')
      .set('Authorization', `Bearer ${tokens.adminToken}`);
  }
}

/**
 * Runs a single load test stage with explicit concurrency and request bounds.
 */
async function runLoadStage(app, stageName, concurrency, totalRequests, context) {
  console.log(
    `\n  ▸ Executing Stage: ${stageName} (Concurrency: ${concurrency}, Total Requests: ${totalRequests})...`
  );

  const durations = [];
  const statusCodes = {};
  let failureCount = 0;

  let inFlight = 0;
  let completed = 0;
  let nextIndex = 0;

  const initialCpu = process.cpuUsage();
  const stageStartTime = process.hrtime.bigint();

  async function executeWorker() {
    const start = process.hrtime.bigint();
    try {
      const res = await dispatchMixedTraffic(app, context);
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      durations.push(durationMs);

      statusCodes[res.status] = (statusCodes[res.status] || 0) + 1;
      if (res.status >= 400) {
        failureCount++;
      }
    } catch {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      durations.push(durationMs);
      failureCount++;
      statusCodes['ERR'] = (statusCodes['ERR'] || 0) + 1;
    }
  }

  await new Promise((resolve) => {
    function launch() {
      while (inFlight < concurrency && nextIndex < totalRequests) {
        inFlight++;
        nextIndex++;
        executeWorker().finally(() => {
          inFlight--;
          completed++;
          if (completed === totalRequests) {
            resolve();
          } else {
            launch();
          }
        });
      }
    }
    launch();
  });

  const stageEndTime = process.hrtime.bigint();
  const totalDurationMs = Number(stageEndTime - stageStartTime) / 1e6;
  const cpuDiff = process.cpuUsage(initialCpu);

  durations.sort((a, b) => a - b);

  const total = durations.length;
  const sum = durations.reduce((acc, v) => acc + v, 0);
  const avgMs = total > 0 ? Number((sum / total).toFixed(2)) : 0;
  const minMs = total > 0 ? Number(durations[0].toFixed(2)) : 0;
  const maxMs = total > 0 ? Number(durations[total - 1].toFixed(2)) : 0;
  const p50Ms = calculatePercentile(durations, 50);
  const p90Ms = calculatePercentile(durations, 90);
  const p95Ms = calculatePercentile(durations, 95);
  const p99Ms = calculatePercentile(durations, 99);
  const throughputReqSec =
    totalDurationMs > 0 ? Number(((total / totalDurationMs) * 1000).toFixed(2)) : 0;
  const errorRatePercent = total > 0 ? Number(((failureCount / total) * 100).toFixed(2)) : 0;

  const memUsage = process.memoryUsage();

  return {
    stage: stageName,
    concurrency,
    totalRequests,
    totalDurationMs: Number(totalDurationMs.toFixed(2)),
    throughputReqSec,
    errorRatePercent,
    statusCodes,
    latency: {
      avgMs,
      minMs,
      maxMs,
      p50Ms,
      p90Ms,
      p95Ms,
      p99Ms,
    },
    resourceUsage: {
      heapUsedMb: Number((memUsage.heapUsed / 1024 / 1024).toFixed(2)),
      rssMb: Number((memUsage.rss / 1024 / 1024).toFixed(2)),
      cpuUserMs: Number((cpuDiff.user / 1000).toFixed(2)),
      cpuSystemMs: Number((cpuDiff.system / 1000).toFixed(2)),
    },
  };
}

async function executeControlledLoadTesting() {
  console.log('🚀 Starting Controlled Step-Up Load Testing Suite (AC11, AC13)...\n');
  const { app, uri } = await setupPerfEnvironment();
  console.log(`[PerfSuite] Isolated Environment Active at: ${uri}`);

  const stagesReport = [];

  try {
    console.log('[PerfSuite] Seeding baseline records...');
    const manifest = await seedPerformanceData();
    console.log('[PerfSuite] Seeding complete. Initializing workload profiles...\n');

    const context = {
      tokens: manifest.tokens,
      testBranchId: manifest.branches[0]._id.toString(),
      testCustomerId: manifest.customers[0]._id.toString(),
    };

    // Stage 1: Light Concurrency
    const stage1 = await runLoadStage(app, 'Stage 1: Warmup & Light Load', 5, 25, context);
    stagesReport.push(stage1);

    // Stage 2: Operational Peak Load
    const stage2 = await runLoadStage(app, 'Stage 2: Target Peak Concurrency', 15, 60, context);
    stagesReport.push(stage2);

    // Stage 3: High Stress Load
    const stage3 = await runLoadStage(app, 'Stage 3: High Stress Concurrency', 30, 120, context);
    stagesReport.push(stage3);

    // Comparison Table
    console.log(
      '\n========================================================================================================'
    );
    console.log(
      '                            CONTROLLED LOAD TESTING STAGE COMPARISON REPORT                             '
    );
    console.log(
      '========================================================================================================'
    );

    const tableData = stagesReport.map((s) => ({
      Stage: s.stage,
      Concurrency: s.concurrency,
      TotalReqs: s.totalRequests,
      'Duration (ms)': s.totalDurationMs,
      'Throughput (req/s)': s.throughputReqSec,
      'Avg (ms)': s.latency.avgMs,
      'p50 (ms)': s.latency.p50Ms,
      'p95 (ms)': s.latency.p95Ms,
      'Max (ms)': s.latency.maxMs,
      'Error Rate (%)': s.errorRatePercent,
      'Heap (MB)': s.resourceUsage.heapUsedMb,
      'RSS (MB)': s.resourceUsage.rssMb,
      'NFR-001 (p95<=2s)': s.latency.p95Ms <= 2000 ? 'PASS' : 'FAIL',
    }));

    console.table(tableData);

    const fullEvidence = {
      executedAt: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      stages: stagesReport,
      allStagesCompliant: stagesReport.every(
        (s) => s.latency.p95Ms <= 2000 && s.errorRatePercent < 1.0
      ),
    };

    fs.writeFileSync(RESULTS_FILE, JSON.stringify(fullEvidence, null, 2), 'utf-8');
    console.log(`💾 Evidence successfully written to: ${RESULTS_FILE}\n`);

    return fullEvidence;
  } finally {
    console.log('[PerfSuite] Tearing down environment...');
    await teardownPerfEnvironment();
    console.log('[PerfSuite] Teardown complete.\n');
  }
}

if (require.main === module) {
  executeControlledLoadTesting()
    .then((evidence) => {
      if (!evidence || !evidence.allStagesCompliant) {
        console.error(
          '\n❌ Controlled load testing failed: One or more stages violated NFR-001 (p95 <= 2000ms or errorRate > 0).'
        );
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('❌ Controlled load test failed:', err);
      process.exit(1);
    });
}

module.exports = { executeControlledLoadTesting };
