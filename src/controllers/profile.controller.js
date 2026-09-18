const catchAsync = require('../utils/catchAsync');
const { getOwnProfile, updateOwnProfile } = require('../services/profile.service');

const getProfile = catchAsync(async (req, res) => {
  const profile = await getOwnProfile(req.auth.userId);

  return res.status(200).json({
    success: true,
    data: profile,
  });
});

const updateProfile = catchAsync(async (req, res) => {
  const profile = await updateOwnProfile(req.auth.userId, req.body);

  return res.status(200).json({
    success: true,
    data: profile,
  });
});

module.exports = {
  getProfile,
  updateProfile,
};
