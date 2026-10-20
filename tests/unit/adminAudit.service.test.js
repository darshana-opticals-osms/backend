jest.mock('../../src/services/audit.service', () => ({
  record: jest.fn().mockResolvedValue({ eventId: 'mock-event-id' }),
}));

const auditService = require('../../src/services/audit.service');
const {
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  AUDIT_TARGET_TYPE,
  AUDIT_OUTCOME,
} = require('../../src/constants/audit');
const { ROLE_VALUES } = require('../../src/constants/roles');
const {
  recordStaffRoleChange,
  recordStaffBranchReassigned,
  recordStaffStatusToggled,
  recordStaffProfileUpdated,
  recordDoctorUpdated,
  recordDoctorStatusToggled,
} = require('../../src/services/adminAudit.service');

describe('adminAudit.service unit tests (ADR-012, AC14)', () => {
  const mockAdmin = {
    userId: '507f1f77bcf86cd799439011',
    role: ROLE_VALUES.SYSTEM_ADMIN,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records staff role change event', async () => {
    await recordStaffRoleChange({
      adminUser: mockAdmin,
      staffId: '507f1f77bcf86cd799439022',
      oldRole: ROLE_VALUES.BRANCH_ASSISTANT,
      newRole: ROLE_VALUES.BRANCH_MANAGER,
    });

    expect(auditService.record).toHaveBeenCalledWith({
      action: AUDIT_ACTION.USER_ROLE_PERMISSIONS_MODIFIED,
      actor: {
        actorType: AUDIT_ACTOR_TYPE.USER,
        actorId: mockAdmin.userId,
        actorRole: ROLE_VALUES.SYSTEM_ADMIN,
      },
      target: {
        targetType: AUDIT_TARGET_TYPE.USER,
        targetId: '507f1f77bcf86cd799439022',
      },
      outcome: AUDIT_OUTCOME.SUCCESS,
      metadata: {
        field: 'role',
        previousRole: ROLE_VALUES.BRANCH_ASSISTANT,
        newRole: ROLE_VALUES.BRANCH_MANAGER,
      },
    });
  });

  it('records staff branch reassignment event', async () => {
    await recordStaffBranchReassigned({
      adminUser: mockAdmin,
      staffId: '507f1f77bcf86cd799439022',
      oldBranchId: '507f1f77bcf86cd799439033',
      newBranchId: '507f1f77bcf86cd799439044',
    });

    expect(auditService.record).toHaveBeenCalledWith({
      action: AUDIT_ACTION.STAFF_BRANCH_REASSIGNED,
      actor: {
        actorType: AUDIT_ACTOR_TYPE.USER,
        actorId: mockAdmin.userId,
        actorRole: ROLE_VALUES.SYSTEM_ADMIN,
      },
      target: {
        targetType: AUDIT_TARGET_TYPE.USER,
        targetId: '507f1f77bcf86cd799439022',
      },
      outcome: AUDIT_OUTCOME.SUCCESS,
      metadata: {
        field: 'branchId',
        previousBranchId: '507f1f77bcf86cd799439033',
        newBranchId: '507f1f77bcf86cd799439044',
      },
    });
  });

  it('records staff status toggle event', async () => {
    await recordStaffStatusToggled({
      adminUser: mockAdmin,
      staffId: '507f1f77bcf86cd799439022',
      oldStatus: true,
      newStatus: false,
    });

    expect(auditService.record).toHaveBeenCalledWith({
      action: AUDIT_ACTION.USER_ACCOUNT_STATUS_TOGGLED,
      actor: {
        actorType: AUDIT_ACTOR_TYPE.USER,
        actorId: mockAdmin.userId,
        actorRole: ROLE_VALUES.SYSTEM_ADMIN,
      },
      target: {
        targetType: AUDIT_TARGET_TYPE.USER,
        targetId: '507f1f77bcf86cd799439022',
      },
      outcome: AUDIT_OUTCOME.SUCCESS,
      metadata: {
        field: 'isActive',
        previousStatus: true,
        newStatus: false,
      },
    });
  });

  it('records staff profile updated and strips sensitive fields', async () => {
    await recordStaffProfileUpdated({
      adminUser: mockAdmin,
      staffId: '507f1f77bcf86cd799439022',
      updatedFields: {
        name: 'New Name',
        phone: '0771234567',
        password: 'password123',
        passwordHash: 'hash',
        role: 'OPTOMETRIST',
      },
    });

    expect(auditService.record).toHaveBeenCalledWith({
      action: AUDIT_ACTION.STAFF_PROFILE_UPDATED,
      actor: {
        actorType: AUDIT_ACTOR_TYPE.USER,
        actorId: mockAdmin.userId,
        actorRole: ROLE_VALUES.SYSTEM_ADMIN,
      },
      target: {
        targetType: AUDIT_TARGET_TYPE.USER,
        targetId: '507f1f77bcf86cd799439022',
      },
      outcome: AUDIT_OUTCOME.SUCCESS,
      metadata: {
        updatedFields: ['name', 'phone'],
      },
    });
  });

  it('records doctor updated event', async () => {
    await recordDoctorUpdated({
      adminUser: mockAdmin,
      doctorId: '507f1f77bcf86cd799439055',
      updatedFields: {
        name: 'Dr. New Name',
        specialization: 'Glaucoma',
      },
    });

    expect(auditService.record).toHaveBeenCalledWith({
      action: AUDIT_ACTION.DOCTOR_RECORD_UPDATED,
      actor: {
        actorType: AUDIT_ACTOR_TYPE.USER,
        actorId: mockAdmin.userId,
        actorRole: ROLE_VALUES.SYSTEM_ADMIN,
      },
      target: {
        targetType: AUDIT_TARGET_TYPE.DOCTOR,
        targetId: '507f1f77bcf86cd799439055',
      },
      outcome: AUDIT_OUTCOME.SUCCESS,
      metadata: {
        updatedFields: ['name', 'specialization'],
      },
    });
  });

  it('records doctor status toggled event', async () => {
    await recordDoctorStatusToggled({
      adminUser: mockAdmin,
      doctorId: '507f1f77bcf86cd799439055',
      oldStatus: true,
      newStatus: false,
    });

    expect(auditService.record).toHaveBeenCalledWith({
      action: AUDIT_ACTION.DOCTOR_STATUS_TOGGLED,
      actor: {
        actorType: AUDIT_ACTOR_TYPE.USER,
        actorId: mockAdmin.userId,
        actorRole: ROLE_VALUES.SYSTEM_ADMIN,
      },
      target: {
        targetType: AUDIT_TARGET_TYPE.DOCTOR,
        targetId: '507f1f77bcf86cd799439055',
      },
      outcome: AUDIT_OUTCOME.SUCCESS,
      metadata: {
        field: 'isActive',
        previousStatus: true,
        newStatus: false,
      },
    });
  });
});
