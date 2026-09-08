const { NotFoundError } = require('../errors/AppError');

/**
 * Middleware to catch 404 requests for non-existent routes.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const notFound = (req, _res, next) => {
  next(new NotFoundError(`Route not found: ${req.originalUrl}`));
};

module.exports = notFound;
