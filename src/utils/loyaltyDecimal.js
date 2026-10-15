const { ValidationError } = require('../errors/AppError');

// Integer hundredths internally; Decimal128 strings at persistence/DTO boundaries.
// Never round binary floats.
function toMinor(value) {
  const text =
    typeof value === 'string' ? value : value?._bsontype === 'Decimal128' ? value.toString() : '';
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text))
    throw new ValidationError('A finite decimal with at most two places is required.');
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor.toString().length > 34) throw new ValidationError('Decimal128 precision exceeded.');
  return negative ? -minor : minor;
}

function fromMinor(minor) {
  if (typeof minor !== 'bigint' || (minor < 0n ? -minor : minor).toString().length > 34)
    throw new ValidationError('Decimal128 precision exceeded.');
  const absolute = minor < 0n ? -minor : minor;
  return `${minor < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function isPoints(value) {
  try {
    toMinor(value);
    return true;
  } catch {
    return false;
  }
}

// Arithmetic utility only, never an HTTP input or an earning authorization boundary.
function calculateEarnedPoints(eligibleSpend) {
  const cents = toMinor(eligibleSpend);
  if (cents < 0n) throw new ValidationError('Eligible spend cannot be negative.');
  // Spend has already been aggregated. Round the final nonnegative points once, HALF_UP.
  return fromMinor((cents + 50n) / 100n);
}

module.exports = { toMinor, fromMinor, isPoints, calculateEarnedPoints };
