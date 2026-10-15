const mongoose = require('mongoose');
const Branch = require('../models/branch.model');
const Customer = require('../models/customer.model');
const Staff = require('../models/staff.model');
const Appointment = require('../models/appointment.model');
const DoctorSession = require('../models/doctorSession.model');
const Doctor = require('../models/doctor.model');
const { ROLE_VALUES } = require('../constants/roles');
const { APPOINTMENT_STATUS_VALUES } = require('../constants/appointmentStatuses');
const {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} = require('../errors/AppError');

const APPROVED_GAMPHA_BRANCH_CODE = 'GAMPAHA_CENTRAL';
const MIN_BOOKING_LEAD_TIME_MS = 24 * 60 * 60 * 1000;
const TX_RETRY_LIMIT = 5;

const parseIsoDate = (value, fieldName) => {
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return value;
    throw new ValidationError(`${fieldName} must be a valid ISO-8601 date.`);
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a valid ISO-8601 date.`);
  }

  const parts = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/
  );
  if (!parts) {
    throw new ValidationError(`${fieldName} must include a valid ISO-8601 timezone timestamp.`);
  }

  const [, year, month, day, hour, minute, second, offset] = parts;
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  calendarDate.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  if (
    calendarDate.getUTCFullYear() !== Number(year) ||
    calendarDate.getUTCMonth() !== Number(month) - 1 ||
    calendarDate.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59))
  ) {
    throw new ValidationError(`${fieldName} must be a valid ISO-8601 date.`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid ISO-8601 date.`);
  }
  return date;
};

const toPublicProvider = (staff) => ({
  id: staff._id ? staff._id.toString() : staff.id,
  name: staff.name,
  role: staff.role,
  branchId: staff.branchId ? staff.branchId.toString() : staff.branchId,
});

const toPublicSession = (session) => {
  const doctor =
    session.doctorId && typeof session.doctorId === 'object' && session.doctorId.name
      ? session.doctorId
      : null;

  return {
    id: session._id ? session._id.toString() : session.id,
    doctorId: doctor
      ? doctor._id.toString()
      : session.doctorId
        ? session.doctorId.toString()
        : null,
    doctorName: doctor?.name,
    specialization: doctor?.specialization,
    doctor: doctor
      ? {
          id: doctor._id.toString(),
          name: doctor.name,
          specialization: doctor.specialization,
        }
      : undefined,
    staffId: session.staffId ? session.staffId.toString() : null,
    branchId: session.branchId ? session.branchId.toString() : session.branchId,
    startAt: session.startAt,
    endAt: session.endAt,
    capacity: session.capacity,
    confirmedCount: session.confirmedCount ?? 0,
    remainingCapacity: Math.max((session.capacity ?? 0) - (session.confirmedCount ?? 0), 0),
  };
};

