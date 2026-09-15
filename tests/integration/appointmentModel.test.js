const { connectDatabase, disconnectDatabase } = require('../../src/config/database');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Appointment = require('../../src/models/appointment.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { APPOINTMENT_STATUS_VALUES } = require('../../src/constants/appointmentStatuses');

const syntheticHash = '$2b$12$' + 'a'.repeat(53);

async function createTestCustomer() {
  return Customer.create({
    name: 'Appointment Test Customer',
    email: 'appointment.customer@example.com',
    address: '12 Test Street, Colombo',
    phone: '+94711234567',
    passwordHash: syntheticHash,
  });
}

async function createTestOptometrist() {
  return Staff.create({
    name: 'Test Optometrist',
    email: 'optometrist@example.com',
    phone: '+94719876543',
    address: '8 Clinic Road, Colombo',
    role: ROLE_VALUES.OPTOMETRIST,
    passwordHash: syntheticHash,
  });
}

describe('Appointment model', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;

    await connectDatabase();

    await Promise.all([Appointment.deleteMany({}), Customer.deleteMany({}), Staff.deleteMany({})]);
  });

  afterEach(async () => {
    await Promise.all([Appointment.deleteMany({}), Customer.deleteMany({}), Staff.deleteMany({})]);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('should create a valid Appointment record', async () => {
    // Arrange
    const customer = await createTestCustomer();
    const optometrist = await createTestOptometrist();

    const appointmentPayload = {
      customerId: customer._id,
      staffId: optometrist._id,
      dateTime: new Date('2026-09-20T09:30:00.000Z'),
      status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
    };

    // Act
    const appointment = await Appointment.create(appointmentPayload);

    // Assert
    expect(appointment.customerId.toString()).toBe(customer._id.toString());
    expect(appointment.staffId.toString()).toBe(optometrist._id.toString());
    expect(appointment.dateTime).toEqual(appointmentPayload.dateTime);
    expect(appointment.status).toBe(APPOINTMENT_STATUS_VALUES.CONFIRMED);
  });

  it('should enforce required Appointment fields', () => {
    // Arrange
    const invalidAppointment = new Appointment({});

    // Act
    const validationError = invalidAppointment.validateSync();

    // Assert
    expect(validationError.errors.customerId).toBeDefined();
    expect(validationError.errors.staffId).toBeDefined();
    expect(validationError.errors.dateTime).toBeDefined();
    expect(validationError.errors.status).toBeDefined();
  });

  it('should reject an invalid appointment date and time', () => {
    // Arrange
    const invalidAppointment = new Appointment({
      customerId: '507f1f77bcf86cd799439011',
      staffId: '507f1f77bcf86cd799439012',
      dateTime: 'not-a-valid-date',
      status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
    });

    // Act
    const validationError = invalidAppointment.validateSync();

    // Assert
    expect(validationError.errors.dateTime).toBeDefined();
  });

  it('should reject an invalid appointment status', () => {
    // Arrange
    const invalidAppointment = new Appointment({
      customerId: '507f1f77bcf86cd799439011',
      staffId: '507f1f77bcf86cd799439012',
      dateTime: new Date(),
      status: 'INVALID_STATUS',
    });

    // Act
    const validationError = invalidAppointment.validateSync();

    // Assert
    expect(validationError.errors.status).toBeDefined();
  });

  it('should preserve the Customer-to-Appointment relationship', async () => {
    // Arrange
    const customer = await createTestCustomer();
    const optometrist = await createTestOptometrist();

    // Act
    const appointment = await Appointment.create({
      customerId: customer._id,
      staffId: optometrist._id,
      dateTime: new Date('2026-09-20T10:00:00.000Z'),
      status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
    });

    // Assert
    expect(appointment.customerId.toString()).toBe(customer._id.toString());
  });

  it('should preserve the Staff-to-Appointment relationship', async () => {
    // Arrange
    const customer = await createTestCustomer();
    const optometrist = await createTestOptometrist();

    // Act
    const appointment = await Appointment.create({
      customerId: customer._id,
      staffId: optometrist._id,
      dateTime: new Date('2026-09-20T10:20:00.000Z'),
      status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
    });

    // Assert
    expect(appointment.staffId.toString()).toBe(optometrist._id.toString());
  });

  it('should reject malformed relationship identifiers during creation', async () => {
    // Arrange
    const invalidAppointment = {
      customerId: 'invalid-customer-id',
      staffId: 'invalid-staff-id',
      dateTime: new Date('2026-09-20T11:00:00.000Z'),
      status: APPOINTMENT_STATUS_VALUES.CONFIRMED,
    };

    // Act / Assert
    await expect(Appointment.create(invalidAppointment)).rejects.toThrow();
  });
});
