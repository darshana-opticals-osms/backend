const catchAsync = require('../../src/utils/catchAsync');

describe('catchAsync', () => {
  describe('wrapper execution', () => {
    it('should invoke Express next() with error given an async function that throws or rejects', async () => {
      // Arrange
      const error = new Error('Async execution failed');
      const asyncFn = catchAsync(async () => {
        throw error;
      });
      const req = {};
      const res = {};
      const next = jest.fn();

      // Act
      await asyncFn(req, res, next);

      // Assert
      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
