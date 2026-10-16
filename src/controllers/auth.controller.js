const catchAsync = require('../utils/catchAsync');
const { registerCustomer, login: loginUser } = require('../services/auth.service');
const {
  requestPasswordReset,
  resetPassword: resetPasswordService,
} = require('../services/passwordReset.service');

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

const forgotPassword = catchAsync(async (req, res) => {
  const result = await requestPasswordReset(req.body.email);

  return res.status(200).json(result);
});

const resetPassword = catchAsync(async (req, res) => {
  const result = await resetPasswordService({
    token: req.body.token,
    newPassword: req.body.newPassword,
  });

  return res.status(200).json(result);
});

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
};