const toPublicAppointment = (appointment, { includeCustomerContact = false } = {}) => {
  const customer =
    appointment.customerId &&
    typeof appointment.customerId === 'object' &&
    appointment.customerId._id &&
    appointment.customerId.name
      ? appointment.customerId
      : null;

  const doctor =
    appointment.doctorId &&
    typeof appointment.doctorId === 'object' &&
    appointment.doctorId.name
      ? appointment.doctorId
      : null;

  return {
    id: appointment._id ? appointment._id.toString() : appointment.id,
    doctorId: doctor
      ? doctor._id.toString()
      : appointment.doctorId
        ? appointment.doctorId.toString()
        : null,
    doctorName: doctor?.name,
    specialization: doctor?.specialization,
    doctor: doctor
      ? {
          id: doctor._id.toString(),
          name: doctor.name,
          specialization: doctor.specialization,
        }
      : undefined,
    staffId: appointment.staffId?._id
      ? appointment.staffId._id.toString()
      : appointment.staffId
        ? appointment.staffId.toString()
        : null,
    providerName: doctor?.name || appointment.staffId?.name,
    ...(includeCustomerContact && customer
      ? {
          customer: {
            id: customer._id.toString(),
            name: customer.name,
            phone: customer.phone,
          },
        }
      : {}),
    sessionId: appointment.sessionId ? appointment.sessionId.toString() : appointment.sessionId,
    branchId: appointment.branchId ? appointment.branchId.toString() : appointment.branchId,
    dateTime: appointment.dateTime,
    status: appointment.status,
    position: appointment.position ?? null,
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
};

async function getApprovedGampahaBranch(mongoSession = null) {
  const branchQuery = Branch.findOne({ codeName: APPROVED_GAMPHA_BRANCH_CODE });
  if (mongoSession) branchQuery.session(mongoSession);
  const branch = await branchQuery.lean();
  if (!branch) {
    throw new NotFoundError('The approved Gampaha Main Branch is not configured.');
  }
  return branch;
}

function hasErrorLabel(error, label) {
  return typeof error?.hasErrorLabel === 'function'
    ? error.hasErrorLabel(label)
    : error?.errorLabels?.includes(label) || false;
}

function isTransientTransactionError(error) {
  return (
    hasErrorLabel(error, 'TransientTransactionError') ||
    error?.code === 112 ||
    error?.codeName === 'WriteConflict'
  );
}

function isUnsupportedTransactionError(error) {
  return (
    error?.code === 20 ||
    error?.codeName === 'IllegalOperation' ||
    /transaction numbers are only allowed|replica set member or mongos/i.test(error?.message || '')
  );
}

function transactionUnavailableError() {
  return new AppError(
    'Appointment operations require MongoDB replica-set transaction support.',
    503,
    null,
    'TRANSACTIONS_UNAVAILABLE',
    true
  );
}

async function abortTransaction(session) {
  if (session.inTransaction()) {
    await session.abortTransaction().catch(() => {});
  }
}

async function withRetryTransaction(work) {
  for (let attempt = 0; attempt < TX_RETRY_LIMIT; attempt += 1) {
    let session;
    let commitOutcomeUnknown = false;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      const result = await work(session);

      for (let commitAttempt = 0; commitAttempt < TX_RETRY_LIMIT; commitAttempt += 1) {
        try {
          await session.commitTransaction();
          return result;
        } catch (error) {
          if (hasErrorLabel(error, 'UnknownTransactionCommitResult')) {
            if (commitAttempt + 1 === TX_RETRY_LIMIT) {
              commitOutcomeUnknown = true;
              throw new AppError(
                'The appointment operation outcome could not be confirmed. Check its current status before retrying.',
                503,
                null,
                'TRANSACTION_OUTCOME_UNKNOWN',
                true
              );
            }
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (session && !commitOutcomeUnknown) await abortTransaction(session);

      if (isUnsupportedTransactionError(error)) {
        throw transactionUnavailableError();
      }
      if (isTransientTransactionError(error)) {
        if (attempt + 1 < TX_RETRY_LIMIT) continue;
        throw new AppError(
          'The appointment operation could not be completed due to concurrent updates. Please retry.',
          503,
          null,
          'TRANSACTION_RETRIES_EXHAUSTED',
          true
        );
      }
      throw error;
    } finally {
      if (session) await session.endSession();
    }
  }

  throw new AppError(
    'The appointment operation could not be completed due to concurrent updates. Please retry.',
    503,
    null,
    'TRANSACTION_RETRIES_EXHAUSTED',
    true
  );
}

async function assertAuthorizedStaffAccess(authUser, requiredRoles = [], mongoSession = null) {
  if (!authUser || !authUser.userId || !authUser.role) {
    throw new ForbiddenError('Access forbidden.');
  }

  const staffQuery = Staff.findById(authUser.userId);
  if (mongoSession) staffQuery.session(mongoSession);
  const staff = await staffQuery.lean();
  if (!staff) {
    throw new ForbiddenError('Access forbidden.');
  }

  if (requiredRoles.length > 0 && !requiredRoles.includes(staff.role)) {
    throw new ForbiddenError('Access forbidden.');
  }

  const approvedBranch = await getApprovedGampahaBranch(mongoSession);
  if (String(staff.branchId) !== String(approvedBranch._id)) {
    throw new ForbiddenError('Staff access is restricted to the approved Gampaha branch.');
  }

  return staff;
}

async function assertCustomerOwnsAppointment(customerId, appointment) {
  if (!appointment || !appointment.customerId) {
    throw new NotFoundError('Appointment not found.');
  }

  if (String(appointment.customerId) !== String(customerId)) {
    throw new ForbiddenError('Customer cannot access another customer appointment.');
  }

  return toPublicAppointment(appointment);
}

async function appointmentBelongsToBranch(appointment, branchId) {
  if (appointment.branchId) {
    return String(appointment.branchId) === String(branchId);
  }
  if (appointment.sessionId) {
    const session = await DoctorSession.findById(appointment.sessionId).select('branchId').lean();
    return Boolean(session && String(session.branchId) === String(branchId));
  }
  return false;
}

async function lockOptometristScheduling(staff, branchId, mongoSession) {
  if (!staff || !staff._id) return;
  const result = await Staff.updateOne(
    {
      _id: staff._id,
      role: ROLE_VALUES.OPTOMETRIST,
      branchId,
    },
    { $inc: { schedulingVersion: 1 } },
    { session: mongoSession, timestamps: false }
  );
  if (result.modifiedCount !== 1) {
    throw new ConflictError(
      'The optometrist eligibility changed during scheduling. Please retry.',
      null,
      'PROVIDER_CHANGED'
    );
  }
}

async function ensureSessionScope(
  session,
  errorMessage = 'Access forbidden.',
  mongoSession = null
) {
  if (!session) {
    throw new NotFoundError('Doctor session not found.');
  }

  const approvedBranch = await getApprovedGampahaBranch(mongoSession);
  if (String(session.branchId) !== String(approvedBranch._id)) {
    throw new ForbiddenError(errorMessage);
  }

  return session;
}

async function syncSessionAppointments(sessionId, updates, mongoSession) {
  if (!sessionId || !updates || Object.keys(updates).length === 0) {
    return;
  }

  await Appointment.updateMany({ sessionId }, { $set: updates }, { session: mongoSession });
}

async function compactSessionPositions(sessionId, excludedId, mongoSession) {
  const activeAppointments = await Appointment.find({
    sessionId,
    status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
    _id: { $ne: excludedId },
  })
    .sort({ position: 1, createdAt: 1 })
    .session(mongoSession)
    .lean();

  if (activeAppointments.length === 0) {
    return 0;
  }

  const highestPosition = activeAppointments.reduce(
    (highest, appointment) => Math.max(highest, appointment.position || 0),
    0
  );
  const baseTempPosition = highestPosition + activeAppointments.length;

  for (let index = 0; index < activeAppointments.length; index += 1) {
    await Appointment.updateOne(
      { _id: activeAppointments[index]._id },
      { $set: { position: baseTempPosition + index + 1 } },
      { session: mongoSession }
    );
  }

  for (let index = 0; index < activeAppointments.length; index += 1) {
    await Appointment.updateOne(
      { _id: activeAppointments[index]._id },
      { $set: { position: index + 1 } },
      { session: mongoSession }
    );
  }

  return activeAppointments.length;
}

async function listProviders(authUser) {
  if (authUser?.role === ROLE_VALUES.BRANCH_ASSISTANT) {
    await assertAuthorizedStaffAccess(authUser, [ROLE_VALUES.BRANCH_ASSISTANT]);
  } else if (!authUser || authUser.role !== ROLE_VALUES.CUSTOMER) {
    throw new ForbiddenError('Access forbidden.');
  }

  const approvedBranch = await getApprovedGampahaBranch();
  const staffMembers = await Staff.find({
    role: ROLE_VALUES.OPTOMETRIST,
    branchId: approvedBranch._id,
  })
    .select('name role branchId')
    .sort({ name: 1, _id: 1 })
    .lean();

  return staffMembers.map(toPublicProvider);
}

async function listAvailableSessions(authUser = null) {
  const approvedBranch = await getApprovedGampahaBranch();
  const now = new Date(Date.now());

  if (
    authUser &&
    [ROLE_VALUES.BRANCH_ASSISTANT, ROLE_VALUES.BRANCH_MANAGER].includes(authUser.role)
  ) {
    await assertAuthorizedStaffAccess(authUser, [authUser.role]);
    const sessions = await DoctorSession.find({ branchId: approvedBranch._id })
      .populate('doctorId', 'name specialization')
      .sort({ startAt: -1 })
      .lean();
    return sessions.map((session) => toPublicSession(session));
  }

  const earliestBookable = new Date(now.getTime() + MIN_BOOKING_LEAD_TIME_MS);
  const sessions = await DoctorSession.find({
    branchId: approvedBranch._id,
    startAt: { $gte: earliestBookable },
    $expr: { $lt: ['$confirmedCount', '$capacity'] },
  })
    .populate('doctorId', 'name specialization')
    .sort({ startAt: 1 })
    .lean();

  return sessions.map((session) => toPublicSession(session));
}

async function createDoctorSession(input, authUser) {
  if (!authUser || authUser.role !== ROLE_VALUES.BRANCH_ASSISTANT) {
    throw new ForbiddenError('Only branch assistants may create doctor sessions.');
  }

  return withRetryTransaction(async (mongoSession) => {
    await assertAuthorizedStaffAccess(authUser, [ROLE_VALUES.BRANCH_ASSISTANT], mongoSession);

    const body = { ...input };
    const allowedKeys = new Set(['doctorId', 'branchId', 'startAt', 'endAt', 'capacity']);
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) {
        throw new ValidationError(`${key} is not allowed for doctor session creation.`);
      }
    }

    const { doctorId, branchId, startAt, endAt, capacity } = body;
    if (!doctorId || !mongoose.isValidObjectId(doctorId)) {
      throw new ValidationError('doctorId must be a valid MongoDB ObjectId.');
    }
    if (!branchId || !mongoose.isValidObjectId(branchId)) {
      throw new ValidationError('branchId must be a valid MongoDB ObjectId.');
    }

    const assignedDoctor = await Doctor.findById(doctorId).session(mongoSession).lean();
    if (!assignedDoctor) {
      throw new NotFoundError('Doctor not found.');
    }

    const approvedBranch = await getApprovedGampahaBranch(mongoSession);
    if (String(branchId) !== String(approvedBranch._id)) {
      throw new ConflictError(
        'Doctor sessions are only supported at the approved Gampaha Main Branch.',
        null,
        'INVALID_BRANCH'
      );
    }

    const startDate = parseIsoDate(startAt, 'startAt');
    const endDate = parseIsoDate(endAt, 'endAt');
    if (startDate.getTime() >= endDate.getTime()) {
      throw new ValidationError('Session startAt must be earlier than endAt.');
    }
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new ValidationError('capacity must be a positive safe integer.');
    }

    const overlap = await DoctorSession.findOne({
      doctorId,
      startAt: { $lt: endDate },
      endAt: { $gt: startDate },
    })
      .session(mongoSession)
      .lean();

    if (overlap) {
      throw new ConflictError(
        'The doctor already has an overlapping session.',
        null,
        'OVERLAPPING_SESSION'
      );
    }

    const [created] = await DoctorSession.create(
      [
        {
          doctorId,
          branchId,
          startAt: startDate,
          endAt: endDate,
          capacity,
          confirmedCount: 0,
        },
      ],
      { session: mongoSession }
    );

    const createdObj = created.toObject ? created.toObject() : created;
    createdObj.doctorId = assignedDoctor;
    return toPublicSession(createdObj);
  });
}

