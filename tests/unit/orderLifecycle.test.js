/**
 * Unit tests for the ADR-004 Order Lifecycle constants and helper functions.
 *
 * These tests verify:
 *  - All canonical status values are present and unchanged.
 *  - The allowed-transition matrix matches ADR-004 Section 9 exactly.
 *  - isValidOrderStatus() correctly classifies canonical vs unknown values.
 *  - isValidStatusTransition() permits only approved transitions.
 *  - isTerminalStatus() correctly identifies terminal states.
 *  - Authorized update roles and tracking-view roles are exported.
 */

const {
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  ALLOWED_STATUS_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  ORDER_STATUS_UPDATE_ROLES,
  ORDER_TRACKING_VIEW_ROLES,
  isValidOrderStatus,
  isValidStatusTransition,
  isTerminalStatus,
} = require('../../src/constants/orderStatuses');

const { ROLE_VALUES } = require('../../src/constants/roles');

// ─── Canonical Status Values ──────────────────────────────────────────────────

describe('ORDER_STATUS_VALUES', () => {
  it('contains exactly the six ADR-004 canonical statuses', () => {
    const expected = [
      'ORDER_CREATED',
      'PROCESSING',
      'READY_FOR_PICKUP',
      'PICKED_UP',
      'COMPLETED',
      'CANCELLED',
    ];
    expect(Object.values(ORDER_STATUS_VALUES)).toEqual(expect.arrayContaining(expected));
    expect(Object.values(ORDER_STATUS_VALUES)).toHaveLength(expected.length);
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(ORDER_STATUS_VALUES)).toBe(true);
  });
});

describe('ORDER_STATUSES', () => {
  it('is an array of all canonical status strings', () => {
    expect(Array.isArray(ORDER_STATUSES)).toBe(true);
    expect(ORDER_STATUSES).toHaveLength(6);
    for (const s of Object.values(ORDER_STATUS_VALUES)) {
      expect(ORDER_STATUSES).toContain(s);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ORDER_STATUSES)).toBe(true);
  });
});

// ─── Allowed Transition Matrix (ADR-004 §9) ───────────────────────────────────

describe('ALLOWED_STATUS_TRANSITIONS', () => {
  it('has an entry for every canonical status', () => {
    for (const s of ORDER_STATUSES) {
      expect(ALLOWED_STATUS_TRANSITIONS).toHaveProperty(s);
    }
  });

  it('allows ORDER_CREATED → PROCESSING and ORDER_CREATED → CANCELLED only', () => {
    const allowed = ALLOWED_STATUS_TRANSITIONS[ORDER_STATUS_VALUES.ORDER_CREATED];
    expect(allowed).toEqual(
      expect.arrayContaining([ORDER_STATUS_VALUES.PROCESSING, ORDER_STATUS_VALUES.CANCELLED])
    );
    expect(allowed).toHaveLength(2);
  });

  it('allows PROCESSING → READY_FOR_PICKUP and PROCESSING → CANCELLED only', () => {
    const allowed = ALLOWED_STATUS_TRANSITIONS[ORDER_STATUS_VALUES.PROCESSING];
    expect(allowed).toEqual(
      expect.arrayContaining([ORDER_STATUS_VALUES.READY_FOR_PICKUP, ORDER_STATUS_VALUES.CANCELLED])
    );
    expect(allowed).toHaveLength(2);
  });

  it('allows READY_FOR_PICKUP → PICKED_UP only', () => {
    const allowed = ALLOWED_STATUS_TRANSITIONS[ORDER_STATUS_VALUES.READY_FOR_PICKUP];
    expect(allowed).toEqual([ORDER_STATUS_VALUES.PICKED_UP]);
  });

  it('allows PICKED_UP → COMPLETED only', () => {
    const allowed = ALLOWED_STATUS_TRANSITIONS[ORDER_STATUS_VALUES.PICKED_UP];
    expect(allowed).toEqual([ORDER_STATUS_VALUES.COMPLETED]);
  });

  it('allows no transitions from terminal state COMPLETED', () => {
    expect(ALLOWED_STATUS_TRANSITIONS[ORDER_STATUS_VALUES.COMPLETED]).toHaveLength(0);
  });

  it('allows no transitions from terminal state CANCELLED', () => {
    expect(ALLOWED_STATUS_TRANSITIONS[ORDER_STATUS_VALUES.CANCELLED]).toHaveLength(0);
  });

  it('is frozen at the top level', () => {
    expect(Object.isFrozen(ALLOWED_STATUS_TRANSITIONS)).toBe(true);
  });
});

// ─── Terminal States ───────────────────────────────────────────────────────────

