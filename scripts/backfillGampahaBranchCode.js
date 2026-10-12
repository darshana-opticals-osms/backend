const mongoose = require('mongoose');
const Branch = require('../src/models/branch.model');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { ConflictError, NotFoundError, ValidationError } = require('../src/errors/AppError');

const GAMPAHA_BRANCH_CODE = 'GAMPAHA_CENTRAL';

async function backfillGampahaBranchCode({ branchId, confirmAddress, apply = false }) {
  if (!mongoose.isValidObjectId(branchId)) {
    throw new ValidationError('A valid existing branchId is required.');
  }

  const branch = await Branch.findById(branchId).lean();
  if (!branch) throw new NotFoundError('The explicitly selected Branch record was not found.');
  if (!confirmAddress || confirmAddress !== branch.address) {
    throw new ValidationError('confirmAddress must exactly match the selected Branch address.');
  }
  if (branch.codeName && branch.codeName !== GAMPAHA_BRANCH_CODE) {
    throw new ConflictError(
      'The selected Branch already has a different codeName.',
      null,
      'BRANCH_CODE_CONFLICT'
    );
  }

  const existingApproved = await Branch.findOne({ codeName: GAMPAHA_BRANCH_CODE }).lean();
  if (existingApproved && String(existingApproved._id) !== String(branch._id)) {
    throw new ConflictError(
      'Another Branch already owns GAMPAHA_CENTRAL; no records were changed.',
      null,
      'BRANCH_CODE_ALREADY_ASSIGNED'
    );
  }

  if (!apply || branch.codeName === GAMPAHA_BRANCH_CODE) {
    return {
      applied: false,
      alreadyApplied: branch.codeName === GAMPAHA_BRANCH_CODE,
      branch: {
        id: branch._id.toString(),
        codeName: branch.codeName || null,
        address: branch.address,
        contactNumber: branch.contactNumber,
      },
    };
  }

  const updated = await Branch.findOneAndUpdate(
    {
      _id: branch._id,
      $or: [
        { codeName: { $exists: false } },
        { codeName: null },
        { codeName: GAMPAHA_BRANCH_CODE },
      ],
    },
    { $set: { codeName: GAMPAHA_BRANCH_CODE } },
    { new: true, runValidators: true }
  ).lean();
  if (!updated) {
    throw new ConflictError(
      'The selected Branch changed during backfill; no records were changed.'
    );
  }

  return {
    applied: true,
    alreadyApplied: false,
    branch: {
      id: updated._id.toString(),
      codeName: updated.codeName,
      address: updated.address,
      contactNumber: updated.contactNumber,
    },
  };
}

async function listBranches() {
  return Branch.find({}).select('_id codeName address contactNumber').sort({ address: 1 }).lean();
}

async function main(args, output = process.stdout) {
  await connectDatabase();
  try {
    if (args.includes('--list')) {
      output.write(`${JSON.stringify(await listBranches(), null, 2)}\n`);
      return;
    }

    const branchIndex = args.indexOf('--branch-id');
    const addressIndex = args.indexOf('--confirm-address');
    if (branchIndex < 0 || addressIndex < 0) {
      throw new ValidationError(
        'Use --list, or provide --branch-id <id> --confirm-address <exact address> [--apply].'
      );
    }

    const result = await backfillGampahaBranchCode({
      branchId: args[branchIndex + 1],
      confirmAddress: args[addressIndex + 1],
      apply: args.includes('--apply'),
    });
    output.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

async function runCli(args, output = process.stdout, errorOutput = process.stderr) {
  try {
    await main(args, output);
    return 0;
  } catch (error) {
    errorOutput.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = { GAMPAHA_BRANCH_CODE, backfillGampahaBranchCode, listBranches, main, runCli };
