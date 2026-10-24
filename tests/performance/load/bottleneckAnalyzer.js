/**
 * Database Query Execution Plan & Index Bottleneck Analyzer (AC14, AC15)
 *
 * Runs MongoDB explain('executionStats') on critical application queries,
 * evaluates index usage (IXSCAN vs COLLSCAN), in-memory sort stages,
 * and docsExamined to docsReturned ratio.
 */

const fs = require('fs');
const path = require('path');
const { setupPerfEnvironment, teardownPerfEnvironment } = require('../setup/perfEnvironment');
const { seedPerformanceData } = require('../setup/seedData');
const Inventory = require('../../../src/models/inventory.model');
const Order = require('../../../src/models/order.model');
const Prescription = require('../../../src/models/prescription.model');
const Appointment = require('../../../src/models/appointment.model');
const Branch = require('../../../src/models/branch.model');

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const RESULTS_FILE = path.join(RESULTS_DIR, 'bottleneck-analysis-results.json');

/**
 * Extracts key execution metrics from a MongoDB executionStats plan.
 */
function extractPlanMetrics(explainResult) {
  const stats = explainResult.executionStats || {};
  const winningPlan = explainResult.queryPlanner?.winningPlan || {};

  function findStages(node, targetStages, collected = []) {
    if (!node) return collected;
    if (targetStages.includes(node.stage)) {
      collected.push(node.stage);
    }
    if (node.inputStage) {
      findStages(node.inputStage, targetStages, collected);
    }
    if (node.inputStages) {
      node.inputStages.forEach((s) => findStages(s, targetStages, collected));
    }
    return collected;
  }

  const allStages = findStages(winningPlan, ['COLLSCAN', 'IXSCAN', 'SORT', 'FETCH']);
  const isIndexed = allStages.includes('IXSCAN');
  const hasInMemorySort = allStages.includes('SORT');

  return {
    nReturned: stats.nReturned || 0,
    totalDocsExamined: stats.totalDocsExamined || 0,
    totalKeysExamined: stats.totalKeysExamined || 0,
    executionTimeMillis: stats.executionTimeMillis || 0,
    isIndexed,
    hasInMemorySort,
    primaryStage: winningPlan.stage,
    allStages,
  };
}

async function analyzeQueryBottlenecks() {
  console.log('🚀 Starting Database Query & Index Bottleneck Analysis (AC14, AC15)...\n');
  const { uri } = await setupPerfEnvironment();
  console.log(`[PerfSuite] Connected to: ${uri}`);

  const analysisReports = [];

  try {
    console.log('[PerfSuite] Seeding database for execution plan profiling...');
    const manifest = await seedPerformanceData();
    console.log('[PerfSuite] Dataset initialized. Profiling critical query execution plans...\n');

    const gampahaBranch = await Branch.findOne({ codeName: 'GAMPAHA_CENTRAL' });
    const testCustomerId = manifest.customers[0]._id;

    // Query 1: Product Catalogue Fulfillment Filtering & Sort
    console.log('🔍 [1/5] Profiling Product Catalog Active In-Stock Query...');
    const catalogExplain = await Inventory.find({
      branchId: gampahaBranch._id,
      quantity: { $gt: 0 },
    })
      .sort({ itemName: 1, _id: 1 })
      .explain('executionStats');

    const catalogMetrics = extractPlanMetrics(catalogExplain);
    analysisReports.push({
      query: 'Product Catalog: In-Stock Filter & Sort',
      collection: 'inventories',
      filter: '{ branchId, quantity: { $gt: 0 } }',
      sort: '{ itemName: 1, _id: 1 }',
      ...catalogMetrics,
    });

    // Query 2: Product Catalogue Category Filter
    console.log('🔍 [2/5] Profiling Product Category Filtering Query...');
    const categoryExplain = await Inventory.find({
      branchId: gampahaBranch._id,
      category: 'Frames',
      quantity: { $gt: 0 },
    })
      .sort({ itemName: 1, _id: 1 })
      .explain('executionStats');

    const categoryMetrics = extractPlanMetrics(categoryExplain);
    analysisReports.push({
      query: 'Product Catalog: Category Filter & Sort',
      collection: 'inventories',
      filter: "{ branchId, category: 'Frames', quantity: { $gt: 0 } }",
      sort: '{ itemName: 1, _id: 1 }',
      ...categoryMetrics,
    });

    // Query 3: Customer Order History Lookup
    console.log('🔍 [3/5] Profiling Customer Order History Query...');
    const orderExplain = await Order.find({ customerId: testCustomerId })
      .sort({ createdAt: -1 })
      .explain('executionStats');

    const orderMetrics = extractPlanMetrics(orderExplain);
    analysisReports.push({
      query: 'Customer Order History',
      collection: 'orders',
      filter: '{ customerId }',
      sort: '{ createdAt: -1 }',
      ...orderMetrics,
    });

    // Query 4: Customer Prescription History Lookup
    console.log('🔍 [4/5] Profiling Clinical Prescription History Query...');
    const rxExplain = await Prescription.find({ customerId: testCustomerId, isArchived: false })
      .sort({ recordedAt: -1 })
      .explain('executionStats');

    const rxMetrics = extractPlanMetrics(rxExplain);
    analysisReports.push({
      query: 'Clinical Prescription History',
      collection: 'prescriptions',
      filter: '{ customerId, isArchived: false }',
      sort: '{ recordedAt: -1 }',
      ...rxMetrics,
    });

    // Query 5: Customer Appointments Lookup
    console.log('🔍 [5/5] Profiling Customer Appointment Schedule Query...');
    const apptExplain = await Appointment.find({ customerId: testCustomerId })
      .sort({ dateTime: -1 })
      .explain('executionStats');

    const apptMetrics = extractPlanMetrics(apptExplain);
    analysisReports.push({
      query: 'Customer Appointment Schedule',
      collection: 'appointments',
      filter: '{ customerId }',
      sort: '{ dateTime: -1 }',
      ...apptMetrics,
    });

    // Display formatted table
    console.log(
      '\n========================================================================================================'
    );
    console.log(
      '                        MONGODB QUERY EXECUTION PLAN BOTTLENECK REPORT                                  '
    );
    console.log(
      '========================================================================================================'
    );

    const tableData = analysisReports.map((r) => {
      let assessment = 'OPTIMAL';
      if (r.allStages.includes('COLLSCAN')) {
        assessment = 'BOTTLENECK: COLLSCAN';
      } else if (r.hasInMemorySort) {
        assessment = 'OPPORTUNITY: In-Memory Sort';
      }

      return {
        Query: r.query,
        Collection: r.collection,
        Indexed: r.isIndexed ? 'YES (IXSCAN)' : 'NO (COLLSCAN)',
        'In-Memory Sort': r.hasInMemorySort ? 'YES (Unindexed Sort)' : 'NO (Index-Covered)',
        'Docs Examined': r.totalDocsExamined,
        'Docs Returned': r.nReturned,
        'Time (ms)': r.executionTimeMillis,
        Assessment: assessment,
      };
    });

    console.table(tableData);

    const fullEvidence = {
      analyzedAt: new Date().toISOString(),
      reports: analysisReports,
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
  analyzeQueryBottlenecks().catch((err) => {
    console.error('❌ Bottleneck analysis failed:', err);
    process.exit(1);
  });
}

module.exports = { analyzeQueryBottlenecks };
