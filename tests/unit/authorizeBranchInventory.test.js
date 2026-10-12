const mongoose = require('mongoose');
const Inventory = require('../../src/models/inventory.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { ForbiddenError, NotFoundError } = require('../../src/errors/AppError');
const {
  authorizeCreateInventoryBranch,
  authorizeBranchInventoryAccess,
  authorizeInventoryItemBranch,
  authorizeReorderAlertsBranch,
  authorizeReorderAlertsBranchParam,
} = require('../../src/middleware/authorizeBranchInventory');

jest.mock('../../src/models/inventory.model');

describe('authorizeBranchInventory middleware', () => {
  const branchA = new mongoose.Types.ObjectId().toString();
  const branchB = new mongoose.Types.ObjectId().toString();
  const itemId = new mongoose.Types.ObjectId().toString();

  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe('authorizeCreateInventoryBranch', () => {
    it('should allow BRANCH_MANAGER creating an item for their own branch', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        body: { branchId: branchA },
      };

      authorizeCreateInventoryBranch(req, {}, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject BRANCH_MANAGER creating an item for a different branch with ForbiddenError', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        body: { branchId: branchB },
      };

      authorizeCreateInventoryBranch(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
      expect(next.mock.calls[0][0].message).toMatch(/assigned branch/i);
    });

    it('should reject BRANCH_MANAGER without a branchId claim', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: null },
        body: { branchId: branchA },
      };

      authorizeCreateInventoryBranch(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });
  });

  describe('authorizeBranchInventoryAccess', () => {
    it('should allow BRANCH_MANAGER accessing their own branch inventory', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        params: { branchId: branchA },
      };

      authorizeBranchInventoryAccess(req, {}, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject BRANCH_MANAGER accessing another branch inventory', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        params: { branchId: branchB },
      };

      authorizeBranchInventoryAccess(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    it('should allow SYSTEM_ADMIN accessing any branch inventory', () => {
      const req = {
        auth: { role: ROLE_VALUES.SYSTEM_ADMIN },
        params: { branchId: branchB },
      };

      authorizeBranchInventoryAccess(req, {}, next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('authorizeInventoryItemBranch', () => {
    it('should reject with NotFoundError when inventory item does not exist', async () => {
      Inventory.findById.mockResolvedValue(null);

      const req = {
        params: { id: itemId },
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
      };

      await authorizeInventoryItemBranch(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    });

    it('should allow BRANCH_MANAGER modifying item belonging to their branch', async () => {
      const mockItem = { _id: itemId, branchId: branchA };
      Inventory.findById.mockResolvedValue(mockItem);

      const req = {
        params: { id: itemId },
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        body: { itemName: 'Updated Name' },
      };

      await authorizeInventoryItemBranch(req, {}, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.inventoryItem).toBe(mockItem);
    });

    it('should reject BRANCH_MANAGER modifying item belonging to a foreign branch', async () => {
      const mockItem = { _id: itemId, branchId: branchB };
      Inventory.findById.mockResolvedValue(mockItem);

      const req = {
        params: { id: itemId },
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        body: { itemName: 'Updated Name' },
      };

      await authorizeInventoryItemBranch(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    it('should reject BRANCH_MANAGER attempting to reassign item to a different branch', async () => {
      const mockItem = { _id: itemId, branchId: branchA };
      Inventory.findById.mockResolvedValue(mockItem);

      const req = {
        params: { id: itemId },
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        body: { branchId: branchB },
      };

      await authorizeInventoryItemBranch(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
      expect(next.mock.calls[0][0].message).toMatch(/may not reassign/i);
    });

    it('should allow SYSTEM_ADMIN modifying an item', async () => {
      const mockItem = { _id: itemId, branchId: branchB };
      Inventory.findById.mockResolvedValue(mockItem);

      const req = {
        params: { id: itemId },
        auth: { role: ROLE_VALUES.SYSTEM_ADMIN },
        body: { price: 15000 },
      };

      await authorizeInventoryItemBranch(req, {}, next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('authorizeReorderAlertsBranch', () => {
    it('should auto-populate branchId in query for BRANCH_MANAGER when omitted', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        query: {},
      };

      authorizeReorderAlertsBranch(req, {}, next);

      expect(req.query.branchId).toBe(branchA);
      expect(next).toHaveBeenCalledWith();
    });

    it('should allow BRANCH_MANAGER if query branchId matches their branch', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        query: { branchId: branchA },
      };

      authorizeReorderAlertsBranch(req, {}, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject BRANCH_MANAGER querying another branchId', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        query: { branchId: branchB },
      };

      authorizeReorderAlertsBranch(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    it('should reject BRANCH_MANAGER without an assigned branchId (fail-closed)', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: null },
        query: {},
      };

      authorizeReorderAlertsBranch(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    it('should allow SYSTEM_ADMIN querying without branch scoping', () => {
      const req = {
        auth: { role: ROLE_VALUES.SYSTEM_ADMIN },
        query: {},
      };

      authorizeReorderAlertsBranch(req, {}, next);

      expect(req.query.branchId).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('authorizeReorderAlertsBranchParam', () => {
    it('should allow BRANCH_MANAGER for their own branch in params', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        params: { branchId: branchA },
      };

      authorizeReorderAlertsBranchParam(req, {}, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject BRANCH_MANAGER for a foreign branch in params', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        params: { branchId: branchB },
      };

      authorizeReorderAlertsBranchParam(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    it('should allow SYSTEM_ADMIN for any branch in params', () => {
      const req = {
        auth: { role: ROLE_VALUES.SYSTEM_ADMIN },
        params: { branchId: branchB },
      };

      authorizeReorderAlertsBranchParam(req, {}, next);

      expect(next).toHaveBeenCalledWith();
    });
  });
});
