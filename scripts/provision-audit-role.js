/**
 * MongoDB Database-Level Role Provisioning Script (ADR-012 §10.1 / DDP-066)
 *
 * Enforces database-level append-only access controls on the `auditevents` collection:
 * - Grants: `insert`, `find`
 * - Denies / Excludes: `update`, `remove`, `dropCollection`, `dropDatabase`
 *
 * This satisfies Layer 3 of the ADR-012 Multi-Layer Immutability Architecture.
 *
 * Usage:
 *   node scripts/provision-audit-role.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/darshana_opticals';
const ROLE_NAME = 'auditAppendOnly';
const COLLECTION_NAME = 'auditevents';

async function provisionAuditRole() {
  console.log(`Connecting to MongoDB to provision role: ${ROLE_NAME}...`);

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  try {
    // Check if role already exists
    const roleInfo = await db.command({ rolesInfo: ROLE_NAME, showPrivileges: true });

    if (roleInfo.roles && roleInfo.roles.length > 0) {
      console.log(`Role "${ROLE_NAME}" already exists. Updating privileges...`);
      await db.command({
        updateRole: ROLE_NAME,
        privileges: [
          {
            resource: { db: db.databaseName, collection: COLLECTION_NAME },
            actions: ['insert', 'find'],
          },
        ],
        roles: [],
      });
      console.log(`Role "${ROLE_NAME}" updated successfully.`);
    } else {
      console.log(`Creating custom append-only role "${ROLE_NAME}"...`);
      await db.command({
        createRole: ROLE_NAME,
        privileges: [
          {
            resource: { db: db.databaseName, collection: COLLECTION_NAME },
            actions: ['insert', 'find'],
          },
        ],
        roles: [],
      });
      console.log(`Role "${ROLE_NAME}" created successfully.`);
    }

    console.log(`
================================================================================
Database-Level Append-Only Audit Role Provisioned (ADR-012 §10.1)
Database:   ${db.databaseName}
Collection: ${COLLECTION_NAME}
Privileges: insert, find (Strictly Append-Only; update & remove prohibited)
================================================================================
`);
  } catch (error) {
    console.error('Failed to provision database role:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  provisionAuditRole();
}

module.exports = {
  provisionAuditRole,
  ROLE_NAME,
  COLLECTION_NAME,
};
