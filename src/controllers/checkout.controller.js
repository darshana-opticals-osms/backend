const catchAsync = require('../utils/catchAsync');
const { checkoutCustomer } = require('../services/checkout.service');

const checkout = catchAsync(async (req, res) => {
  const result = await checkoutCustomer(req.auth.userId);

  return res.status(201).json({ success: true, data: result });
});

module.exports = { checkout };
