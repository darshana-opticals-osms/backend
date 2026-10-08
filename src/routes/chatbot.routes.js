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
 *       400:
 *         description: Bad Request — empty message or length exceeded.
 *       401:
 *         description: Unauthorized — valid customer JWT authentication required.
 *       403:
 *         description: Forbidden — restricted to CUSTOMER role.
 *       429:
 *         description: Too Many Requests — rate limit exceeded (10 requests/min).
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
