const mongoose = require('mongoose');
const { ROLE_VALUES, CUSTOMER_ROLE_VALUES } = require('../constants/roles');
const { isPoints, toMinor } = require('../utils/loyaltyDecimal');
const { ForbiddenError } = require('../errors/AppError');

const customerSchema = new mongoose.Schema(
  {
    loyaltyBalance: {
      type: mongoose.Schema.Types.Decimal128,
      default() {
        return this.isNew ? '0.00' : undefined;
      },
      select: false,
      immutable: true,
      validate: isPoints,
    },
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
        delete ret.loyaltyBalance;
      },
    },
    toObject: {
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.loyaltyBalance;
      },
    },
  }
);

function rejectBalanceWrite() {
  throw new ForbiddenError(
    'Loyalty balance is maintained only by the loyalty service.',
    null,
    'LOYALTY_WRITE_FORBIDDEN'
  );
}
function assertInitialBalance(document) {
  if (document.loyaltyBalance !== undefined && toMinor(document.loyaltyBalance) !== 0n)
    rejectBalanceWrite();
}
customerSchema.pre('save', function () {
  if (this.isNew) assertInitialBalance(this);
  else if (this.isModified('loyaltyBalance')) rejectBalanceWrite();
});
customerSchema.pre('insertMany', function (next, documents) {
  try {
    for (const document of documents) {
      if (document.loyaltyBalance !== undefined)
        assertInitialBalance({
          loyaltyBalance: mongoose.Types.Decimal128.fromString(String(document.loyaltyBalance)),
        });
    }
    next();
  } catch (error) {
    next(error);
  }
});
function touchesBalance(update) {
  if (Array.isArray(update)) return true;
  if (!update || typeof update !== 'object') return false;
  return Object.entries(update).some(
    ([key, value]) =>
      key === 'loyaltyBalance' ||
      key.startsWith('loyaltyBalance.') ||
      (key === '$rename' &&
        Object.values(value).some((target) => String(target).startsWith('loyaltyBalance'))) ||
      (key.startsWith('$') && touchesBalance(value))
  );
}
customerSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'],
  function () {
    if (this.op.includes('Replace') || this.op === 'replaceOne' || touchesBalance(this.getUpdate()))
      rejectBalanceWrite();
  }
);
customerSchema.pre('bulkWrite', function (next, operations) {
  try {
    for (const operation of operations) {
      if (
        operation.replaceOne ||
        touchesBalance(operation.updateOne?.update) ||
        touchesBalance(operation.updateMany?.update)
      )
        rejectBalanceWrite();
      if (operation.insertOne?.document?.loyaltyBalance !== undefined)
        assertInitialBalance({
          loyaltyBalance: mongoose.Types.Decimal128.fromString(
            String(operation.insertOne.document.loyaltyBalance)
          ),
        });
    }
    next();
  } catch (error) {
    next(error);
  }
});

customerSchema.pre('aggregate', function () {
  if (
    this.pipeline().some((stage) => Object.hasOwn(stage, '$out') || Object.hasOwn(stage, '$merge'))
  )
    rejectBalanceWrite();
});

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
