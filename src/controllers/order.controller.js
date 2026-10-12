const catchAsync = require('../utils/catchAsync');
const {
  getOrders: getOrdersService,
  getOrderById: getOrderByIdService,
  updateOrderStatus: updateOrderStatusService,
} = require('../services/order.service');

/**
 * GET /api/orders
 *
 * Returns Orders accessible to caller:
 * - CUSTOMER: Returns only orders owned by the authenticated customer.
 * - Staff (SALES_ASSISTANT_CASHIER):
 *   Returns all orders in reverse chronological order for tracking and fulfillment.
 *
 * AC1, AC2, AC6, ADR-004 §12, §13.
 */
const getOrders = catchAsync(async (req, res) => {
  const orders = await getOrdersService({
    userId: req.auth.userId,
    role: req.auth.role,
  });
  return res.status(200).json({ success: true, data: orders });
});

/**
 * GET /api/orders/:id
 *
 * Returns a single Order with its OrderItems:
 * - CUSTOMER: Enforces customer ownership (scoped lookup to prevent IDOR).
 * - Staff (SALES_ASSISTANT_CASHIER):
 *   Returns tracking information and line items for the requested order.
 *
 * AC3, AC4, AC5, AC6, AC9, ADR-004 §12, §13.
 */
const getOrderById = catchAsync(async (req, res) => {
  const order = await getOrderByIdService({
    orderId: req.params.id,
    userId: req.auth.userId,
    role: req.auth.role,
  });
  return res.status(200).json({ success: true, data: order });
});

/**
 * PATCH /api/orders/:id/status
 *
 * Updates an Order's canonical tracking status by authorized staff.
 * Caller identity is derived from the JWT (req.auth.userId).
 * Staff role authorization is enforced at route level via middleware.
 *
 * ADR-004 §9, §10, §11, §15, §16, §17.
 */
const updateOrderStatus = catchAsync(async (req, res) => {
  const updatedOrder = await updateOrderStatusService(
    req.params.id,
    req.body.status,
    req.auth.userId
  );
  return res.status(200).json({ success: true, data: updatedOrder });
});

module.exports = {
  getOrders,
  getOrderById,
  getMyOrders: getOrders,
  getMyOrderById: getOrderById,
  updateOrderStatus,
};
