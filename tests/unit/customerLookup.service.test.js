const mongoose = require('mongoose');
const Customer = require('../../src/models/customer.model');
const {
  lookupCustomers,
  validateAndNormalizeQuery,
  shapeCustomer,
  escapeRegex,
  LOOKUP_RESULT_LIMIT,
  LOOKUP_QUERY_MIN_LENGTH,
  LOOKUP_QUERY_MAX_LENGTH,
} = require('../../src/services/customerLookup.service');
const { ValidationError } = require('../../src/errors/AppError');

// ─── Mock Customer Model ──────────────────────────────────────────────────────

const mockLean = jest.fn();
const mockLimit = jest.fn(() => ({ lean: mockLean }));
const mockSort = jest.fn(() => ({ limit: mockLimit }));
const mockSelect = jest.fn(() => ({ sort: mockSort }));

jest.mock('../../src/models/customer.model', () => ({
  find: jest.fn(),
}));

// Wire up the chainable mock before each test
beforeEach(() => {
  jest.clearAllMocks();
  mockLean.mockResolvedValue([]);
  Customer.find.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ sort: mockSort });
  mockSort.mockReturnValue({ limit: mockLimit });
  mockLimit.mockReturnValue({ lean: mockLean });
});

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Builds a minimal mock Customer document as returned from .lean() */
const buildMockCustomer = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  name: 'Kamal Perera',
  email: 'kamal.customer@example.com',
  phone: '+94 71 200 0001',
  ...overrides,
});

// ─── escapeRegex ─────────────────────────────────────────────────────────────

describe('escapeRegex', () => {
  it('should escape all regex metacharacters', () => {
    expect(escapeRegex('hello.world')).toBe('hello\\.world');
    expect(escapeRegex('a+b')).toBe('a\\+b');
    expect(escapeRegex('price^')).toBe('price\\^');
    expect(escapeRegex('(test)')).toBe('\\(test\\)');
    expect(escapeRegex('[abc]')).toBe('\\[abc\\]');
    expect(escapeRegex('{1,3}')).toBe('\\{1,3\\}');
    expect(escapeRegex('a|b')).toBe('a\\|b');
    expect(escapeRegex('a?b')).toBe('a\\?b');
    expect(escapeRegex('a*b')).toBe('a\\*b');
    expect(escapeRegex('a$b')).toBe('a\\$b');
    expect(escapeRegex('back\\slash')).toBe('back\\\\slash');
  });

  it('should return plain strings unchanged', () => {
    expect(escapeRegex('Kamal')).toBe('Kamal');
    expect(escapeRegex('alice')).toBe('alice');
    expect(escapeRegex('94 71')).toBe('94 71');
  });
});

// ─── validateAndNormalizeQuery ────────────────────────────────────────────────

describe('validateAndNormalizeQuery', () => {
  it('should return the trimmed query when it is valid', () => {
    expect(validateAndNormalizeQuery('  Kamal  ')).toBe('Kamal');
    expect(validateAndNormalizeQuery('ab')).toBe('ab');
    expect(validateAndNormalizeQuery('a'.repeat(LOOKUP_QUERY_MAX_LENGTH))).toBe(
      'a'.repeat(LOOKUP_QUERY_MAX_LENGTH)
    );
  });

  it('should throw ValidationError when query is not a string', () => {
    expect(() => validateAndNormalizeQuery(undefined)).toThrow(ValidationError);
    expect(() => validateAndNormalizeQuery(null)).toThrow(ValidationError);
    expect(() => validateAndNormalizeQuery(123)).toThrow(ValidationError);
    expect(() => validateAndNormalizeQuery({ $where: '1' })).toThrow(ValidationError);
  });

  it('should throw ValidationError when query is empty or whitespace only', () => {
    expect(() => validateAndNormalizeQuery('')).toThrow(ValidationError);
    expect(() => validateAndNormalizeQuery('   ')).toThrow(ValidationError);
    expect(() => validateAndNormalizeQuery('\t\n')).toThrow(ValidationError);
  });

  it(`should throw ValidationError when trimmed query is shorter than ${LOOKUP_QUERY_MIN_LENGTH} characters`, () => {
    expect(() => validateAndNormalizeQuery('a')).toThrow(ValidationError);
    expect(() => validateAndNormalizeQuery(' a ')).toThrow(ValidationError);
  });

  it(`should throw ValidationError when query exceeds ${LOOKUP_QUERY_MAX_LENGTH} characters`, () => {
    const tooLong = 'a'.repeat(LOOKUP_QUERY_MAX_LENGTH + 1);
    expect(() => validateAndNormalizeQuery(tooLong)).toThrow(ValidationError);
  });

  it('should accept exactly the minimum length boundary', () => {
    const minQuery = 'a'.repeat(LOOKUP_QUERY_MIN_LENGTH);
    expect(validateAndNormalizeQuery(minQuery)).toBe(minQuery);
  });

  it('should accept exactly the maximum length boundary', () => {
    const maxQuery = 'a'.repeat(LOOKUP_QUERY_MAX_LENGTH);
    expect(validateAndNormalizeQuery(maxQuery)).toBe(maxQuery);
  });
});

