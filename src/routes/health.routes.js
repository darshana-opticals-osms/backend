const express = require('express');
const { getHealthStatus } = require('../controllers/health.controller');

const router = express.Router();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: System health check
 *     description: Returns the backend service status without authentication.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - status
 *                 - service
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 service:
 *                   type: string
 *                   example: osms-backend
 */
router.get('/health', getHealthStatus);

module.exports = router;
