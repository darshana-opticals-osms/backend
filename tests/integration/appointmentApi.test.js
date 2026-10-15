const bcrypt = require('bcrypt');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('../../src/app');
const Branch = require('../../src/models/branch.model');
const Customer = require('../../src/models/customer.model');
const Staff = require('../../src/models/staff.model');
const Doctor = require('../../src/models/doctor.model');
const Appointment = require('../../src/models/appointment.model');
const DoctorSession = require('../../src/models/doctorSession.model');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { generalLimiter } = require('../../src/middleware/rateLimiter');
const { createAccessToken } = require('../../src/utils/jwt');
const { createAppointment } = require('../../src/services/appointment.service');

describe('Appointment scheduling API', () => {
  let app;
  let mongoServer;
  let originalEnv;
  let gampahaBranch;
  let optometrist;
  let doctor;
  let branchAssistant;
  let customer;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'appointment-api-test-secret';
    process.env.JWT_EXPIRES_IN = '1h';
    delete process.env.MONGODB_URI;
    mongoServer = await MongoMemoryServer.create({ instance: { replSet: 'rs0' } });
    const uri = mongoServer.getUri();
    await mongoose.connect(uri, { directConnection: true });
    await mongoose.connection.db.admin().command({
      replSetInitiate: {
        _id: 'rs0',
        members: [{ _id: 0, host: new URL(uri).host }],
      },
    });
    await mongoose.disconnect();
    await mongoose.connect(`${uri}?replicaSet=rs0`, { serverSelectionTimeoutMS: 15000 });
    await Promise.all([
      Branch.init(),
      Customer.init(),
      Staff.init(),
      Doctor.init(),
      Appointment.init(),
      DoctorSession.init(),
    ]);
    app = createApp();
  }, 30000);

  beforeEach(async () => {
    generalLimiter.resetKey('::ffff:127.0.0.1');
    generalLimiter.resetKey('127.0.0.1');
    await Promise.all([
      Branch.deleteMany({}),
      Customer.deleteMany({}),
      Staff.deleteMany({}),
      Doctor.deleteMany({}),
      Appointment.deleteMany({}),
      DoctorSession.deleteMany({}),
    ]);

    gampahaBranch = await Branch.create({
      codeName: 'GAMPAHA_CENTRAL',
      address: '12 Main Street, Gampaha',
      contactNumber: '+94 33 222 0000',
    });

    doctor = await Doctor.create({
      name: 'Dr. Gampaha',
      specialization: 'Optometrist',
    });

    const passwordHash = await bcrypt.hash('Password123!', 12);
    optometrist = await Staff.create({
      name: 'Dr. Gampaha',
      email: 'gampaha.optometrist@example.com',
      phone: '+94 77 100 0100',
      address: '12 Main Street, Gampaha',
      branchId: gampahaBranch._id,
      role: ROLE_VALUES.OPTOMETRIST,
      passwordHash,
    });

    branchAssistant = await Staff.create({
      name: 'Gampaha Branch Assistant',
      email: 'gampaha.branchAssistant@example.com',
      phone: '+94 77 100 0101',
      address: '12 Main Street, Gampaha',
      branchId: gampahaBranch._id,
      role: ROLE_VALUES.BRANCH_ASSISTANT,
      passwordHash,
    });

    customer = await Customer.create({
      name: 'Test Customer',
      email: 'customer.appointment@example.com',
      phone: '+94 71 200 0004',
      address: '10 A, Gampaha',
      role: ROLE_VALUES.CUSTOMER,
      passwordHash,
    });
  });

  afterAll(async () => {
    await Promise.all([
      Branch.deleteMany({}),
      Customer.deleteMany({}),
      Staff.deleteMany({}),
      Doctor.deleteMany({}),
      Appointment.deleteMany({}),
      DoctorSession.deleteMany({}),
    ]);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    try {
      if (mongoServer) await mongoServer.stop();
    } catch {
      void 0;
    }
    process.env = originalEnv;
  }, 30000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createCustomer = (email) =>
    Customer.create({
      name: 'Test Customer',
      email,
      phone: '+94 71 200 0004',
      address: '10 A, Gampaha',
      role: ROLE_VALUES.CUSTOMER,
      passwordHash: '$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

  const createSession = async ({
    capacity = 3,
    daysAhead = 3,
    staff = optometrist,
    startAt: suppliedStartAt,
    endAt: suppliedEndAt,
  } = {}) => {
    const startAt = suppliedStartAt || new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    return DoctorSession.create({
      staffId: staff._id,
      branchId: gampahaBranch._id,
      startAt,
      endAt: suppliedEndAt || new Date(startAt.getTime() + 60 * 60 * 1000),
      capacity,
      confirmedCount: 0,
    });
  };

  const tokenFor = (userId, role = ROLE_VALUES.CUSTOMER) =>
    createAccessToken({ userId: userId.toString(), role });

  const book = (session, bookingCustomer) =>
    request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${tokenFor(bookingCustomer._id)}`)
      .send({ sessionId: session._id.toString() });

  it('should list Gampaha providers and allow a customer to book a valid session', async () => {
    const sessionStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const sessionEnd = new Date(sessionStart.getTime() + 60 * 60 * 1000);

    const branchAssistantToken = createAccessToken({
      userId: branchAssistant._id.toString(),
      role: ROLE_VALUES.BRANCH_ASSISTANT,
    });

    const branchAssistantProvidersResponse = await request(app)
      .get('/api/appointments/providers')
      .set('Authorization', `Bearer ${branchAssistantToken}`);
    expect(branchAssistantProvidersResponse.status).toBe(200);
    const discoveredProvider = branchAssistantProvidersResponse.body.data.find(
      (provider) => provider.id === doctor._id.toString()
    );
    expect(discoveredProvider).toMatchObject({
      id: doctor._id.toString(),
      name: 'Dr. Gampaha',
      specialization: 'Optometrist',
    });
    expect(discoveredProvider).not.toHaveProperty('email');
    expect(discoveredProvider).not.toHaveProperty('phone');

    const createSessionResponse = await request(app)
      .post('/api/doctor-sessions')
      .set('Authorization', `Bearer ${branchAssistantToken}`)
      .send({
        doctorId: discoveredProvider.id,
        branchId: gampahaBranch._id.toString(),
        startAt: sessionStart.toISOString(),
        endAt: sessionEnd.toISOString(),
        capacity: 3,
      });

    expect(createSessionResponse.status).toBe(201);
    expect(createSessionResponse.body.success).toBe(true);

    const customerToken = createAccessToken({
      userId: customer._id.toString(),
      role: ROLE_VALUES.CUSTOMER,
    });

    const providersResponse = await request(app)
      .get('/api/appointments/providers')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(providersResponse.status).toBe(200);
    expect(providersResponse.body.success).toBe(true);
    expect(providersResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: doctor._id.toString(),
          name: 'Dr. Gampaha',
          specialization: 'Optometrist',
        }),
      ])
    );
    const publicProvider = providersResponse.body.data.find(
      (provider) => provider.id === doctor._id.toString()
    );
    expect(publicProvider).not.toHaveProperty('email');
    expect(publicProvider).not.toHaveProperty('phone');

    const availableResponse = await request(app)
      .get('/api/doctor-sessions/available')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(availableResponse.status).toBe(200);
    expect(availableResponse.body.success).toBe(true);
    expect(availableResponse.body.data.length).toBeGreaterThan(0);

    const bookingResponse = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        sessionId: createSessionResponse.body.data.id,
      });

    expect(bookingResponse.status).toBe(201);
    expect(bookingResponse.body.success).toBe(true);
    expect(bookingResponse.body.data.status).toBe('CONFIRMED');
    expect(bookingResponse.body.data.position).toBe(1);
    expect(bookingResponse.body.data).not.toHaveProperty('customerId');
    expect(bookingResponse.body.data.providerName).toBe('Dr. Gampaha');
    expect(bookingResponse.body.data).not.toHaveProperty('email');
    expect(bookingResponse.body.data).not.toHaveProperty('phone');
    expect(bookingResponse.body.data).not.toHaveProperty('passwordHash');
    expect(bookingResponse.body.data).not.toHaveProperty('customer');

    const branchAssistantAppointments = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${branchAssistantToken}`);
    expect(branchAssistantAppointments.body.data[0].customer).toEqual({
      id: customer._id.toString(),
      name: customer.name,
      phone: customer.phone,
    });
    expect(branchAssistantAppointments.body.data[0].customer).not.toHaveProperty('email');
    expect(branchAssistantAppointments.body.data[0].customer).not.toHaveProperty('address');

    const branchAssistantAppointment = await request(app)
      .get(`/api/appointments/${bookingResponse.body.data.id}`)
      .set('Authorization', `Bearer ${branchAssistantToken}`);
    expect(branchAssistantAppointment.body.data.customer).toEqual(
      branchAssistantAppointments.body.data[0].customer
    );

    const customerAppointments = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(customerAppointments.body.data[0]).not.toHaveProperty('customer');
  });

  it('allows exactly one customer to book a capacity-one session under concurrent requests', async () => {
    const session = await createSession({ capacity: 1 });
    const otherCustomer = await createCustomer('race.capacity-one@example.com');

    const responses = await Promise.all([book(session, customer), book(session, otherCustomer)]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const persisted = await Appointment.find({
      sessionId: session._id,
      status: 'CONFIRMED',
    }).lean();
    expect(persisted).toHaveLength(1);
    expect(persisted.map((appointment) => appointment.position)).toEqual([1]);
    expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(1);
  });

  it('assigns distinct sequential positions when both concurrent capacity-two bookings succeed', async () => {
    const session = await createSession({ capacity: 2 });
    const otherCustomer = await createCustomer('race.capacity-two@example.com');

    const responses = await Promise.all([book(session, customer), book(session, otherCustomer)]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const persisted = await Appointment.find({ sessionId: session._id, status: 'CONFIRMED' })
      .sort({ position: 1 })
      .lean();
    expect(persisted.map((appointment) => appointment.position)).toEqual([1, 2]);
    expect(new Set(persisted.map((appointment) => appointment.position)).size).toBe(2);
    expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(persisted.length);
  });

  it.each([
    ['first', 0],
    ['middle', 1],
    ['last', 2],
  ])(
    'cancels the %s position and compacts unique active positions',
    async (_label, cancelIndex) => {
      const session = await createSession({ capacity: 3 });
      const customers = [customer];
      customers.push(await createCustomer('cancel.second@example.com'));
      customers.push(await createCustomer('cancel.third@example.com'));
      const responses = await Promise.all(
        customers.map((bookingCustomer) => book(session, bookingCustomer))
      );
      expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
      const canceledAppointmentId = responses[cancelIndex].body.data.id;

      const cancellation = await request(app)
        .patch(`/api/appointments/${canceledAppointmentId}/cancel`)
        .set(
          'Authorization',
          `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`
        )
        .send();

      expect(cancellation.status).toBe(200);
      const canceled = await Appointment.findById(canceledAppointmentId).lean();
      expect(canceled.status).toBe('CANCELLED');
      expect(canceled.position).toBeNull();
      const active = await Appointment.find({ sessionId: session._id, status: 'CONFIRMED' })
        .sort({ position: 1 })
        .lean();
      expect(active.map((appointment) => appointment.position)).toEqual([1, 2]);

      const replacement = await createCustomer(`cancel.replacement.${cancelIndex}@example.com`);
      const replacementResponse = await book(session, replacement);
      expect(replacementResponse.status).toBe(201);
      expect(replacementResponse.body.data.position).toBe(3);
      expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(3);
    }
  );

  it('denies cross-customer appointment reads and cancellation', async () => {
    const session = await createSession({ capacity: 2 });
    const otherCustomer = await createCustomer('ownership.other@example.com');
    const booking = await book(session, otherCustomer);
    const customerToken = tokenFor(customer._id);

    const readResponse = await request(app)
      .get(`/api/appointments/${booking.body.data.id}`)
      .set('Authorization', `Bearer ${customerToken}`);
    const cancelResponse = await request(app)
      .patch(`/api/appointments/${booking.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send();

    expect(readResponse.status).toBe(403);
    expect(cancelResponse.status).toBe(403);
    expect((await Appointment.findById(booking.body.data.id)).status).toBe('CONFIRMED');
  });

  it('allows customer cancellation before start and rejects a second cancellation', async () => {
    const session = await createSession({ capacity: 1 });
    const booking = await book(session, customer);
    const cancelPath = `/api/appointments/${booking.body.data.id}/cancel`;
    const customerToken = tokenFor(customer._id);

    const allowed = await request(app)
      .patch(cancelPath)
      .set('Authorization', `Bearer ${customerToken}`)
      .send();
    expect(allowed.status).toBe(200);
    expect((await Appointment.findById(booking.body.data.id)).status).toBe('CANCELLED');

    const alreadyCancelled = await request(app)
      .patch(cancelPath)
      .set('Authorization', `Bearer ${customerToken}`)
      .send();
    expect(alreadyCancelled.status).toBe(409);
  });

  it('allows customer cancellation shortly before the session starts', async () => {
    const fixedNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    const sessionStart = new Date(fixedNow + 3 * 24 * 60 * 60 * 1000);
    const session = await DoctorSession.create({
      staffId: optometrist._id,
      branchId: gampahaBranch._id,
      startAt: sessionStart,
      endAt: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      capacity: 1,
    });
    const booking = await book(session, customer);
    expect(booking.status).toBe(201);
    Date.now.mockReturnValue(sessionStart.getTime() - 60_000);

    const response = await request(app)
      .patch(`/api/appointments/${booking.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(customer._id)}`)
      .send();

    expect(response.status).toBe(200);
    expect((await Appointment.findById(booking.body.data.id)).status).toBe('CANCELLED');
  });

  it('rejects customer cancellation at the exact session start instant', async () => {
    const fixedNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    const sessionStart = new Date(fixedNow + 3 * 24 * 60 * 60 * 1000);
    const session = await DoctorSession.create({
      staffId: optometrist._id,
      branchId: gampahaBranch._id,
      startAt: sessionStart,
      endAt: new Date(sessionStart.getTime() + 60 * 60 * 1000),
      capacity: 1,
    });
    const booking = await book(session, customer);
    expect(booking.status).toBe(201);
    Date.now.mockReturnValue(sessionStart.getTime());

    const response = await request(app)
      .patch(`/api/appointments/${booking.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(customer._id)}`)
      .send();

    expect(response.status).toBe(409);
    expect((await Appointment.findById(booking.body.data.id)).status).toBe('CONFIRMED');
  });

  it('returns an empty customer appointment list and rejects missing or invalid JWTs', async () => {
    const emptyList = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${tokenFor(customer._id)}`);
    expect(emptyList.status).toBe(200);
    expect(emptyList.body.data).toEqual([]);
    expect((await request(app).get('/api/appointments')).status).toBe(401);
    expect(
      (await request(app).get('/api/appointments').set('Authorization', 'Bearer invalid-token'))
        .status
    ).toBe(401);
  });

  it('rejects unsafe or unknown appointment payloads, arrays, malformed JSON, and query parameters', async () => {
    const session = await createSession({ capacity: 2 });
    const customerToken = tokenFor(customer._id);
    const postAppointment = (body) =>
      request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(body);

    for (const field of ['customerId', 'position', 'status']) {
      expect(
        (await postAppointment({ sessionId: session._id.toString(), [field]: 'forged' })).status
      ).toBe(422);
    }
    expect((await postAppointment({ sessionId: 'invalid-object-id' })).status).toBe(422);
    expect((await postAppointment([{ sessionId: session._id.toString() }])).status).toBe(422);
    for (const malformedId of [123, {}, [], 'abcdefghijkl', 'z'.repeat(24)]) {
      expect((await postAppointment({ sessionId: malformedId })).status).toBe(422);
    }
    expect(
      (await postAppointment({ sessionId: session._id.toString(), $where: 'true' })).status
    ).toBe(422);
    expect(
      (await postAppointment({ sessionId: session._id.toString(), 'a.b': 'value' })).status
    ).toBe(422);

    const malformedJson = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Content-Type', 'application/json')
      .send('{"sessionId":');
    expect(malformedJson.status).toBe(400);

    expect(
      (
        await request(app)
          .patch(`/api/appointments/${new mongoose.Types.ObjectId()}/cancel`)
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ reason: 'not supported' })
      ).status
    ).toBe(422);
    expect(
      (
        await request(app)
          .get('/api/appointments?unexpected=true')
          .set('Authorization', `Bearer ${customerToken}`)
      ).status
    ).toBe(422);
    expect(
      (
        await request(app)
          .get('/api/appointments/not-an-object-id')
          .set('Authorization', `Bearer ${customerToken}`)
      ).status
    ).toBe(422);
    expect(
      (
        await request(app)
          .get('/api/appointments/abcdefghijkl')
          .set('Authorization', `Bearer ${customerToken}`)
      ).status
    ).toBe(422);
    expect(
      (
        await request(app)
          .patch('/api/doctor-sessions/abcdefghijkl')
          .set(
            'Authorization',
            `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`
          )
          .send({ capacity: 2 })
      ).status
    ).toBe(422);
    for (const sessionId of [123, {}, [], 'abcdefghijkl']) {
      expect(
        (
          await request(app)
            .patch(`/api/appointments/${new mongoose.Types.ObjectId()}/reassign`)
            .set(
              'Authorization',
              `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`
            )
            .send({ sessionId })
        ).status
      ).toBe(422);
    }
  });

  it('rejects array, unsafe, unknown, and invalid-ID doctor-session payloads', async () => {
    const token = tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT);
    const startAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const payload = {
      doctorId: doctor._id.toString(),
      branchId: gampahaBranch._id.toString(),
      startAt: startAt.toISOString(),
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000).toISOString(),
      capacity: 1,
    };
    const createSessionRequest = (body) =>
      request(app).post('/api/doctor-sessions').set('Authorization', `Bearer ${token}`).send(body);

    expect((await createSessionRequest([payload])).status).toBe(422);
    expect((await createSessionRequest({ ...payload, unexpected: true })).status).toBe(422);
    expect((await createSessionRequest({ ...payload, $where: 'true' })).status).toBe(422);
    expect((await createSessionRequest({ ...payload, 'field.name': 'value' })).status).toBe(422);
    expect((await createSessionRequest({ ...payload, doctorId: 'bad-id' })).status).toBe(422);
    for (const doctorId of [123, {}, [], 'abcdefghijkl']) {
      expect((await createSessionRequest({ ...payload, doctorId })).status).toBe(422);
    }
    expect(await DoctorSession.countDocuments({})).toBe(0);
  });

  it('rolls back a partially executed cancellation when compaction fails', async () => {
    const session = await createSession({ capacity: 3 });
    const otherCustomer = await createCustomer('cancel.rollback@example.com');
    await Promise.all([book(session, customer), book(session, otherCustomer)]);
    const appointment = await Appointment.findOne({ sessionId: session._id, position: 1 }).lean();
    const originalUpdateOne = Appointment.updateOne.bind(Appointment);
    let updateCount = 0;
    jest.spyOn(Appointment, 'updateOne').mockImplementation((...args) => {
      updateCount += 1;
      if (updateCount === 2) return Promise.reject(new Error('simulated compaction failure'));
      return originalUpdateOne(...args);
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .patch(`/api/appointments/${appointment._id}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`)
      .send();

    expect(response.status).toBe(500);
    expect(await Appointment.findById(appointment._id).lean()).toMatchObject({
      status: 'CONFIRMED',
      position: 1,
    });
    expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(2);
    expect(await Appointment.countDocuments({ sessionId: session._id, status: 'CONFIRMED' })).toBe(
      2
    );
  });

  it('keeps positions and counts consistent when cancellation races with a new booking', async () => {
    const session = await createSession({ capacity: 2 });
    const secondCustomer = await createCustomer('cancel-race.second@example.com');
    const thirdCustomer = await createCustomer('cancel-race.third@example.com');
    const bookings = await Promise.all([book(session, customer), book(session, secondCustomer)]);
    expect(bookings.map((response) => response.status)).toEqual([201, 201]);
    const branchAssistantToken = tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT);
    const cancelRequest = request(app)
      .patch(`/api/appointments/${bookings[0].body.data.id}/cancel`)
      .set('Authorization', `Bearer ${branchAssistantToken}`)
      .send();

    const [cancelResponse, bookingResponse] = await Promise.all([
      cancelRequest,
      book(session, thirdCustomer),
    ]);

    expect(cancelResponse.status).toBe(200);
    expect([201, 409]).toContain(bookingResponse.status);
    const active = await Appointment.find({ sessionId: session._id, status: 'CONFIRMED' })
      .sort({ position: 1 })
      .lean();
    expect(active.map((appointment) => appointment.position)).toEqual(
      active.map((_appointment, index) => index + 1)
    );
    expect(new Set(active.map((appointment) => appointment.position)).size).toBe(active.length);
    expect(active.length).toBeLessThanOrEqual(session.capacity);
    expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(active.length);
    expect((await Appointment.findById(bookings[0].body.data.id)).position).toBeNull();
  });

  it('rolls back a capacity reservation when appointment persistence fails', async () => {
    const session = await createSession({ capacity: 1 });
    jest.spyOn(Appointment, 'create').mockRejectedValue(new Error('simulated appointment failure'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await book(session, customer);

    expect(response.status).toBe(500);
    expect(await Appointment.countDocuments({ sessionId: session._id })).toBe(0);
    expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(0);
  });

  it('returns a sanitized unavailable error instead of writing without transaction support', async () => {
    const session = await createSession({ capacity: 1 });
    const unavailableError = Object.assign(
      new Error('Transaction numbers are only allowed on a replica set member or mongos'),
      { code: 20, codeName: 'IllegalOperation' }
    );
    jest.spyOn(mongoose, 'startSession').mockRejectedValue(unavailableError);

    await expect(
      createAppointment(
        { sessionId: session._id.toString() },
        {
          userId: customer._id.toString(),
          role: ROLE_VALUES.CUSTOMER,
        }
      )
    ).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'TRANSACTIONS_UNAVAILABLE',
      message: 'Appointment operations require MongoDB replica-set transaction support.',
    });
    expect(await Appointment.countDocuments({ sessionId: session._id })).toBe(0);
    expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(0);
  });

  it('bounds retries for transient transaction failures without attempting a non-transactional write', async () => {
    const session = await createSession({ capacity: 1 });
    const transientError = Object.assign(new Error('transient transaction conflict'), {
      code: 112,
      codeName: 'WriteConflict',
    });
    const startSession = jest.spyOn(mongoose, 'startSession').mockRejectedValue(transientError);

    await expect(
      createAppointment(
        { sessionId: session._id.toString() },
        {
          userId: customer._id.toString(),
          role: ROLE_VALUES.CUSTOMER,
        }
      )
    ).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'TRANSACTION_RETRIES_EXHAUSTED',
    });
    expect(startSession).toHaveBeenCalledTimes(5);
    expect(await Appointment.countDocuments({ sessionId: session._id })).toBe(0);
    expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(0);
  });

  it('retries an unknown commit result without rerunning the appointment operation', async () => {
    const session = await createSession({ capacity: 1 });
    const startSession = mongoose.startSession.bind(mongoose);
    let commitAttempts = 0;
    jest.spyOn(mongoose, 'startSession').mockImplementation(async (...args) => {
      const mongoSession = await startSession(...args);
      mongoSession.commitTransaction = async () => {
        commitAttempts += 1;
        const unknownResult = new Error('commit result is unknown');
        unknownResult.errorLabels = ['UnknownTransactionCommitResult'];
        throw unknownResult;
      };
      return mongoSession;
    });
    const createAppointmentSpy = jest.spyOn(Appointment, 'create');

    const response = await book(session, customer);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
    expect(commitAttempts).toBe(5);
    expect(createAppointmentSpy).toHaveBeenCalledTimes(1);
    expect(await Appointment.countDocuments({ sessionId: session._id })).toBe(0);
    expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(0);
  });

  it('reassigns an appointment atomically and rejects reassignment to the same session', async () => {
    const source = await createSession({ capacity: 2, daysAhead: 3 });
    const target = await createSession({ capacity: 2, daysAhead: 5 });
    const booking = await book(source, customer);
    expect(booking.status).toBe(201);
    const branchAssistantToken = tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT);

    const response = await request(app)
      .patch(`/api/appointments/${booking.body.data.id}/reassign`)
      .set('Authorization', `Bearer ${branchAssistantToken}`)
      .send({ sessionId: target._id.toString() });
    expect(response.status).toBe(200);

    const appointment = await Appointment.findById(booking.body.data.id).lean();
    expect(appointment.sessionId.toString()).toBe(target._id.toString());
    expect(appointment.staffId.toString()).toBe(optometrist._id.toString());
    expect(appointment.dateTime).toEqual(target.startAt);
    expect(appointment.position).toBe(1);
    expect((await DoctorSession.findById(source._id)).confirmedCount).toBe(0);
    expect((await DoctorSession.findById(target._id)).confirmedCount).toBe(1);

    const sameSession = await request(app)
      .patch(`/api/appointments/${booking.body.data.id}/reassign`)
      .set('Authorization', `Bearer ${branchAssistantToken}`)
      .send({ sessionId: target._id.toString() });
    expect(sameSession.status).toBe(409);
  });

  it('compacts a multi-booking source session when reassigning a middle appointment', async () => {
    const source = await createSession({ capacity: 3, daysAhead: 3 });
    const target = await createSession({ capacity: 2, daysAhead: 5 });
    const customers = [customer];
    customers.push(await createCustomer('reassign.compact.second@example.com'));
    customers.push(await createCustomer('reassign.compact.third@example.com'));
    const bookings = await Promise.all(
      customers.map((bookingCustomer) => book(source, bookingCustomer))
    );
    expect(bookings.map((response) => response.status)).toEqual([201, 201, 201]);

    const response = await request(app)
      .patch(`/api/appointments/${bookings[1].body.data.id}/reassign`)
      .set('Authorization', `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`)
      .send({ sessionId: target._id.toString() });

    expect(response.status).toBe(200);
    expect(
      (
        await Appointment.find({ sessionId: source._id, status: 'CONFIRMED' }).sort({ position: 1 })
      ).map((appointment) => appointment.position)
    ).toEqual([1, 2]);
    expect(
      (await Appointment.findOne({ sessionId: target._id, status: 'CONFIRMED' })).position
    ).toBe(1);
    expect((await DoctorSession.findById(source._id)).confirmedCount).toBe(2);
    expect((await DoctorSession.findById(target._id)).confirmedCount).toBe(1);
  });

  it('allows only one concurrent reassignment into the final target seat', async () => {
    const sourceA = await createSession({ capacity: 1, daysAhead: 3 });
    const sourceB = await createSession({ capacity: 1, daysAhead: 4 });
    const target = await createSession({ capacity: 1, daysAhead: 6 });
    const otherCustomer = await createCustomer('reassign.race@example.com');
    const bookings = await Promise.all([book(sourceA, customer), book(sourceB, otherCustomer)]);
    expect(bookings.map((response) => response.status)).toEqual([201, 201]);
    const branchAssistantToken = tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT);
    const reassign = (booking) =>
      request(app)
        .patch(`/api/appointments/${booking.body.data.id}/reassign`)
        .set('Authorization', `Bearer ${branchAssistantToken}`)
        .send({ sessionId: target._id.toString() });

    const responses = await Promise.all(bookings.map(reassign));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await Appointment.countDocuments({ sessionId: target._id, status: 'CONFIRMED' })).toBe(
      1
    );
    expect((await DoctorSession.findById(target._id)).confirmedCount).toBe(1);
  });

  it('rolls back target reservation when reassignment persistence fails', async () => {
    const source = await createSession({ capacity: 1, daysAhead: 3 });
    const target = await createSession({ capacity: 1, daysAhead: 5 });
    const booking = await book(source, customer);
    jest
      .spyOn(Appointment, 'updateOne')
      .mockRejectedValue(new Error('simulated reassignment failure'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .patch(`/api/appointments/${booking.body.data.id}/reassign`)
      .set('Authorization', `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`)
      .send({ sessionId: target._id.toString() });

    expect(response.status).toBe(500);
    const persisted = await Appointment.findById(booking.body.data.id).lean();
    expect(persisted.sessionId.toString()).toBe(source._id.toString());
    expect(persisted.position).toBe(1);
    expect((await DoctorSession.findById(source._id)).confirmedCount).toBe(1);
    expect((await DoctorSession.findById(target._id)).confirmedCount).toBe(0);
  });

  it('rejects full, duplicate-customer, and other-branch reassignment targets without changing source bookings', async () => {
    const source = await createSession({ capacity: 2, daysAhead: 3 });
    const fullTarget = await createSession({ capacity: 1, daysAhead: 5 });
    const duplicateTarget = await createSession({ capacity: 2, daysAhead: 6 });
    const fullCustomer = await createCustomer('reassign.full.target@example.com');
    const sourceBooking = await book(source, customer);
    const targetOccupant = await book(fullTarget, fullCustomer);
    const duplicateBooking = await book(duplicateTarget, customer);
    expect([sourceBooking.status, targetOccupant.status, duplicateBooking.status]).toEqual([
      201, 201, 201,
    ]);
    const branchAssistantToken = tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT);
    const reassign = (appointmentId, targetSessionId) =>
      request(app)
        .patch(`/api/appointments/${appointmentId}/reassign`)
        .set('Authorization', `Bearer ${branchAssistantToken}`)
        .send({ sessionId: targetSessionId.toString() });

    const fullResponse = await reassign(sourceBooking.body.data.id, fullTarget._id);
    expect(fullResponse.status).toBe(409);
    const duplicateResponse = await reassign(sourceBooking.body.data.id, duplicateTarget._id);
    expect(duplicateResponse.status).toBe(409);

    const tooSoonTarget = await createSession({ capacity: 2, daysAhead: 0.5 });
    const tooSoonResponse = await reassign(sourceBooking.body.data.id, tooSoonTarget._id);
    expect(tooSoonResponse.status).toBe(409);

    const invalidProviderTarget = await createSession({ capacity: 2, daysAhead: 7 });
    await Staff.updateOne(
      { _id: optometrist._id },
      { $set: { role: ROLE_VALUES.BRANCH_ASSISTANT } }
    );
    const invalidProviderResponse = await reassign(
      sourceBooking.body.data.id,
      invalidProviderTarget._id
    );
    expect(invalidProviderResponse.status).toBe(422);
    await Staff.updateOne({ _id: optometrist._id }, { $set: { role: ROLE_VALUES.OPTOMETRIST } });

    const otherBranch = await Branch.create({
      address: 'Other Branch',
      contactNumber: '+94 11 222 0000',
    });
    const otherStaff = await Staff.create({
      name: 'Other Branch Optometrist',
      email: 'other.optometrist@example.com',
      phone: '+94 77 100 0300',
      address: 'Other Branch',
      branchId: otherBranch._id,
      role: ROLE_VALUES.OPTOMETRIST,
      passwordHash: '$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const otherStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const otherSession = await DoctorSession.create({
      staffId: otherStaff._id,
      branchId: otherBranch._id,
      startAt: otherStart,
      endAt: new Date(otherStart.getTime() + 60 * 60 * 1000),
      capacity: 2,
    });
    const mismatchedProviderSession = await DoctorSession.create({
      staffId: otherStaff._id,
      branchId: gampahaBranch._id,
      startAt: otherStart,
      endAt: new Date(otherStart.getTime() + 60 * 60 * 1000),
      capacity: 2,
    });
    const providerBranchResponse = await reassign(
      sourceBooking.body.data.id,
      mismatchedProviderSession._id
    );
    expect(providerBranchResponse.status).toBe(422);
    const branchResponse = await reassign(sourceBooking.body.data.id, otherSession._id);
    expect(branchResponse.status).toBe(403);
    const unchanged = await Appointment.findById(sourceBooking.body.data.id).lean();
    expect(unchanged.sessionId.toString()).toBe(source._id.toString());
    expect((await DoctorSession.findById(source._id)).confirmedCount).toBe(1);
    expect((await DoctorSession.findById(fullTarget._id)).confirmedCount).toBe(1);
    expect((await DoctorSession.findById(duplicateTarget._id)).confirmedCount).toBe(1);
  });

  it('gives Gampaha branch managers scoped read access but no appointment write access', async () => {
    const session = await createSession({ capacity: 1 });
    const booking = await book(session, customer);
    const passwordHash = '$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const manager = await Staff.create({
      name: 'Gampaha Manager',
      email: 'manager.gampaha@example.com',
      phone: '+94 77 100 0200',
      address: 'Gampaha',
      branchId: gampahaBranch._id,
      role: ROLE_VALUES.BRANCH_MANAGER,
      passwordHash,
    });
    const otherBranch = await Branch.create({
      address: 'Other Branch',
      contactNumber: '+94 11 222 0000',
    });
    const otherManager = await Staff.create({
      name: 'Other Branch Manager',
      email: 'manager.other@example.com',
      phone: '+94 77 100 0201',
      address: 'Other Branch',
      branchId: otherBranch._id,
      role: ROLE_VALUES.BRANCH_MANAGER,
      passwordHash,
    });
    const managerToken = tokenFor(manager._id, ROLE_VALUES.BRANCH_MANAGER);

    expect(
      (
        await request(app)
          .get('/api/doctor-sessions')
          .set('Authorization', `Bearer ${managerToken}`)
      ).status
    ).toBe(200);
    const managerAppointments = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(managerAppointments.body.data).toHaveLength(1);
    expect(managerAppointments.body.data[0]).not.toHaveProperty('customer');
    expect(
      (
        await request(app)
          .get(`/api/appointments/${booking.body.data.id}`)
          .set('Authorization', `Bearer ${managerToken}`)
      ).status
    ).toBe(200);
    const managerAppointment = await request(app)
      .get(`/api/appointments/${booking.body.data.id}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(managerAppointment.body.data).not.toHaveProperty('customer');
    expect(
      (
        await request(app)
          .post('/api/appointments')
          .set('Authorization', `Bearer ${managerToken}`)
          .send({ sessionId: session._id })
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/api/appointments/${booking.body.data.id}/cancel`)
          .set('Authorization', `Bearer ${managerToken}`)
          .send()
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/api/appointments/${booking.body.data.id}/reassign`)
          .set('Authorization', `Bearer ${managerToken}`)
          .send({ sessionId: session._id })
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/api/doctor-sessions/${session._id}`)
          .set('Authorization', `Bearer ${managerToken}`)
          .send({ capacity: 2 })
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/doctor-sessions')
          .set('Authorization', `Bearer ${managerToken}`)
          .send({
            doctorId: doctor._id.toString(),
            branchId: gampahaBranch._id.toString(),
            startAt: session.startAt.toISOString(),
            endAt: session.endAt.toISOString(),
            capacity: 1,
          })
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/appointments')
          .set('Authorization', `Bearer ${tokenFor(otherManager._id, ROLE_VALUES.BRANCH_MANAGER)}`)
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/appointments')
          .set('Authorization', `Bearer ${tokenFor(optometrist._id, ROLE_VALUES.OPTOMETRIST)}`)
      ).status
    ).toBe(403);
  });

  it('denies Branch Assistants assigned to another branch from Gampaha appointment management', async () => {
    const session = await createSession({ capacity: 1 });
    const booking = await book(session, customer);
    const otherBranch = await Branch.create({
      address: 'Branch Assistant Other Branch',
      contactNumber: '+94 11 222 0001',
    });
    const otherBranchAssistant = await Staff.create({
      name: 'Other Branch Assistant',
      email: 'branch-assistant.other@example.com',
      phone: '+94 77 100 0301',
      address: 'Other Branch',
      branchId: otherBranch._id,
      role: ROLE_VALUES.BRANCH_ASSISTANT,
      passwordHash: '$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const token = tokenFor(otherBranchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT);

    expect(
      (
        await request(app)
          .get('/api/appointments/providers')
          .set('Authorization', `Bearer ${token}`)
      ).status
    ).toBe(403);
    expect(
      (await request(app).get('/api/appointments').set('Authorization', `Bearer ${token}`)).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/appointments/${booking.body.data.id}`)
          .set('Authorization', `Bearer ${token}`)
      ).status
    ).toBe(403);
    expect(
      (await request(app).get('/api/doctor-sessions').set('Authorization', `Bearer ${token}`))
        .status
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/api/appointments/${booking.body.data.id}/cancel`)
          .set('Authorization', `Bearer ${token}`)
          .send()
      ).status
    ).toBe(403);
    const targetSession = await createSession({ capacity: 1, daysAhead: 5 });
    expect(
      (
        await request(app)
          .patch(`/api/appointments/${booking.body.data.id}/reassign`)
          .set('Authorization', `Bearer ${token}`)
          .send({ sessionId: targetSession._id.toString() })
      ).status
    ).toBe(403);
    const sessionStart = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(
      (
        await request(app)
          .post('/api/doctor-sessions')
          .set('Authorization', `Bearer ${token}`)
          .send({
            doctorId: doctor._id.toString(),
            branchId: gampahaBranch._id.toString(),
            startAt: sessionStart.toISOString(),
            endAt: new Date(sessionStart.getTime() + 60 * 60 * 1000).toISOString(),
            capacity: 1,
          })
      ).status
    ).toBe(403);
  });

  it('denies System Admin and Optometrist access to unsupported appointment management routes', async () => {
    const systemAdminToken = tokenFor(new mongoose.Types.ObjectId(), ROLE_VALUES.SYSTEM_ADMIN);
    const optometristToken = tokenFor(optometrist._id, ROLE_VALUES.OPTOMETRIST);

    for (const token of [systemAdminToken, optometristToken]) {
      expect(
        (await request(app).get('/api/appointments').set('Authorization', `Bearer ${token}`)).status
      ).toBe(403);
      expect(
        (
          await request(app)
            .get(`/api/appointments/${new mongoose.Types.ObjectId()}`)
            .set('Authorization', `Bearer ${token}`)
        ).status
      ).toBe(403);
      expect(
        (await request(app).get('/api/doctor-sessions').set('Authorization', `Bearer ${token}`))
          .status
      ).toBe(403);
    }
  });

  it('denies the retired Sales Assistant/Cashier role access to appointment operations', async () => {
    const retiredRoleToken = tokenFor(new mongoose.Types.ObjectId(), 'SALES_ASSISTANT_CASHIER');

    expect(
      (
        await request(app)
          .get('/api/appointments/providers')
          .set('Authorization', `Bearer ${retiredRoleToken}`)
      ).status
    ).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/appointments')
          .set('Authorization', `Bearer ${retiredRoleToken}`)
      ).status
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/doctor-sessions')
          .set('Authorization', `Bearer ${retiredRoleToken}`)
          .send({})
      ).status
    ).toBe(401);
  });

  it('preserves customer visibility for legacy appointments after staff branch transfer without guessing scope', async () => {
    const otherBranch = await Branch.create({
      address: 'Transferred Staff Branch',
      contactNumber: '+94 11 222 0002',
    });
    const legacy = await Appointment.create({
      customerId: customer._id,
      staffId: optometrist._id,
      dateTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      status: 'CONFIRMED',
    });
    await Staff.updateOne({ _id: optometrist._id }, { $set: { branchId: otherBranch._id } });
    const passwordHash = '$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const gampahaManager = await Staff.create({
      name: 'Gampaha History Manager',
      email: 'manager.history.gampaha@example.com',
      phone: '+94 77 100 0302',
      address: 'Gampaha',
      branchId: gampahaBranch._id,
      role: ROLE_VALUES.BRANCH_MANAGER,
      passwordHash,
    });

    const customerAppointments = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${tokenFor(customer._id)}`);
    const customerAppointment = await request(app)
      .get(`/api/appointments/${legacy._id}`)
      .set('Authorization', `Bearer ${tokenFor(customer._id)}`);
    const staffAppointments = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${tokenFor(gampahaManager._id, ROLE_VALUES.BRANCH_MANAGER)}`);

    expect(customerAppointments.body.data.map((item) => item.id)).toContain(legacy._id.toString());
    expect(customerAppointment.status).toBe(200);
    expect(staffAppointments.body.data).toEqual([]);
  });

  it('returns customer-owned legacy history when GAMPAHA_CENTRAL is not configured', async () => {
    const legacy = await Appointment.create({
      customerId: customer._id,
      staffId: optometrist._id,
      dateTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      status: 'CONFIRMED',
    });
    await Branch.updateOne({ _id: gampahaBranch._id }, { $unset: { codeName: 1 } });

    const response = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${tokenFor(customer._id)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((appointment) => appointment.id)).toContain(
      legacy._id.toString()
    );
  });

  it('rejects impossible ISO dates and excludes providers who are no longer eligible', async () => {
    const branchAssistantToken = tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT);
    const createSessionRequest = (startAt, endAt) =>
      request(app)
        .post('/api/doctor-sessions')
        .set('Authorization', `Bearer ${branchAssistantToken}`)
        .send({
          doctorId: doctor._id.toString(),
          branchId: gampahaBranch._id.toString(),
          startAt,
          endAt,
          capacity: 1,
        });
    const impossibleDate = await createSessionRequest(
      '2026-02-30T09:00:00Z',
      '2026-02-30T10:00:00Z'
    );
    expect(impossibleDate.status).toBe(422);
    const missingTimezone = await createSessionRequest(
      '2026-10-20T09:00:00',
      '2026-10-20T10:00:00'
    );
    expect(missingTimezone.status).toBe(422);

    const session = await createSession({ capacity: 1 });
    await Staff.updateOne(
      { _id: optometrist._id },
      { $set: { role: ROLE_VALUES.BRANCH_ASSISTANT } }
    );
    const available = await request(app)
      .get('/api/doctor-sessions/available')
      .set('Authorization', `Bearer ${tokenFor(customer._id)}`);
    expect(available.body.data).toEqual([]);
    const booking = await book(session, customer);
    expect(booking.status).toBe(422);
  });

  it('rejects a booking inside the 24-hour lead-time boundary', async () => {
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000 - 60_000);
    const session = await DoctorSession.create({
      staffId: optometrist._id,
      branchId: gampahaBranch._id,
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
      capacity: 1,
    });

    const response = await book(session, customer);

    expect(response.status).toBe(409);
    expect(await Appointment.countDocuments({ sessionId: session._id })).toBe(0);
    expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(0);
  });

  it('allows booking at the exact 24-hour lead-time boundary using a deterministic clock', async () => {
    const fixedNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    const startAt = new Date(fixedNow + 24 * 60 * 60 * 1000);
    const session = await DoctorSession.create({
      staffId: optometrist._id,
      branchId: gampahaBranch._id,
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
      capacity: 1,
    });

    const response = await book(session, customer);

    expect(response.status).toBe(201);
    expect((await Appointment.findById(response.body.data.id)).position).toBe(1);
  });

  it('serializes concurrent overlapping session creation for the same optometrist', async () => {
    const firstStart = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const createSessionRequest = (startAt) =>
      request(app)
        .post('/api/doctor-sessions')
        .set(
          'Authorization',
          `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`
        )
        .send({
          doctorId: doctor._id.toString(),
          branchId: gampahaBranch._id.toString(),
          startAt: startAt.toISOString(),
          endAt: new Date(startAt.getTime() + 60 * 60 * 1000).toISOString(),
          capacity: 1,
        });

    const responses = await Promise.all([
      createSessionRequest(firstStart),
      createSessionRequest(new Date(firstStart.getTime() + 30 * 60 * 1000)),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await DoctorSession.countDocuments({ doctorId: doctor._id })).toBe(1);
  });

  it('serializes simultaneous updates that would create overlapping optometrist sessions', async () => {
    const baseline = Date.now() + 5 * 24 * 60 * 60 * 1000;
    const first = await createSession({
      startAt: new Date(baseline),
      endAt: new Date(baseline + 60 * 60 * 1000),
    });
    const second = await createSession({
      startAt: new Date(baseline + 3 * 60 * 60 * 1000),
      endAt: new Date(baseline + 4 * 60 * 60 * 1000),
    });
    const token = tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT);
    const update = (session, startOffset, endOffset) =>
      request(app)
        .patch(`/api/doctor-sessions/${session._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          startAt: new Date(baseline + startOffset * 60 * 60 * 1000).toISOString(),
          endAt: new Date(baseline + endOffset * 60 * 60 * 1000).toISOString(),
        });

    const responses = await Promise.all([update(first, 1.5, 3.5), update(second, 2.5, 4.5)]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const persistedSessions = await DoctorSession.find({ staffId: optometrist._id })
      .sort({ startAt: 1 })
      .lean();
    expect(persistedSessions).toHaveLength(2);
    expect(
      persistedSessions[0].startAt < persistedSessions[1].endAt &&
        persistedSessions[0].endAt > persistedSessions[1].startAt
    ).toBe(false);
    expect(
      (await Staff.findById(optometrist._id).select('+schedulingVersion')).schedulingVersion
    ).toBe(1);
  });

  it('moves an existing session to an eligible doctor after the former doctor transfers branches', async () => {
    const session = await createSession({ capacity: 2 });
    const booking = await book(session, customer);
    const otherBranch = await Branch.create({
      address: 'Former Optometrist Branch',
      contactNumber: '+94 11 222 0010',
    });
    const replacementDoctor = await Staff.create({
      name: 'Dr. Replacement',
      email: 'replacement.optometrist@example.com',
      phone: '+94 77 100 0310',
      address: 'Gampaha',
      branchId: gampahaBranch._id,
      role: ROLE_VALUES.OPTOMETRIST,
      passwordHash: '$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await Staff.updateOne({ _id: optometrist._id }, { $set: { branchId: otherBranch._id } });

    const response = await request(app)
      .patch(`/api/doctor-sessions/${session._id}`)
      .set('Authorization', `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`)
      .send({ staffId: replacementDoctor._id.toString() });

    expect(response.status).toBe(200);
    const updatedSession = await DoctorSession.findById(session._id).lean();
    const updatedAppointment = await Appointment.findById(booking.body.data.id).lean();
    expect(updatedSession.staffId.toString()).toBe(replacementDoctor._id.toString());
    expect(updatedAppointment.staffId.toString()).toBe(replacementDoctor._id.toString());
    expect(updatedAppointment.dateTime).toEqual(updatedSession.startAt);
    expect(updatedAppointment.branchId.toString()).toBe(gampahaBranch._id.toString());
    const replacementSessions = await DoctorSession.find({ staffId: replacementDoctor._id }).lean();
    expect(replacementSessions).toHaveLength(1);
    expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(1);
  });

  it('rejects booking when provider eligibility changes after the transaction read', async () => {
    const session = await createSession({ capacity: 1 });
    const otherBranch = await Branch.create({
      address: 'Eligibility Race Branch',
      contactNumber: '+94 11 222 0011',
    });
    const updateStaff = Staff.updateOne.bind(Staff);
    let eligibilityChanged = false;
    jest.spyOn(Staff, 'updateOne').mockImplementation(async (filter, update, options) => {
      if (!eligibilityChanged && options?.session && filter.role === ROLE_VALUES.OPTOMETRIST) {
        eligibilityChanged = true;
        await updateStaff(
          { _id: optometrist._id },
          { $set: { role: ROLE_VALUES.BRANCH_ASSISTANT, branchId: otherBranch._id } }
        );
      }
      return updateStaff(filter, update, options);
    });

    const response = await book(session, customer);

    expect(eligibilityChanged).toBe(true);
    expect(response.status).toBe(422);
    expect(await Appointment.countDocuments({ sessionId: session._id })).toBe(0);
    expect((await DoctorSession.findById(session._id)).confirmedCount).toBe(0);
  });

  it('rejects reassignment when the target provider transfers after the transaction read', async () => {
    const source = await createSession({ capacity: 1, daysAhead: 3 });
    const target = await createSession({ capacity: 1, daysAhead: 5 });
    const booking = await book(source, customer);
    const otherBranch = await Branch.create({
      address: 'Reassignment Eligibility Race Branch',
      contactNumber: '+94 11 222 0012',
    });
    const updateStaff = Staff.updateOne.bind(Staff);
    let eligibilityChanged = false;
    jest.spyOn(Staff, 'updateOne').mockImplementation(async (filter, update, options) => {
      if (
        !eligibilityChanged &&
        options?.session &&
        String(filter._id) === String(optometrist._id) &&
        filter.role === ROLE_VALUES.OPTOMETRIST
      ) {
        eligibilityChanged = true;
        await updateStaff({ _id: optometrist._id }, { $set: { branchId: otherBranch._id } });
      }
      return updateStaff(filter, update, options);
    });

    const response = await request(app)
      .patch(`/api/appointments/${booking.body.data.id}/reassign`)
      .set('Authorization', `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`)
      .send({ sessionId: target._id.toString() });

    expect(eligibilityChanged).toBe(true);
    expect(response.status).toBe(422);
    const persisted = await Appointment.findById(booking.body.data.id).lean();
    expect(persisted.sessionId.toString()).toBe(source._id.toString());
    expect((await DoctorSession.findById(source._id)).confirmedCount).toBe(1);
    expect((await DoctorSession.findById(target._id)).confirmedCount).toBe(0);
  });

  it('rejects capacity reductions below current confirmed bookings', async () => {
    const session = await createSession({ capacity: 3 });
    await Promise.all([
      book(session, customer),
      book(session, await createCustomer('capacity.second@example.com')),
    ]);
    const response = await request(app)
      .patch(`/api/doctor-sessions/${session._id}`)
      .set('Authorization', `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`)
      .send({ capacity: 0 });
    expect(response.status).toBe(422);
    const belowConfirmed = await request(app)
      .patch(`/api/doctor-sessions/${session._id}`)
      .set('Authorization', `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`)
      .send({ capacity: 1 });
    expect(belowConfirmed.status).toBe(409);
  });

  it('syncs cancelled session-linked records on reschedule and keeps legacy appointments visible', async () => {
    const session = await createSession({ capacity: 2 });
    const linkedAppointments = await Appointment.create([
      {
        customerId: customer._id,
        staffId: optometrist._id,
        sessionId: session._id,
        dateTime: session.startAt,
        status: 'CONFIRMED',
        position: 1,
      },
      {
        customerId: customer._id,
        staffId: optometrist._id,
        sessionId: session._id,
        dateTime: session.startAt,
        status: 'CANCELLED',
        position: null,
      },
      {
        customerId: customer._id,
        staffId: optometrist._id,
        dateTime: new Date(session.startAt.getTime() - 24 * 60 * 60 * 1000),
        status: 'CONFIRMED',
      },
    ]);
    const newStartAt = new Date(session.startAt.getTime() + 2 * 60 * 60 * 1000);

    const response = await request(app)
      .patch(`/api/doctor-sessions/${session._id}`)
      .set('Authorization', `Bearer ${tokenFor(branchAssistant._id, ROLE_VALUES.BRANCH_ASSISTANT)}`)
      .send({
        startAt: newStartAt.toISOString(),
        endAt: new Date(newStartAt.getTime() + 60 * 60 * 1000).toISOString(),
      });

    expect(response.status).toBe(200);
    const synced = await Appointment.find({ sessionId: session._id }).sort({ status: 1 }).lean();
    expect(synced).toHaveLength(2);
    synced.forEach((appointment) => expect(appointment.dateTime).toEqual(newStartAt));
    const customerAppointments = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${tokenFor(customer._id)}`);
    expect(customerAppointments.body.data).toHaveLength(3);
    expect(linkedAppointments).toHaveLength(3);
  });
});
