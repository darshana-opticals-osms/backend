const mongoose = require('mongoose');
const {
  INQUIRY_TYPES,
  INQUIRY_TYPE_VALUES,
  RESPONSE_STATUSES,
  RESPONSE_STATUS_VALUES,
} = require('../constants/chatbot.constants');

/**
 * Chatbot Model (ADR-010 Section 9.3 & Baseline SDS)
 *
 * Persists interaction metadata (chatId, customerId, inquiryType, responseStatus).
 * Note: Message conversation contents are statelessly managed on the client (sessionStorage)
 * and are not persisted in MongoDB for maximum customer privacy (ADR-010 Section 9.3.2 & 11.6).
 */
const chatbotSchema = new mongoose.Schema(
  {
    // Baseline SDS field: Chat_ID (interaction UUID/unique string)
    chatId: {
      type: String,
      required: [true, 'chatId is required.'],
      unique: true,
      trim: true,
      index: true,
    },

    // Baseline SDS field: Customer_Id (authenticated customer reference)
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'customerId is required.'],
      index: true,
    },

    // Baseline SDS field: Inquiry_Type (categorization enum)
    inquiryType: {
      type: String,
      enum: {
        values: INQUIRY_TYPE_VALUES,
        message: 'inquiryType must be one of: ' + INQUIRY_TYPE_VALUES.join(', ') + '.',
      },
      default: INQUIRY_TYPES.GENERAL_INQUIRY,
      required: [true, 'inquiryType is required.'],
    },

    // Baseline SDS field: Response_Status (operational status enum)
    responseStatus: {
      type: String,
      enum: {
        values: RESPONSE_STATUS_VALUES,
        message: 'responseStatus must be one of: ' + RESPONSE_STATUS_VALUES.join(', ') + '.',
      },
      default: RESPONSE_STATUSES.ANSWERED,
      required: [true, 'responseStatus is required.'],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Chatbot', chatbotSchema);
