const express = require('express');
const {
  getProviders,
  getAvailableSessions,
  createDoctorSessionHandler,
  updateDoctorSessionHandler,
  createAppointmentHandler,
  listAppointmentsHandler,
  getAppointmentHandler,
  cancelAppointmentHandler,
  reassignAppointmentHandler,
} = require('../controllers/appointment.controller');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { validate } = require('../middleware/validate');
const { ROLE_VALUES } = require('../constants/roles');

const isObjectIdString = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

const ensureDoctorSessionBody = (req) => {
  const errors = [];
  const { body } = req;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'Doctor session payload must be an object.' }];
  }

  const allowed = new Set(['doctorId', 'branchId', 'startAt', 'endAt', 'capacity']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      errors.push({ field: key, message: `${key} is not an approved doctor session field.` });
    }
  }

  if (!isObjectIdString(body.doctorId)) {
    errors.push({ field: 'doctorId', message: 'doctorId must be a valid MongoDB ObjectId.' });
  }
  if (body.branchId !== undefined && !isObjectIdString(body.branchId)) {
    errors.push({ field: 'branchId', message: 'branchId must be a valid MongoDB ObjectId.' });
  }
  if (typeof body.startAt !== 'string' || !body.startAt.trim()) {
    errors.push({ field: 'startAt', message: 'startAt must be a valid ISO-8601 timestamp.' });
  }
  if (typeof body.endAt !== 'string' || !body.endAt.trim()) {
    errors.push({ field: 'endAt', message: 'endAt must be a valid ISO-8601 timestamp.' });
  }
  if (!Number.isSafeInteger(body.capacity) || body.capacity <= 0) {
    errors.push({ field: 'capacity', message: 'capacity must be a positive safe integer.' });
  }

  return errors;
};

const ensureAppointmentBody = (req) => {
  const errors = [];
  const { body } = req;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'Appointment payload must be an object.' }];
  }

  const allowed = new Set(['sessionId']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      errors.push({ field: key, message: `${key} is not an approved appointment field.` });
    }
  }

  if (!isObjectIdString(body.sessionId)) {
    errors.push({ field: 'sessionId', message: 'sessionId must be a valid MongoDB ObjectId.' });
  }

  return errors;
};

const ensureIdParam = (req) => {
  const { id } = req.params;
  if (!isObjectIdString(id)) {
    return [{ field: 'id', message: 'id must be a valid MongoDB ObjectId.' }];
  }
  return [];
};

const ensureEmptyBody = (req) => {
  if (
    req.body === undefined ||
    (req.body &&
      typeof req.body === 'object' &&
      !Array.isArray(req.body) &&
      Object.keys(req.body).length === 0)
  ) {
    return [];
  }
  return [{ field: 'body', message: 'This endpoint does not accept a request body.' }];
};

const router = express.Router();

router.get(
  '/appointments/providers',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER, ROLE_VALUES.BRANCH_ASSISTANT),
  getProviders
);

router.get(
  '/doctor-sessions/available',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  getAvailableSessions
);

router.post(
  '/doctor-sessions',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_ASSISTANT),
  validate(ensureDoctorSessionBody),
  createDoctorSessionHandler
);

router.get(
  '/doctor-sessions',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_ASSISTANT, ROLE_VALUES.BRANCH_MANAGER),
  getAvailableSessions
);

router.patch(
  '/doctor-sessions/:id',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_ASSISTANT),
  validate(ensureIdParam),
  validate((req) => {
    const errors = [];
    const { body } = req;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return [{ field: 'body', message: 'Session update payload must be an object.' }];
    }
    const allowed = new Set(['doctorId', 'staffId', 'branchId', 'startAt', 'endAt', 'capacity']);
    for (const key of Object.keys(body)) {
      if (!allowed.has(key)) {
        errors.push({ field: key, message: `${key} is not an approved doctor session field.` });
      }
    }
    if (Object.keys(body).length === 0) {
      errors.push({ field: 'body', message: 'At least one session field must be supplied.' });
    }
    if (body.doctorId !== undefined && !isObjectIdString(body.doctorId)) {
      errors.push({ field: 'doctorId', message: 'doctorId must be a valid MongoDB ObjectId.' });
    }
    if (body.staffId !== undefined && !isObjectIdString(body.staffId)) {
      errors.push({ field: 'staffId', message: 'staffId must be a valid MongoDB ObjectId.' });
    }
    if (body.branchId !== undefined && !isObjectIdString(body.branchId)) {
      errors.push({ field: 'branchId', message: 'branchId must be a valid MongoDB ObjectId.' });
    }
    if (body.startAt !== undefined && (typeof body.startAt !== 'string' || !body.startAt.trim())) {
      errors.push({ field: 'startAt', message: 'startAt must be a valid ISO-8601 timestamp.' });
    }
    if (body.endAt !== undefined && (typeof body.endAt !== 'string' || !body.endAt.trim())) {
      errors.push({ field: 'endAt', message: 'endAt must be a valid ISO-8601 timestamp.' });
    }
    if (
      body.capacity !== undefined &&
      (!Number.isSafeInteger(body.capacity) || body.capacity <= 0)
    ) {
      errors.push({ field: 'capacity', message: 'capacity must be a positive safe integer.' });
    }
    return errors;
  }),
  updateDoctorSessionHandler
);

router.post(
  '/appointments',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  validate(ensureAppointmentBody),
  createAppointmentHandler
);

router.get(
  '/appointments',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER, ROLE_VALUES.BRANCH_ASSISTANT, ROLE_VALUES.BRANCH_MANAGER),
  listAppointmentsHandler
);

router.get(
  '/appointments/:id',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER, ROLE_VALUES.BRANCH_ASSISTANT, ROLE_VALUES.BRANCH_MANAGER),
  validate(ensureIdParam),
  getAppointmentHandler
);

router.patch(
  '/appointments/:id/cancel',
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER, ROLE_VALUES.BRANCH_ASSISTANT),
  validate(ensureIdParam),
  validate(ensureEmptyBody),
  cancelAppointmentHandler
);

router.patch(
  '/appointments/:id/reassign',
  authenticate,
  authorizeRoles(ROLE_VALUES.BRANCH_ASSISTANT),
  validate((req) => {
    const errors = [];
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return [{ field: 'body', message: 'Reassignment payload must be an object.' }];
    }
    if (Object.keys(req.body).length !== 1 || !req.body.sessionId) {
      errors.push({ field: 'sessionId', message: 'sessionId is required.' });
    }
    if (req.body.sessionId && !isObjectIdString(req.body.sessionId)) {
      errors.push({ field: 'sessionId', message: 'sessionId must be a valid MongoDB ObjectId.' });
    }
    return errors;
  }),
  reassignAppointmentHandler
);

module.exports = router;
