const { ROLE_VALUES } = require('../constants/roles');
const {
  SALES_VIEW_ROLES,
  INVENTORY_VIEW_ROLES,
} = require('../constants/report.constants');
const { ForbiddenError, UnauthorizedError } = require('../errors/AppError');

/**
 * Resolves the authenticated user's reporting authorization and branch scope.
 * Prevents branch-scope IDOR and enforces ADR-014 role matrix.
 *
 * @param {import('express').Request} req
 * @param {'sales'|'inventory'} reportCategory
 * @returns {{ branchId: string|null, isOrgWide: boolean, role: string }}
 */
function resolveReportScope(req, reportCategory) {
  const role = req.auth?.role || req.user?.role;

  if (!role) {
    throw new UnauthorizedError('Authentication required.');
  }

  // 1. Role Authorization Check
  if (reportCategory === 'sales') {
    if (!SALES_VIEW_ROLES.includes(role)) {
      throw new ForbiddenError('Access forbidden: insufficient role permissions.');
    }
  } else if (reportCategory === 'inventory') {
    if (!INVENTORY_VIEW_ROLES.includes(role)) {
      throw new ForbiddenError('Access forbidden: insufficient role permissions.');
    }
  } else {
    throw new ForbiddenError('Unsupported report category.');
  }

  // 2. Branch Scope Resolution
  const requestedBranchId = req.query?.branchId;

  if (role === ROLE_VALUES.BRANCH_MANAGER) {
    const userBranchId = req.auth?.branchId || req.user?.branchId;
    if (!userBranchId) {
      throw new ForbiddenError('Branch Manager is not assigned to an active branch.');
    }

    const assignedBranchStr = userBranchId.toString();

    // If a branchId was explicitly provided, it MUST match the assigned branch
    if (requestedBranchId && requestedBranchId !== 'ALL') {
      if (requestedBranchId.toString() !== assignedBranchStr) {
        throw new ForbiddenError('Access forbidden: cannot query branch data outside assigned scope.');
      }
    }

    return {
      branchId: assignedBranchStr,
      isOrgWide: false,
      role,
    };
  }

  // SYSTEM_ADMIN has organization-wide capability and can filter by branchId
  if (requestedBranchId && requestedBranchId !== 'ALL') {
    return {
      branchId: requestedBranchId.toString(),
      isOrgWide: false,
      role,
    };
  }

  return {
    branchId: null,
    isOrgWide: true,
    role,
  };
}

module.exports = {
  resolveReportScope,
};
