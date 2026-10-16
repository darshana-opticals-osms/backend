const {
  sanitizeAuditMetadata,
  isProhibitedKey,
  MAX_METADATA_BYTES,
  MAX_DEPTH,
} = require('../../src/utils/auditSanitizer');
const { AUDIT_PROHIBITED_METADATA_KEYS } = require('../../src/constants/audit');

describe('auditSanitizer (Unit Tests)', () => {
  describe('isProhibitedKey', () => {
    it('should identify all AUDIT_PROHIBITED_METADATA_KEYS regardless of casing', () => {
      for (const key of AUDIT_PROHIBITED_METADATA_KEYS) {
        expect(isProhibitedKey(key)).toBe(true);
        expect(isProhibitedKey(key.toLowerCase())).toBe(true);
        expect(isProhibitedKey(key.toUpperCase())).toBe(true);
      }
    });

    it('should return false for benign operational keys', () => {
      const allowedKeys = [
        'previousQuantity',
        'newQuantity',
        'adjustmentDelta',
        'reason',
        'providerOrderId',
        'providerTransactionId',
        'statusFrom',
        'statusTo',
        'currency',
        'amount',
        'branchId',
        'prescriptionId',
        'customerId',
      ];

      for (const key of allowedKeys) {
        expect(isProhibitedKey(key)).toBe(false);
      }
    });
  });

  describe('sanitizeAuditMetadata', () => {
    it('should return null when input is null, undefined, or not a plain object', () => {
      expect(sanitizeAuditMetadata(null)).toBeNull();
      expect(sanitizeAuditMetadata(undefined)).toBeNull();
      expect(sanitizeAuditMetadata('a string')).toBeNull();
      expect(sanitizeAuditMetadata(12345)).toBeNull();
      expect(sanitizeAuditMetadata(true)).toBeNull();
      expect(sanitizeAuditMetadata(['an', 'array'])).toBeNull();
    });

    it('should remove all AUDIT_PROHIBITED_METADATA_KEYS from shallow metadata', () => {
      const sensitivePayload = {
        validField: 'allowed_value',
      };

      for (const prohibitedKey of AUDIT_PROHIBITED_METADATA_KEYS) {
        sensitivePayload[prohibitedKey] = 'sensitive_content';
        sensitivePayload[prohibitedKey.toUpperCase()] = 'sensitive_uppercase';
      }

      const result = sanitizeAuditMetadata(sensitivePayload);

      expect(result).toBeDefined();
      expect(result.validField).toBe('allowed_value');

      for (const prohibitedKey of AUDIT_PROHIBITED_METADATA_KEYS) {
        expect(result[prohibitedKey]).toBeUndefined();
        expect(result[prohibitedKey.toUpperCase()]).toBeUndefined();
      }
    });

    it('should remove prohibited keys deeply nested inside nested objects and arrays', () => {
      const nestedInput = {
        level1: {
          password: 'secret_password',
          safeField1: 'keep_me',
          level2: {
            cvv: '123',
            cardNumber: '4111111111111111',
            safeField2: 'also_keep_me',
            list: [
              { token: 'bearer-xyz', itemCode: 'ITEM-1' },
              { secret: 'topsecret', itemCode: 'ITEM-2' },
            ],
          },
        },
      };

      const result = sanitizeAuditMetadata(nestedInput);

      expect(result.level1.safeField1).toBe('keep_me');
      expect(result.level1.password).toBeUndefined();
      expect(result.level1.level2.safeField2).toBe('also_keep_me');
      expect(result.level1.level2.cvv).toBeUndefined();
      expect(result.level1.level2.cardNumber).toBeUndefined();
      expect(result.level1.level2.list).toHaveLength(2);
      expect(result.level1.level2.list[0].itemCode).toBe('ITEM-1');
      expect(result.level1.level2.list[0].token).toBeUndefined();
      expect(result.level1.level2.list[1].itemCode).toBe('ITEM-2');
      expect(result.level1.level2.list[1].secret).toBeUndefined();
    });

    it('should strip MongoDB operator injection keys ($gt, dot-notation keys)', () => {
      const injectionAttempt = {
        $gt: 'malicious',
        $ne: 'injection',
        'user.password': 'dot_attack',
        normalKey: 'normalValue',
      };

      const result = sanitizeAuditMetadata(injectionAttempt);

      expect(result.$gt).toBeUndefined();
      expect(result.$ne).toBeUndefined();
      expect(result['user.password']).toBeUndefined();
      expect(result.normalKey).toBe('normalValue');
    });

    it('should truncate recursion beyond MAX_DEPTH with [DEPTH_LIMIT]', () => {
      // Build an object with depth > MAX_DEPTH (7 levels)
      let deepObj = { terminal: 'deepest_value' };
      for (let i = 0; i <= MAX_DEPTH + 1; i++) {
        deepObj = { nested: deepObj };
      }

      const result = sanitizeAuditMetadata(deepObj);

      let current = result;
      for (let i = 0; i <= MAX_DEPTH; i++) {
        current = current.nested;
      }
      expect(current).toBe('[DEPTH_LIMIT]');
    });

    it('should strip functions, symbols, and undefined array elements', () => {
      const input = {
        fn: () => 'execute()',
        sym: Symbol('sym'),
        safeString: 'hello',
        arr: [1, () => 'inline', 2, Symbol('arr_sym'), 3],
      };

      const result = sanitizeAuditMetadata(input);

      expect(result.fn).toBeUndefined();
      expect(result.sym).toBeUndefined();
      expect(result.safeString).toBe('hello');
      expect(result.arr).toEqual([1, 2, 3]);
    });

    it('should throw an error when metadata serialization exceeds MAX_METADATA_BYTES', () => {
      const largePayload = {
        blob: 'A'.repeat(MAX_METADATA_BYTES + 100),
      };

      expect(() => sanitizeAuditMetadata(largePayload)).toThrow(
        /AuditEvent metadata exceeds the maximum allowed size/
      );
    });

    it('should throw an error for circular references', () => {
      const circular = { a: 'safe' };
      circular.self = circular;

      expect(() => sanitizeAuditMetadata(circular)).toThrow(
        /AuditEvent metadata is not JSON-serializable/
      );
    });

    it('should preserve primitive values and Date instances properly', () => {
      const date = new Date('2026-10-17T00:00:00Z');
      const input = {
        str: 'value',
        num: 42,
        bool: true,
        nullVal: null,
        dateVal: date,
      };

      const result = sanitizeAuditMetadata(input);

      expect(result.str).toBe('value');
      expect(result.num).toBe(42);
      expect(result.bool).toBe(true);
      expect(result.nullVal).toBeNull();
      expect(result.dateVal).toBe(date);
    });
  });
});
