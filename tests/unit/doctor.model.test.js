const mongoose = require('mongoose');
const Doctor = require('../../src/models/doctor.model');

describe('Doctor model (Unit tests)', () => {
  it('should validate a valid Doctor object without throwing errors', async () => {
    const doctor = new Doctor({
      name: 'Dr. Nimal Perera',
      specialization: 'Ophthalmologist',
    });

    await expect(doctor.validate()).resolves.toBeUndefined();
    expect(doctor.name).toBe('Dr. Nimal Perera');
    expect(doctor.specialization).toBe('Ophthalmologist');
  });

  it('should trim whitespace around name and specialization', () => {
    const doctor = new Doctor({
      name: '   Dr. Kamal Silva   ',
      specialization: '   Optometry Specialist   ',
    });

    expect(doctor.name).toBe('Dr. Kamal Silva');
    expect(doctor.specialization).toBe('Optometry Specialist');
  });

  it('should fail validation when name is missing or empty', async () => {
    const missingName = new Doctor({
      specialization: 'Ophthalmologist',
    });
    const emptyName = new Doctor({
      name: '',
      specialization: 'Ophthalmologist',
    });

    await expect(missingName.validate()).rejects.toThrow(mongoose.Error.ValidationError);
    await expect(emptyName.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should fail validation when name is whitespace only', async () => {
    const whitespaceName = new Doctor({
      name: '     ',
      specialization: 'Ophthalmologist',
    });

    await expect(whitespaceName.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should fail validation when name exceeds 100 characters', async () => {
    const longName = new Doctor({
      name: 'Dr. ' + 'a'.repeat(98),
      specialization: 'Ophthalmologist',
    });

    await expect(longName.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should fail validation when specialization is missing or empty', async () => {
    const missingSpec = new Doctor({
      name: 'Dr. Nimal Perera',
    });
    const emptySpec = new Doctor({
      name: 'Dr. Nimal Perera',
      specialization: '',
    });

    await expect(missingSpec.validate()).rejects.toThrow(mongoose.Error.ValidationError);
    await expect(emptySpec.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should fail validation when specialization is whitespace only', async () => {
    const whitespaceSpec = new Doctor({
      name: 'Dr. Nimal Perera',
      specialization: '    ',
    });

    await expect(whitespaceSpec.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should fail validation when specialization exceeds 100 characters', async () => {
    const longSpec = new Doctor({
      name: 'Dr. Nimal Perera',
      specialization: 's'.repeat(101),
    });

    await expect(longSpec.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should not contain any authentication, user, or role fields in schema', () => {
    const schemaPaths = Object.keys(Doctor.schema.paths);

    expect(schemaPaths).toContain('name');
    expect(schemaPaths).toContain('specialization');
    expect(schemaPaths).toContain('createdAt');
    expect(schemaPaths).toContain('updatedAt');

    // AC1 & AC4: Strict boundary against auth/login fields
    expect(schemaPaths).not.toContain('email');
    expect(schemaPaths).not.toContain('password');
    expect(schemaPaths).not.toContain('passwordHash');
    expect(schemaPaths).not.toContain('role');
    expect(schemaPaths).not.toContain('staffId');
    expect(schemaPaths).not.toContain('userId');
    expect(schemaPaths).not.toContain('tokens');
    expect(schemaPaths).not.toContain('branchId');
  });
});
