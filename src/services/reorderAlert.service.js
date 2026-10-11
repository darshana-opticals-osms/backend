const mongoose = require('mongoose');
const ReorderAlert = require('../models/reorderAlert.model');
const InventoryConfig = require('../models/inventoryConfig.model');
const Inventory = require('../models/inventory.model');
const {
  REORDER_ALERT_STATUS,
  DEFAULT_REORDER_THRESHOLD,
  REMINDER_CONFIG,
} = require('../constants/inventoryAlert.constants');
const { ValidationError } = require('../errors/AppError');

const REORDER_THRESHOLD_KEY = 'REORDER_THRESHOLD';

/**
 * Retrieves the global reorder threshold from InventoryConfig or fallback to default.
 * @param {import('mongoose').ClientSession|null} [session=null]
 * @returns {Promise<number>}
 */
async function getGlobalReorderThreshold(session = null) {
  const query = InventoryConfig.findOne({ key: REORDER_THRESHOLD_KEY });
  if (session) {
    query.session(session);
  }
  const config = await query;
  if (config && typeof config.value === 'number' && Number.isFinite(config.value)) {
    return config.value;
  }
  return DEFAULT_REORDER_THRESHOLD;
}

/**
 * Sets the global reorder threshold and reconciles all inventory records.
 * @param {number} newThreshold
 * @param {string|mongoose.Types.ObjectId|null} [updatedBy=null]
 * @returns {Promise<{ threshold: number, reconciliation: { totalEvaluated: number } }>}
 */
async function setGlobalReorderThreshold(newThreshold, updatedBy = null) {
  if (
    typeof newThreshold !== 'number' ||
    !Number.isFinite(newThreshold) ||
    newThreshold < 0
  ) {
    throw new ValidationError('Reorder threshold must be a non-negative number.', {
      field: 'threshold',
    });
  }

  await InventoryConfig.findOneAndUpdate(
    { key: REORDER_THRESHOLD_KEY },
    { $set: { value: newThreshold, updatedBy } },
    { upsert: true, new: true, runValidators: true }
  );

  const reconciliation = await reconcileAllInventories(newThreshold);

  return {
    threshold: newThreshold,
    reconciliation,
  };
}

/**
 * Authoritatively evaluates the reorder alert state for an inventory item.
 * @param {object} inventoryRecord
 * @param {number|null} [threshold=null]
 * @param {import('mongoose').ClientSession|null} [session=null]
 * @returns {Promise<object|null>}
 */
async function evaluateReorderAlert(inventoryRecord, threshold = null, session = null) {
  if (!inventoryRecord || !inventoryRecord._id) {
    return null;
  }

  let effectiveThreshold = threshold;
  if (effectiveThreshold === null || effectiveThreshold === undefined) {
    effectiveThreshold = await getGlobalReorderThreshold(session);
  }

  const { quantity, _id: inventoryId, branchId } = inventoryRecord;

  if (quantity <= effectiveThreshold) {
    // Condition is LOW STOCK: ensure one active alert exists
    const query = ReorderAlert.findOne({
      inventoryId,
      status: REORDER_ALERT_STATUS.ACTIVE,
    });
    if (session) {
      query.session(session);
    }
    const existingActiveAlert = await query;

    if (existingActiveAlert) {
      // Deduplicate: update existing active alert rather than creating a new one
      existingActiveAlert.currentQuantity = quantity;
      existingActiveAlert.threshold = effectiveThreshold;
      await existingActiveAlert.save(session ? { session } : {});
      return existingActiveAlert;
    }

    // No active alert: create a new active alert record
    const alertData = {
      inventoryId,
      branchId,
      currentQuantity: quantity,
      threshold: effectiveThreshold,
      status: REORDER_ALERT_STATUS.ACTIVE,
    };

    if (session) {
      const [newAlert] = await ReorderAlert.create([alertData], { session });
      return newAlert;
    }

    return await ReorderAlert.create(alertData);
  }

  // Condition is NORMAL (quantity > threshold): resolve any existing active alert
  const query = ReorderAlert.findOne({
    inventoryId,
    status: REORDER_ALERT_STATUS.ACTIVE,
  });
  if (session) {
    query.session(session);
  }
  const existingActiveAlert = await query;

  if (existingActiveAlert) {
    existingActiveAlert.status = REORDER_ALERT_STATUS.RESOLVED;
    existingActiveAlert.resolvedAt = new Date();
    await existingActiveAlert.save(session ? { session } : {});
    return existingActiveAlert;
  }

  return null;
}

