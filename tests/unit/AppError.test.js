const {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  InternalServerError,
} = require('../../src/errors/AppError');

describe('AppError', () => {
  describe('constructor', () => {
    it('should set message, statusCode, status, isOperational, and details given custom parameters', () => {
      // Arrange
      const message = 'Custom operational error';
      const statusCode = 400;
      const details = { field: 'email' };
      const errorCode = 'CUSTOM_ERROR';

      // Act
      const err = new AppError(message, statusCode, details, errorCode);

      // Assert
      expect(err.message).toBe(message);
      expect(err.statusCode).toBe(statusCode);
      expect(err.status).toBe('fail');
      expect(err.isOperational).toBe(true);
      expect(err.details).toEqual(details);
      expect(err.errorCode).toBe(errorCode);
    });

    it('should default status to error given a 5xx status code', () => {
      // Arrange
      const message = 'Internal server error';
      const statusCode = 500;

      // Act
      const err = new AppError(message, statusCode);

      // Assert
      expect(err.status).toBe('error');
    });
  });

  describe('Subclasses', () => {
    it('should instantiate subclasses with correct default status codes and error codes', () => {
      // Arrange & Act
      const badRequest = new BadRequestError();
      const unauthorized = new UnauthorizedError();
      const forbidden = new ForbiddenError();
      const notFound = new NotFoundError();
      const conflict = new ConflictError();
      const validation = new ValidationError();
      const internalServer = new InternalServerError();

      // Assert
      expect(badRequest.statusCode).toBe(400);
      expect(unauthorized.statusCode).toBe(401);
      expect(forbidden.statusCode).toBe(403);
      expect(notFound.statusCode).toBe(404);
      expect(conflict.statusCode).toBe(409);
      expect(validation.statusCode).toBe(422);
      expect(internalServer.statusCode).toBe(500);
    });
  });
});
