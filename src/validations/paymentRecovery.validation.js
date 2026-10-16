const { isIdentifier } = require('./paymentMonitoring.validation');
function validatePaymentRecovery(req) {
  const errors = [];
  if (!isIdentifier(req.params.paymentId))
    errors.push({ field: 'paymentId', message: 'Invalid Payment identifier.' });
  for (const field of Object.keys(req.query || {}))
    errors.push({ field, message: 'Query parameters are not supported.' });
  const body = req.body === undefined ? {} : req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return [...errors, { field: 'body', message: 'A JSON object is required.' }];
  for (const field of Object.keys(body))
    if (field !== 'dryRun') errors.push({ field, message: 'Unsupported recovery field.' });
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean')
    errors.push({ field: 'dryRun', message: 'dryRun must be boolean.' });
  return errors;
}
module.exports = { validatePaymentRecovery };