describe('TERMINAL_ORDER_STATUSES', () => {
  it('contains COMPLETED and CANCELLED', () => {
    expect(TERMINAL_ORDER_STATUSES).toContain(ORDER_STATUS_VALUES.COMPLETED);
    expect(TERMINAL_ORDER_STATUSES).toContain(ORDER_STATUS_VALUES.CANCELLED);
  });

  it('contains exactly two entries', () => {
    expect(TERMINAL_ORDER_STATUSES).toHaveLength(2);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(TERMINAL_ORDER_STATUSES)).toBe(true);
  });
});

// ─── Authorized Roles ─────────────────────────────────────────────────────────

describe('ORDER_STATUS_UPDATE_ROLES', () => {
  it('includes BRANCH_ASSISTANT', () => {
    expect(ORDER_STATUS_UPDATE_ROLES).toContain(ROLE_VALUES.BRANCH_ASSISTANT);
  });

  it('does not include BRANCH_MANAGER', () => {
    expect(ORDER_STATUS_UPDATE_ROLES).not.toContain(ROLE_VALUES.BRANCH_MANAGER);
  });

  it('does not include SYSTEM_ADMIN', () => {
    expect(ORDER_STATUS_UPDATE_ROLES).not.toContain(ROLE_VALUES.SYSTEM_ADMIN);
  });

  it('does not include CUSTOMER (customers cannot update status)', () => {
    expect(ORDER_STATUS_UPDATE_ROLES).not.toContain(ROLE_VALUES.CUSTOMER);
  });

  it('does not include OPTOMETRIST', () => {
    expect(ORDER_STATUS_UPDATE_ROLES).not.toContain(ROLE_VALUES.OPTOMETRIST);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ORDER_STATUS_UPDATE_ROLES)).toBe(true);
  });
});

describe('ORDER_TRACKING_VIEW_ROLES', () => {
  it('includes BRANCH_ASSISTANT', () => {
    expect(ORDER_TRACKING_VIEW_ROLES).toContain(ROLE_VALUES.BRANCH_ASSISTANT);
  });

  it('does not include BRANCH_MANAGER', () => {
    expect(ORDER_TRACKING_VIEW_ROLES).not.toContain(ROLE_VALUES.BRANCH_MANAGER);
  });

  it('does not include SYSTEM_ADMIN', () => {
    expect(ORDER_TRACKING_VIEW_ROLES).not.toContain(ROLE_VALUES.SYSTEM_ADMIN);
  });

  it('does not include CUSTOMER (customer uses own-resource endpoint)', () => {
    expect(ORDER_TRACKING_VIEW_ROLES).not.toContain(ROLE_VALUES.CUSTOMER);
  });

  it('does not include OPTOMETRIST', () => {
    expect(ORDER_TRACKING_VIEW_ROLES).not.toContain(ROLE_VALUES.OPTOMETRIST);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ORDER_TRACKING_VIEW_ROLES)).toBe(true);
  });
});

// ─── isValidOrderStatus ───────────────────────────────────────────────────────

describe('isValidOrderStatus()', () => {
  it('returns true for each canonical status', () => {
    for (const s of ORDER_STATUSES) {
      expect(isValidOrderStatus(s)).toBe(true);
    }
  });

  it('returns false for an unknown status string', () => {
    expect(isValidOrderStatus('SHIPPED')).toBe(false);
    expect(isValidOrderStatus('DELIVERED')).toBe(false);
    expect(isValidOrderStatus('PENDING')).toBe(false);
    expect(isValidOrderStatus('')).toBe(false);
  });

  it('returns false for non-string inputs', () => {
    expect(isValidOrderStatus(null)).toBe(false);
    expect(isValidOrderStatus(undefined)).toBe(false);
    expect(isValidOrderStatus(42)).toBe(false);
  });
});

// ─── isValidStatusTransition ──────────────────────────────────────────────────

