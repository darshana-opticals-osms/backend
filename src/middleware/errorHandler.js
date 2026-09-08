const { AppError } = require('../errors/AppError');

/**
 * Handles CastError (e.g. invalid MongoDB ObjectId)
 */
const handleCastErrorDB = (err) => {
  return new AppError(`Invalid ${err.path}: ${err.value}`, 400, null, 'INVALID_ID');
};

/**
 * Handles Mongoose duplicate key errors (code 11000)
 */
const handleDuplicateFieldsDB = (err) => {
  const value = err.errmsg ? err.errmsg.match(/(["'])(\\?.)*?\1/)?.[0] : '';
  const message = `Duplicate field value: ${value || 'value already exists'}. Please use another value!`;
  return new AppError(message, 409, null, 'DUPLICATE_FIELD');
};

/**
 * Handles Mongoose ValidationError
 */
const handleValidationErrorDB = (err) => {
  const errors = err.errors ? Object.values(err.errors).map((el) => el.message) : [];
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 422, errors, 'VALIDATION_ERROR');
};

/**
 * Handles JWT Invalid Token Error
 */
const handleJWTError = () =>
  new AppError('Invalid token. Please log in again!', 401, null, 'UNAUTHORIZED');

/**
 * Handles JWT Expired Token Error
 */
const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again.', 401, null, 'UNAUTHORIZED');

/**
 * Centralized Error Handling Middleware
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  let error = err;

  // Normalize non-AppError exceptions or ODM/JWT errors into AppError instances
  if (!(error instanceof AppError)) {
    if (error.name === 'CastError') error = handleCastErrorDB(error);
    else if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    else if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
    else if (error.name === 'JsonWebTokenError') error = handleJWTError();
    else if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
    else if (error.name === 'SyntaxError' && error.status === 400 && 'body' in error) {
      error = new AppError('Malformed JSON payload', 400, null, 'BAD_REQUEST');
    }
  }

  const statusCode = error.statusCode || 500;
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isOperational = error.isOperational || false;

  // Formulate consistent response
  const response = {
    success: false,
    error: {
      message: isOperational || isDevelopment ? error.message : 'Internal server error',
      code: error.errorCode || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR'),
      ...(error.details !== undefined && error.details !== null ? { details: error.details } : {}),
    },
  };

  // Provide extra diagnostic details in development mode
  if (isDevelopment) {
    response.error.stack = error.stack;
  }

  // Log non-operational / unexpected errors for server logs
  if (statusCode >= 500 && !isOperational) {
    console.error('UNHANDLED SERVER ERROR 💥:', err);
  }

  return res.status(statusCode).json(response);
};

module.exports = errorHandler;