/**
 * Reconciles all existing inventory records against the authoritative threshold.
 * @param {number|null} [threshold=null]
 * @param {import('mongoose').ClientSession|null} [session=null]
 * @returns {Promise<{ totalEvaluated: number }>}
 */
async function reconcileAllInventories(threshold = null, session = null) {
  let effectiveThreshold = threshold;
  if (effectiveThreshold === null || effectiveThreshold === undefined) {
    effectiveThreshold = await getGlobalReorderThreshold(session);
  }

  const query = Inventory.find({});
  if (session) {
    query.session(session);
  }
  const items = await query;

  for (const item of items) {
    await evaluateReorderAlert(item, effectiveThreshold, session);
  }

  return { totalEvaluated: items.length };
}

/**
 * Retrieves active reorder alerts with optional branch filtering.
 * @param {{ branchId?: string, page?: number, limit?: number }} [options={}]
 * @returns {Promise<{ alerts: object[], total: number, page: number, limit: number }>}
 */
async function getActiveReorderAlerts({ branchId = null, page = 1, limit = 50 } = {}) {
  const filter = { status: REORDER_ALERT_STATUS.ACTIVE };

  if (branchId) {
    if (!mongoose.isValidObjectId(branchId)) {
      throw new ValidationError('Invalid branch reference.', { field: 'branchId' });
    }
    filter.branchId = branchId;
  }

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
  const skip = (safePage - 1) * safeLimit;

  const [alerts, total] = await Promise.all([
    ReorderAlert.find(filter)
      .populate('inventoryId', 'itemName category brand price quantity')
      .populate('branchId', 'name address city')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ReorderAlert.countDocuments(filter),
  ]);

  return {
    alerts,
    total,
    page: safePage,
    limit: safeLimit,
  };
}

/**
 * Checks and updates periodic reminders for active alerts during working hours (8 AM - 6 PM).
 * @param {Date} [currentTime=new Date()]
 * @returns {Promise<{ remindersSent: number, withinWorkingHours: boolean }>}
 */
async function processPeriodicReminders(currentTime = new Date()) {
  const currentHour = currentTime.getHours();
  const isWorkingHours =
    currentHour >= REMINDER_CONFIG.START_HOUR && currentHour < REMINDER_CONFIG.END_HOUR;

  if (!isWorkingHours) {
    return { remindersSent: 0, withinWorkingHours: false };
  }

  const intervalMs = REMINDER_CONFIG.INTERVAL_HOURS * 60 * 60 * 1000;
  const cutoffTime = new Date(currentTime.getTime() - intervalMs);

  const candidateAlerts = await ReorderAlert.find({
    status: REORDER_ALERT_STATUS.ACTIVE,
    $or: [
      { lastReminderSentAt: null },
      { lastReminderSentAt: { $lte: cutoffTime } },
    ],
  });

  let remindersSent = 0;

  for (const alert of candidateAlerts) {
    const inventory = await Inventory.findById(alert.inventoryId);
    if (!inventory) {
      continue;
    }

    if (inventory.quantity <= alert.threshold) {
      alert.currentQuantity = inventory.quantity;
      alert.lastReminderSentAt = currentTime;
      await alert.save();
      remindersSent += 1;
    } else {
      // Stock rose above threshold; resolve alert
      alert.status = REORDER_ALERT_STATUS.RESOLVED;
      alert.resolvedAt = currentTime;
      await alert.save();
    }
  }

  return { remindersSent, withinWorkingHours: true };
}

module.exports = {
  REORDER_THRESHOLD_KEY,
  getGlobalReorderThreshold,
  setGlobalReorderThreshold,
  evaluateReorderAlert,
  reconcileAllInventories,
  getActiveReorderAlerts,
  processPeriodicReminders,
};
