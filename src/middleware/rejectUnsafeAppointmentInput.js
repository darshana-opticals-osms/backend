const { ValidationError } = require('../errors/AppError');

function findUnsafeKey(value, path = 'body') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const unsafePath = findUnsafeKey(value[index], `${path}[${index}]`);
      if (unsafePath) return unsafePath;
    }
    return null;
  }

  if (!value || typeof value !== 'object') return null;

  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.')) return `${path}.${key}`;
    const unsafePath = findUnsafeKey(child, `${path}.${key}`);
    if (unsafePath) return unsafePath;
  }
  return null;
}

function rejectUnsafeAppointmentInput(req, _res, next) {
  const unsafeBodyPath = findUnsafeKey(req.body);
  const unsafeQueryPath = findUnsafeKey(req.query, 'query');
  const unsafeParamPath = findUnsafeKey(req.params, 'params');

  if (unsafeBodyPath || unsafeQueryPath || unsafeParamPath) {
    return next(
      new ValidationError('Appointment requests cannot contain MongoDB operator or dotted keys.')
    );
  }

  if (Object.keys(req.query || {}).length > 0) {
    return next(new ValidationError('Appointment endpoints do not accept query parameters.'));
  }

  return next();
}

module.exports = { rejectUnsafeAppointmentInput, findUnsafeKey };
