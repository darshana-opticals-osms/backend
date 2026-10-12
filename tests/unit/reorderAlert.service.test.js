const mongoose = require('mongoose');
const ReorderAlert = require('../../src/models/reorderAlert.model');
const InventoryConfig = require('../../src/models/inventoryConfig.model');
const Inventory = require('../../src/models/inventory.model');
const {
  REORDER_ALERT_STATUS,
  DEFAULT_REORDER_THRESHOLD,
} = require('../../src/constants/inventoryAlert.constants');
const {
  getGlobalReorderThreshold,
  setGlobalReorderThreshold,
  evaluateReorderAlert,
  reconcileAllInventories,
  getActiveReorderAlerts,
  processPeriodicReminders,
} = require('../../src/services/reorderAlert.service');

jest.mock('../../src/models/reorderAlert.model', () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  countDocuments: jest.fn(),
}));

jest.mock('../../src/models/inventoryConfig.model', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock('../../src/models/inventory.model', () => ({
  find: jest.fn(),
  findById: jest.fn(),
}));

describe('ReorderAlert service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getGlobalReorderThreshold', () => {
    it('should return configured threshold when present in database', async () => {
      InventoryConfig.findOne.mockResolvedValue({ key: 'REORDER_THRESHOLD', value: 8 });

      const threshold = await getGlobalReorderThreshold();

      expect(threshold).toBe(8);
      expect(InventoryConfig.findOne).toHaveBeenCalledWith({ key: 'REORDER_THRESHOLD' });
    });

    it('should return default threshold 5 when no configuration is present', async () => {
      InventoryConfig.findOne.mockResolvedValue(null);

      const threshold = await getGlobalReorderThreshold();

      expect(threshold).toBe(DEFAULT_REORDER_THRESHOLD);
    });

    it('should return default threshold when configured value is not a valid number', async () => {
      InventoryConfig.findOne.mockResolvedValue({ key: 'REORDER_THRESHOLD', value: 'invalid' });

      const threshold = await getGlobalReorderThreshold();

      expect(threshold).toBe(DEFAULT_REORDER_THRESHOLD);
    });
  });

  describe('setGlobalReorderThreshold', () => {
    it('should reject a negative threshold value', async () => {
      await expect(setGlobalReorderThreshold(-1)).rejects.toMatchObject({
        statusCode: 422,
      });

      expect(InventoryConfig.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('should reject non-numeric threshold value', async () => {
      await expect(setGlobalReorderThreshold('ten')).rejects.toMatchObject({
        statusCode: 422,
      });

      expect(InventoryConfig.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('should update threshold and reconcile all inventory records', async () => {
      InventoryConfig.findOneAndUpdate.mockResolvedValue({ key: 'REORDER_THRESHOLD', value: 10 });
      Inventory.find.mockResolvedValue([
        {
          _id: new mongoose.Types.ObjectId(),
          branchId: new mongoose.Types.ObjectId(),
          quantity: 5,
        },
      ]);
      ReorderAlert.findOne.mockResolvedValue(null);
      ReorderAlert.create.mockResolvedValue({ status: REORDER_ALERT_STATUS.ACTIVE });

      const result = await setGlobalReorderThreshold(10);

      expect(InventoryConfig.findOneAndUpdate).toHaveBeenCalledWith(
        { key: 'REORDER_THRESHOLD' },
        { $set: { value: 10, updatedBy: null } },
        { upsert: true, new: true, runValidators: true }
      );
      expect(result.threshold).toBe(10);
      expect(result.reconciliation.totalEvaluated).toBe(1);
    });

    it('should restore previous threshold in InventoryConfig if reconciliation fails midway (recovery strategy)', async () => {
      InventoryConfig.findOne.mockResolvedValue({
        key: 'REORDER_THRESHOLD',
        value: 5,
        updatedBy: 'user-orig',
      });
      InventoryConfig.findOneAndUpdate.mockResolvedValue({ key: 'REORDER_THRESHOLD', value: 10 });
      Inventory.find.mockRejectedValueOnce(new Error('DB failure during reconciliation'));

      await expect(setGlobalReorderThreshold(10)).rejects.toThrow(
        'DB failure during reconciliation'
      );

      expect(InventoryConfig.findOneAndUpdate).toHaveBeenCalledWith(
        { key: 'REORDER_THRESHOLD' },
        { $set: { value: 5, updatedBy: 'user-orig' } },
        { upsert: true, new: true }
      );
    });
  });

  describe('evaluateReorderAlert', () => {
    it('should return null when inventory record is null or missing id', async () => {
      const result = await evaluateReorderAlert(null);
      expect(result).toBeNull();
    });

    it('should create a new active alert when quantity <= threshold and no active alert exists', async () => {
      const inventoryId = new mongoose.Types.ObjectId();
      const branchId = new mongoose.Types.ObjectId();
      const inventory = { _id: inventoryId, branchId, quantity: 4 };

      ReorderAlert.findOne.mockResolvedValue(null);
      const createdAlert = {
        _id: new mongoose.Types.ObjectId(),
        inventoryId,
        branchId,
        currentQuantity: 4,
        threshold: 5,
        status: REORDER_ALERT_STATUS.ACTIVE,
      };
      ReorderAlert.create.mockResolvedValue(createdAlert);

      const result = await evaluateReorderAlert(inventory, 5);

      expect(ReorderAlert.findOne).toHaveBeenCalledWith({
        inventoryId,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });
      expect(ReorderAlert.create).toHaveBeenCalledWith({
        inventoryId,
        branchId,
        currentQuantity: 4,
        threshold: 5,
        status: REORDER_ALERT_STATUS.ACTIVE,
      });
      expect(result).toEqual(createdAlert);
    });

    it('should prevent duplicate alert by updating existing active alert when quantity <= threshold', async () => {
      const inventoryId = new mongoose.Types.ObjectId();
      const branchId = new mongoose.Types.ObjectId();
      const inventory = { _id: inventoryId, branchId, quantity: 2 };

      const existingActiveAlert = {
        _id: new mongoose.Types.ObjectId(),
        inventoryId,
        branchId,
        currentQuantity: 5,
        threshold: 5,
        status: REORDER_ALERT_STATUS.ACTIVE,
        save: jest.fn().mockResolvedValue(true),
      };
      ReorderAlert.findOne.mockResolvedValue(existingActiveAlert);

      const result = await evaluateReorderAlert(inventory, 5);

      expect(ReorderAlert.create).not.toHaveBeenCalled();
      expect(existingActiveAlert.currentQuantity).toBe(2);
      expect(existingActiveAlert.threshold).toBe(5);
      expect(existingActiveAlert.save).toHaveBeenCalled();
      expect(result).toEqual(existingActiveAlert);
    });

    it('should resolve an active alert when stock rises above threshold (quantity > threshold)', async () => {
      const inventoryId = new mongoose.Types.ObjectId();
      const branchId = new mongoose.Types.ObjectId();
      const inventory = { _id: inventoryId, branchId, quantity: 10 };

      const existingActiveAlert = {
        _id: new mongoose.Types.ObjectId(),
        inventoryId,
        branchId,
        currentQuantity: 3,
        threshold: 5,
        status: REORDER_ALERT_STATUS.ACTIVE,
        save: jest.fn().mockResolvedValue(true),
      };
      ReorderAlert.findOne.mockResolvedValue(existingActiveAlert);

      const result = await evaluateReorderAlert(inventory, 5);

      expect(existingActiveAlert.status).toBe(REORDER_ALERT_STATUS.RESOLVED);
      expect(existingActiveAlert.resolvedAt).toBeInstanceOf(Date);
      expect(existingActiveAlert.save).toHaveBeenCalled();
      expect(result).toEqual(existingActiveAlert);
    });

    it('should do nothing and return null when stock is above threshold and no active alert exists', async () => {
      const inventoryId = new mongoose.Types.ObjectId();
      const branchId = new mongoose.Types.ObjectId();
      const inventory = { _id: inventoryId, branchId, quantity: 15 };

      ReorderAlert.findOne.mockResolvedValue(null);

      const result = await evaluateReorderAlert(inventory, 5);

      expect(ReorderAlert.create).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('reconcileAllInventories', () => {
    it('should iterate and evaluate all inventory records', async () => {
      const items = [
        { _id: new mongoose.Types.ObjectId(), quantity: 3 },
        { _id: new mongoose.Types.ObjectId(), quantity: 12 },
      ];
      Inventory.find.mockResolvedValue(items);
      ReorderAlert.findOne.mockResolvedValue(null);

      const result = await reconcileAllInventories(5);

      expect(Inventory.find).toHaveBeenCalledWith({});
      expect(result.totalEvaluated).toBe(2);
    });
  });

  describe('getActiveReorderAlerts', () => {
    it('should reject invalid branchId format', async () => {
      await expect(getActiveReorderAlerts({ branchId: 'invalid-branch-id' })).rejects.toMatchObject(
        {
          statusCode: 422,
        }
      );
    });

    it('should query active alerts with pagination', async () => {
      const mockChain = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: 'alert1' }]),
      };
      ReorderAlert.find.mockReturnValue(mockChain);
      ReorderAlert.countDocuments.mockResolvedValue(1);

      const result = await getActiveReorderAlerts({ page: 1, limit: 10 });

      expect(result.alerts).toEqual([{ _id: 'alert1' }]);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });
  });

  describe('processPeriodicReminders', () => {
    it('should not send reminders outside working hours (e.g. 7 AM)', async () => {
      const earlyMorning = new Date();
      earlyMorning.setHours(7, 30, 0, 0);

      const result = await processPeriodicReminders(earlyMorning);

      expect(result.withinWorkingHours).toBe(false);
      expect(result.remindersSent).toBe(0);
      expect(ReorderAlert.find).not.toHaveBeenCalled();
    });

    it('should send reminders for candidate alerts during working hours when still low stock', async () => {
      const workingTime = new Date();
      workingTime.setHours(10, 0, 0, 0);

      const inventoryId = new mongoose.Types.ObjectId();
      const mockAlert = {
        _id: new mongoose.Types.ObjectId(),
        inventoryId,
        threshold: 5,
        status: REORDER_ALERT_STATUS.ACTIVE,
        currentQuantity: 3,
        lastReminderSentAt: null,
        save: jest.fn().mockResolvedValue(true),
      };

      ReorderAlert.find.mockResolvedValue([mockAlert]);
      Inventory.findById.mockResolvedValue({ _id: inventoryId, quantity: 2 });

      const result = await processPeriodicReminders(workingTime);

      expect(result.withinWorkingHours).toBe(true);
      expect(result.remindersSent).toBe(1);
      expect(mockAlert.currentQuantity).toBe(2);
      expect(mockAlert.lastReminderSentAt).toEqual(workingTime);
      expect(mockAlert.save).toHaveBeenCalled();
    });

    it('should resolve alert during reminder check if stock rose above threshold', async () => {
      const workingTime = new Date();
      workingTime.setHours(11, 0, 0, 0);

      const inventoryId = new mongoose.Types.ObjectId();
      const mockAlert = {
        _id: new mongoose.Types.ObjectId(),
        inventoryId,
        threshold: 5,
        status: REORDER_ALERT_STATUS.ACTIVE,
        currentQuantity: 3,
        lastReminderSentAt: null,
        save: jest.fn().mockResolvedValue(true),
      };

      ReorderAlert.find.mockResolvedValue([mockAlert]);
      Inventory.findById.mockResolvedValue({ _id: inventoryId, quantity: 15 });

      const result = await processPeriodicReminders(workingTime);

      expect(result.remindersSent).toBe(0);
      expect(mockAlert.status).toBe(REORDER_ALERT_STATUS.RESOLVED);
      expect(mockAlert.resolvedAt).toEqual(workingTime);
      expect(mockAlert.save).toHaveBeenCalled();
    });
  });
});
