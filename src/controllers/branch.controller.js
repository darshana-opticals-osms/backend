const catchAsync = require('../utils/catchAsync');
const { listBranches } = require('../services/branch.service');

const getBranches = catchAsync(async (_req, res) => {
  const branches = await listBranches();

  return res.status(200).json({
    success: true,
    data: branches,
  });
});

module.exports = {
  getBranches,
};
