const mongoose = require('mongoose');
const Usage = require('../models/chatbotUsage.model');
const { AppError } = require('../errors/AppError');
const { CHATBOT_DEFAULTS } = require('../constants/chatbot.constants');

class ChatbotUsageService {
  static async reserve(customerId) {
    const _id = new mongoose.Types.ObjectId(customerId);
    const expired = { $lte: [{ $ifNull: ['$expiresAt', new Date(0)] }, '$$NOW'] };
    try {
      // Retry when first-window initialization or TTL deletion races admission.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const admitted = await Usage.findOneAndUpdate(
          {
            _id,
            $expr: {
              $or: [
                expired,
                { $lte: ['$messageCount', CHATBOT_DEFAULTS.MAX_SESSION_MESSAGES - 2] },
              ],
            },
          },
          [
            {
              $set: {
                windowStart: { $cond: [expired, '$$NOW', '$windowStart'] },
                expiresAt: {
                  $cond: [
                    expired,
                    { $add: ['$$NOW', CHATBOT_DEFAULTS.SESSION_WINDOW_MS] },
                    '$expiresAt',
                  ],
                },
                messageCount: { $cond: [expired, 2, { $add: ['$messageCount', 2] }] },
              },
            },
          ],
          { new: true, writeConcern: { w: 'majority' } }
        );
        if (admitted) return;
        const [active] = await Usage.aggregate([
          { $match: { _id } },
          {
            $match: {
              $expr: {
                $and: [
                  { $gt: ['$expiresAt', '$$NOW'] },
                  { $gte: ['$messageCount', CHATBOT_DEFAULTS.MAX_SESSION_MESSAGES] },
                ],
              },
            },
          },
          {
            $project: {
              retryAfter: { $ceil: { $divide: [{ $subtract: ['$expiresAt', '$$NOW'] }, 1000] } },
            },
          },
        ]);
        if (active) {
          const exhausted = new AppError(
            'Chatbot session message limit reached. Please try again later.',
            429,
            null,
            'CHATBOT_SESSION_EXHAUSTED'
          );
          exhausted.retryAfter = Math.max(1, active.retryAfter);
          throw exhausted;
        }
        // MongoDB forbids $expr in upserts. Initialize separately using only
        // the unique Customer key; this step never reserves or refunds slots.
        try {
          await Usage.updateOne(
            { _id },
            [
              {
                $set: {
                  windowStart: { $ifNull: ['$windowStart', '$$NOW'] },
                  expiresAt: {
                    $ifNull: [
                      '$expiresAt',
                      { $add: ['$$NOW', CHATBOT_DEFAULTS.SESSION_WINDOW_MS] },
                    ],
                  },
                  messageCount: { $ifNull: ['$messageCount', 0] },
                },
              },
            ],
            { upsert: true, writeConcern: { w: 'majority' } }
          );
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      }
      throw new Error('Usage admission contention');
    } catch (error) {
      if (error.errorCode === 'CHATBOT_SESSION_EXHAUSTED') throw error;
      throw new AppError(
        'Chatbot is temporarily unavailable. Please try again later.',
        503,
        null,
        'CHATBOT_USAGE_UNAVAILABLE',
        true
      );
    }
  }
}

module.exports = ChatbotUsageService;