describe('isValidStatusTransition()', () => {
  // ── Permitted transitions ──────────────────────────────────────────────────

  it('permits ORDER_CREATED → PROCESSING', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.ORDER_CREATED, ORDER_STATUS_VALUES.PROCESSING)
    ).toBe(true);
  });

  it('permits ORDER_CREATED → CANCELLED', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.ORDER_CREATED, ORDER_STATUS_VALUES.CANCELLED)
    ).toBe(true);
  });

  it('permits PROCESSING → READY_FOR_PICKUP', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.PROCESSING, ORDER_STATUS_VALUES.READY_FOR_PICKUP)
    ).toBe(true);
  });

  it('permits PROCESSING → CANCELLED', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.PROCESSING, ORDER_STATUS_VALUES.CANCELLED)
    ).toBe(true);
  });

  it('permits READY_FOR_PICKUP → PICKED_UP', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.READY_FOR_PICKUP, ORDER_STATUS_VALUES.PICKED_UP)
    ).toBe(true);
  });

  it('permits PICKED_UP → COMPLETED', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.PICKED_UP, ORDER_STATUS_VALUES.COMPLETED)
    ).toBe(true);
  });

  // ── Rejected skips (ADR-004 §9: no lifecycle jumping) ─────────────────────

  it('rejects ORDER_CREATED → COMPLETED (lifecycle skip)', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.ORDER_CREATED, ORDER_STATUS_VALUES.COMPLETED)
    ).toBe(false);
  });

  it('rejects ORDER_CREATED → READY_FOR_PICKUP (lifecycle skip)', () => {
    expect(
      isValidStatusTransition(
        ORDER_STATUS_VALUES.ORDER_CREATED,
        ORDER_STATUS_VALUES.READY_FOR_PICKUP
      )
    ).toBe(false);
  });

  it('rejects ORDER_CREATED → PICKED_UP (lifecycle skip)', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.ORDER_CREATED, ORDER_STATUS_VALUES.PICKED_UP)
    ).toBe(false);
  });

  it('rejects PROCESSING → PICKED_UP (lifecycle skip)', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.PROCESSING, ORDER_STATUS_VALUES.PICKED_UP)
    ).toBe(false);
  });

  it('rejects PROCESSING → COMPLETED (lifecycle skip)', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.PROCESSING, ORDER_STATUS_VALUES.COMPLETED)
    ).toBe(false);
  });

  it('rejects READY_FOR_PICKUP → CANCELLED (not an allowed transition)', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.READY_FOR_PICKUP, ORDER_STATUS_VALUES.CANCELLED)
    ).toBe(false);
  });

  it('rejects READY_FOR_PICKUP → COMPLETED (lifecycle skip)', () => {
    expect(
      isValidStatusTransition(ORDER_STATUS_VALUES.READY_FOR_PICKUP, ORDER_STATUS_VALUES.COMPLETED)
    ).toBe(false);
  });

  // ── Terminal state lock (ADR-004 §9) ──────────────────────────────────────

  it('rejects any transition from terminal COMPLETED', () => {
    for (const s of ORDER_STATUSES) {
      expect(isValidStatusTransition(ORDER_STATUS_VALUES.COMPLETED, s)).toBe(false);
    }
  });

  it('rejects any transition from terminal CANCELLED', () => {
    for (const s of ORDER_STATUSES) {
      expect(isValidStatusTransition(ORDER_STATUS_VALUES.CANCELLED, s)).toBe(false);
    }
  });

  // ── Unknown / invalid inputs ───────────────────────────────────────────────

  it('returns false when currentStatus is unknown', () => {
    expect(isValidStatusTransition('SHIPPED', ORDER_STATUS_VALUES.COMPLETED)).toBe(false);
  });

  it('returns false when nextStatus is unknown', () => {
    expect(isValidStatusTransition(ORDER_STATUS_VALUES.PROCESSING, 'SHIPPED')).toBe(false);
  });

  it('returns false when both arguments are unknown', () => {
    expect(isValidStatusTransition('SHIPPED', 'DELIVERED')).toBe(false);
  });
});

// ─── isTerminalStatus ─────────────────────────────────────────────────────────

describe('isTerminalStatus()', () => {
  it('returns true for COMPLETED', () => {
    expect(isTerminalStatus(ORDER_STATUS_VALUES.COMPLETED)).toBe(true);
  });

  it('returns true for CANCELLED', () => {
    expect(isTerminalStatus(ORDER_STATUS_VALUES.CANCELLED)).toBe(true);
  });

  it('returns false for all non-terminal canonical statuses', () => {
    const nonTerminal = [
      ORDER_STATUS_VALUES.ORDER_CREATED,
      ORDER_STATUS_VALUES.PROCESSING,
      ORDER_STATUS_VALUES.READY_FOR_PICKUP,
      ORDER_STATUS_VALUES.PICKED_UP,
    ];
    for (const s of nonTerminal) {
      expect(isTerminalStatus(s)).toBe(false);
    }
  });

  it('returns false for an unknown status string', () => {
    expect(isTerminalStatus('SHIPPED')).toBe(false);
    expect(isTerminalStatus('')).toBe(false);
  });

  it('returns false for non-string inputs', () => {
    expect(isTerminalStatus(null)).toBe(false);
    expect(isTerminalStatus(undefined)).toBe(false);
  });
});
