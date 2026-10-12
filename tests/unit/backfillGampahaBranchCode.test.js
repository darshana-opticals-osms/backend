jest.mock('../../src/models/branch.model', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../../src/config/database', () => ({
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
}));

const mongoose = require('mongoose');
const Branch = require('../../src/models/branch.model');
const database = require('../../src/config/database');
const {
  backfillGampahaBranchCode,
  GAMPAHA_BRANCH_CODE,
  listBranches,
  main,
  runCli,
} = require('../../scripts/backfillGampahaBranchCode');

describe('Gampaha branch code backfill', () => {
  const branchId = new mongoose.Types.ObjectId();
  const selectedBranch = {
    _id: branchId,
    codeName: undefined,
    address: 'Verified address from operations register',
    contactNumber: '+94 33 200 0000',
  };

  beforeEach(() => {
    Branch.findById.mockReturnValue({ lean: async () => selectedBranch });
    Branch.findOne.mockReturnValue({ lean: async () => null });
    Branch.findOneAndUpdate.mockReturnValue({
      lean: async () => ({ ...selectedBranch, codeName: GAMPAHA_BRANCH_CODE }),
    });
    Branch.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: async () => [selectedBranch] }),
      }),
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('defaults to a non-destructive dry run and never creates a Branch', async () => {
    const result = await backfillGampahaBranchCode({
      branchId: branchId.toString(),
      confirmAddress: selectedBranch.address,
    });

    expect(result).toMatchObject({ applied: false, alreadyApplied: false });
    expect(Branch.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('requires exact address confirmation before applying the code', async () => {
    await expect(
      backfillGampahaBranchCode({
        branchId: branchId.toString(),
        confirmAddress: 'Unverified address',
        apply: true,
      })
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(Branch.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('updates only the explicitly selected existing Branch and can be safely rerun', async () => {
    const result = await backfillGampahaBranchCode({
      branchId: branchId.toString(),
      confirmAddress: selectedBranch.address,
      apply: true,
    });

    expect(result).toMatchObject({
      applied: true,
      branch: { id: branchId.toString(), codeName: GAMPAHA_BRANCH_CODE },
    });
    expect(Branch.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: branchId }),
      { $set: { codeName: GAMPAHA_BRANCH_CODE } },
      expect.any(Object)
    );

    const assignedBranch = { ...selectedBranch, codeName: GAMPAHA_BRANCH_CODE };
    Branch.findById.mockReturnValue({ lean: async () => assignedBranch });
    Branch.findOne.mockReturnValue({ lean: async () => assignedBranch });
    const rerun = await backfillGampahaBranchCode({
      branchId: branchId.toString(),
      confirmAddress: selectedBranch.address,
      apply: true,
    });
    expect(rerun).toMatchObject({ applied: false, alreadyApplied: true });
    expect(Branch.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('refuses to claim the identifier when another Branch already owns it', async () => {
    Branch.findOne.mockReturnValue({
      lean: async () => ({ _id: new mongoose.Types.ObjectId() }),
    });

    await expect(
      backfillGampahaBranchCode({
        branchId: branchId.toString(),
        confirmAddress: selectedBranch.address,
        apply: true,
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(Branch.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('lists existing Branch records without writing', async () => {
    await expect(listBranches()).resolves.toEqual([selectedBranch]);
    expect(Branch.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('supports listing and dry-run commands and always disconnects', async () => {
    const output = { write: jest.fn() };
    await main(['--list'], output);
    expect(output.write).toHaveBeenCalledWith(`${JSON.stringify([selectedBranch], null, 2)}\n`);
    expect(database.connectDatabase).toHaveBeenCalledTimes(1);
    expect(database.disconnectDatabase).toHaveBeenCalledTimes(1);

    await main(
      ['--branch-id', branchId.toString(), '--confirm-address', selectedBranch.address],
      output
    );
    expect(output.write).toHaveBeenLastCalledWith(
      `${JSON.stringify(
        {
          applied: false,
          alreadyApplied: false,
          branch: {
            id: branchId.toString(),
            codeName: null,
            address: selectedBranch.address,
            contactNumber: selectedBranch.contactNumber,
          },
        },
        null,
        2
      )}\n`
    );
    expect(database.disconnectDatabase).toHaveBeenCalledTimes(2);
  });

  it('returns a safe command error for missing arguments and still disconnects', async () => {
    const output = { write: jest.fn() };
    const errorOutput = { write: jest.fn() };

    await expect(main([], output)).rejects.toMatchObject({ statusCode: 422 });
    expect(database.disconnectDatabase).toHaveBeenCalledTimes(1);
    await expect(runCli([], output, errorOutput)).resolves.toBe(1);
    expect(errorOutput.write).toHaveBeenCalledWith(expect.stringContaining('Use --list'));
    expect(database.disconnectDatabase).toHaveBeenCalledTimes(2);
  });
});
