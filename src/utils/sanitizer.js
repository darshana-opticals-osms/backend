/**
 * Recursively sanitizes input objects/strings to prevent Mongo query injection and XSS.
 *
 * @param {any} value - Input value to sanitize
 * @returns {any} Sanitized value
 */
const sanitizeValue = (value) => {
  if (typeof value === 'string') {
    let cleaned = value.trim();
    // Strip malicious script tags
    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    return cleaned;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value !== null && typeof value === 'object') {
    const sanitizedObj = {};
    for (const key of Object.keys(value)) {
      // Prevent MongoDB operator injection (keys starting with $ or containing .)
      if (key.startsWith('$') || key.includes('.')) {
        continue;
      }
      sanitizedObj[key] = sanitizeValue(value[key]);
    }
    return sanitizedObj;
  }

  return value;
};

/**
 * Express middleware to sanitize req.body, req.query, and req.params
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const sanitizeInput = (req, _res, next) => {
  if (req.body) req.body = sanitizeValue(req.body);
  if (req.query) req.query = sanitizeValue(req.query);
  if (req.params) req.params = sanitizeValue(req.params);
  next();
};

/**
 * Sanitizes log messages to strip passwords, secrets, tokens, DB URIs, and credentials before logging (ADR-008).
 *
 * @param {string} message - Message to sanitize
 * @returns {string} Sanitized string
 */
const sanitizeLogMessage = (message) => {
  if (typeof message !== 'string') {
    return '';
  }

  return message
    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, 'mongodb://[REDACTED]')
    .replace(/\b[A-Za-z]:\\[^,;)}\r\n]*?\.[A-Za-z0-9]{1,12}(?=$|[\s,;)}])/g, '[PATH REDACTED]')
    .replace(/(?<![:/])\/[^,;)}\r\n]*?\.[A-Za-z0-9]{1,12}(?=$|[\s,;)}])/g, '[PATH REDACTED]')
    .replace(/\b[A-Za-z]:\\[^\s,;)}]+/g, '[PATH REDACTED]')
    .replace(/(?<![:/])\/[^\s,;)}]+/g, '[PATH REDACTED]')
    .replace(
      /(password|passwd|pwd|secret|token|bearer|key|api_key|api_secret|authorization|auth|passwordHash)=([^\s&,{}]+)/gi,
      '$1=[REDACTED]'
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]');
};

module.exports = {
  sanitizeValue,
  sanitizeInput,
  sanitizeLogMessage,
};
