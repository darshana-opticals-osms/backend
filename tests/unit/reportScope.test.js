const { resolveReportScope } = require('../../src/utils/reportScope');
const { ROLE_VALUES } = require('../../src/constants/roles');
const { ForbiddenError, UnauthorizedError } = require('../../src/errors/AppError');

describe('resolveReportScope utility (ADR-014 §10 / ADR-002 Alignment)', () => {
  const branchA = '507f1f77bcf86cd799439011';
  const branchB = '507f1f77bcf86cd799439022';

  describe('System Admin Access (Org-Wide & Branch Filterable)', () => {
    it('allows SYSTEM_ADMIN organization-wide access for sales reports when branchId is omitted', () => {
      const req = { auth: { role: ROLE_VALUES.SYSTEM_ADMIN }, query: {} };
      const scope = resolveReportScope(req, 'sales');

      expect(scope).toEqual({
        branchId: null,
        isOrgWide: true,
        role: ROLE_VALUES.SYSTEM_ADMIN,
      });
    });

    it('allows SYSTEM_ADMIN to filter sales reports by specific branch', () => {
      const req = { auth: { role: ROLE_VALUES.SYSTEM_ADMIN }, query: { branchId: branchA } };
      const scope = resolveReportScope(req, 'sales');

      expect(scope).toEqual({
        branchId: branchA,
        isOrgWide: false,
        role: ROLE_VALUES.SYSTEM_ADMIN,
      });
    });

    it('allows SYSTEM_ADMIN organization-wide and branch-filtered access to inventory reports', () => {
      const orgReq = { auth: { role: ROLE_VALUES.SYSTEM_ADMIN }, query: {} };
      expect(resolveReportScope(orgReq, 'inventory').isOrgWide).toBe(true);

      const branchReq = { auth: { role: ROLE_VALUES.SYSTEM_ADMIN }, query: { branchId: branchB } };
      const branchScope = resolveReportScope(branchReq, 'inventory');
      expect(branchScope.isOrgWide).toBe(false);
      expect(branchScope.branchId).toBe(branchB);
    });
  });

  describe('Branch Manager Access (FR-012 View - Branch Scoped)', () => {
    it('forces branchId to assigned branch for BRANCH_MANAGER', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        query: {},
      };
      const scope = resolveReportScope(req, 'sales');

      expect(scope).toEqual({
        branchId: branchA,
        isOrgWide: false,
        role: ROLE_VALUES.BRANCH_MANAGER,
      });
    });

    it('allows BRANCH_MANAGER if queried branchId matches assigned branch', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        query: { branchId: branchA },
      };
      const scope = resolveReportScope(req, 'sales');

      expect(scope.branchId).toBe(branchA);
    });

    it('denies BRANCH_MANAGER with 403 Forbidden when requesting another branch (Prevent IDOR - AC31)', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: branchA },
        query: { branchId: branchB },
      };

      expect(() => resolveReportScope(req, 'sales')).toThrow(ForbiddenError);
    });

    it('denies BRANCH_MANAGER with 403 Forbidden if no branchId is assigned to user', () => {
      const req = {
        auth: { role: ROLE_VALUES.BRANCH_MANAGER, branchId: null },
        query: {},
      };

      expect(() => resolveReportScope(req, 'sales')).toThrow(ForbiddenError);
    });
  });

  describe('Unauthorized Roles (AC29)', () => {
    it.each([
      ROLE_VALUES.CUSTOMER,
      ROLE_VALUES.OPTOMETRIST,
      ROLE_VALUES.BRANCH_ASSISTANT,
      'UNKNOWN_ROLE',
    ])('denies role %s with 403 Forbidden on sales and inventory reports', (role) => {
      const req = { auth: { role, branchId: branchA }, query: {} };

      expect(() => resolveReportScope(req, 'sales')).toThrow(ForbiddenError);
      expect(() => resolveReportScope(req, 'inventory')).toThrow(ForbiddenError);
    });

    it('denies unauthenticated requests with 401 Unauthorized', () => {
      const req = { auth: null, query: {} };

      expect(() => resolveReportScope(req, 'sales')).toThrow(UnauthorizedError);
    });
  });
});
