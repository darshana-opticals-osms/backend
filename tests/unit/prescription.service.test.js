const mongoose = require('mongoose');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Prescription = require('../../src/models/prescription.model');
const {
  createPrescription,
  getMyPrescriptionHistory,
  getCustomerPrescriptionHistory,
  shapePrescription,
  validateCustomerExists,
  validateStaffExists,
  INVALID_CUSTOMER_REFERENCE,
  INVALID_STAFF_REFERENCE,
} = require('../../src/services/prescription.service');

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../src/models/customer.model', () => ({
  exists: jest.fn(),
}));

jest.mock('../../src/models/staff.model', () => ({
  exists: jest.fn(),
}));

jest.mock('../../src/models/prescription.model', () => ({
  create: jest.fn(),
  find: jest.fn(),
}));

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const validCustomerId = new mongoose.Types.ObjectId().toString();
const validStaffId = new mongoose.Types.ObjectId().toString();
const validPrescriptionId = new mongoose.Types.ObjectId();

/** Minimal valid clinical input for prescription creation. */
const validClinicalInput = {
  customerId: validCustomerId,
  rightEye: {
    distance: { sph: -1.25, cyl: -0.5, axis: 90, va: '6/6' },
    reading: { add: 1.0, nearVa: 'N8' },
  },
  leftEye: {
    distance: { sph: -1.5, cyl: -0.75, axis: 85, va: '6/9' },
    reading: { add: 1.0, nearVa: 'N8' },
  },
  remarks: 'Routine check.',
};

