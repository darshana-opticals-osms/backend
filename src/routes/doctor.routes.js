const express = require('express');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { ROLE_VALUES } = require('../constants/roles');
const { validateCreateDoctor } = require('../validations/doctor.validation');
const { createDoctorHandler, getDoctorsHandler } = require('../controllers/doctor.controller');

const router = express.Router();

/**
 * Route: POST /api/doctors
 * Access: SYSTEM_ADMIN only
 */
router.post(
  '/doctors',
  authenticate,
  authorizeRoles(ROLE_VALUES.SYSTEM_ADMIN),
  validateCreateDoctor,
  createDoctorHandler
);

/**
 * Route: GET /api/doctors
 * Access: All authenticated canonical roles (CUSTOMER, SYSTEM_ADMIN, BRANCH_MANAGER, BRANCH_ASSISTANT, OPTOMETRIST)
 */
router.get(
  '/doctors',
  authenticate,
  authorizeRoles(
    ROLE_VALUES.CUSTOMER,
    ROLE_VALUES.SYSTEM_ADMIN,
    ROLE_VALUES.BRANCH_MANAGER,
    ROLE_VALUES.BRANCH_ASSISTANT,
    ROLE_VALUES.OPTOMETRIST
  ),
  getDoctorsHandler
);

module.exports = router;
