const catchAsync = require('../utils/catchAsync');
const {
  getCustomerOrders,
  getCustomerOrderById,
  updateOrderStatus: updateOrderStatusService,
} = require('../services/order.service');

/**
 * GET /api/orders
 *
 * Returns all Orders owned by the authenticated CUSTOMER.
 * Customer identity is derived from the JWT (req.auth.userId) — never from a
 * client-supplied parameter.
 *
 * AC1 – Customer Order History Endpoint.
 * AC2 – Empty history is a valid result (returns []).
 */
const getMyOrders = catchAsync(async (req, res) => {
  const orders = await getCustomerOrders(req.auth.userId);
  return res.status(200).json({ success: true, data: orders });
});

/**
 * GET /api/orders/:id
 *
 * Returns a single Order with its OrderItems, enforcing customer ownership.
 * Customer identity is derived from the JWT (req.auth.userId).
 * The orderId comes from the validated URL path parameter.
 *
 * AC3  – Retrieve Single Customer Order.
 * AC4  – Prevent Cross-Customer Access (ownership enforced in service).
 * AC5  – Invalid Order Identifier returns a validation error.
 * AC6  – Non-Existent Order returns not-found (no information leakage).
 * AC9  – OrderItems returned safely.
 */
const getMyOrderById = catchAsync(async (req, res) => {
  const order = await getCustomerOrderById(req.auth.userId, req.params.id);
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
  getMyOrders,
  getMyOrderById,
  updateOrderStatus,
};
