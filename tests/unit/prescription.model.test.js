const mongoose = require('mongoose');
const Prescription = require('../../src/models/prescription.model');

describe('Prescription model (Unit tests)', () => {
  const validCustomerId = new mongoose.Types.ObjectId();
  const validStaffId = new mongoose.Types.ObjectId();

  it('should validate a valid prescription object without throwing errors', async () => {
    // Arrange
    const prescription = new Prescription({
      customerId: validCustomerId,
      recordedBy: validStaffId,
      rightEye: {
        distance: { sph: -2.0, cyl: -0.5, axis: 180, va: '6/6' },
        reading: { add: 2.0, nearVa: 'N6' },
      },
      leftEye: {
        distance: { sph: -2.25, cyl: -0.75, axis: 175, va: '6/6' },
        reading: { add: 2.0, nearVa: 'N6' },
      },
      remarks: 'Unit test prescription',
    });

    // Act & Assert
    await expect(prescription.validate()).resolves.toBeUndefined();
    expect(prescription.customerId).toEqual(validCustomerId);
    expect(prescription.recordedBy).toEqual(validStaffId);
    expect(prescription.isArchived).toBe(false);
    expect(prescription.recordedAt).toBeInstanceOf(Date);
  });

  it('should set expected default values for omitted optional fields', () => {
    // Arrange & Act
    const prescription = new Prescription({
      customerId: validCustomerId,
      recordedBy: validStaffId,
    });

    // Assert
    expect(prescription.isArchived).toBe(false);
    expect(prescription.remarks).toBe('');
    expect(prescription.rightEye.distance.sph).toBeNull();
    expect(prescription.rightEye.distance.cyl).toBeNull();
    expect(prescription.rightEye.distance.axis).toBeNull();
    expect(prescription.rightEye.distance.va).toBeNull();
    expect(prescription.rightEye.reading.add).toBeNull();
    expect(prescription.rightEye.reading.nearVa).toBeNull();
  });

  it('should fail validation when required fields customerId or recordedBy are missing', async () => {
    // Arrange
    const missingCustomerId = new Prescription({
      recordedBy: validStaffId,
    });
    const missingRecordedBy = new Prescription({
      customerId: validCustomerId,
    });

    // Act & Assert
    await expect(missingCustomerId.validate()).rejects.toThrow(mongoose.Error.ValidationError);
    await expect(missingRecordedBy.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it('should fail validation when axis is negative or exceeds 180 degrees', async () => {
    // Arrange
    const negativeAxis = new Prescription({
      customerId: validCustomerId,
      recordedBy: validStaffId,
      rightEye: { distance: { axis: -5 } },
    });
    const overflowAxis = new Prescription({
      customerId: validCustomerId,
      recordedBy: validStaffId,
      leftEye: { distance: { axis: 185 } },
    });

    // Act & Assert
    await expect(negativeAxis.validate()).rejects.toThrow(mongoose.Error.ValidationError);
    await expect(overflowAxis.validate()).rejects.toThrow(mongoose.Error.ValidationError);
  });
});
