// Preserve the request shape before the global sanitizer removes Mongo-style keys.
// The loyalty validator uses this snapshot only to reject unsupported client input.
const captureLoyaltyRequest = (req, _res, next) => {
  if (req.method === 'GET') {
    req.loyaltyOriginalQuery = req.query;
    req.loyaltyOriginalBody = req.body;
  }

  next();
};

module.exports = captureLoyaltyRequest;
