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
});
