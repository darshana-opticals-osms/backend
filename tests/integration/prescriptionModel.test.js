const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Prescription = require('../../src/models/prescription.model');
const { ROLE_VALUES } = require('../../src/constants/roles');

const syntheticHash = '$2b$12$' + 'a'.repeat(53);

describe('Prescription model (ADR-001 Compliance)', () => {
  let testCustomer;
  let testOptometrist;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;
    await connectDatabase();
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Prescription.deleteMany({})]);
  });

  beforeEach(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Prescription.deleteMany({})]);

    testCustomer = await Customer.create({
      name: 'John Customer',
      email: 'john.customer@example.com',
      address: '100 Main Street, Colombo',
      phone: '+94711234567',
      passwordHash: syntheticHash,
    });

    testOptometrist = await Staff.create({
      name: 'Dr. Jane Optometrist',
      email: 'jane.optometrist@example.com',
      phone: '+94719876543',
      address: 'Clinical Wing, OSMS Branch 1',
      branchId: new mongoose.Types.ObjectId(),
      role: ROLE_VALUES.OPTOMETRIST,
      passwordHash: syntheticHash,
    });
  });

  afterAll(async () => {
    await Promise.all([Customer.deleteMany({}), Staff.deleteMany({}), Prescription.deleteMany({})]);
    await disconnectDatabase();
  });

  it('should create a valid clinical prescription record with approved fields and relationships (AC1, AC2, AC3, AC5)', async () => {
    // Arrange
    const prescriptionPayload = {
      customerId: testCustomer._id,
      recordedBy: testOptometrist._id,
      rightEye: {
        distance: { sph: -1.25, cyl: -0.5, axis: 90, va: '6/6' },
        reading: { add: +1.5, nearVa: 'N5' },
      },
      leftEye: {
        distance: { sph: -1.5, cyl: -0.75, axis: 85, va: '6/9' },
        reading: { add: +1.5, nearVa: 'N5' },
      },
      remarks: 'Patient reports mild strain when reading.',
    };

    // Act
    const prescription = await Prescription.create(prescriptionPayload);

    // Assert
    expect(prescription.customerId.toString()).toBe(testCustomer._id.toString());
    expect(prescription.recordedBy.toString()).toBe(testOptometrist._id.toString());
    expect(prescription.rightEye.distance).toMatchObject({
      sph: -1.25,
      cyl: -0.5,
      axis: 90,
      va: '6/6',
    });
    expect(prescription.rightEye.reading).toMatchObject({ add: 1.5, nearVa: 'N5' });
    expect(prescription.leftEye.distance).toMatchObject({
      sph: -1.5,
      cyl: -0.75,
      axis: 85,
      va: '6/9',
    });
    expect(prescription.leftEye.reading).toMatchObject({ add: 1.5, nearVa: 'N5' });
    expect(prescription.remarks).toBe('Patient reports mild strain when reading.');
    expect(prescription.isArchived).toBe(false);
    expect(prescription.recordedAt).toBeInstanceOf(Date);
    expect(prescription.createdAt).toBeInstanceOf(Date);
    expect(prescription.updatedAt).toBeInstanceOf(Date);
  });

  it('should support multiple historical prescription records for the same customer without overwriting (AC4)', async () => {
    // Arrange
    const firstPrescription = await Prescription.create({
      customerId: testCustomer._id,
      recordedBy: testOptometrist._id,
      rightEye: { distance: { sph: -1.0 } },
      leftEye: { distance: { sph: -1.0 } },
      remarks: 'Initial prescription 2025',
    });

    const secondPrescription = await Prescription.create({
      customerId: testCustomer._id,
      recordedBy: testOptometrist._id,
      rightEye: { distance: { sph: -1.5 } },
      leftEye: { distance: { sph: -1.5 } },
      remarks: 'Follow-up prescription 2026',
    });

    // Act
    const customerPrescriptions = await Prescription.find({ customerId: testCustomer._id }).sort({
      createdAt: 1,
    });

    // Assert
    expect(customerPrescriptions).toHaveLength(2);
    expect(customerPrescriptions[0]._id.toString()).toBe(firstPrescription._id.toString());
    expect(customerPrescriptions[1]._id.toString()).toBe(secondPrescription._id.toString());
    expect(customerPrescriptions[0].remarks).toBe('Initial prescription 2025');
    expect(customerPrescriptions[1].remarks).toBe('Follow-up prescription 2026');
  });

  it('should enforce required relationship fields (customerId and recordedBy) (AC6)', async () => {
    // Arrange
    const missingCustomerPayload = {
      recordedBy: testOptometrist._id,
    };
    const missingStaffPayload = {
      customerId: testCustomer._id,
    };

    // Act / Assert
    await expect(Prescription.create(missingCustomerPayload)).rejects.toThrow(
      mongoose.Error.ValidationError
    );
    await expect(Prescription.create(missingStaffPayload)).rejects.toThrow(
      mongoose.Error.ValidationError
    );
  });

  it('should validate axis values to be within 0 to 180 degrees (AC7)', async () => {
    // Arrange
    const invalidAxisPayload = {
      customerId: testCustomer._id,
      recordedBy: testOptometrist._id,
      rightEye: {
        distance: { axis: 200 },
      },
    };

    // Act / Assert
    await expect(Prescription.create(invalidAxisPayload)).rejects.toThrow(
      mongoose.Error.ValidationError
    );
  });

  it('should successfully populate associated Customer and Staff profiles (AC10)', async () => {
    // Arrange
    const createdPrescription = await Prescription.create({
      customerId: testCustomer._id,
      recordedBy: testOptometrist._id,
      remarks: 'Populate test',
    });

    // Act
    const populatedPrescription = await Prescription.findById(createdPrescription._id)
      .populate('customerId', 'name email role')
      .populate('recordedBy', 'name email role');

    // Assert
    expect(populatedPrescription.customerId.name).toBe('John Customer');
    expect(populatedPrescription.customerId.email).toBe('john.customer@example.com');
    expect(populatedPrescription.recordedBy.name).toBe('Dr. Jane Optometrist');
    expect(populatedPrescription.recordedBy.role).toBe(ROLE_VALUES.OPTOMETRIST);
  });

  it('should allow soft-archiving prescription records without hard deletion (AC8)', async () => {
    // Arrange
    const prescription = await Prescription.create({
      customerId: testCustomer._id,
      recordedBy: testOptometrist._id,
      remarks: 'Archival test',
    });

    // Act
    prescription.isArchived = true;
    await prescription.save();

    const archivedPrescription = await Prescription.findById(prescription._id);

    // Assert
    expect(archivedPrescription.isArchived).toBe(true);
    expect(archivedPrescription.updatedAt.getTime()).toBeGreaterThanOrEqual(
      prescription.createdAt.getTime()
    );
  });
});
