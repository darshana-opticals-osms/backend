require('dotenv').config();
const { disconnectDatabase } = require('../config/database');
const { seedDatabase } = require('./seed');
const { DEV_DEFAULT_PASSWORD } = require('./data/users.data');

async function runCliSeed() {
  const isReset = process.argv.includes('--reset');

  console.log('🌱 OSMS Seed Mechanism Starting...');
  if (isReset) {
    console.log('🧹 Mode: RESET & SEED');
  } else {
    console.log('🔄 Mode: REPEATABLE SEED (Upsert)');
  }

  try {
    const summary = await seedDatabase({ reset: isReset });

    console.log('\n✅ Seed Execution Complete!');
    console.log('-------------------------------------------');
    console.log(
      `- Branches Created:  ${summary.branchesCreated} (Total in DB: ${summary.totalBranches})`
    );
    console.log(
      `- Admins Created:    ${summary.adminsCreated} (Total in DB: ${summary.totalAdmins})`
    );
    console.log(
      `- Staff Created:     ${summary.staffCreated} (Total in DB: ${summary.totalStaff})`
    );
    console.log(
      `- Customers Created: ${summary.customersCreated} (Total in DB: ${summary.totalCustomers})`
    );
    console.log(
      `- Inventory Created: ${summary.inventoryCreated} (Total in DB: ${summary.totalInventory})`
    );
    console.log('-------------------------------------------');
    console.log(`🔑 Development Password for seeded accounts: ${DEV_DEFAULT_PASSWORD}\n`);

    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seed Operation Failed:', error.message);
    await disconnectDatabase().catch(() => undefined);
    process.exit(1);
  }
}

if (require.main === module) {
  runCliSeed();
}

module.exports = { runCliSeed };