async function updateDoctorSession(sessionId, input, authUser) {
  if (!authUser || authUser.role !== ROLE_VALUES.BRANCH_ASSISTANT) {
    throw new ForbiddenError('Only branch assistants may update doctor sessions.');
  }

  return withRetryTransaction(async (mongoSession) => {
    await assertAuthorizedStaffAccess(authUser, [ROLE_VALUES.BRANCH_ASSISTANT], mongoSession);

    if (!mongoose.isValidObjectId(sessionId)) {
      throw new ValidationError('sessionId must be a valid MongoDB ObjectId.');
    }

    const session = await DoctorSession.findById(sessionId).session(mongoSession).lean();
    if (!session) {
      throw new NotFoundError('Doctor session not found.');
    }
    await ensureSessionScope(
      session,
      'Staff access is restricted to the approved Gampaha branch.',
      mongoSession
    );

    const patch = { ...input };
    const allowedKeys = new Set(['doctorId', 'branchId', 'startAt', 'endAt', 'capacity']);
    for (const key of Object.keys(patch)) {
      if (!allowedKeys.has(key)) {
        throw new ValidationError(`${key} is not allowed for doctor session updates.`);
      }
    }
    if (Object.keys(patch).length === 0) {
      throw new ValidationError('At least one field must be supplied to update the session.');
    }

    const newDoctorId = patch.doctorId ?? session.doctorId;
    const newBranchId = patch.branchId ?? session.branchId;
    const newStartAt = patch.startAt ? parseIsoDate(patch.startAt, 'startAt') : session.startAt;
    const newEndAt = patch.endAt ? parseIsoDate(patch.endAt, 'endAt') : session.endAt;
    const nextCapacity = patch.capacity !== undefined ? patch.capacity : session.capacity;

    if (newStartAt.getTime() >= newEndAt.getTime()) {
      throw new ValidationError('Session startAt must be earlier than endAt.');
    }
    if (!Number.isSafeInteger(nextCapacity) || nextCapacity <= 0) {
      throw new ValidationError('capacity must be a positive safe integer.');
    }
    if (nextCapacity < (session.confirmedCount ?? 0)) {
      throw new ConflictError(
        'capacity cannot be reduced below the confirmed active bookings.',
        null,
        'CAPACITY_TOO_LOW'
      );
    }

    if (!newDoctorId || !mongoose.isValidObjectId(newDoctorId)) {
      throw new ValidationError('doctorId must be a valid MongoDB ObjectId.');
    }

    const assignedDoctor = await Doctor.findById(newDoctorId).session(mongoSession).lean();
    if (!assignedDoctor) {
      throw new NotFoundError('Doctor not found.');
    }

    const approvedBranch = await getApprovedGampahaBranch(mongoSession);
    if (String(newBranchId) !== String(approvedBranch._id)) {
      throw new ConflictError(
        'Doctor sessions are only supported at the approved Gampaha Main Branch.',
        null,
        'INVALID_BRANCH'
      );
    }

    const overlap = await DoctorSession.findOne({
      _id: { $ne: sessionId },
      doctorId: newDoctorId,
      startAt: { $lt: newEndAt },
      endAt: { $gt: newStartAt },
    })
      .session(mongoSession)
      .lean();
    if (overlap) {
      throw new ConflictError(
        'The doctor already has an overlapping session.',
        null,
        'OVERLAPPING_SESSION'
      );
    }

    const updated = await DoctorSession.findByIdAndUpdate(
      sessionId,
      {
        doctorId: newDoctorId,
        branchId: newBranchId,
        startAt: newStartAt,
        endAt: newEndAt,
        capacity: nextCapacity,
      },
      { new: true, runValidators: true, session: mongoSession }
    ).lean();

    await syncSessionAppointments(
      sessionId,
      {
        doctorId: newDoctorId,
        dateTime: newStartAt,
        branchId: newBranchId,
      },
      mongoSession
    );

    updated.doctorId = assignedDoctor;
    return toPublicSession(updated);
  });
}

