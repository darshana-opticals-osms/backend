const catchAsync = require('../utils/catchAsync');
const ChatbotService = require('../services/chatbot.service');
const { UnauthorizedError } = require('../errors/AppError');

/**
 * POST /api/v1/chatbot/query
 *
 * Processes a customer chatbot query statelessly using grounded RAG knowledge.
 * Access: Authenticated CUSTOMER role only (enforced via authenticate & authorizeRoles middleware).
 *
 * AC12 – Authentication required (CUSTOMER role under ADR-002)
 * AC13 – Customer ID derived securely from req.auth.userId, never from client body
 * AC15 – Message validated (non-empty, max 500 chars)
 * AC17 – Chatbot-specific rate limiting applied
 * AC31 – Safe provider response normalization
 */
const handleChatbotQuery = catchAsync(async (req, res) => {
  // AC13: Extract customer identity securely from verified JWT payload
  const customerId = req.auth?.userId || req.auth?.id || req.user?.id || req.user?.userId;

  if (!customerId) {
    throw new UnauthorizedError('Authenticated customer identity is missing.');
  }

  const { message, history } = req.body;

  const result = await ChatbotService.processQuery({
    customerId,
    message,
    history,
  });

  return res.status(200).json({
    status: 'success',
    data: {
      chatId: result.chatId,
      inquiryType: result.inquiryType,
      responseStatus: result.responseStatus,
      responseText: result.responseText,
    },
  });
});

module.exports = {
  handleChatbotQuery,
};
