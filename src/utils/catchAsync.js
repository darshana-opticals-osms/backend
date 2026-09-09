/**
 * Wraps an async route handler or middleware to catch any rejected promises
 * or synchronous throws and pass them to the express next() error handler.
 *
 * @param {Function} fn - Express route handler or middleware function
 * @returns {Function} Express middleware function
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    try {
      Promise.resolve(fn(req, res, next)).catch(next);
    } catch (err) {
      next(err);
    }
  };
};

module.exports = catchAsync;
