const mongoose = require('mongoose');
const { UnauthorizedError } = require('../errors/AppError');
const { verifyAccessToken } = require('../utils/jwt');
const Staff = require('../models/staff.model');
const { STAFF_ROLE_VALUES } = require('../constants/roles');

const authenticate = async (req, _res, next) => {
  const authorizationHeader = req.get('authorization');

  if (!authorizationHeader || !/^Bearer\s+\S+$/.test(authorizationHeader)) {
    return next(new UnauthorizedError('Authentication required.'));
  }

  const [, token] = authorizationHeader.split(/\s+/);

  try {
    req.auth = verifyAccessToken(token);

    if (
      mongoose.connection.readyState === 1 &&
      req.auth &&
      req.auth.userId &&
      mongoose.isValidObjectId(req.auth.userId) &&
      STAFF_ROLE_VALUES.includes(req.auth.role)
    ) {
      const staff = await Staff.findById(req.auth.userId).select('role branchId isActive').lean();
      if (staff) {
        if (staff.isActive === false) {
          return next(new UnauthorizedError('Account is inactive.'));
        }
        req.auth.role = staff.role;
        req.auth.branchId = staff.branchId ? staff.branchId.toString() : null;
      }
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = authenticate;
