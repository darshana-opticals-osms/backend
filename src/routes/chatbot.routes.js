const express = require('express');
const { handleChatbotQuery } = require('../controllers/chatbot.controller');
const authenticate = require('../middleware/authenticate');
const { authorizeRoles } = require('../middleware/authorizeRoles');
const { chatbotLimiter } = require('../middleware/rateLimiter');
const { validateChatbotQuery } = require('../validations/chatbot.validation');
const { ROLE_VALUES } = require('../constants/roles');

const router = express.Router();

/**
 * @openapi
 * /v1/chatbot/query:
 *   post:
 *     summary: Submit a grounded AI chatbot inquiry
 *     description: >
 *       Processes a customer question statelessly using grounded OSMS Knowledge Area articles and AI RAG generation.
 *       Full message logs are not persisted on the server for customer privacy (managed in browser sessionStorage).
 *       Requires authenticated CUSTOMER role.
 *       A shared fixed 30-minute Customer usage window permits 20 messages (10 question/reply exchanges).
 *       Each admitted query reserves two messages, including unsupported replies and failed requests.
 *       Manual retries/replays count again; automatic provider retries use the same reservation.
 *       Refresh, logout/login, tab close and clearing history do not reset usage. No reset endpoint exists.
 *       Only Customer reference, window timestamps and count are stored; expired usage uses MongoDB TTL cleanup.
 *     tags:
 *       - Chatbot
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 description: Grounded customer inquiry text (max 500 chars)
 *                 example: What are your store opening hours in Colombo?
 *               history:
 *                 type: array
 *                 description: Optional active session history (up to last 6 messages)
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                       enum: [user, assistant]
 *                     text:
 *                       type: string
 *     responses:
 *       200:
 *         description: Chatbot query processed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     chatId:
 *                       type: string
 *                       example: chat_12345
 *                     inquiryType:
 *                       type: string
 *                       example: STORE_INFO
 *                     responseStatus:
 *                       type: string
 *                       example: ANSWERED
 *                     responseText:
 *                       type: string
 *                       example: Darshana Opticals is open Monday to Saturday from 9:00 AM to 7:00 PM.
 *       422:
 *         description: Unprocessable Entity — validation error (empty message, length exceeded, or invalid history).
 *       401:
 *         description: Unauthorized — valid customer JWT authentication required.
 *       403:
 *         description: Forbidden — restricted to CUSTOMER role.
 *       429:
 *         description: Per-minute limit (RATE_LIMIT_EXCEEDED) or shared session budget (CHATBOT_SESSION_EXHAUSTED) exceeded.
 *         headers:
 *           Retry-After:
 *             description: Seconds until usage window expiry for CHATBOT_SESSION_EXHAUSTED.
 *             schema:
 *               type: integer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       enum: [RATE_LIMIT_EXCEEDED, CHATBOT_SESSION_EXHAUSTED]
 *                     message:
 *                       type: string
 *                       example: Chatbot session message limit reached. Please try again later.
 *       503:
 *         description: Usage admission unavailable (CHATBOT_USAGE_UNAVAILABLE); no retrieval or provider work performed.
 */
router.post(
  ['/v1/chatbot/query', '/chatbot/query'],
  authenticate,
  authorizeRoles(ROLE_VALUES.CUSTOMER),
  chatbotLimiter,
  validateChatbotQuery,
  handleChatbotQuery
);

module.exports = router;
