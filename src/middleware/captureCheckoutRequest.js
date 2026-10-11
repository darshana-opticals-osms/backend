const captureCheckoutRequest = (req, _res, next) => {
  if (req.method === 'POST') {
    req.checkoutOriginalBody = req.body;
    req.checkoutOriginalQuery = req.query;
  }

  next();
};

module.exports = captureCheckoutRequest;
