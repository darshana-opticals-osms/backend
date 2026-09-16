const { UnauthorizedError } = require('../errors/AppError');
const { verifyAccessToken } = require('../utils/jwt');

const authenticate = (req, _res, next) => {
  const authorizationHeader = req.get('authorization');

  if (!authorizationHeader || !/^Bearer\s+\S+$/.test(authorizationHeader)) {
    return next(new UnauthorizedError('Authentication required.'));
  }

  const [, token] = authorizationHeader.split(/\s+/);

  try {
    req.auth = verifyAccessToken(token);
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = authenticate;
