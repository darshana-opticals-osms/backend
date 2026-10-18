/**
 * Mask customer name according to ADR-014 §11.2:
 * Preserve first letter of each name token; mask remaining characters with 3 asterisks.
 * E.g., "Kasun Perera" -> "K*** P***"
 */
function maskCustomerName(name) {
  if (!name || typeof name !== 'string') {
    return 'N/A';
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return 'N/A';
  }

  return trimmed
    .split(/\s+/)
    .map((token) => `${token.charAt(0).toUpperCase()}***`)
    .join(' ');
}

/**
 * Mask email address according to ADR-014 §11.2:
 * Preserve first character of username; mask remainder with 3 asterisks; retain domain.
 * E.g., "kasun.p@gmail.com" -> "k***@gmail.com"
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') {
    return 'N/A';
  }

  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) {
    return 'N/A';
  }

  const firstChar = trimmed.charAt(0).toLowerCase();
  const domain = trimmed.slice(atIndex);
  return `${firstChar}***${domain}`;
}

/**
 * Mask phone number according to ADR-014 §11.2:
 * Retain country/area prefix and last 3 digits; mask middle digits.
 * E.g., "+94771234567" -> "+94 77 **** 567"
 * E.g., "0771234567" -> "077 **** 567"
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return 'N/A';
  }

  const cleaned = phone.replace(/[\s()-]/g, '');

  // International Sri Lankan format: +94XXXXXXXXX (12 chars with +)
  if (/^\+94\d{9}$/.test(cleaned)) {
    const area = cleaned.slice(3, 5);
    const last3 = cleaned.slice(-3);
    return `+94 ${area} **** ${last3}`;
  }

  // Local Sri Lankan format: 0XXXXXXXXX (10 chars)
  if (/^0\d{9}$/.test(cleaned)) {
    const area = cleaned.slice(0, 3);
    const last3 = cleaned.slice(-3);
    return `${area} **** ${last3}`;
  }

  // Fallback for other lengths: keep first 3 and last 3 if possible
  if (cleaned.length >= 7) {
    const start = cleaned.slice(0, 3);
    const end = cleaned.slice(-3);
    return `${start} **** ${end}`;
  }

  return '****';
}

/**
 * Mask delivery address according to ADR-014 §11.2:
 * Omit street-level address; retain only locality / city.
 * E.g., "123 Galle Road, Colombo 03" -> "Colombo 03"
 */
function maskAddress(address) {
  if (!address || typeof address !== 'string') {
    return 'N/A';
  }

  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return 'N/A';
  }

  // Return the last segment which represents city/locality
  return parts[parts.length - 1];
}

/**
 * Sanitize and mask order customer info DTO for report listing:
 * Strictly eliminates all clinical/prescription attributes and masks PII.
 */
function shapeReportCustomer(customer = {}) {
  if (!customer) {
    return {
      name: 'N/A',
      email: 'N/A',
      phone: 'N/A',
      address: 'N/A',
    };
  }

  const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.name || '';

  return {
    name: maskCustomerName(fullName),
    email: maskEmail(customer.email),
    phone: maskPhone(customer.phone),
    address: maskAddress(customer.address),
  };
}

module.exports = {
  maskCustomerName,
  maskEmail,
  maskPhone,
  maskAddress,
  shapeReportCustomer,
};
