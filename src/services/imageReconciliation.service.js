const { ImageUpload, IMAGE_UPLOAD_STATUS } = require('../models/imageUpload.model');
const { deleteImage } = require('./imageUpload.service');
const { sanitizeLogMessage } = require('../utils/sanitizer');

const MAX_CLEANUP_ATTEMPTS = 3;
const DEFAULT_ABANDONED_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Reconciles and retries failed image cleanups up to MAX_CLEANUP_ATTEMPTS.
 *
 * @param {number} [maxAttempts=MAX_CLEANUP_ATTEMPTS]
 * @returns {Promise<{ attempted: number, succeeded: number, failed: number }>}
 */
async function reconcileFailedCleanups(maxAttempts = MAX_CLEANUP_ATTEMPTS) {
  const pendingCleanups = await ImageUpload.find({
    status: IMAGE_UPLOAD_STATUS.FAILED_CLEANUP,
    cleanupAttempts: { $lt: maxAttempts },
  });

  let succeeded = 0;
  let failed = 0;

  for (const record of pendingCleanups) {
    try {
      const deleteResult = await deleteImage(record.publicId);
      if (deleteResult.success) {
        record.status = IMAGE_UPLOAD_STATUS.DELETED;
        record.cleanupAttempts += 1;
        record.lastCleanupError = null;
        await record.save();
        succeeded += 1;
      } else {
        record.cleanupAttempts += 1;
        record.lastCleanupError = sanitizeLogMessage(
          `Provider deletion returned: ${deleteResult.result}`
        );
        await record.save();
        failed += 1;
      }
    } catch (err) {
      record.cleanupAttempts += 1;
      record.lastCleanupError = sanitizeLogMessage(err?.message || 'Deletion retry failed');
      await record.save();
      failed += 1;

      if (record.cleanupAttempts >= maxAttempts) {
        console.warn(
          `[ImageReconciliation] Asset ${record.publicId} reached maximum cleanup attempts (${maxAttempts}). Operational follow-up required.`
        );
      }
    }
  }

  return { attempted: pendingCleanups.length, succeeded, failed };
}

/**
 * Purges abandoned image uploads that remained in PENDING status longer than threshold.
 *
 * @param {number} [thresholdAgeMs=DEFAULT_ABANDONED_THRESHOLD_MS]
 * @returns {Promise<{ attempted: number, purged: number, failed: number }>}
 */
async function reconcileAbandonedUploads(thresholdAgeMs = DEFAULT_ABANDONED_THRESHOLD_MS) {
  const cutoffDate = new Date(Date.now() - thresholdAgeMs);

  const abandonedUploads = await ImageUpload.find({
    status: IMAGE_UPLOAD_STATUS.PENDING,
    createdAt: { $lt: cutoffDate },
  });

  let purged = 0;
  let failed = 0;

  for (const record of abandonedUploads) {
    try {
      const deleteResult = await deleteImage(record.publicId);
      if (deleteResult.success) {
        record.status = IMAGE_UPLOAD_STATUS.DELETED;
        record.cleanupAttempts += 1;
        record.lastCleanupError = null;
        await record.save();
        purged += 1;
      } else {
        record.status = IMAGE_UPLOAD_STATUS.FAILED_CLEANUP;
        record.cleanupAttempts += 1;
        record.lastCleanupError = sanitizeLogMessage(
          `Provider purge returned: ${deleteResult.result}`
        );
        await record.save();
        failed += 1;
      }
    } catch (err) {
      record.status = IMAGE_UPLOAD_STATUS.FAILED_CLEANUP;
      record.cleanupAttempts += 1;
      record.lastCleanupError = sanitizeLogMessage(err?.message || 'Purge abandoned asset failed');
      await record.save();
      failed += 1;
    }
  }

  return { attempted: abandonedUploads.length, purged, failed };
}

/**
 * Runs one combined reconciliation pass for both failed cleanups and abandoned uploads.
 * Safe execution: errors are logged and never throw unhandled exceptions.
 *
 * @returns {Promise<{ failedCleanups: object, abandonedUploads: object } | null>}
 */
async function runImageReconciliation() {
  try {
    const failedCleanups = await reconcileFailedCleanups();
    const abandonedUploads = await reconcileAbandonedUploads();
    return { failedCleanups, abandonedUploads };
  } catch (error) {
    console.error(
      '[ImageReconciliation] Error executing image reconciliation:',
      sanitizeLogMessage(error?.message || 'Unknown reconciliation error')
    );
    return null;
  }
}

module.exports = {
  MAX_CLEANUP_ATTEMPTS,
  DEFAULT_ABANDONED_THRESHOLD_MS,
  reconcileFailedCleanups,
  reconcileAbandonedUploads,
  runImageReconciliation,
};
