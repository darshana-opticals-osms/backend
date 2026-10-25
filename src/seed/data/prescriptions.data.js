/**
 * Fictional Clinical Prescription Seed Data (ADR-001, FR-002, FR-013)
 *
 * All clinical prescription parameters (sph, cyl, axis, va, add, nearVa, remarks)
 * are completely fictional non-production data following ADR-001 clinical specifications.
 */

const SEED_PRESCRIPTIONS = [
  {
    customerEmail: 'kamal.customer@example.com',
    staffEmail: 'optometrist.kandy@darshanaopticals.local',
    recordedAt: new Date('2026-03-15T10:30:00Z'),
    rightEye: {
      distance: { sph: -1.25, cyl: -0.5, axis: 90, va: '6/6' },
      reading: { add: 1.75, nearVa: 'N5' },
    },
    leftEye: {
      distance: { sph: -1.5, cyl: -0.75, axis: 85, va: '6/6' },
      reading: { add: 1.75, nearVa: 'N5' },
    },
    remarks:
      'Patient reports mild eyestrain during evening reading. Progressive lenses recommended.',
    isArchived: false,
  },
  {
    customerEmail: 'kamal.customer@example.com',
    staffEmail: 'optometrist.kandy@darshanaopticals.local',
    recordedAt: new Date('2025-02-10T09:15:00Z'),
    rightEye: {
      distance: { sph: -1.0, cyl: -0.25, axis: 90, va: '6/6' },
      reading: { add: 1.5, nearVa: 'N6' },
    },
    leftEye: {
      distance: { sph: -1.25, cyl: -0.5, axis: 85, va: '6/6' },
      reading: { add: 1.5, nearVa: 'N6' },
    },
    remarks: 'Initial clinical prescription recorded.',
    isArchived: false,
  },
  {
    customerEmail: 'alice.customer@example.com',
    staffEmail: 'optometrist.kandy@darshanaopticals.local',
    recordedAt: new Date('2026-05-20T14:00:00Z'),
    rightEye: {
      distance: { sph: 0.75, cyl: -0.25, axis: 180, va: '6/6' },
      reading: { add: 2.0, nearVa: 'N5' },
    },
    leftEye: {
      distance: { sph: 1.0, cyl: -0.5, axis: 175, va: '6/6' },
      reading: { add: 2.0, nearVa: 'N5' },
    },
    remarks: 'Hyperopia with mild astigmatism. Anti-reflective coating suggested.',
    isArchived: false,
  },
];

module.exports = {
  SEED_PRESCRIPTIONS,
};
