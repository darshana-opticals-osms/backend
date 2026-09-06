/**
 * Wraps an async route handler or middleware to catch any rejected promises
 * and pass them to the express next() error handler.
 *
 * @param {Function} fn - Async express route handler function
 * @returns {Function} Express middleware function
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

module.exports = catchAsync;
