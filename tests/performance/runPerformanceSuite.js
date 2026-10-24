/**
 * Master Performance Test Suite Runner
 *
 * Sequentially executes:
 * 1. Seed verification (verifySeed)
 * 2. Endpoint baseline latency benchmarks (baselineBenchmarks)
 * 3. Atomic concurrency & resilience suites (runConcurrencySuite)
 * 4. Controlled multi-stage load test (controlledLoadTest)
 * 5. MongoDB query execution plan profiler (bottleneckAnalyzer)
 *
 * Ensures all performance evidence is up-to-date and exits with code 0 on full success.
 */

const { spawn } = require('child_process');
const path = require('path');

const SUITE_STEPS = [
  {
    name: '1. Seed Data Integrity Verification',
    script: path.join(__dirname, 'setup', 'verifySeed.js'),
  },
  {
    name: '2. Baseline Latency Benchmarking (13 Endpoints)',
    script: path.join(__dirname, 'benchmarks', 'baselineBenchmarks.js'),
  },
  {
    name: '3. Concurrency & Resilience Validation',
    script: path.join(__dirname, 'concurrency', 'runConcurrencySuite.js'),
  },
  {
    name: '4. Controlled Load & Saturation Testing',
    script: path.join(__dirname, 'load', 'controlledLoadTest.js'),
  },
  {
    name: '5. Query Plan Bottleneck Profiling',
    script: path.join(__dirname, 'load', 'bottleneckAnalyzer.js'),
  },
];

function runStep(step) {
  return new Promise((resolve, reject) => {
    console.log(`\n======================================================`);
    console.log(`[MASTER RUNNER] Executing: ${step.name}`);
    console.log(`======================================================\n`);

    const child = spawn(process.execPath, [step.script], {
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Step failed with exit code ${code}: ${step.name}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function runAll() {
  const startTime = Date.now();
  console.log(`======================================================`);
  console.log(`   DARSHANA OPTICALS OSMS - PERFORMANCE TEST SUITE   `);
  console.log(`======================================================`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Total Steps: ${SUITE_STEPS.length}\n`);

  for (const step of SUITE_STEPS) {
    try {
      await runStep(step);
    } catch (err) {
      console.error(`\n[MASTER RUNNER ERROR] ${err.message}`);
      process.exit(1);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n======================================================`);
  console.log(`   ALL PERFORMANCE TESTS COMPLETED SUCCESSFULLY!     `);
  console.log(`======================================================`);
  console.log(`Total Runtime: ${durationSec}s`);
  console.log(`Results generated under: tests/performance/results/`);
  console.log(`======================================================\n`);
}

if (require.main === module) {
  runAll().catch((err) => {
    console.error('Fatal master suite execution error:', err);
    process.exit(1);
  });
}

module.exports = { runAll };
