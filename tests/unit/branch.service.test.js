const mongoose = require('mongoose');
const Branch = require('../../src/models/branch.model');
const {
  PUBLIC_BRANCH_FIELDS,
  listBranches,
  toPublicBranch,
} = require('../../src/services/branch.service');

jest.mock('../../src/models/branch.model', () => ({
  find: jest.fn(),
}));

describe('Branch service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return normalized safe Branch references in deterministic order', async () => {
    const firstBranch = {
      _id: new mongoose.Types.ObjectId(),
      address: '100 Galle Road, Colombo 03',
      contactNumber: '+94 11 250 0000',
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 2,
    };
    const secondBranch = {
      _id: new mongoose.Types.ObjectId(),
      address: '45 Peradeniya Road, Kandy',
      contactNumber: '+94 81 220 0000',
    };
    const lean = jest.fn().mockResolvedValue([firstBranch, secondBranch]);
    const sort = jest.fn().mockReturnValue({ lean });
    const select = jest.fn().mockReturnValue({ sort });
    Branch.find.mockReturnValue({ select });

    const result = await listBranches();

    expect(Branch.find).toHaveBeenCalledWith();
    expect(select).toHaveBeenCalledWith(PUBLIC_BRANCH_FIELDS);
    expect(sort).toHaveBeenCalledWith({ address: 1, _id: 1 });
    expect(lean).toHaveBeenCalledWith();
    expect(result).toEqual([
      {
        id: firstBranch._id.toString(),
        address: firstBranch.address,
        contactNumber: firstBranch.contactNumber,
      },
      {
        id: secondBranch._id.toString(),
        address: secondBranch.address,
        contactNumber: secondBranch.contactNumber,
      },
    ]);
    expect(result[0]).not.toHaveProperty('name');
    expect(result[0]).not.toHaveProperty('_id');
    expect(result[0]).not.toHaveProperty('__v');
    expect(result[0]).not.toHaveProperty('createdAt');
    expect(result[0]).not.toHaveProperty('updatedAt');
    expect(firstBranch).toHaveProperty('createdAt');
  });

  it('should return an empty array when no Branch records exist', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ lean });
    const select = jest.fn().mockReturnValue({ sort });
    Branch.find.mockReturnValue({ select });

    await expect(listBranches()).resolves.toEqual([]);
  });

  it('should normalize a Branch without mutating the source record', () => {
    const branch = {
      _id: new mongoose.Types.ObjectId(),
      address: '12 Main Street, Gampaha',
      contactNumber: '+94 33 222 0000',
      name: 'Unsupported name',
    };

    const result = toPublicBranch(branch);

    expect(result).toEqual({
      id: branch._id.toString(),
      address: branch.address,
      contactNumber: branch.contactNumber,
    });
    expect(branch).toHaveProperty('name', 'Unsupported name');
  });
});