async function createAppointment(input, authUser) {
  if (!authUser || authUser.role !== ROLE_VALUES.CUSTOMER) {
    throw new ForbiddenError('Only customers may create appointments.');
  }

  const { sessionId } = input || {};
  const customerId = authUser.userId;

  if (!sessionId || !mongoose.isValidObjectId(sessionId)) {
    throw new ValidationError('sessionId must be a valid MongoDB ObjectId.');
  }

  if (Object.keys(input || {}).some((key) => key !== 'sessionId')) {
    throw new ValidationError('Only sessionId is accepted for appointment creation.');
  }

  return withRetryTransaction(async (mongoSession) => {
    const customer = await Customer.findById(customerId).session(mongoSession).lean();
    if (!customer) {
      throw new NotFoundError('Customer not found.');
    }

    const approvedBranch = await getApprovedGampahaBranch(mongoSession);
    const session = await DoctorSession.findById(sessionId).session(mongoSession).lean();
    if (!session) {
      throw new NotFoundError('Doctor session not found.');
    }
    if (String(session.branchId) !== String(approvedBranch._id)) {
      throw new ConflictError(
        'Appointments are only available at the approved Gampaha Main Branch.',
        null,
        'INVALID_BRANCH'
      );
    }

    let doctor = null;
    let staff = null;
    if (session.doctorId) {
      doctor = await Doctor.findById(session.doctorId).session(mongoSession).lean();
      if (!doctor) {
        throw new ValidationError('Selected session does not reference a valid doctor.');
      }
    } else if (session.staffId) {
      staff = await Staff.findById(session.staffId).session(mongoSession).lean();
      if (
        !staff ||
        staff.role !== ROLE_VALUES.OPTOMETRIST ||
        String(staff.branchId) !== String(approvedBranch._id)
      ) {
        throw new ValidationError('Selected session does not reference a valid optometrist.');
      }
      await lockOptometristScheduling(staff, approvedBranch._id, mongoSession);
    } else {
      throw new ValidationError('Selected session does not have an assigned provider.');
    }

    const now = new Date(Date.now());
    const earliestAllowed = new Date(session.startAt.getTime() - MIN_BOOKING_LEAD_TIME_MS);
    if (now.getTime() > earliestAllowed.getTime()) {
      throw new ConflictError(
        'Appointments must be booked at least 24 hours before the session starts.',
        null,
        'BOOKING_WINDOW'
      );
    }

    const confirmedCount = await Appointment.countDocuments({
      sessionId,
      status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
    }).session(mongoSession);
    if (confirmedCount >= (session.capacity ?? 0)) {
      throw new ConflictError(
        'The doctor session is full. Please choose another session.',
        null,
        'SESSION_FULL'
      );
    }

    const existingBooking = await Appointment.exists({
      customerId,
      sessionId,
      status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
    }).session(mongoSession);
    if (existingBooking) {
      throw new ConflictError(
        'Customer already has a confirmed booking for this session.',
        null,
        'DUPLICATE_BOOKING'
      );
    }

    const nextPosition = confirmedCount + 1;
    const reservation = await DoctorSession.updateOne(
      {
        _id: session._id,
        capacity: { $gt: confirmedCount },
        confirmedCount: session.confirmedCount ?? 0,
      },
      { $set: { confirmedCount: nextPosition } },
      { session: mongoSession }
    );
    if (reservation.modifiedCount !== 1) {
      throw new ConflictError(
        'The session availability changed. Please choose another session.',
        null,
        'SESSION_FULL'
      );
    }

    const [created] = await Appointment.create(
      [
        {
          customerId,
          sessionId,
          branchId: approvedBranch._id,
          doctorId: session.doctorId || null,
          staffId: session.staffId || null,
          dateTime: session.startAt,
          status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
          position: nextPosition,
        },
      ],
      { session: mongoSession }
    );

    const createdAppointment = created.toObject ? created.toObject() : created;
    if (doctor) createdAppointment.doctorId = doctor;
    if (staff) createdAppointment.staffId = { _id: staff._id, name: staff.name };
    return toPublicAppointment(createdAppointment);
  });
}

