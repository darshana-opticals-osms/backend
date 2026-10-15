const mongoose = require('mongoose');

// One shared usage window per Customer; no conversation content or tokens.
const schema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    windowStart: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    messageCount: { type: Number, required: true, min: 0, max: 20 },
  },
  { versionKey: false }
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ChatbotUsage', schema);
