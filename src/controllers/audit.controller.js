const catchAsync = require('../utils/catchAsync');
const auditService = require('../services/audit.service');

/**
 * GET /api/audit-events
 *
 * Retrieves immutable audit events with bounded pagination and safe filters.
 * Restricted strictly to SYSTEM_ADMIN role (ADR-012 AC53–AC58).
 */
const getAuditEvents = catchAsync(async (req, res) => {
  const { action, actorId, targetType, targetId, branchId, fromDate, toDate, page, limit } =
    req.query;

  const result = await auditService.query({
    action,
    actorId,
    targetType,
    targetId,
    branchId,
    fromDate,
    toDate,
    page,
    limit,
  });

  return res.status(200).json({
    success: true,
    data: result.events,
    pagination: {
      total: result.total,
      page: result.page,
      pages: result.pages,
    },
  });
});

module.exports = {
  getAuditEvents,
};