async function listAppointments(authUser) {
  if (!authUser || !authUser.role || !authUser.userId) {
    throw new ForbiddenError('Access forbidden.');
  }
  if (authUser.role === ROLE_VALUES.CUSTOMER) {
    const appointments = await Appointment.find({ customerId: authUser.userId })
      .sort({ createdAt: -1 })
      .populate('doctorId', 'name specialization')
      .populate('staffId', 'name')
      .lean();
    return appointments.map((appointment) => toPublicAppointment(appointment));
  }

  if ([ROLE_VALUES.BRANCH_ASSISTANT, ROLE_VALUES.BRANCH_MANAGER].includes(authUser.role)) {
    await assertAuthorizedStaffAccess(authUser, [authUser.role]);
    const approvedBranch = await getApprovedGampahaBranch();
    const sessionIds = await DoctorSession.find({ branchId: approvedBranch._id }).distinct('_id');
    const appointments = await Appointment.find({
      $or: [{ sessionId: { $in: sessionIds } }, { branchId: approvedBranch._id }],
    })
      .sort({ createdAt: -1 })
      .populate('doctorId', 'name specialization')
      .populate('staffId', 'name')
      .lean();
    if (authUser.role === ROLE_VALUES.BRANCH_ASSISTANT) {
      await Appointment.populate(appointments, { path: 'customerId', select: 'name phone' });
      return appointments.map((appointment) =>
        toPublicAppointment(appointment, { includeCustomerContact: true })
      );
    }
    return appointments.map((appointment) => toPublicAppointment(appointment));
  }

  throw new ForbiddenError('Access forbidden.');
}

