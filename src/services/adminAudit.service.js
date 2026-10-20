const auditService = require('./audit.service');
const {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_TARGET_TYPE,
  AUDIT_OUTCOME,
} = require('../constants/audit');

const buildAdminActor = (adminUser) => ({
  actorType: AUDIT_ACTOR_TYPE.USER,
  actorId: String(adminUser.userId || adminUser.id),
  actorRole: String(adminUser.role),
});

/**
 * Records an immutable audit event for staff role modification (AC14, ADR-012).
 */
const recordStaffRoleChange = async ({ adminUser, staffId, oldRole, newRole }) => {
  return auditService.record({
    action: AUDIT_ACTION.USER_ROLE_PERMISSIONS_MODIFIED,
    actor: buildAdminActor(adminUser),
    target: {
      targetType: AUDIT_TARGET_TYPE.USER,
      targetId: String(staffId),
    },
    outcome: AUDIT_OUTCOME.SUCCESS,
    metadata: {
      field: 'role',
      previousRole: oldRole,
      newRole,
    },
  });
};

/**
 * Records an immutable audit event for staff branch reassignment (AC14, ADR-012).
 */
const recordStaffBranchReassigned = async ({ adminUser, staffId, oldBranchId, newBranchId }) => {
  return auditService.record({
    action: AUDIT_ACTION.STAFF_BRANCH_REASSIGNED,
    actor: buildAdminActor(adminUser),
    target: {
      targetType: AUDIT_TARGET_TYPE.USER,
      targetId: String(staffId),
    },
    outcome: AUDIT_OUTCOME.SUCCESS,
    metadata: {
      field: 'branchId',
      previousBranchId: oldBranchId ? String(oldBranchId) : null,
      newBranchId: newBranchId ? String(newBranchId) : null,
    },
  });
};

/**
 * Records an immutable audit event for staff account activation or deactivation (AC14, ADR-012).
 */
const recordStaffStatusToggled = async ({ adminUser, staffId, oldStatus, newStatus }) => {
  return auditService.record({
    action: AUDIT_ACTION.USER_ACCOUNT_STATUS_TOGGLED,
    actor: buildAdminActor(adminUser),
    target: {
      targetType: AUDIT_TARGET_TYPE.USER,
      targetId: String(staffId),
    },
    outcome: AUDIT_OUTCOME.SUCCESS,
    metadata: {
      field: 'isActive',
      previousStatus: Boolean(oldStatus),
      newStatus: Boolean(newStatus),
    },
  });
};

/**
 * Records an immutable audit event for staff profile updates (AC14, ADR-012).
 */
const recordStaffProfileUpdated = async ({ adminUser, staffId, updatedFields = {} }) => {
  // Strip any security sensitive or prohibited fields
  const safeFields = { ...updatedFields };
  delete safeFields.password;
  delete safeFields.passwordHash;
  delete safeFields.passwordResetTokenHash;
  delete safeFields.role;
  delete safeFields.branchId;

  return auditService.record({
    action: AUDIT_ACTION.STAFF_PROFILE_UPDATED,
    actor: buildAdminActor(adminUser),
    target: {
      targetType: AUDIT_TARGET_TYPE.USER,
      targetId: String(staffId),
    },
    outcome: AUDIT_OUTCOME.SUCCESS,
    metadata: {
      updatedFields: Object.keys(safeFields),
    },
  });
};

/**
 * Records an immutable audit event for doctor record updates (AC14, ADR-012).
 */
const recordDoctorUpdated = async ({ adminUser, doctorId, updatedFields = {} }) => {
  return auditService.record({
    action: AUDIT_ACTION.DOCTOR_RECORD_UPDATED,
    actor: buildAdminActor(adminUser),
    target: {
      targetType: AUDIT_TARGET_TYPE.DOCTOR,
      targetId: String(doctorId),
    },
    outcome: AUDIT_OUTCOME.SUCCESS,
    metadata: {
      updatedFields: Object.keys(updatedFields),
    },
  });
};

/**
 * Records an immutable audit event for doctor activation / deactivation (AC14, ADR-012).
 */
const recordDoctorStatusToggled = async ({ adminUser, doctorId, oldStatus, newStatus }) => {
  return auditService.record({
    action: AUDIT_ACTION.DOCTOR_STATUS_TOGGLED,
    actor: buildAdminActor(adminUser),
    target: {
      targetType: AUDIT_TARGET_TYPE.DOCTOR,
      targetId: String(doctorId),
    },
    outcome: AUDIT_OUTCOME.SUCCESS,
    metadata: {
      field: 'isActive',
      previousStatus: Boolean(oldStatus),
      newStatus: Boolean(newStatus),
    },
  });
};

module.exports = {
  recordStaffRoleChange,
  recordStaffBranchReassigned,
  recordStaffStatusToggled,
  recordStaffProfileUpdated,
  recordDoctorUpdated,
  recordDoctorStatusToggled,
};
