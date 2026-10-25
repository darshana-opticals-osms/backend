/**
 * Fictional User Seed Data (AC3, AC4, AC7, AC8)
 *
 * All user names, emails, addresses, and phone numbers are completely fictional.
 * Passwords are dynamically hashed during seeding using central authentication hashing configuration (AC7).
 */

const { ROLE_VALUES } = require('../../constants/roles');

const DEV_DEFAULT_PASSWORD = 'DevPassword123!';

// Verified team-controlled Gmail address (ADR-010 / Chatbot store email).
// Developers may override this base in .env using DEV_SEED_EMAIL_BASE if testing with their own inbox.
const DEV_SEED_BASE_EMAIL = (process.env.DEV_SEED_EMAIL_BASE || 'darshanaoptic@gmail.com').trim();

/**
 * Builds a verified team Gmail address with a plus-address alias for test identity segregation.
 * Complies with development notification safety: notifications and password reset links
 * are strictly delivered to the team-controlled inbox, avoiding unverified external recipients.
 *
 * @param {string} alias - Test identity identifier (e.g. 'admin.dev', 'sales.gampaha')
 * @returns {string} Plus-addressed email
 */
function createSeedEmail(alias) {
  const atIndex = DEV_SEED_BASE_EMAIL.indexOf('@');
  if (atIndex === -1) {
    return `${DEV_SEED_BASE_EMAIL}+${alias}@gmail.com`;
  }
  const user = DEV_SEED_BASE_EMAIL.slice(0, atIndex);
  const domain = DEV_SEED_BASE_EMAIL.slice(atIndex + 1);
  return `${user}+${alias}@${domain}`;
}

const SEED_ADMINS = [
  {
    name: 'Dev Admin',
    email: createSeedEmail('admin.dev'),
    phone: '+94 77 100 0001',
    role: ROLE_VALUES.SYSTEM_ADMIN,
    legacyEmails: ['admin.dev@darshanaopticals.local', 'admin.dev@gmail.com'],
  },
];

const SEED_STAFF = [
  {
    branchCodeName: 'COLOMBO_MAIN',
    name: 'Colombo Branch Manager',
    email: createSeedEmail('manager.colombo'),
    phone: '+94 77 100 0002',
    address: '100 Galle Road, Colombo 03',
    role: ROLE_VALUES.BRANCH_MANAGER,
    legacyEmails: ['manager.colombo@darshanaopticals.local', 'manager.colombo@gmail.com'],
  },
  {
    branchCodeName: 'KANDY_CITY',
    name: 'Kandy Optometrist',
    email: createSeedEmail('optometrist.kandy'),
    phone: '+94 77 100 0004',
    address: '45 Peradeniya Road, Kandy',
    role: ROLE_VALUES.OPTOMETRIST,
    legacyEmails: ['optometrist.kandy@darshanaopticals.local', 'optometrist.kandy@gmail.com'],
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    name: 'Gampaha Branch Assistant',
    email: createSeedEmail('sales.gampaha'),
    phone: '+94 77 100 0005',
    address: '12 Main Street, Gampaha',
    role: ROLE_VALUES.BRANCH_ASSISTANT,
    legacyEmails: ['sales.gampaha@darshanaopticals.local', 'sales.gampaha@gmail.com'],
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    name: 'Gampaha Optometrist',
    email: createSeedEmail('optometrist.gampaha'),
    phone: '+94 77 100 0006',
    address: '12 Main Street, Gampaha',
    role: ROLE_VALUES.OPTOMETRIST,
    legacyEmails: ['optometrist.gampaha@darshanaopticals.local', 'optometrist.gampaha@gmail.com'],
  },
  {
    branchCodeName: 'GAMPAHA_CENTRAL',
    name: 'Gampaha Branch Manager',
    email: createSeedEmail('manager.gampaha'),
    phone: '+94 77 100 0007',
    address: '12 Main Street, Gampaha',
    role: ROLE_VALUES.BRANCH_MANAGER,
    legacyEmails: ['manager.gampaha@darshanaopticals.local', 'manager.gampaha@gmail.com'],
  },
];

const SEED_CUSTOMERS = [
  {
    name: 'Kamal Perera',
    email: createSeedEmail('kamal.customer'),
    phone: '+94 71 200 0001',
    address: '15 Station Road, Nugegoda',
    role: ROLE_VALUES.CUSTOMER,
    legacyEmails: ['kamal.customer@example.com', 'kamal.customer@gmail.com'],
  },
  {
    name: 'Alice Silva',
    email: createSeedEmail('alice.customer'),
    phone: '+94 71 200 0002',
    address: '88 Temple Road, Kandy',
    role: ROLE_VALUES.CUSTOMER,
    legacyEmails: ['alice.customer@example.com', 'alice.customer@gmail.com'],
  },
  {
    name: 'Nimal Fernando',
    email: createSeedEmail('nimal.customer'),
    phone: '+94 71 200 0003',
    address: '42 Beach Road, Negombo',
    role: ROLE_VALUES.CUSTOMER,
    legacyEmails: ['nimal.customer@example.com', 'nimal.customer@gmail.com'],
  },
];

module.exports = {
  DEV_DEFAULT_PASSWORD,
  DEV_SEED_BASE_EMAIL,
  createSeedEmail,
  SEED_ADMINS,
  SEED_STAFF,
  SEED_CUSTOMERS,
};
