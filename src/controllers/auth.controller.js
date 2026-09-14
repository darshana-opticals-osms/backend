const catchAsync = require('../utils/catchAsync');
const { registerCustomer, login: loginUser } = require('../services/auth.service');

const register = catchAsync(async (req, res) => {
  const customer = await registerCustomer(req.body);

  return res.status(201).json({
    success: true,
    data: customer,
  });
});

const login = catchAsync(async (req, res) => {
  const authentication = await loginUser(req.body);

  return res.status(200).json({
    success: true,
    data: authentication,
  });
});

module.exports = {
  register,
  login,
};
