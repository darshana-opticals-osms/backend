/**
 * Fictional User Seed Data (AC3, AC4, AC7, AC8)
 *
 * All user names, emails, addresses, and phone numbers are completely fictional.
 * Passwords are dynamically hashed during seeding using central authentication hashing configuration (AC7).
 */

const { ROLE_VALUES } = require('../../constants/roles');

const DEV_DEFAULT_PASSWORD = 'DevPassword123!';

// System Admin uses a configurable development Gmail address (defaults to admin.dev@gmail.com).
// Admin accounts are excluded by policy from password reset issuance (Issue #83 AC2, AC6).
const DEV_ADMIN_EMAIL = (process.env.DEV_ADMIN_EMAIL || 'admin.dev@gmail.com').trim();

const SEED_ADMINS = [
  {
    name: 'Dev Admin',
    email: DEV_ADMIN_EMAIL,
    phone: '+94 77 100 0001',
    role: ROLE_VALUES.SYSTEM_ADMIN,
    legacyEmails: ['admin.dev@darshanaopticals.local', 'darshanaoptic+admin.dev@gmail.com'],
  },
];

const SEED_STAFF = [
  {
    branchCodeName: 'MAIN_BRANCH',
    name: 'Colombo Branch Manager',
    email: 'manager.colombo@darshanaopticals.local',
    phone: '+94 77 100 0002',
    address: '100 Galle Road, Colombo 03',
    role: ROLE_VALUES.BRANCH_MANAGER,
    legacyEmails: ['manager.colombo@gmail.com', 'darshanaoptic+manager.colombo@gmail.com'],
  },
  {
    branchCodeName: 'VEYANGODA_BRANCH',
    name: 'Kandy Optometrist',
    email: 'optometrist.kandy@darshanaopticals.local',
    phone: '+94 77 100 0004',
    address: '45 Peradeniya Road, Kandy',
    role: ROLE_VALUES.OPTOMETRIST,
    legacyEmails: ['optometrist.kandy@gmail.com', 'darshanaoptic+optometrist.kandy@gmail.com'],
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    name: 'Gampaha Branch Assistant',
    email: 'sales.gampaha@darshanaopticals.local',
    phone: '+94 77 100 0005',
    address: '12 Main Street, Gampaha',
    role: ROLE_VALUES.BRANCH_ASSISTANT,
    legacyEmails: ['sales.gampaha@gmail.com', 'darshanaoptic+sales.gampaha@gmail.com'],
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    name: 'Gampaha Optometrist',
    email: 'optometrist.gampaha@darshanaopticals.local',
    phone: '+94 77 100 0006',
    address: '12 Main Street, Gampaha',
    role: ROLE_VALUES.OPTOMETRIST,
    legacyEmails: ['optometrist.gampaha@gmail.com', 'darshanaoptic+optometrist.gampaha@gmail.com'],
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    name: 'Gampaha Branch Manager',
    email: 'manager.gampaha@darshanaopticals.local',
    phone: '+94 77 100 0007',
    address: '12 Main Street, Gampaha',
    role: ROLE_VALUES.BRANCH_MANAGER,
    legacyEmails: ['manager.gampaha@gmail.com', 'darshanaoptic+manager.gampaha@gmail.com'],
  },
];

const SEED_CUSTOMERS = [
  {
    name: 'Kamal Perera',
    email: 'kamal.customer@example.com',
    phone: '+94 71 200 0001',
    address: '15 Station Road, Nugegoda',
    role: ROLE_VALUES.CUSTOMER,
    legacyEmails: ['kamal.customer@gmail.com', 'darshanaoptic+kamal.customer@gmail.com'],
  },
  {
    name: 'Alice Silva',
    email: 'alice.customer@example.com',
    phone: '+94 71 200 0002',
    address: '88 Temple Road, Kandy',
    role: ROLE_VALUES.CUSTOMER,
    legacyEmails: ['alice.customer@gmail.com', 'darshanaoptic+alice.customer@gmail.com'],
  },
  {
    name: 'Nimal Fernando',
    email: 'nimal.customer@example.com',
    phone: '+94 71 200 0003',
    address: '42 Beach Road, Negombo',
    role: ROLE_VALUES.CUSTOMER,
    legacyEmails: ['nimal.customer@gmail.com', 'darshanaoptic+nimal.customer@gmail.com'],
  },
];

module.exports = {
  DEV_DEFAULT_PASSWORD,
  DEV_ADMIN_EMAIL,
  SEED_ADMINS,
  SEED_STAFF,
  SEED_CUSTOMERS,
};