/** Builds a mock Prescription document returned by Prescription.create(). */
const buildMockPrescriptionDoc = (overrides = {}) => {
  const staffId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();

  return {
    _id: validPrescriptionId,
    customerId,
    recordedBy: { _id: staffId, name: 'Dr. Nimal', toString: () => staffId.toString() },
    recordedAt: new Date('2024-05-01T10:00:00.000Z'),
    rightEye: {
      distance: { sph: -1.25, cyl: -0.5, axis: 90, va: '6/6' },
      reading: { add: 1.0, nearVa: 'N8' },
    },
    leftEye: {
      distance: { sph: -1.5, cyl: -0.75, axis: 85, va: '6/9' },
      reading: { add: 1.0, nearVa: 'N8' },
    },
    remarks: 'Routine check.',
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    populate: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Prescription service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── validateCustomerExists ───────────────────────────────────────────────────

  describe('validateCustomerExists', () => {
    it('should resolve when the customer exists', async () => {
      // Arrange
      Customer.exists.mockResolvedValue({ _id: validCustomerId });

      // Act & Assert
      await expect(validateCustomerExists(validCustomerId)).resolves.toBeUndefined();
      expect(Customer.exists).toHaveBeenCalledWith({ _id: validCustomerId });
    });

    it('should throw ValidationError (422) given a malformed customerId', async () => {
      // Arrange - Act - Assert
      await expect(validateCustomerExists('not-an-object-id')).rejects.toMatchObject({
        statusCode: 422,
        errorCode: INVALID_CUSTOMER_REFERENCE,
      });

      expect(Customer.exists).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError (404) given a well-formed but non-existent customerId', async () => {
      // Arrange
      Customer.exists.mockResolvedValue(null);

      // Act & Assert
      await expect(validateCustomerExists(validCustomerId)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: INVALID_CUSTOMER_REFERENCE,
      });
    });
  });

  // ── validateStaffExists ──────────────────────────────────────────────────────

  describe('validateStaffExists', () => {
    it('should resolve when the staff exists', async () => {
      // Arrange
      Staff.exists.mockResolvedValue({ _id: validStaffId });

      // Act & Assert
      await expect(validateStaffExists(validStaffId)).resolves.toBeUndefined();
      expect(Staff.exists).toHaveBeenCalledWith({ _id: validStaffId });
    });

    it('should throw ValidationError (422) given a malformed staffId', async () => {
      // Arrange - Act - Assert
      await expect(validateStaffExists('not-an-object-id')).rejects.toMatchObject({
        statusCode: 422,
        errorCode: INVALID_STAFF_REFERENCE,
      });

      expect(Staff.exists).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError (404) given a well-formed but non-existent staffId', async () => {
      // Arrange
      Staff.exists.mockResolvedValue(null);

      // Act & Assert
      await expect(validateStaffExists(validStaffId)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: INVALID_STAFF_REFERENCE,
      });
    });
  });

  // ── createPrescription ───────────────────────────────────────────────────────

  describe('createPrescription', () => {
    it('should create a prescription given an authorized Optometrist and a valid customer', async () => {
      // Arrange
      Staff.exists.mockResolvedValue({ _id: validStaffId });
      Customer.exists.mockResolvedValue({ _id: validCustomerId });

      const mockDoc = buildMockPrescriptionDoc();
      Prescription.create.mockResolvedValue(mockDoc);

      // Act
      const result = await createPrescription(validStaffId, validClinicalInput);

      // Assert
      expect(Staff.exists).toHaveBeenCalledWith({ _id: validStaffId });
      expect(Customer.exists).toHaveBeenCalledWith({ _id: validCustomerId });
      expect(Prescription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: validCustomerId,
          recordedBy: validStaffId,
        })
      );
      expect(result).toHaveProperty('id');
    });

    it('should derive recordedBy from the authenticated staff identity, not from client input', async () => {
      // Arrange
      const clientSuppliedRecordedBy = new mongoose.Types.ObjectId().toString();
      const maliciousInput = {
        ...validClinicalInput,
        recordedBy: clientSuppliedRecordedBy, // client tries to override
      };

      Staff.exists.mockResolvedValue({ _id: validStaffId });
      Customer.exists.mockResolvedValue({ _id: validCustomerId });

      const mockDoc = buildMockPrescriptionDoc();
      Prescription.create.mockResolvedValue(mockDoc);

      // Act
      await createPrescription(validStaffId, maliciousInput);

      // Assert — recordedBy must be the server-side staffId, never the client value
      expect(Prescription.create).toHaveBeenCalledWith(
        expect.objectContaining({ recordedBy: validStaffId })
      );
      expect(Prescription.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ recordedBy: clientSuppliedRecordedBy })
      );
    });

    it('should reject prescription creation when the authenticated staff does not exist', async () => {
      // Arrange
      Staff.exists.mockResolvedValue(null);

      // Act & Assert
      await expect(createPrescription(validStaffId, validClinicalInput)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: INVALID_STAFF_REFERENCE,
      });

      expect(Customer.exists).not.toHaveBeenCalled();
      expect(Prescription.create).not.toHaveBeenCalled();
    });

    it('should reject prescription creation when the target customer does not exist', async () => {
      // Arrange
      Staff.exists.mockResolvedValue({ _id: validStaffId });
      Customer.exists.mockResolvedValue(null);

      // Act & Assert
      await expect(createPrescription(validStaffId, validClinicalInput)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: INVALID_CUSTOMER_REFERENCE,
      });

      expect(Prescription.create).not.toHaveBeenCalled();
    });

    it('should reject prescription creation when customerId is malformed', async () => {
      // Arrange
      Staff.exists.mockResolvedValue({ _id: validStaffId });

      const malformedInput = { ...validClinicalInput, customerId: 'bad-id' };

      // Act & Assert
      await expect(createPrescription(validStaffId, malformedInput)).rejects.toMatchObject({
        statusCode: 422,
        errorCode: INVALID_CUSTOMER_REFERENCE,
      });

      expect(Prescription.create).not.toHaveBeenCalled();
    });

    it('should insert a new Prescription record rather than overwriting an existing one', async () => {
      // Arrange — two sequential creation calls to the same customer
      Staff.exists.mockResolvedValue({ _id: validStaffId });
      Customer.exists.mockResolvedValue({ _id: validCustomerId });

      const mockDoc1 = buildMockPrescriptionDoc();
      const mockDoc2 = buildMockPrescriptionDoc({
        _id: new mongoose.Types.ObjectId(),
        remarks: 'Corrected prescription.',
      });

      Prescription.create.mockResolvedValueOnce(mockDoc1).mockResolvedValueOnce(mockDoc2);

      // Act
      await createPrescription(validStaffId, validClinicalInput);
      await createPrescription(validStaffId, {
        ...validClinicalInput,
        remarks: 'Corrected prescription.',
      });

      // Assert — create must have been called twice, proving insert-only behavior
      expect(Prescription.create).toHaveBeenCalledTimes(2);
    });

    it('should accept right eye clinical fields (sph, cyl, axis, va, add, nearVa)', async () => {
      // Arrange
      Staff.exists.mockResolvedValue({ _id: validStaffId });
      Customer.exists.mockResolvedValue({ _id: validCustomerId });

      const mockDoc = buildMockPrescriptionDoc();
      Prescription.create.mockResolvedValue(mockDoc);

      // Act & Assert — should not throw
      await expect(createPrescription(validStaffId, validClinicalInput)).resolves.toBeDefined();

      const callArg = Prescription.create.mock.calls[0][0];
      expect(callArg).toHaveProperty('rightEye');
    });

    it('should accept left eye clinical fields (sph, cyl, axis, va, add, nearVa)', async () => {
      // Arrange
      Staff.exists.mockResolvedValue({ _id: validStaffId });
      Customer.exists.mockResolvedValue({ _id: validCustomerId });

      const mockDoc = buildMockPrescriptionDoc();
      Prescription.create.mockResolvedValue(mockDoc);

      // Act & Assert
      await expect(createPrescription(validStaffId, validClinicalInput)).resolves.toBeDefined();

      const callArg = Prescription.create.mock.calls[0][0];
      expect(callArg).toHaveProperty('leftEye');
    });

    it('should pass the remarks field to Prescription.create', async () => {
      // Arrange
      Staff.exists.mockResolvedValue({ _id: validStaffId });
      Customer.exists.mockResolvedValue({ _id: validCustomerId });

      const mockDoc = buildMockPrescriptionDoc();
      Prescription.create.mockResolvedValue(mockDoc);

      // Act
      await createPrescription(validStaffId, validClinicalInput);

      // Assert
      const callArg = Prescription.create.mock.calls[0][0];
      expect(callArg.remarks).toBe(validClinicalInput.remarks);
    });

    it('should record a correction as a new Prescription document, leaving the original intact', async () => {
      // Arrange
      Staff.exists.mockResolvedValue({ _id: validStaffId });
      Customer.exists.mockResolvedValue({ _id: validCustomerId });

      const originalId = new mongoose.Types.ObjectId();
      const correctionId = new mongoose.Types.ObjectId();

      const originalDoc = buildMockPrescriptionDoc({ _id: originalId });
      const correctionDoc = buildMockPrescriptionDoc({
        _id: correctionId,
        remarks: 'Correction of original.',
      });

      Prescription.create.mockResolvedValueOnce(originalDoc).mockResolvedValueOnce(correctionDoc);

      // Act
      const original = await createPrescription(validStaffId, validClinicalInput);
      const correction = await createPrescription(validStaffId, {
        ...validClinicalInput,
        remarks: 'Correction of original.',
      });

      // Assert — two separate documents; neither overwrites the other
      expect(Prescription.create).toHaveBeenCalledTimes(2);
      expect(original.id).toBe(originalId.toString());
      expect(correction.id).toBe(correctionId.toString());
    });
  });

  // ── getMyPrescriptionHistory ─────────────────────────────────────────────────

  describe('getMyPrescriptionHistory', () => {
    it('should return only prescriptions belonging to the authenticated customer', async () => {
      // Arrange
      const customerAId = new mongoose.Types.ObjectId().toString();
      const customerBId = new mongoose.Types.ObjectId().toString();

      const customerADoc = buildMockPrescriptionDoc({
        customerId: new mongoose.Types.ObjectId(customerAId),
      });

      const sortMock = jest.fn().mockResolvedValue([customerADoc]);
      const populateMock = jest.fn().mockReturnValue({ sort: sortMock });
      Prescription.find.mockReturnValue({ populate: populateMock });

      // Act
      const result = await getMyPrescriptionHistory(customerAId);

      // Assert — query scoped to authenticated customer's ID only
      expect(Prescription.find).toHaveBeenCalledWith({ customerId: customerAId });
      expect(result).toHaveLength(1);
      // Customer B's ID should not appear in results
      expect(result.every((r) => r.customerId !== customerBId)).toBe(true);
    });

    it('should return an empty array when the customer has no prescriptions', async () => {
      // Arrange
      const sortMock = jest.fn().mockResolvedValue([]);
      const populateMock = jest.fn().mockReturnValue({ sort: sortMock });
      Prescription.find.mockReturnValue({ populate: populateMock });

      // Act
      const result = await getMyPrescriptionHistory(validCustomerId);

      // Assert — empty history is valid, not an error
      expect(result).toEqual([]);
    });

    it('should order prescription history by recordedAt descending (newest first)', async () => {
      // Arrange
      const older = buildMockPrescriptionDoc({ recordedAt: new Date('2024-01-01') });
      const newer = buildMockPrescriptionDoc({ recordedAt: new Date('2024-06-01') });

      const sortMock = jest.fn().mockResolvedValue([newer, older]);
      const populateMock = jest.fn().mockReturnValue({ sort: sortMock });
      Prescription.find.mockReturnValue({ populate: populateMock });

      // Act
      const result = await getMyPrescriptionHistory(validCustomerId);

      // Assert — sort called with recordedAt descending
      expect(sortMock).toHaveBeenCalledWith({ recordedAt: -1 });
      // newest first
      expect(result[0].recordedAt.getTime()).toBeGreaterThan(result[1].recordedAt.getTime());
    });

    it('should return all historical records, not just the latest', async () => {
      // Arrange — three historical prescriptions
      const docs = [
        buildMockPrescriptionDoc({
          _id: new mongoose.Types.ObjectId(),
          recordedAt: new Date('2024-06-01'),
        }),
        buildMockPrescriptionDoc({
          _id: new mongoose.Types.ObjectId(),
          recordedAt: new Date('2024-03-01'),
        }),
        buildMockPrescriptionDoc({
          _id: new mongoose.Types.ObjectId(),
          recordedAt: new Date('2024-01-01'),
        }),
      ];

      const sortMock = jest.fn().mockResolvedValue(docs);
      const populateMock = jest.fn().mockReturnValue({ sort: sortMock });
      Prescription.find.mockReturnValue({ populate: populateMock });

      // Act
      const result = await getMyPrescriptionHistory(validCustomerId);

      // Assert — all three records returned
      expect(result).toHaveLength(3);
    });
  });

  // ── getCustomerPrescriptionHistory ───────────────────────────────────────────

  describe('getCustomerPrescriptionHistory', () => {
    it('should return prescription history for a valid existing customer', async () => {
      // Arrange
      Customer.exists.mockResolvedValue({ _id: validCustomerId });

      const docs = [buildMockPrescriptionDoc(), buildMockPrescriptionDoc()];

      const sortMock = jest.fn().mockResolvedValue(docs);
      const populateMock = jest.fn().mockReturnValue({ sort: sortMock });
      Prescription.find.mockReturnValue({ populate: populateMock });

      // Act
      const result = await getCustomerPrescriptionHistory(validCustomerId);

      // Assert
      expect(Customer.exists).toHaveBeenCalledWith({ _id: validCustomerId });
      expect(Prescription.find).toHaveBeenCalledWith({ customerId: validCustomerId });
      expect(result).toHaveLength(2);
    });

    it('should reject given a malformed customerId', async () => {
      // Arrange - Act - Assert
      await expect(getCustomerPrescriptionHistory('bad-id')).rejects.toMatchObject({
        statusCode: 422,
        errorCode: INVALID_CUSTOMER_REFERENCE,
      });

      expect(Prescription.find).not.toHaveBeenCalled();
    });

    it('should reject given a non-existent customerId', async () => {
      // Arrange
      Customer.exists.mockResolvedValue(null);

      // Act & Assert
      await expect(getCustomerPrescriptionHistory(validCustomerId)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: INVALID_CUSTOMER_REFERENCE,
      });

      expect(Prescription.find).not.toHaveBeenCalled();
    });

    it('should order results by recordedAt descending', async () => {
      // Arrange
      Customer.exists.mockResolvedValue({ _id: validCustomerId });

      const sortMock = jest.fn().mockResolvedValue([]);
      const populateMock = jest.fn().mockReturnValue({ sort: sortMock });
      Prescription.find.mockReturnValue({ populate: populateMock });

      // Act
      await getCustomerPrescriptionHistory(validCustomerId);

      // Assert
      expect(sortMock).toHaveBeenCalledWith({ recordedAt: -1 });
    });
  });

  // ── shapePrescription ────────────────────────────────────────────────────────

  describe('shapePrescription', () => {
    it('should return only approved clinical response fields and exclude unrelated internal data', () => {
      // Arrange
      const staffId = new mongoose.Types.ObjectId();
      const customerId = new mongoose.Types.ObjectId();

      const rawDoc = {
        _id: new mongoose.Types.ObjectId(),
        customerId,
        recordedBy: {
          _id: staffId,
          name: 'Dr. Nimal',
          passwordHash: 'secret',
          email: 'doc@test.com',
        },
        recordedAt: new Date('2024-05-01T10:00:00.000Z'),
        rightEye: {
          distance: { sph: -1.0, cyl: -0.5, axis: 90, va: '6/6' },
          reading: { add: 1.0, nearVa: 'N8' },
        },
        leftEye: {
          distance: { sph: -1.25, cyl: -0.25, axis: 85, va: '6/9' },
          reading: { add: 1.0, nearVa: 'N8' },
        },
        remarks: 'Routine check.',
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        // Internal fields that must NOT appear in output
        __v: 0,
        internalField: 'should not appear',
      };

      // Act
      const shaped = shapePrescription(rawDoc);

      // Assert — approved fields present
      expect(shaped).toHaveProperty('id');
      expect(shaped).toHaveProperty('customerId');
      expect(shaped).toHaveProperty('recordedBy');
      expect(shaped).toHaveProperty('recordedAt');
      expect(shaped).toHaveProperty('rightEye');
      expect(shaped).toHaveProperty('leftEye');
      expect(shaped).toHaveProperty('remarks');
      expect(shaped).toHaveProperty('isArchived');
      expect(shaped).toHaveProperty('createdAt');
      expect(shaped).toHaveProperty('updatedAt');

      // Assert — sensitive / internal Staff fields are excluded from recordedBy
      expect(shaped.recordedBy).not.toHaveProperty('passwordHash');
      expect(shaped.recordedBy).not.toHaveProperty('email');

      // Assert — only id and name exposed on recordedBy
      expect(shaped.recordedBy).toHaveProperty('id');
      expect(shaped.recordedBy.name).toBe('Dr. Nimal');

      // Assert — internal document fields excluded
      expect(shaped).not.toHaveProperty('__v');
      expect(shaped).not.toHaveProperty('internalField');
    });

    it('should include all ADR-001 eye measurement fields in the response shape', () => {
      // Arrange
      const staffId = new mongoose.Types.ObjectId();
      const rawDoc = {
        _id: new mongoose.Types.ObjectId(),
        customerId: new mongoose.Types.ObjectId(),
        recordedBy: { _id: staffId, name: 'Dr. Nimal' },
        recordedAt: new Date(),
        rightEye: {
          distance: { sph: -2.0, cyl: -0.5, axis: 90, va: '6/6' },
          reading: { add: 1.5, nearVa: 'N6' },
        },
        leftEye: {
          distance: { sph: -1.75, cyl: -0.25, axis: 80, va: '6/9' },
          reading: { add: 1.5, nearVa: 'N6' },
        },
        remarks: '',
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Act
      const shaped = shapePrescription(rawDoc);

      // Assert — right eye distance
      expect(shaped.rightEye.distance.sph).toBe(-2.0);
      expect(shaped.rightEye.distance.cyl).toBe(-0.5);
      expect(shaped.rightEye.distance.axis).toBe(90);
      expect(shaped.rightEye.distance.va).toBe('6/6');
      // Assert — right eye reading
      expect(shaped.rightEye.reading.add).toBe(1.5);
      expect(shaped.rightEye.reading.nearVa).toBe('N6');
      // Assert — left eye distance
      expect(shaped.leftEye.distance.sph).toBe(-1.75);
      expect(shaped.leftEye.distance.axis).toBe(80);
      // Assert — left eye reading
      expect(shaped.leftEye.reading.nearVa).toBe('N6');
    });

    it('should expose null for optional eye measurements that were not supplied', () => {
      // Arrange
      const rawDoc = {
        _id: new mongoose.Types.ObjectId(),
        customerId: new mongoose.Types.ObjectId(),
        recordedBy: new mongoose.Types.ObjectId(),
        recordedAt: new Date(),
        rightEye: { distance: {}, reading: {} },
        leftEye: { distance: {}, reading: {} },
        remarks: '',
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Act
      const shaped = shapePrescription(rawDoc);

      // Assert — nulls for all optional fields
      expect(shaped.rightEye.distance.sph).toBeNull();
      expect(shaped.rightEye.distance.cyl).toBeNull();
      expect(shaped.rightEye.distance.axis).toBeNull();
      expect(shaped.rightEye.distance.va).toBeNull();
      expect(shaped.rightEye.reading.add).toBeNull();
      expect(shaped.rightEye.reading.nearVa).toBeNull();
    });
  });
});