async function getAppointmentById(appointmentId, authUser) {
  if (!mongoose.isValidObjectId(appointmentId)) {
    throw new ValidationError('appointmentId must be a valid MongoDB ObjectId.');
  }

  const appointmentQuery = Appointment.findById(appointmentId)
    .populate('doctorId', 'name specialization')
    .populate('staffId', 'name');
  if (authUser?.role === ROLE_VALUES.BRANCH_ASSISTANT) {
    appointmentQuery.populate('customerId', 'name phone');
  }
  const appointment = await appointmentQuery.lean();
  if (!appointment) {
    throw new NotFoundError('Appointment not found.');
  }

  if (authUser.role === ROLE_VALUES.CUSTOMER) {
    return assertCustomerOwnsAppointment(authUser.userId, appointment);
  }

  if ([ROLE_VALUES.BRANCH_ASSISTANT, ROLE_VALUES.BRANCH_MANAGER].includes(authUser.role)) {
    if (!(await appointmentBelongsToBranch(appointment, (await getApprovedGampahaBranch())._id))) {
      throw new ForbiddenError('Access forbidden.');
    }
    if (authUser.role === ROLE_VALUES.BRANCH_MANAGER) {
      await assertAuthorizedStaffAccess(authUser, [ROLE_VALUES.BRANCH_MANAGER]);
    } else {
      await assertAuthorizedStaffAccess(authUser, [ROLE_VALUES.BRANCH_ASSISTANT]);
    }
    return toPublicAppointment(appointment, {
      includeCustomerContact: authUser.role === ROLE_VALUES.BRANCH_ASSISTANT,
    });
  }

  throw new ForbiddenError('Access forbidden.');
}

