class AppError extends Error {
  /**
   * Base custom application error class.
   * @param {string} message - User-friendly error message.
   * @param {number} statusCode - HTTP status code (default 500).
   * @param {any} [details=null] - Additional validation or contextual error details.
   * @param {string|null} [errorCode=null] - Application error code identifier.
   */
  constructor(message, statusCode = 500, details = null, errorCode = null) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.details = details;
    this.errorCode = errorCode;

    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad Request', details = null, errorCode = 'BAD_REQUEST') {
    super(message, 400, details, errorCode);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access', details = null, errorCode = 'UNAUTHORIZED') {
    super(message, 401, details, errorCode);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden', details = null, errorCode = 'FORBIDDEN') {
    super(message, 403, details, errorCode);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details = null, errorCode = 'NOT_FOUND') {
    super(message, 404, details, errorCode);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details = null, errorCode = 'CONFLICT') {
    super(message, 409, details, errorCode);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation error', details = null, errorCode = 'VALIDATION_ERROR') {
    super(message, 422, details, errorCode);
  }
}

class InternalServerError extends AppError {
  constructor(
    message = 'Internal server error',
    details = null,
    errorCode = 'INTERNAL_SERVER_ERROR'
  ) {
    super(message, 500, details, errorCode);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  InternalServerError,
};
