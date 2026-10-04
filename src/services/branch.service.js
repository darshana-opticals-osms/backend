const Branch = require('../models/branch.model');

const PUBLIC_BRANCH_FIELDS = {
  address: 1,
  contactNumber: 1,
};

const toPublicBranch = (branch) => ({
  id: branch._id.toString(),
  address: branch.address,
  contactNumber: branch.contactNumber,
});

const listBranches = async () => {
  const branches = await Branch.find()
    .select(PUBLIC_BRANCH_FIELDS)
    .sort({ address: 1, _id: 1 })
    .lean();

  return branches.map(toPublicBranch);
};

module.exports = {
  PUBLIC_BRANCH_FIELDS,
  toPublicBranch,
  listBranches,
};