async function cancelAppointment(appointmentId, authUser) {
  if (!authUser || !authUser.userId || !authUser.role) {
    throw new ForbiddenError('Access forbidden.');
  }

  if (authUser.role === ROLE_VALUES.BRANCH_MANAGER) {
    throw new ForbiddenError('Branch managers cannot cancel appointments.');
  }

  return withRetryTransaction(async (mongoSession) => {
    const appointment = await Appointment.findById(appointmentId).session(mongoSession).lean();
    if (!appointment) {
      throw new NotFoundError('Appointment not found.');
    }

    if (authUser.role === ROLE_VALUES.CUSTOMER) {
      if (String(appointment.customerId) !== String(authUser.userId)) {
        throw new ForbiddenError('Customer cannot cancel another customer appointment.');
      }
    } else if (authUser.role === ROLE_VALUES.BRANCH_ASSISTANT) {
      await assertAuthorizedStaffAccess(authUser, [ROLE_VALUES.BRANCH_ASSISTANT]);
    } else {
      throw new ForbiddenError('Access forbidden.');
    }

    if (appointment.status !== APPOINTMENT_STATUS_VALUES.CONFIRMED) {
      throw new ConflictError(
        'Only confirmed appointments may be cancelled.',
        null,
        'INVALID_STATUS'
      );
    }

    const session = appointment.sessionId
      ? await DoctorSession.findById(appointment.sessionId).session(mongoSession).lean()
      : null;
    if (appointment.sessionId && !session) {
      throw new NotFoundError('Doctor session not found for this appointment.');
    }
    const approvedBranch = await getApprovedGampahaBranch(mongoSession);
    if (session && authUser.role === ROLE_VALUES.BRANCH_ASSISTANT) {
      await ensureSessionScope(session, 'Access forbidden.', mongoSession);
    } else if (
      authUser.role === ROLE_VALUES.BRANCH_ASSISTANT &&
      !(await appointmentBelongsToBranch(appointment, approvedBranch._id))
    ) {
      throw new ForbiddenError('Access forbidden.');
    }

    const now = new Date(Date.now());
    const appointmentStart = session?.startAt || appointment.dateTime;
    if (
      authUser.role === ROLE_VALUES.CUSTOMER &&
      now.getTime() >= new Date(appointmentStart).getTime()
    ) {
      throw new ConflictError(
        'Customer cancellation is only allowed before the session start time.',
        null,
        'CUSTOMER_CANCEL_WINDOW'
      );
    }

    await Appointment.updateOne(
      { _id: appointment._id },
      { $set: { status: APPOINTMENT_STATUS_VALUES.CANCELLED, position: null } },
      { session: mongoSession }
    );
    if (!session) return { success: true };

    const remainingCount = await compactSessionPositions(
      appointment.sessionId,
      appointment._id,
      mongoSession
    );
    await DoctorSession.updateOne(
      { _id: session._id },
      { $set: { confirmedCount: remainingCount } },
      { session: mongoSession }
    );

    return { success: true };
  });
}

