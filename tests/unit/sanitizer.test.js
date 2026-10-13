const { sanitizeValue } = require('../../src/utils/sanitizer');

describe('Sanitizer', () => {
  describe('sanitizeValue', () => {
    it('should trim whitespace and strip script tags given string inputs', () => {
      // Arrange
      const input = '  hello <script>alert("xss")</script> world  ';

      // Act
      const result = sanitizeValue(input);

      // Assert
      expect(result).toBe('hello  world');
    });

    it('should remove MongoDB query operator keys starting with $ or containing dot notation', () => {
      // Arrange
      const maliciousObj = {
        $gt: '',
        'user.name': 'admin',
        validKey: '  clean value  ',
      };

      // Act
      const result = sanitizeValue(maliciousObj);

      // Assert
      expect(result.$gt).toBeUndefined();
      expect(result['user.name']).toBeUndefined();
      expect(result.validKey).toBe('clean value');
    });

    it('should sanitize array elements recursively given an array of inputs', () => {
      // Arrange
      const input = ['  item1  ', '<script>bad</script>item2'];

      // Act
      const result = sanitizeValue(input);

      // Assert
      expect(result).toEqual(['item1', 'item2']);
    });
  });

  describe('sanitizeLogMessage', () => {
    const { sanitizeLogMessage } = require('../../src/utils/sanitizer');

    it('should redact sensitive credentials, api_secrets, and bearer tokens from messages', () => {
      const raw =
        'Error connecting with api_secret=supersecret123 and token=mytoken and Bearer eyJhbGciOi';
      const cleaned = sanitizeLogMessage(raw);

      expect(cleaned).toContain('api_secret=[REDACTED]');
      expect(cleaned).toContain('token=[REDACTED]');
      expect(cleaned).toContain('Bearer [REDACTED]');
      expect(cleaned).not.toContain('supersecret123');
    });

    it('should redact mongo URIs and system file paths', () => {
      const raw =
        'Failed at mongodb+srv://admin:pass@cluster.mongodb.net/test in E:\\project\\src\\app.js';
      const cleaned = sanitizeLogMessage(raw);

      expect(cleaned).toContain('mongodb://[REDACTED]');
      expect(cleaned).toContain('[PATH REDACTED]');
      expect(cleaned).not.toContain('cluster.mongodb.net');
    });

    it('should return empty string for non-string input', () => {
      expect(sanitizeLogMessage(null)).toBe('');
      expect(sanitizeLogMessage(undefined)).toBe('');
      expect(sanitizeLogMessage(123)).toBe('');
    });
  });
});