// ─── shapeCustomer ────────────────────────────────────────────────────────────

describe('shapeCustomer', () => {
  it('should return only id, name, email, phone', () => {
    const doc = buildMockCustomer();
    const result = shapeCustomer(doc);

    expect(result).toEqual({
      id: doc._id.toString(),
      name: doc.name,
      email: doc.email,
      phone: doc.phone,
    });
  });

  it('should never expose passwordHash (AC17)', () => {
    const doc = buildMockCustomer({ passwordHash: '$2b$12$something' });
    const result = shapeCustomer(doc);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('should never expose address (AC18)', () => {
    const doc = buildMockCustomer({ address: '15 Station Road, Nugegoda' });
    const result = shapeCustomer(doc);
    expect(result).not.toHaveProperty('address');
  });

  it('should never expose role', () => {
    const doc = buildMockCustomer({ role: 'CUSTOMER' });
    const result = shapeCustomer(doc);
    expect(result).not.toHaveProperty('role');
  });

  it('should never expose createdAt or updatedAt', () => {
    const doc = buildMockCustomer({ createdAt: new Date(), updatedAt: new Date() });
    const result = shapeCustomer(doc);
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('updatedAt');
  });

  it('should convert _id ObjectId to string for the id field (AC16)', () => {
    const doc = buildMockCustomer();
    const result = shapeCustomer(doc);
    expect(typeof result.id).toBe('string');
    expect(result.id).toBe(doc._id.toString());
  });
});

// ─── lookupCustomers ─────────────────────────────────────────────────────────

describe('lookupCustomers', () => {
  describe('query validation', () => {
    it('should throw ValidationError for a missing query (AC9)', async () => {
      await expect(lookupCustomers(undefined)).rejects.toThrow(ValidationError);
      expect(Customer.find).not.toHaveBeenCalled();
    });

    it('should throw ValidationError for an empty string query (AC9)', async () => {
      await expect(lookupCustomers('')).rejects.toThrow(ValidationError);
      expect(Customer.find).not.toHaveBeenCalled();
    });

    it('should throw ValidationError for a whitespace-only query (AC9)', async () => {
      await expect(lookupCustomers('   ')).rejects.toThrow(ValidationError);
      expect(Customer.find).not.toHaveBeenCalled();
    });

    it('should throw ValidationError when query is too short (AC9)', async () => {
      await expect(lookupCustomers('a')).rejects.toThrow(ValidationError);
      expect(Customer.find).not.toHaveBeenCalled();
    });

    it('should throw ValidationError when query is too long (AC9)', async () => {
      const tooLong = 'x'.repeat(LOOKUP_QUERY_MAX_LENGTH + 1);
      await expect(lookupCustomers(tooLong)).rejects.toThrow(ValidationError);
      expect(Customer.find).not.toHaveBeenCalled();
    });

    it('should throw ValidationError when query is not a string (AC10)', async () => {
      await expect(lookupCustomers({ $where: 'this.name' })).rejects.toThrow(ValidationError);
      expect(Customer.find).not.toHaveBeenCalled();
    });
  });

  describe('safe query construction (AC10, AC11)', () => {
    it('should construct the $or filter with $regex and case-insensitive option', async () => {
      mockLean.mockResolvedValue([]);

      await lookupCustomers('Kamal');

      expect(Customer.find).toHaveBeenCalledWith({
        $or: [
          { name: { $regex: 'Kamal', $options: 'i' } },
          { email: { $regex: 'Kamal', $options: 'i' } },
          { phone: { $regex: 'Kamal', $options: 'i' } },
        ],
      });
    });

    it('should escape regex metacharacters in the query before passing to $regex (AC11)', async () => {
      mockLean.mockResolvedValue([]);

      await lookupCustomers('te.st');

      expect(Customer.find).toHaveBeenCalledWith({
        $or: [
          { name: { $regex: 'te\\.st', $options: 'i' } },
          { email: { $regex: 'te\\.st', $options: 'i' } },
          { phone: { $regex: 'te\\.st', $options: 'i' } },
        ],
      });
    });

    it('should escape a query containing multiple regex metacharacters (AC11)', async () => {
      mockLean.mockResolvedValue([]);

      await lookupCustomers('a+b^c');

      const callArg = Customer.find.mock.calls[0][0];
      // Each $regex value must have the metacharacters escaped
      expect(callArg.$or[0].name.$regex).toBe('a\\+b\\^c');
      expect(callArg.$or[1].email.$regex).toBe('a\\+b\\^c');
      expect(callArg.$or[2].phone.$regex).toBe('a\\+b\\^c');
    });

    it('should trim leading/trailing whitespace from the query before searching (AC9)', async () => {
      mockLean.mockResolvedValue([]);

      await lookupCustomers('  Kamal  ');

      const callArg = Customer.find.mock.calls[0][0];
      expect(callArg.$or[0].name.$regex).toBe('Kamal');
    });

    it('should never use password or authentication data as search criteria (AC7)', async () => {
      mockLean.mockResolvedValue([]);

      await lookupCustomers('Kamal');

      const callArg = Customer.find.mock.calls[0][0];
      const filterKeys = JSON.stringify(callArg);
      expect(filterKeys).not.toContain('passwordHash');
      expect(filterKeys).not.toContain('password');
    });

    it('should never use address as a search criterion (AC8)', async () => {
      mockLean.mockResolvedValue([]);

      await lookupCustomers('Kamal');

      const callArg = Customer.find.mock.calls[0][0];
      const filterKeys = JSON.stringify(callArg);
      expect(filterKeys).not.toContain('address');
    });
  });

  describe('result projection and shaping (AC15-AC22)', () => {
    it('should select only name, email, phone fields from the database (AC15)', async () => {
      mockLean.mockResolvedValue([]);
      await lookupCustomers('Kamal');
      expect(mockSelect).toHaveBeenCalledWith('name email phone');
    });

    it('should return shaped results with only id, name, email, phone (AC15)', async () => {
      const raw = buildMockCustomer();
      mockLean.mockResolvedValue([raw]);

      const results = await lookupCustomers('Kamal');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: raw._id.toString(),
        name: raw.name,
        email: raw.email,
        phone: raw.phone,
      });
    });

    it('should not expose passwordHash in the response (AC17)', async () => {
      const raw = buildMockCustomer({ passwordHash: '$2b$12$hashed' });
      mockLean.mockResolvedValue([raw]);

      const results = await lookupCustomers('Kamal');
      const bodyText = JSON.stringify(results);

      expect(bodyText).not.toContain('passwordHash');
      expect(bodyText).not.toContain('$2b$');
    });

    it('should not expose address in the response (AC18)', async () => {
      const raw = buildMockCustomer({ address: '15 Station Road, Nugegoda' });
      mockLean.mockResolvedValue([raw]);

      const results = await lookupCustomers('Kamal');
      const bodyText = JSON.stringify(results);

      expect(bodyText).not.toContain('address');
      expect(bodyText).not.toContain('Station Road');
    });

    it('should not expose Prescription data (AC19)', async () => {
      const raw = buildMockCustomer({ prescriptions: [{ rightEye: { sph: -1.25 } }] });
      mockLean.mockResolvedValue([raw]);

      const results = await lookupCustomers('Kamal');
      const bodyText = JSON.stringify(results);

      expect(bodyText).not.toContain('prescriptions');
      expect(bodyText).not.toContain('rightEye');
    });

    it('should not expose Order data (AC20)', async () => {
      const raw = buildMockCustomer({ orders: [{ orderId: 'ORD001' }] });
      mockLean.mockResolvedValue([raw]);

      const results = await lookupCustomers('Kamal');
      const bodyText = JSON.stringify(results);

      expect(bodyText).not.toContain('orders');
    });

    it('should not expose Payment data (AC21)', async () => {
      const raw = buildMockCustomer({ payments: [{ amount: 5000 }] });
      mockLean.mockResolvedValue([raw]);

      const results = await lookupCustomers('Kamal');
      const bodyText = JSON.stringify(results);

      expect(bodyText).not.toContain('payments');
    });
  });

  describe('result set behaviour (AC23-AC27)', () => {
    it('should return an empty array when no Customers match (AC23)', async () => {
      mockLean.mockResolvedValue([]);

      const results = await lookupCustomers('Nonexistent');

      expect(results).toEqual([]);
    });

    it('should return multiple matching Customers safely (AC24)', async () => {
      const customers = [
        buildMockCustomer({ name: 'Alice Silva' }),
        buildMockCustomer({ name: 'Alice Fernando' }),
      ];
      mockLean.mockResolvedValue(customers);

      const results = await lookupCustomers('Alice');

      expect(results).toHaveLength(2);
    });

    it(`should apply a result limit of ${LOOKUP_RESULT_LIMIT} (AC25)`, async () => {
      mockLean.mockResolvedValue([]);
      await lookupCustomers('Kamal');
      expect(mockLimit).toHaveBeenCalledWith(LOOKUP_RESULT_LIMIT);
    });

    it('should apply deterministic ordering: name ASC, _id ASC tiebreak (AC26)', async () => {
      mockLean.mockResolvedValue([]);
      await lookupCustomers('Kamal');
      expect(mockSort).toHaveBeenCalledWith({ name: 1, _id: 1 });
    });

    it('should return each matched Customer with an authoritative id (AC16)', async () => {
      const customers = [buildMockCustomer(), buildMockCustomer()];
      mockLean.mockResolvedValue(customers);

      const results = await lookupCustomers('Kamal');

      results.forEach((r, i) => {
        expect(r.id).toBe(customers[i]._id.toString());
        expect(typeof r.id).toBe('string');
      });
    });

    it('should use .lean() for efficient plain-object results', async () => {
      mockLean.mockResolvedValue([]);
      await lookupCustomers('Kamal');
      expect(mockLean).toHaveBeenCalled();
    });
  });

  describe('name, email, phone lookup (AC6, AC12, AC13, AC14)', () => {
    it('should include name in the $or search criteria (AC6)', async () => {
      mockLean.mockResolvedValue([]);
      await lookupCustomers('Kamal');

      const callArg = Customer.find.mock.calls[0][0];
      const fields = callArg.$or.map((clause) => Object.keys(clause)[0]);
      expect(fields).toContain('name');
    });

    it('should include email in the $or search criteria (AC6, AC13)', async () => {
      mockLean.mockResolvedValue([]);
      await lookupCustomers('kamal');

      const callArg = Customer.find.mock.calls[0][0];
      const fields = callArg.$or.map((clause) => Object.keys(clause)[0]);
      expect(fields).toContain('email');
    });

    it('should include phone in the $or search criteria (AC6, AC14)', async () => {
      mockLean.mockResolvedValue([]);
      await lookupCustomers('94711');

      const callArg = Customer.find.mock.calls[0][0];
      const fields = callArg.$or.map((clause) => Object.keys(clause)[0]);
      expect(fields).toContain('phone');
    });

    it('should use case-insensitive matching for name (AC12)', async () => {
      mockLean.mockResolvedValue([]);
      await lookupCustomers('kamal');

      const callArg = Customer.find.mock.calls[0][0];
      const nameClause = callArg.$or.find((c) => c.name);
      expect(nameClause.name.$options).toBe('i');
    });

    it('should use case-insensitive matching for email (AC12, AC13)', async () => {
      mockLean.mockResolvedValue([]);
      await lookupCustomers('kamal');

      const callArg = Customer.find.mock.calls[0][0];
      const emailClause = callArg.$or.find((c) => c.email);
      expect(emailClause.email.$options).toBe('i');
    });
  });
});
