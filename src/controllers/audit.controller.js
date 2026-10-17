const catchAsync = require('../utils/catchAsync');
const auditService = require('../services/audit.service');
const { AUDIT_ACTION, AUDIT_TARGET_TYPE, AUDIT_OUTCOME } = require('../constants/audit');

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

  // Meta-auditing (ADR-012 §14.2): Record AUDIT_TRAIL_ACCESSED by SYSTEM_ADMIN
  const authUser = req.user || req.auth;
  if (authUser && (authUser.userId || authUser.id || authUser._id)) {
    const actor = auditService.buildUserActor({
      userId: authUser.userId || authUser.id || authUser._id,
      role: authUser.role,
    });
    const correlationId = req.headers ? req.headers['x-correlation-id'] : null;

    await auditService.record({
      action: AUDIT_ACTION.AUDIT_TRAIL_ACCESSED,
      actor,
      target: {
        targetType: AUDIT_TARGET_TYPE.AUDIT_LOG,
        targetId: 'AUDIT_TRAIL',
      },
      outcome: AUDIT_OUTCOME.SUCCESS,
      correlationId,
      metadata: {
        filterCriteria: {
          action: action || null,
          actorId: actorId || null,
          targetType: targetType || null,
          targetId: targetId || null,
          branchId: branchId || null,
        },
        resultCount: result.events ? result.events.length : 0,
        totalCount: result.total,
        page: result.page,
      },
    });
  }

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
