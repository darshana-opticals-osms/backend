/**
 * Fictional User Seed Data (AC3, AC4, AC7, AC8)
 *
 * All user names, emails, addresses, and phone numbers are completely fictional.
 * Passwords are dynamically hashed during seeding using central authentication hashing configuration (AC7).
 */

const { ROLE_VALUES } = require('../../constants/roles');

const DEV_DEFAULT_PASSWORD = 'DevPassword123!';

const SEED_ADMINS = [
  {
    name: 'Dev Admin',
    email: 'admin.dev@gmail.com',
    phone: '+94 77 100 0001',
    role: ROLE_VALUES.SYSTEM_ADMIN,
  },
];

const SEED_STAFF = [
  {
    branchCodeName: 'COLOMBO_MAIN',
    name: 'Colombo Branch Manager',
    email: 'manager.colombo@gmail.com',
    phone: '+94 77 100 0002',
    address: '100 Galle Road, Colombo 03',
    role: ROLE_VALUES.BRANCH_MANAGER,
  },
  {
    branchCodeName: 'KANDY_CITY',
    name: 'Kandy Optometrist',
    email: 'optometrist.kandy@gmail.com',
    phone: '+94 77 100 0004',
    address: '45 Peradeniya Road, Kandy',
    role: ROLE_VALUES.OPTOMETRIST,
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    name: 'Gampaha Branch Assistant',
    email: 'sales.gampaha@gmail.com',
    phone: '+94 77 100 0005',
    address: '12 Main Street, Gampaha',
    role: ROLE_VALUES.BRANCH_ASSISTANT,
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    name: 'Gampaha Optometrist',
    email: 'optometrist.gampaha@gmail.com',
    phone: '+94 77 100 0006',
    address: '12 Main Street, Gampaha',
    role: ROLE_VALUES.OPTOMETRIST,
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    name: 'Gampaha Branch Manager',
    email: 'manager.gampaha@gmail.com',
    phone: '+94 77 100 0007',
    address: '12 Main Street, Gampaha',
    role: ROLE_VALUES.BRANCH_MANAGER,
  },
];

const SEED_CUSTOMERS = [
  {
    name: 'Kamal Perera',
    email: 'kamal.customer@gmail.com',
    phone: '+94 71 200 0001',
    address: '15 Station Road, Nugegoda',
    role: ROLE_VALUES.CUSTOMER,
  },
  {
    name: 'Alice Silva',
    email: 'alice.customer@gmail.com',
    phone: '+94 71 200 0002',
    address: '88 Temple Road, Kandy',
    role: ROLE_VALUES.CUSTOMER,
  },
  {
    name: 'Nimal Fernando',
    email: 'nimal.customer@gmail.com',
    phone: '+94 71 200 0003',
    address: '42 Beach Road, Negombo',
    role: ROLE_VALUES.CUSTOMER,
  },
];

module.exports = {
  DEV_DEFAULT_PASSWORD,
  SEED_ADMINS,
  SEED_STAFF,
  SEED_CUSTOMERS,
};
