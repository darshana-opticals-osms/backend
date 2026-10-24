/**
 * High-Precision API Performance Benchmarking Engine (AC5)
 *
 * Dispatches requests with configurable concurrency, records sub-millisecond
 * latency metrics with process.hrtime.bigint(), and calculates statistical percentiles.
 */

const request = require('supertest');

/**
 * Calculates a statistical percentile from a sorted array of numbers.
 * @param {number[]} sortedValues
 * @param {number} percentile (0 - 100)
 * @returns {number}
 */
function calculatePercentile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return Number(sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))].toFixed(2));
}

/**
 * Executes a benchmark against an Express application.
 *
 * @param {Object} options
 * @param {Express.Application} options.app - Target Express application
 * @param {string} options.name - Benchmark name
 * @param {string} options.method - HTTP Method ('GET', 'POST', etc.)
 * @param {string} options.path - Request URL path
 * @param {Object} [options.headers={}] - HTTP headers (e.g. Authorization)
 * @param {Object} [options.body=null] - Request body for POST/PUT
 * @param {number} [options.iterations=50] - Total requests to send
 * @param {number} [options.concurrency=10] - Number of parallel workers
 * @param {number} [options.expectedStatus=200] - Expected HTTP status code
 * @returns {Promise<Object>} Benchmark metrics summary
 */
async function runBenchmark({
  app,
  name,
  method = 'GET',
  path,
  headers = {},
  body = null,
  iterations = 50,
  concurrency = 10,
  expectedStatus = 200,
}) {
  const durations = [];
  const statusCodes = {};
  let failureCount = 0;

  let completed = 0;
  let inFlight = 0;
  let nextIndex = 0;

  const suiteStartTime = process.hrtime.bigint();

  async function executeOne() {
    const start = process.hrtime.bigint();
    try {
      let req = request(app)[method.toLowerCase()](path);

      for (const [headerKey, headerVal] of Object.entries(headers)) {
        req = req.set(headerKey, headerVal);
      }

      if (body) {
        req = req.send(body);
      }

      const res = await req;
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1e6; // Convert nanoseconds to milliseconds

      durations.push(durationMs);
      statusCodes[res.status] = (statusCodes[res.status] || 0) + 1;

      if (expectedStatus && res.status !== expectedStatus) {
        failureCount++;
      }
    } catch {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1e6;
      durations.push(durationMs);
      failureCount++;
      statusCodes['ERROR'] = (statusCodes['ERROR'] || 0) + 1;
    }
  }

  // Controlled concurrency pool execution
  await new Promise((resolve) => {
    function launchWorkers() {
      while (inFlight < concurrency && nextIndex < iterations) {
        inFlight++;
        nextIndex++;
        executeOne().finally(() => {
          inFlight--;
          completed++;
          if (completed === iterations) {
            resolve();
          } else {
            launchWorkers();
          }
        });
      }
    }
    launchWorkers();
  });

  const suiteEndTime = process.hrtime.bigint();
  const totalDurationMs = Number(suiteEndTime - suiteStartTime) / 1e6;

  durations.sort((a, b) => a - b);

  const total = durations.length;
  const sum = durations.reduce((acc, val) => acc + val, 0);
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

  return {
    name,
    method,
    path,
    totalRequests: total,
    concurrency,
    totalDurationMs: Number(totalDurationMs.toFixed(2)),
    throughputReqSec,
    errorRatePercent,
    failureCount,
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
    memory: {
      heapUsedMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)),
      rssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
    },
  };
}

module.exports = {
  runBenchmark,
  calculatePercentile,
};
