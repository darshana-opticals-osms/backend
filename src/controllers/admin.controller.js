const catchAsync = require('../utils/catchAsync');
const { provisionStaff } = require('../services/staffProvisioning.service');

const createStaff = catchAsync(async (req, res) => {
  const staff = await provisionStaff(req.body);

  return res.status(201).json({
    success: true,
    data: staff,
  });
});

module.exports = {
  createStaff,
};
