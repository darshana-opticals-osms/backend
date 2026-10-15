jest.mock('../../src/models/branch.model', () => ({ findOne: jest.fn() }));
jest.mock('../../src/models/staff.model', () => ({ findById: jest.fn(), updateOne: jest.fn() }));

const mongoose = require('mongoose');
const Branch = require('../../src/models/branch.model');
const Staff = require('../../src/models/staff.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const {
  assertAuthorizedStaffAccess,
  parseIsoDate,
  toPublicAppointment,
  toPublicProvider,
  toPublicSession,
} = require('../../src/services/appointment.service');

describe('Appointment service validation and response mapping', () => {
  afterEach(() => jest.clearAllMocks());

  it('parses valid explicit-timezone timestamps and rejects impossible or timezone-free values', () => {
    expect(parseIsoDate('2026-10-12T09:30:00Z', 'startAt')).toEqual(
      new Date('2026-10-12T09:30:00Z')
    );
    expect(parseIsoDate('2026-10-12T09:30:00+05:30', 'startAt')).toEqual(
      new Date('2026-10-12T09:30:00+05:30')
    );
    expect(() => parseIsoDate('2026-02-30T09:00:00Z', 'startAt')).toThrow(
      'startAt must be a valid ISO-8601 date.'
    );
    expect(() => parseIsoDate('2026-10-12T09:00:00', 'startAt')).toThrow(
      'startAt must include a valid ISO-8601 timezone timestamp.'
    );
    expect(() => parseIsoDate('2026-10-12T25:00:00+24:00', 'startAt')).toThrow(
      'startAt must be a valid ISO-8601 date.'
    );
  });

  it('maps provider data without personal contact or credential fields', () => {
    const provider = toPublicProvider({
      _id: new mongoose.Types.ObjectId(),
      name: 'Dr. Example',
      email: 'private@example.com',
      phone: '+94 77 100 0000',
      passwordHash: 'not-public',
      role: ROLE_VALUES.OPTOMETRIST,
      branchId: new mongoose.Types.ObjectId(),
    });

    expect(provider).toMatchObject({ name: 'Dr. Example', role: ROLE_VALUES.OPTOMETRIST });
    expect(provider).not.toHaveProperty('email');
    expect(provider).not.toHaveProperty('phone');
    expect(provider).not.toHaveProperty('passwordHash');
  });

  it('maps appointment and session output to their public contracts', () => {
    const providerId = new mongoose.Types.ObjectId();
    const appointment = toPublicAppointment({
      _id: new mongoose.Types.ObjectId(),
      customerId: new mongoose.Types.ObjectId(),
      staffId: { _id: providerId, name: 'Dr. Example', email: 'private@example.com' },
      sessionId: new mongoose.Types.ObjectId(),
      branchId: new mongoose.Types.ObjectId(),
      dateTime: new Date('2026-10-12T09:00:00Z'),
      status: 'CONFIRMED',
      position: 2,
    });
    const doctorId = new mongoose.Types.ObjectId();
    const session = toPublicSession({
      _id: new mongoose.Types.ObjectId(),
      doctorId: { _id: doctorId, name: 'Dr. Nimal Perera', specialization: 'Ophthalmologist' },
      capacity: 4,
      confirmedCount: 2,
    });

    const doctorObj = {
      _id: doctorId,
      name: 'Dr. Nimal Perera',
      specialization: 'Ophthalmologist',
    };
    const doctorAppointment = toPublicAppointment({
      _id: new mongoose.Types.ObjectId(),
      customerId: new mongoose.Types.ObjectId(),
      doctorId: doctorObj,
      sessionId: new mongoose.Types.ObjectId(),
      branchId: new mongoose.Types.ObjectId(),
      dateTime: new Date('2026-10-12T09:00:00Z'),
      status: 'CONFIRMED',
      position: 1,
    });

    expect(doctorAppointment.doctorId).toBe(doctorId.toString());
    expect(doctorAppointment.doctorName).toBe('Dr. Nimal Perera');
    expect(doctorAppointment.specialization).toBe('Ophthalmologist');
    expect(doctorAppointment.doctor).toEqual({
      id: doctorId.toString(),
      name: 'Dr. Nimal Perera',
      specialization: 'Ophthalmologist',
    });
    expect(doctorAppointment.providerName).toBe('Dr. Nimal Perera');

    expect(appointment.staffId).toBe(providerId.toString());
    expect(appointment.providerName).toBe('Dr. Example');
    expect(appointment).not.toHaveProperty('customerId');
    expect(appointment).not.toHaveProperty('email');
    expect(appointment).not.toHaveProperty('customer');
    expect(session).toMatchObject({
      doctorId: doctorId.toString(),
      doctorName: 'Dr. Nimal Perera',
      specialization: 'Ophthalmologist',
      doctor: {
        id: doctorId.toString(),
        name: 'Dr. Nimal Perera',
        specialization: 'Ophthalmologist',
      },
      capacity: 4,
      confirmedCount: 2,
      remainingCapacity: 2,
    });
  });

  it('allows an authenticated same-branch Branch Assistant and rejects invalid role or branch', async () => {
    const branchId = new mongoose.Types.ObjectId();
    const staffId = new mongoose.Types.ObjectId();
    Staff.findById.mockReturnValue({
      lean: async () => ({ _id: staffId, role: ROLE_VALUES.BRANCH_ASSISTANT, branchId }),
    });
    Branch.findOne.mockReturnValue({ lean: async () => ({ _id: branchId }) });

    await expect(
      assertAuthorizedStaffAccess(
        { userId: staffId.toString(), role: ROLE_VALUES.BRANCH_ASSISTANT },
        [ROLE_VALUES.BRANCH_ASSISTANT]
      )
    ).resolves.toMatchObject({ role: ROLE_VALUES.BRANCH_ASSISTANT });

    await expect(
      assertAuthorizedStaffAccess(
        { userId: staffId.toString(), role: ROLE_VALUES.BRANCH_ASSISTANT },
        [ROLE_VALUES.BRANCH_MANAGER]
      )
    ).rejects.toMatchObject({ statusCode: 403 });

    Staff.findById.mockReturnValue({
      lean: async () => ({
        _id: staffId,
        role: ROLE_VALUES.BRANCH_ASSISTANT,
        branchId: new mongoose.Types.ObjectId(),
      }),
    });
    await expect(
      assertAuthorizedStaffAccess(
        { userId: staffId.toString(), role: ROLE_VALUES.BRANCH_ASSISTANT },
        [ROLE_VALUES.BRANCH_ASSISTANT]
      )
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
