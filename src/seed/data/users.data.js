/**
 * Fictional User Seed Data (AC3, AC4, AC7, AC8)
 *
 * All user names, emails, addresses, and phone numbers are completely fictional.
 * Passwords use pre-computed bcrypt salt rounds = 12 hashes (AC7).
 */

const { ROLE_VALUES } = require('../../constants/roles');

const DEV_DEFAULT_PASSWORD = 'DevPassword123!';

// Pre-computed bcrypt hash (rounds=12) for 'DevPassword123!'
const DEV_DEFAULT_PASSWORD_HASH = '$2b$12$qiMDexcrpG3TrGQgG.iK6OvLA40.VeDU8dnhdWInQoI8xUQVxHrwS';

const SEED_ADMINS = [
  {
    name: 'Dev Admin',
    email: 'admin.dev@darshanaopticals.local',
    phone: '+94 77 100 0001',
    role: ROLE_VALUES.SYSTEM_ADMIN,
    passwordHash: DEV_DEFAULT_PASSWORD_HASH,
  },
];

const SEED_STAFF = [
  {
    branchCodeName: 'COLOMBO_MAIN',
    name: 'Colombo Branch Manager',
    email: 'manager.colombo@darshanaopticals.local',
    phone: '+94 77 100 0002',
    address: '100 Galle Road, Colombo 03',
    role: ROLE_VALUES.BRANCH_MANAGER,
    passwordHash: DEV_DEFAULT_PASSWORD_HASH,
  },
  {
    branchCodeName: 'COLOMBO_MAIN',
    name: 'Colombo Inventory Manager',
    email: 'inventory.colombo@darshanaopticals.local',
    phone: '+94 77 100 0003',
    address: '100 Galle Road, Colombo 03',
    role: ROLE_VALUES.INVENTORY_MANAGER,
    passwordHash: DEV_DEFAULT_PASSWORD_HASH,
  },
  {
    branchCodeName: 'KANDY_CITY',
    name: 'Kandy Optometrist',
    email: 'optometrist.kandy@darshanaopticals.local',
    phone: '+94 77 100 0004',
    address: '45 Peradeniya Road, Kandy',
    role: ROLE_VALUES.OPTOMETRIST,
    passwordHash: DEV_DEFAULT_PASSWORD_HASH,
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    name: 'Gampaha Cashier',
    email: 'sales.gampaha@darshanaopticals.local',
    phone: '+94 77 100 0005',
    address: '12 Main Street, Gampaha',
    role: ROLE_VALUES.SALES_ASSISTANT_CASHIER,
    passwordHash: DEV_DEFAULT_PASSWORD_HASH,
  },
];

const SEED_CUSTOMERS = [
  {
    name: 'Kamal Perera',
    email: 'kamal.customer@example.com',
    phone: '+94 71 200 0001',
    address: '15 Station Road, Nugegoda',
    role: ROLE_VALUES.CUSTOMER,
    passwordHash: DEV_DEFAULT_PASSWORD_HASH,
  },
  {
    name: 'Alice Silva',
    email: 'alice.customer@example.com',
    phone: '+94 71 200 0002',
    address: '88 Temple Road, Kandy',
    role: ROLE_VALUES.CUSTOMER,
    passwordHash: DEV_DEFAULT_PASSWORD_HASH,
  },
  {
    name: 'Nimal Fernando',
    email: 'nimal.customer@example.com',
    phone: '+94 71 200 0003',
    address: '42 Beach Road, Negombo',
    role: ROLE_VALUES.CUSTOMER,
    passwordHash: DEV_DEFAULT_PASSWORD_HASH,
  },
];

module.exports = {
  DEV_DEFAULT_PASSWORD,
  DEV_DEFAULT_PASSWORD_HASH,
  SEED_ADMINS,
  SEED_STAFF,
  SEED_CUSTOMERS,
};
