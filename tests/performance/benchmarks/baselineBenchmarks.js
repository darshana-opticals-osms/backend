/**
 * Automated Baseline API Response Performance Suite (AC5, AC6, AC7, AC8)
 *
 * Runs controlled concurrency benchmarks against critical OSMS endpoints,
 * measures response-time percentiles, verifies NFR-001 targets, and
 * exports structured JSON metrics.
 */

const fs = require('fs');
const path = require('path');
const { setupPerfEnvironment, teardownPerfEnvironment } = require('../setup/perfEnvironment');
const { seedPerformanceData } = require('../setup/seedData');
const { runBenchmark } = require('./benchmarkEngine');

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const RESULTS_FILE = path.join(RESULTS_DIR, 'baseline-benchmark-results.json');

// Ensure results directory exists
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

async function executeBaselineBenchmarks() {
  console.log('🚀 Starting OSMS Baseline Performance Benchmark Suite...\n');
  const { app, uri } = await setupPerfEnvironment();
  console.log(`[PerfSuite] Isolated Environment Active at: ${uri}`);

  const benchmarkReports = [];

  try {
    console.log('[PerfSuite] Seeding representative test records...');
    const manifest = await seedPerformanceData();
    console.log('[PerfSuite] Seed complete. Beginning critical endpoint measurements...\n');

    const { tokens, credentials, branches, inventoryItems, fulfillmentItem, customers } = manifest;
    const testBranchId = branches[0]._id.toString();
    const testProductId = fulfillmentItem
      ? fulfillmentItem._id.toString()
      : inventoryItems[0]._id.toString();
    const testCustomerId = customers[0]._id.toString();

    // 1. Health Endpoint (Baseline latency without DB)
    console.log('⏱️  [1/13] Benchmarking Unauthenticated Health Baseline...');
    const healthResult = await runBenchmark({
      app,
      name: 'Health Baseline (No DB)',
      method: 'GET',
      path: '/api/health',
      iterations: 30,
      concurrency: 5,
      expectedStatus: 200,
    });
    benchmarkReports.push(healthResult);

    // 2. Authentication Endpoint (AC6 - Bcrypt computation overhead)
    console.log('⏱️  [2/13] Benchmarking Authentication Login (Bcrypt + JWT)...');
    const authResult = await runBenchmark({
      app,
      name: 'Auth: Customer Login',
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: credentials.customerEmail,
        password: credentials.password,
      },
      iterations: 20,
      concurrency: 5,
      expectedStatus: 200,
    });
    benchmarkReports.push(authResult);

    // 3. Authenticated Profile Overhead (AC6)
    console.log('⏱️  [3/13] Benchmarking Authenticated Profile Overhead...');
    const profileResult = await runBenchmark({
      app,
      name: 'Auth: Customer Profile Overhead',
      method: 'GET',
      path: '/api/profile/me',
      headers: { Authorization: `Bearer ${tokens.customer1Token}` },
      iterations: 30,
      concurrency: 5,
      expectedStatus: 200,
    });
    benchmarkReports.push(profileResult);

    // 4. Product Catalogue (AC7 - Default Listing)
    console.log('⏱️  [4/13] Benchmarking Product Catalogue (Default List)...');
    const catalogListResult = await runBenchmark({
      app,
      name: 'Catalog: Default Product List',
      method: 'GET',
      path: '/api/products',
      iterations: 30,
      concurrency: 10,
      expectedStatus: 200,
    });
    benchmarkReports.push(catalogListResult);

    // 5. Product Catalogue Filter (AC7 - Category Filter)
    console.log('⏱️  [5/13] Benchmarking Product Catalogue (Category Filter)...');
    const catalogCategoryResult = await runBenchmark({
      app,
      name: 'Catalog: Category Filter (Frames)',
      method: 'GET',
      path: '/api/products?category=Frames',
      iterations: 30,
      concurrency: 10,
      expectedStatus: 200,
    });
    benchmarkReports.push(catalogCategoryResult);

    // 6. Product Catalogue Search (AC7 - Text Query)
    console.log('⏱️  [6/13] Benchmarking Product Catalogue (Brand Search)...');
    const catalogSearchResult = await runBenchmark({
      app,
      name: 'Catalog: Text Search (Ray-Ban)',
      method: 'GET',
      path: '/api/products?search=Ray-Ban',
      iterations: 30,
      concurrency: 10,
      expectedStatus: 200,
    });
    benchmarkReports.push(catalogSearchResult);

    // 7. Product Details (AC7 - Single Document Lookup)
    console.log('⏱️  [7/13] Benchmarking Product Details by ID...');
    const productDetailResult = await runBenchmark({
      app,
      name: 'Catalog: Single Product Detail',
      method: 'GET',
      path: `/api/products/${testProductId}`,
      iterations: 30,
      concurrency: 10,
      expectedStatus: 200,
    });
    benchmarkReports.push(productDetailResult);

    // 8. Branch Inventory Retrieval (AC8)
    console.log('⏱️  [8/13] Benchmarking Branch Inventory Retrieval...');
    const branchInventoryResult = await runBenchmark({
      app,
      name: 'Inventory: Branch Stock List',
      method: 'GET',
      path: `/api/inventory/branch/${testBranchId}`,
      headers: { Authorization: `Bearer ${tokens.staffColomboToken}` },
      iterations: 25,
      concurrency: 5,
      expectedStatus: 200,
    });
    benchmarkReports.push(branchInventoryResult);

    // 9. Customer Order History
    console.log('⏱️  [9/13] Benchmarking Customer Order History...');
    const orderHistoryResult = await runBenchmark({
      app,
      name: 'Orders: Customer Order History',
      method: 'GET',
      path: '/api/orders',
      headers: { Authorization: `Bearer ${tokens.customer1Token}` },
      iterations: 25,
      concurrency: 5,
      expectedStatus: 200,
    });
    benchmarkReports.push(orderHistoryResult);

    // 10. Available Doctor Sessions
    console.log('⏱️  [10/13] Benchmarking Doctor Session Availability...');
    const sessionAvailabilityResult = await runBenchmark({
      app,
      name: 'Appointments: Available Doctor Sessions',
      method: 'GET',
      path: '/api/doctor-sessions/available',
      headers: { Authorization: `Bearer ${tokens.customer1Token}` },
      iterations: 25,
      concurrency: 5,
      expectedStatus: 200,
    });
    benchmarkReports.push(sessionAvailabilityResult);

    // 11. Clinical Prescription History (Customer view)
    console.log('⏱️  [11/13] Benchmarking Clinical Prescription History (Customer)...');
    const prescriptionResult = await runBenchmark({
      app,
      name: 'Prescriptions: Customer Own History',
      method: 'GET',
      path: '/api/prescriptions/me',
      headers: { Authorization: `Bearer ${tokens.customer1Token}` },
      iterations: 25,
      concurrency: 5,
      expectedStatus: 200,
    });
    benchmarkReports.push(prescriptionResult);

    // 12. Clinical Prescription History (Optometrist clinical consultation query)
    console.log('⏱️  [12/13] Benchmarking Clinical Prescription History (Optometrist)...');
    const optometristRxResult = await runBenchmark({
      app,
      name: 'Prescriptions: Optometrist Consultation Lookup',
      method: 'GET',
      path: `/api/prescriptions/customer/${testCustomerId}`,
      headers: { Authorization: `Bearer ${tokens.optometristToken}` },
      iterations: 25,
      concurrency: 5,
      expectedStatus: 200,
    });
    benchmarkReports.push(optometristRxResult);

    // 13. Reporting Aggregations (AC8 - Multi-stage Pipeline)
    console.log('⏱️  [13/13] Benchmarking Sales Report Aggregation Pipeline...');
    const salesReportResult = await runBenchmark({
      app,
      name: 'Reports: Sales Summary Aggregation',
      method: 'GET',
      path: '/api/reports/sales?preset=last_30_days',
      headers: { Authorization: `Bearer ${tokens.adminToken}` },
      iterations: 15,
      concurrency: 5,
      expectedStatus: 200,
    });
    benchmarkReports.push(salesReportResult);

    // Display formatted summary table
    console.log(
      '\n===================================================================================================='
    );
    console.log(
      '                           OSMS BASELINE API PERFORMANCE BENCHMARK REPORT                            '
    );
    console.log(
      '===================================================================================================='
    );

    const tableData = benchmarkReports.map((r) => {
      const srsCompliant = r.latency.p95Ms <= 2000 && r.errorRatePercent < 1.0;
      return {
        Endpoint: r.name,
        Method: r.method,
        Reqs: r.totalRequests,
        Concurrency: r.concurrency,
        'Avg (ms)': r.latency.avgMs,
        'p50 (ms)': r.latency.p50Ms,
        'p95 (ms)': r.latency.p95Ms,
        'Max (ms)': r.latency.maxMs,
        'Throughput (req/s)': r.throughputReqSec,
        'Error Rate (%)': r.errorRatePercent,
        'SRS NFR-001': srsCompliant ? 'PASS' : 'FAIL',
      };
    });

    console.table(tableData);

    const fullEvidence = {
      generatedAt: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      totalBenchmarks: benchmarkReports.length,
      allCompliant: benchmarkReports.every(
        (r) => r.latency.p95Ms <= 2000 && r.errorRatePercent < 1.0
      ),
      benchmarks: benchmarkReports,
    };

    fs.writeFileSync(RESULTS_FILE, JSON.stringify(fullEvidence, null, 2), 'utf-8');
    console.log(`💾 Evidence successfully written to: ${RESULTS_FILE}\n`);

    return fullEvidence;
  } finally {
    console.log('[PerfSuite] Tearing down performance test environment...');
    await teardownPerfEnvironment();
    console.log('[PerfSuite] Environment cleanup complete.\n');
  }
}

if (require.main === module) {
  executeBaselineBenchmarks()
    .then((evidence) => {
      if (!evidence || !evidence.allCompliant) {
        console.error(
          '\n❌ Baseline benchmarks failed: One or more endpoints violated NFR-001 (p95 <= 2000ms or errorRate > 0).'
        );
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('❌ Benchmark execution failed:', err);
      process.exit(1);
    });
}

module.exports = { executeBaselineBenchmarks };
