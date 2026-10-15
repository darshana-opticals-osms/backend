const mongoose = require('mongoose');
const { ROLE_VALUES, CUSTOMER_ROLE_VALUES } = require('../constants/roles');

const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address.'],
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\+?[0-9\s()-]{7,20}$/, 'Please provide a valid phone number.'],
    },
    role: {
      type: String,
      default: ROLE_VALUES.CUSTOMER,
      enum: CUSTOMER_ROLE_VALUES,
      immutable: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
      validate: {
        validator(value) {
          return typeof value === 'string' && value.length >= 60 && value.startsWith('$2');
        },
        message: 'Password hash must be a bcrypt-style hash.',
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash;
      },
    },
    toObject: {
      transform(_doc, ret) {
        delete ret.passwordHash;
      },
    },
  }
);

// Account deletion must also remove ephemeral chatbot usage metadata.
customerSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], async function () {
  const query = this.model.find(this.getFilter()).select('_id');
  if (this.op !== 'deleteMany') query.limit(1);
  const customers = await query.session(this.getOptions().session || null).lean();
  this.chatbotUsageCustomerIds = customers.map((customer) => customer._id);
});
customerSchema.post(['deleteOne', 'deleteMany', 'findOneAndDelete'], async function () {
  const Usage = require('./chatbotUsage.model');
  await Usage.deleteMany({ _id: { $in: this.chatbotUsageCustomerIds || [] } }).session(
    this.getOptions().session || null
  );
});
customerSchema.post('deleteOne', { document: true, query: false }, async function () {
  const Usage = require('./chatbotUsage.model');
  await Usage.deleteOne({ _id: this._id }).session(this.$session());
});

module.exports = mongoose.model('Customer', customerSchema);
