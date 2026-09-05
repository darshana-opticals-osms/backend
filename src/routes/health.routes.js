const express = require('express');
const { getHealthStatus } = require('../controllers/health.controller');

const router = express.Router();

router.get('/health', getHealthStatus);

module.exports = router;
