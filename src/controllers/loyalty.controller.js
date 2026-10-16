const catchAsync = require('../utils/catchAsync');
const { getOwnLoyalty: getOwnLoyaltyService } = require('../services/loyaltyRead.service');

const getOwnLoyalty = catchAsync(async (req, res) => {
  const result = await getOwnLoyaltyService({
    customerId: req.auth.userId,
    query: req.query,
  });
  return res.status(200).json({ success: true, data: result });
});

module.exports = { getOwnLoyalty };