async function reassignAppointment(appointmentId, sessionId, authUser) {
  if (!authUser || authUser.role !== ROLE_VALUES.BRANCH_ASSISTANT) {
    throw new ForbiddenError('Only branch assistants may reassign appointments.');
  }

  if (!mongoose.isValidObjectId(appointmentId) || !mongoose.isValidObjectId(sessionId)) {
    throw new ValidationError('appointmentId and sessionId must be valid MongoDB ObjectIds.');
  }

  return withRetryTransaction(async (mongoSession) => {
    await assertAuthorizedStaffAccess(authUser, [ROLE_VALUES.BRANCH_ASSISTANT], mongoSession);

    const appointment = await Appointment.findById(appointmentId).session(mongoSession).lean();
    if (!appointment) {
      throw new NotFoundError('Appointment not found.');
    }
    if (appointment.status !== APPOINTMENT_STATUS_VALUES.CONFIRMED) {
      throw new ConflictError(
        'Only confirmed appointments may be reassigned.',
        null,
        'INVALID_STATUS'
      );
    }

    if (String(appointment.sessionId) === String(sessionId)) {
      throw new ConflictError(
        'Appointment is already scheduled in the target session.',
        null,
        'SAME_SESSION'
      );
    }

    const sourceSession = await DoctorSession.findById(appointment.sessionId)
      .session(mongoSession)
      .lean();
    if (!sourceSession) {
      throw new NotFoundError('Source doctor session not found.');
    }
    await ensureSessionScope(sourceSession, 'Access forbidden.', mongoSession);

    const targetSession = await DoctorSession.findById(sessionId).session(mongoSession).lean();
    if (!targetSession) {
      throw new NotFoundError('Target doctor session not found.');
    }
    await ensureSessionScope(targetSession, 'Access forbidden.', mongoSession);

    let targetDoctor = null;
    let targetStaff = null;
    if (targetSession.doctorId) {
      targetDoctor = await Doctor.findById(targetSession.doctorId).session(mongoSession).lean();
      if (!targetDoctor) {
        throw new ValidationError('Selected target session does not reference a valid doctor.');
      }
    } else if (targetSession.staffId) {
      targetStaff = await Staff.findById(targetSession.staffId).session(mongoSession).lean();
      if (
        !targetStaff ||
        targetStaff.role !== ROLE_VALUES.OPTOMETRIST ||
        String(targetStaff.branchId) !== String(targetSession.branchId)
      ) {
        throw new ValidationError('Selected target session does not reference a valid optometrist.');
      }
      await lockOptometristScheduling(targetStaff, targetSession.branchId, mongoSession);
    } else {
      throw new ValidationError('Selected target session does not have an assigned provider.');
    }

    const approvedBranch = await getApprovedGampahaBranch(mongoSession);
    if (String(targetSession.branchId) !== String(approvedBranch._id)) {
      throw new ConflictError(
        'Appointments are only available at the approved Gampaha Main Branch.',
        null,
        'INVALID_BRANCH'
      );
    }

    const earliestAllowed = Date.now() + MIN_BOOKING_LEAD_TIME_MS;
    if (targetSession.startAt.getTime() < earliestAllowed) {
      throw new ConflictError(
        'The target session must begin at least 24 hours from now.',
        null,
        'BOOKING_WINDOW'
      );
    }

    const targetConfirmedCount = await Appointment.countDocuments({
      sessionId: targetSession._id,
      status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
    }).session(mongoSession);
    if (targetConfirmedCount >= (targetSession.capacity ?? 0)) {
      throw new ConflictError(
        'The target session is full. Please choose another session.',
        null,
        'SESSION_FULL'
      );
    }

    const existingDuplicate = await Appointment.exists({
      customerId: appointment.customerId,
      sessionId,
      status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
      _id: { $ne: appointment._id },
    }).session(mongoSession);
    if (existingDuplicate) {
      throw new ConflictError(
        'Customer already has a confirmed booking in the target session.',
        null,
        'DUPLICATE_BOOKING'
      );
    }

    const targetReservation = await DoctorSession.updateOne(
      {
        _id: targetSession._id,
        capacity: { $gt: targetConfirmedCount },
        confirmedCount: targetSession.confirmedCount ?? 0,
      },
      { $set: { confirmedCount: targetConfirmedCount + 1 } },
      { session: mongoSession }
    );
    if (targetReservation.modifiedCount !== 1) {
      throw new ConflictError(
        'The target session availability changed. Please choose another session.',
        null,
        'SESSION_FULL'
      );
    }

    const nextPosition = targetConfirmedCount + 1;
    await Appointment.updateOne(
      { _id: appointment._id },
      {
        $set: {
          doctorId: targetSession.doctorId || null,
          staffId: targetSession.staffId || null,
          sessionId: targetSession._id,
          branchId: targetSession.branchId,
          dateTime: targetSession.startAt,
          position: nextPosition,
        },
      },
      { session: mongoSession }
    );

    const remainingSourceCount = await compactSessionPositions(
      sourceSession._id,
      appointment._id,
      mongoSession
    );
    const sourceUpdate = await DoctorSession.updateOne(
      {
        _id: sourceSession._id,
        confirmedCount: sourceSession.confirmedCount ?? 0,
      },
      { $set: { confirmedCount: remainingSourceCount } },
      { session: mongoSession }
    );
    if (sourceUpdate.modifiedCount !== 1 && remainingSourceCount !== sourceSession.confirmedCount) {
      throw new ConflictError(
        'The source session changed during reassignment. Please retry.',
        null,
        'SESSION_CHANGED'
      );
    }

    return { success: true };
  });
}

module.exports = {
  APPROVED_GAMPHA_BRANCH_CODE,
  listProviders,
  listAvailableSessions,
  createDoctorSession,
  updateDoctorSession,
  createAppointment,
  listAppointments,
  getAppointmentById,
  cancelAppointment,
  reassignAppointment,
  toPublicProvider,
  toPublicAppointment,
  toPublicSession,
  parseIsoDate,
  getApprovedGampahaBranch,
  assertAuthorizedStaffAccess,
};
