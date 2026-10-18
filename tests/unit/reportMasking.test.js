const {
  maskCustomerName,
  maskEmail,
  maskPhone,
  maskAddress,
  shapeReportCustomer,
} = require('../../src/utils/reportMasking');

describe('reportMasking utility (ADR-014 §11.2)', () => {
  describe('maskCustomerName', () => {
    it('masks full names preserving first character and 3 asterisks per token', () => {
      expect(maskCustomerName('Kasun Perera')).toBe('K*** P***');
      expect(maskCustomerName('Kamal Silva Fernando')).toBe('K*** S*** F***');
      expect(maskCustomerName('alice')).toBe('A***');
    });

    it('handles empty, null, and non-string inputs safely', () => {
      expect(maskCustomerName('')).toBe('N/A');
      expect(maskCustomerName('   ')).toBe('N/A');
      expect(maskCustomerName(null)).toBe('N/A');
      expect(maskCustomerName(undefined)).toBe('N/A');
      expect(maskCustomerName(12345)).toBe('N/A');
    });
  });

  describe('maskEmail', () => {
    it('masks email preserving first character and domain', () => {
      expect(maskEmail('kasun.p@gmail.com')).toBe('k***@gmail.com');
      expect(maskEmail('info@darshanaopticals.lk')).toBe('i***@darshanaopticals.lk');
    });

    it('handles malformed, empty or null emails safely', () => {
      expect(maskEmail('')).toBe('N/A');
      expect(maskEmail(null)).toBe('N/A');
      expect(maskEmail('invalid-email')).toBe('N/A');
      expect(maskEmail('@domain.com')).toBe('N/A');
    });
  });

  describe('maskPhone', () => {
    it('masks +94 international format preserving prefix and last 3 digits', () => {
      expect(maskPhone('+94771234567')).toBe('+94 77 **** 567');
      expect(maskPhone('+94 71 9876543')).toBe('+94 71 **** 543');
    });

    it('masks local Sri Lankan 0-format preserving area and last 3 digits', () => {
      expect(maskPhone('0771234567')).toBe('077 **** 567');
      expect(maskPhone('0112345678')).toBe('011 **** 678');
    });

    it('handles null, undefined and short inputs', () => {
      expect(maskPhone(null)).toBe('N/A');
      expect(maskPhone('')).toBe('N/A');
      expect(maskPhone('123')).toBe('****');
    });
  });

  describe('maskAddress', () => {
    it('omits street level and preserves locality / city', () => {
      expect(maskAddress('123 Galle Road, Colombo 03')).toBe('Colombo 03');
      expect(maskAddress('No 45, Temple Road, Kandy')).toBe('Kandy');
      expect(maskAddress('Gampaha')).toBe('Gampaha');
    });

    it('handles null, undefined and empty address values', () => {
      expect(maskAddress(null)).toBe('N/A');
      expect(maskAddress('')).toBe('N/A');
      expect(maskAddress('   ')).toBe('N/A');
    });
  });

  describe('shapeReportCustomer', () => {
    it('returns masked DTO without clinical or unmasked fields', () => {
      const rawCustomer = {
        firstName: 'Kasun',
        lastName: 'Perera',
        email: 'kasun.p@gmail.com',
        phone: '+94771234567',
        address: '123 Galle Road, Colombo 03',
        prescription: { sphere: -1.5, cylinder: 0.25 }, // Clinical data
        notes: 'Sensitive diagnosis',
      };

      const shaped = shapeReportCustomer(rawCustomer);

      expect(shaped).toEqual({
        name: 'K*** P***',
        email: 'k***@gmail.com',
        phone: '+94 77 **** 567',
        address: 'Colombo 03',
      });
      expect(shaped.prescription).toBeUndefined();
      expect(shaped.notes).toBeUndefined();
    });

    it('handles null customer record gracefully', () => {
      expect(shapeReportCustomer(null)).toEqual({
        name: 'N/A',
        email: 'N/A',
        phone: 'N/A',
        address: 'N/A',
      });
    });
  });
});
