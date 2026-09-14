const catchAsync = require('../utils/catchAsync');
const { registerCustomer } = require('../services/auth.service');

const register = catchAsync(async (req, res) => {
  const customer = await registerCustomer(req.body);

  return res.status(201).json({
    success: true,
    data: customer,
  });
});

module.exports = {
  register,
};
