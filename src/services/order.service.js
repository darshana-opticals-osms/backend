const mongoose = require('mongoose');
const Order = require('../models/order.model');
const OrderItem = require('../models/orderItem.model');
const Customer = require('../models/customer.model');
const Inventory = require('../models/inventory.model');
const Payment = require('../models/payment.model');
const LoyaltyTransaction = require('../models/loyaltyTransaction.model');
const { earnPurchasePoints } = require('./loyalty.service');
const { deductInventoryStock, restoreInventoryStock } = require('./inventory.service');
const { PAYMENT_STATUS } = require('../constants/payment');
const { ROLE_VALUES } = require('../constants/roles');
const {
  ORDER_STATUSES,
  ORDER_STATUS_VALUES,
  ORDER_TRACKING_VIEW_ROLES,
  isValidOrderStatus,
  isValidStatusTransition,
  isTerminalStatus,
} = require('../constants/orderStatuses');
const { domainEvents, ORDER_EVENTS } = require('../utils/domainEvents');
const { cancelUnpaidReservation } = require('./orderReservation.service');
const {
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError,
} = require('../errors/AppError');

const ORDER_NOT_FOUND = 'ORDER_NOT_FOUND';

// ─── Safe Response Shapers ────────────────────────────────────────────────────

/**
 * Shapes a single OrderItem document into the safe customer-facing response.
 *
 * Exposes only approved fields. Internal fields (_id raw, orderId, __v,
 * timestamps) are excluded unless they are part of the approved shape.
 *
 * AC9 – Include Order Items Safely.
 *
 * @param {object} item - Mongoose OrderItem document or plain object
 * @returns {object}
 */
function shapeOrderItem(item) {
  return {
    id: item._id.toString(),
    itemName: item.itemName,
    price: item.price,
    quantity: item.quantity,
  };
}

/**
 * Shapes a status-history entry into the safe customer-facing representation.
 *
 * AC8 – Return Tracking History According to ADR-004 (embedded history).
 * AC18 – Safe API Responses.
 * Review Comment 3 – changedBy internal identifier is omitted for customer views
 * to avoid leaking internal staff ObjectIds. Included only for authorized staff.
 *
 * @param {object} entry
 * @param {object} [options]
 * @param {boolean} [options.isStaff=false] - Whether the caller has authorized staff role
 * @returns {object}
 */
function shapeHistoryEntry(entry, options = {}) {
  const isStaff = options.isStaff || false;
  const shaped = {
    status: entry.status,
    changedAt: entry.changedAt,
  };

  // Only expose internal staff identifier to authorized staff callers; omit for customer views
  if (isStaff && entry.changedBy) {
    shaped.changedBy = entry.changedBy.toString();
  }

  return shaped;
}

/**
 * Shapes a Customer document or plain object into the safe customer representation
 * for authorized staff order responses (Issue #95, AC1, AC2, AC6, AC7).
 *
 * Exposes only name and phone. Internal fields (password, tokens, loyalty balance,
 * address, email, etc.) are omitted to preserve customer privacy.
 *
 * @param {object|null} customer - Mongoose Customer document or plain object
 * @returns {{ name: string, phone: string } | null}
 */
function shapeCustomerSummary(customer) {
  if (!customer) return null;
  return {
    name: customer.name || '',
    phone: customer.phone || '',
  };
}

/**
 * Shapes an Order document into the safe order summary used in order list endpoints.
 *
 * Does not include OrderItems (fetched separately on single-order request).
 * For authorized staff requests (options.isStaff=true), includes basic customer
 * identification (name and phone) alongside customerId (Issue #95, AC1, AC2).
 * For customer requests (options.isStaff=false), preserves existing response contract (AC4, AC6).
 *
 * AC1, AC2, AC4, AC6, AC7, AC8, AC18.
 *
 * @param {object} order - Mongoose Order document or plain object
 * @param {object} [options]
 * @param {boolean} [options.isStaff=false]
 * @param {object|null} [options.customer] - Customer document or plain object
 * @returns {object}
 */
function shapeOrderSummary(order, options = {}) {
  const isStaff = options.isStaff || false;
  const shaped = {
    id: order._id.toString(),
    customerId: order.customerId.toString(),
    branchId: order.branchId ? order.branchId.toString() : null,
    orderDate: order.orderDate,
    orderAmount: order.orderAmount,
    status: order.status,
    statusUpdatedAt: order.statusUpdatedAt,
    statusHistory: (order.statusHistory || []).map((entry) => shapeHistoryEntry(entry, options)),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };

  if (isStaff) {
    shaped.customer =
      options.customer !== undefined
        ? shapeCustomerSummary(options.customer)
        : order.customer
          ? shapeCustomerSummary(order.customer)
          : null;
  }

  return shaped;
}

/**
 * Shapes a single Order document together with its OrderItems into the safe
 * single-order response.
 *
 * AC3, AC7, AC8, AC9, AC18.
 *
 * @param {object} order      - Mongoose Order document or plain object
 * @param {object[]} items    - Array of OrderItem documents
 * @param {object} [options]
 * @param {boolean} [options.isStaff=false]
 * @returns {object}
 */
function shapeOrderDetail(order, items, options = {}) {
  return {
    ...shapeOrderSummary(order, options),
    items: items.map(shapeOrderItem),
  };
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Retrieves orders based on caller role.
 *
 * - CUSTOMER: Returns orders owned by that customer (scoped to customerId).
 * - SYSTEM_ADMIN: Returns all orders (org-wide scope; branchId not required).
 * - Branch-scoped staff (BRANCH_MANAGER, BRANCH_ASSISTANT, OPTOMETRIST):
 *   MUST have a valid assigned branchId. Requests without one are rejected
 *   fail-closed to prevent cross-branch data leakage (Review Comment 3).
 *   Returns unassigned orders (branchId: null, available to claim) plus orders
 *   already assigned to the caller's branch.
 *
 * AC1, AC2, AC6, ADR-004 §12, §13.
 *
 * @param {object} params
 * @param {string} params.userId   - Authenticated user's ID
 * @param {string} params.role     - Authenticated user's canonical role
 * @param {string|null} params.branchId - Authenticated staff member's branch assignment
 * @returns {Promise<object[]>} Safe shaped order summaries
 */
async function getOrders({ userId, role, branchId = null }) {
  if (role === ROLE_VALUES.CUSTOMER) {
    if (!mongoose.isValidObjectId(userId)) {
      throw new ValidationError('Authenticated customer identity is invalid.');
    }
    const orders = await Order.find({ customerId: userId }).sort({ createdAt: -1 }).lean();
    return orders.map((order) => shapeOrderSummary(order, { isStaff: false }));
  }

  if (ORDER_TRACKING_VIEW_ROLES.includes(role)) {
    // Review Comment 3 – Fail-closed: branch-scoped staff require a valid branchId.
    // SYSTEM_ADMIN has org-wide access and is not in ORDER_TRACKING_VIEW_ROLES,
    // so this guard applies only to operational branch staff.
    if (!branchId || !mongoose.isValidObjectId(branchId)) {
      throw new ForbiddenError(
        'A valid branch assignment is required to access order data.',
        null,
        'BRANCH_REQUIRED'
      );
    }

    const filter = {
      $or: [
        { status: ORDER_STATUS_VALUES.ORDER_CREATED, branchId: null },
        { status: ORDER_STATUS_VALUES.PROCESSING, branchId: null },
        { branchId: new mongoose.Types.ObjectId(branchId) },
      ],
    };

    const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();

    // Batch lookup associated customers to prevent N+1 queries (AC8)
    const rawCustomerIds = orders
      .map((o) => o.customerId)
      .filter((id) => Boolean(id) && mongoose.isValidObjectId(id));
    const distinctCustomerIds = [...new Set(rawCustomerIds.map((id) => id.toString()))];

    let customerMap = new Map();
    if (distinctCustomerIds.length > 0 && typeof Customer?.find === 'function') {
      const rawQuery = Customer.find({ _id: { $in: distinctCustomerIds } });
      if (rawQuery) {
        const q = typeof rawQuery.select === 'function' ? rawQuery.select('name phone') : rawQuery;
        const customers = typeof q?.lean === 'function' ? await q.lean() : await q;
        if (Array.isArray(customers)) {
          customerMap = new Map(customers.map((c) => [c._id.toString(), c]));
        }
      }
    }

    return orders.map((order) => {
      const customer =
        (order.customerId && customerMap.get(order.customerId.toString())) ||
        order.customer ||
        null;
      return shapeOrderSummary(order, { isStaff: true, customer });
    });
  }

  throw new ValidationError('Role not authorized for order tracking retrieval.');
}

/**
 * Returns all Orders owned by the authenticated Customer, ordered newest-first.
 * Backwards-compatible convenience wrapper for getOrders.
 *
 * @param {string} authenticatedCustomerId - Customer._id from req.auth (JWT-derived)
 * @returns {Promise<object[]>} Array of safe order summary objects (may be empty)
 */
async function getCustomerOrders(authenticatedCustomerId) {
  return getOrders({ userId: authenticatedCustomerId, role: ROLE_VALUES.CUSTOMER });
}

/**
 * Retrieves a single Order with its OrderItems based on caller role.
 *
 * - CUSTOMER: Enforces ownership (scopes query to _id AND customerId) to prevent IDOR.
 * - Branch-scoped staff (BRANCH_ASSISTANT, BRANCH_MANAGER):
 *   Retrieves any ORDER_CREATED order (available to claim) or orders assigned
 *   to their own branch. Access to another branch's order is denied.
 *   A valid branchId is required (Review Comment 3 – fail-closed).
 *
 * AC3, AC4, AC5, AC6, AC9, ADR-004 §12, §13.
 *
 * @param {object} params
 * @param {string} params.orderId - Target Order ObjectId
 * @param {string} params.userId  - Authenticated user's ID
 * @param {string} params.role    - Authenticated user's canonical role
 * @param {string|null} params.branchId - Staff branch assignment
 * @returns {Promise<object>} Safe shaped order-detail response with items
 */
async function getOrderById({ orderId, userId, role, branchId = null }) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new ValidationError(
      'Order ID must be a valid identifier.',
      [{ field: 'id', message: 'Order ID must be a valid MongoDB ObjectId.' }],
      'INVALID_ORDER_ID'
    );
  }

  const isStaff = ORDER_TRACKING_VIEW_ROLES.includes(role);
  let order;
  if (role === ROLE_VALUES.CUSTOMER) {
    if (!mongoose.isValidObjectId(userId)) {
      throw new ValidationError('Authenticated customer identity is invalid.');
    }
    order = await Order.findOne({
      _id: orderId,
      customerId: userId,
    }).lean();
  } else if (isStaff) {
    // Review Comment 3 – Fail-closed: branch staff require a valid branchId.
    if (!branchId || !mongoose.isValidObjectId(branchId)) {
      throw new ForbiddenError(
        'A valid branch assignment is required to access order data.',
        null,
        'BRANCH_REQUIRED'
      );
    }

    order = await Order.findById(orderId).lean();
    if (order && order.branchId && order.branchId.toString() !== branchId.toString()) {
      throw new ForbiddenError(
        'You are not authorized to view orders assigned to another branch.',
        null,
        'BRANCH_ACCESS_DENIED'
      );
    }
  } else {
    throw new ValidationError('Role not authorized for order tracking retrieval.');
  }

  if (!order) {
    throw new NotFoundError('Order not found.', null, ORDER_NOT_FOUND);
  }

  // Retrieve associated OrderItems for this Order.
  const items = await OrderItem.find({ orderId: order._id }).lean();

  let customer = null;
  if (isStaff && order.customerId && typeof Customer?.findById === 'function') {
    const rawQuery = Customer.findById(order.customerId);
    if (rawQuery) {
      const q = typeof rawQuery.select === 'function' ? rawQuery.select('name phone') : rawQuery;
      customer = typeof q?.lean === 'function' ? await q.lean() : await q;
    }
  } else if (isStaff && order.customer) {
    customer = order.customer;
  }

  return shapeOrderDetail(order, items, { isStaff, customer });
}

/**
 * Returns a single Order with its OrderItems, enforcing customer ownership.
 * Backwards-compatible convenience wrapper for getOrderById.
 *
 * @param {string} authenticatedCustomerId - Customer._id from req.auth (JWT-derived)
 * @param {string} orderId                 - Order ID from URL path parameter
 * @returns {Promise<object>} Safe shaped order-detail response with items
 */
async function getCustomerOrderById(authenticatedCustomerId, orderId) {
  return getOrderById({
    orderId,
    userId: authenticatedCustomerId,
    role: ROLE_VALUES.CUSTOMER,
  });
}

/**
 * Resolves the authoritative Inventory record for an OrderItem at the claiming branch.
 *
 * Review Comment 4 – Use stable product/SKU identity for matching:
 * - Match against source inventory's authoritative attributes (itemName, brand, category)
 *   to avoid ambiguous match across similar product variants.
 * - If sourceRecord cannot be resolved (unresolved legacy reference), fail allocation.
 * - If ambiguous match detected at claiming branch, fail allocation without modifying stock.
 *
 * @param {object} item           - Lean OrderItem document
 * @param {mongoose.Types.ObjectId} branchObjectId - Claiming branch ObjectId
 * @param {import('mongoose').ClientSession|null} [session]
 * @returns {Promise<object>} Matching Inventory document
 * @throws {ConflictError} If stock is insufficient or match is ambiguous
 */
async function resolveClaimingBranchInventory(item, branchObjectId, session) {
  const sourceInventoryId = item.classificationSnapshot?.sourceInventoryId || item.inventoryId;

  if (!sourceInventoryId || !mongoose.isValidObjectId(sourceInventoryId)) {
    throw new ConflictError(
      `Unresolved inventory reference for '${item.itemName}'. Cannot allocate safely without authoritative product reference.`,
      null,
      'UNRESOLVED_INVENTORY_REFERENCE'
    );
  }

  const sourceRecord = await Inventory.findById(sourceInventoryId)
    .session(session || null)
    .lean();

  if (!sourceRecord) {
    throw new ConflictError(
      `Unresolved inventory reference for '${item.itemName}'. Cannot allocate safely without authoritative product reference.`,
      null,
      'UNRESOLVED_INVENTORY_REFERENCE'
    );
  }

  if (sourceRecord.branchId.toString() === branchObjectId.toString()) {
    // Claiming branch IS the original checkout branch — authoritative same-branch match!
    return sourceRecord;
  }

  // Cross-branch fulfillment without globally stable SKU identity fails closed per ADR-014 / Review Item 4
  throw new ConflictError(
    `Cross-branch fulfillment is unsupported: item '${sourceRecord.itemName}' originated from branch '${sourceRecord.branchId}' and cannot be allocated safely to branch '${branchObjectId}' without a shared SKU identity.`,
    null,
    'UNSUPPORTED_CROSS_BRANCH_ALLOCATION'
  );
}

/**
 * Safely resolves a Mongoose query with an optional transaction session,
 * accommodating both real Mongoose queries and unit-test query mocks.
 */
async function resolveMongooseQuery(query, session = null) {
  if (!query) return null;
  let q = query;
  if (typeof q.session === 'function' && session) {
    q = q.session(session);
  }
  if (typeof q.then === 'function') {
    return await q;
  }
  if (typeof q.lean === 'function') {
    return await q.lean();
  }
  return await q;
}

/**
 * Allocates and records fulfillment inventory for an order when claimed by a branch.
 *
 * Review Finding 2 – Prevents double stock deduction on same-branch claims by consuming
 * the reservation made at checkout by checkoutCustomer().
 *
 * Review Finding 4 & 6 – Persists fulfilledInventoryId on OrderItem and uses
 * authoritative deductInventoryStock with fail-closed reorder alerts and audit events.
 *
 * @param {object} order - Mongoose Order document
 * @param {string|mongoose.Types.ObjectId|null} branchId - Claiming branch ID
 * @param {import('mongoose').ClientSession} session - Required active transaction session
 * @param {object|null} [auditUser=null]
 */
async function allocateBranchInventoryForOrder(order, branchId, session, auditUser = null) {
  if (!branchId || !mongoose.isValidObjectId(branchId)) return;

  const branchObjectId = new mongoose.Types.ObjectId(branchId);
  const items = await resolveMongooseQuery(OrderItem.find({ orderId: order._id }), session);

  if (!items || items.length === 0) return;

  for (const item of items) {
    const branchItem = await resolveClaimingBranchInventory(item, branchObjectId, session);

    const originalInventoryId = item.inventoryId ? item.inventoryId.toString() : null;
    const branchInventoryId = branchItem._id.toString();
    const isSameBranch = originalInventoryId && originalInventoryId === branchInventoryId;

    if (isSameBranch) {
      // Review Finding 2: SAME-BRANCH CLAIM
      // Stock was ALREADY deducted/reserved at checkout by checkoutCustomer().
      // Do NOT perform a second physical stock deduction!
      // Simply record fulfilledInventoryId to confirm fulfillment attribution.
      item.fulfilledInventoryId = branchItem._id;
      if (typeof item.save === 'function') {
        await item.save({ session });
      } else if (OrderItem.findByIdAndUpdate) {
        await OrderItem.findByIdAndUpdate(
          item._id,
          { $set: { fulfilledInventoryId: branchItem._id } },
          session ? { session } : {}
        );
      }
    } else {
      // Cross-branch claim (if supported via legacy fallback):
      await deductInventoryStock(
        [{ inventoryId: branchItem._id, quantity: item.quantity }],
        session,
        {
          orderId: order._id.toString(),
          user: auditUser,
          system: !auditUser,
        }
      );

      if (originalInventoryId) {
        await restoreInventoryStock(
          [{ inventoryId: item.inventoryId, quantity: item.quantity }],
          session,
          {
            orderId: order._id.toString(),
            user: auditUser,
            system: !auditUser,
          }
        );
      }

      item.fulfilledInventoryId = branchItem._id;
      if (typeof item.save === 'function') {
        await item.save({ session });
      } else if (OrderItem.findByIdAndUpdate) {
        await OrderItem.findByIdAndUpdate(
          item._id,
          { $set: { fulfilledInventoryId: branchItem._id } },
          session ? { session } : {}
        );
      }
    }
  }
}

/**
 * Restores stock back to the branch inventory when an order in PROCESSING is CANCELLED.
 *
 * Review Finding 4 – Deterministically restores the exact Inventory record that was fulfilled
 * (item.fulfilledInventoryId || item.inventoryId), failing closed on branch mismatch.
 *
 * Review Finding 6 – Participates in transaction session, evaluates reorder alerts fail-closed,
 * and records immutable audit events per ADR-006 and ADR-012.
 *
 * @param {object} order - Mongoose Order document
 * @param {import('mongoose').ClientSession} session - Required active transaction session
 * @param {object|null} [auditUser=null]
 */
async function restoreBranchInventoryForOrder(order, session, auditUser = null) {
  const items = await resolveMongooseQuery(OrderItem.find({ orderId: order._id }), session);
  if (!items || items.length === 0) return;

  const orderBranchIdStr = order.branchId ? order.branchId.toString() : null;

  for (const item of items) {
    const targetInvId = item.fulfilledInventoryId || item.inventoryId;
    if (!targetInvId || !mongoose.isValidObjectId(targetInvId)) {
      throw new ConflictError(
        `Fulfillment inventory cannot be safely resolved for item '${item.itemName}' during cancellation restoration.`,
        null,
        'RESTORATION_INVENTORY_UNRESOLVED'
      );
    }

    const targetInventory = await resolveMongooseQuery(Inventory.findById(targetInvId), session);
    if (!targetInventory) {
      throw new ConflictError(
        `Fulfillment inventory record '${targetInvId}' not found for cancellation restoration.`,
        null,
        'RESTORATION_INVENTORY_NOT_FOUND'
      );
    }

    if (orderBranchIdStr && targetInventory.branchId.toString() !== orderBranchIdStr) {
      throw new ConflictError(
        `Fulfillment inventory belongs to branch '${targetInventory.branchId}' but order was fulfilled by branch '${orderBranchIdStr}'. Cannot restore safely.`,
        null,
        'RESTORATION_BRANCH_MISMATCH'
      );
    }

    await restoreInventoryStock(
      [{ inventoryId: targetInventory._id, quantity: item.quantity }],
      session,
      {
        orderId: order._id.toString(),
        user: auditUser,
        system: !auditUser,
      }
    );
  }
}

/**
 * Claims an IPN-paid order (already in PROCESSING with no branchId) for fulfillment
 * at the calling staff member's branch. Allocates branch inventory atomically.
 *
 * Review Comment 1 – Lifecycle alignment: The PayHere IPN handler automatically
 * transitions ORDER_CREATED → PROCESSING. Staff cannot re-send PROCESSING for these
 * orders (it would be an invalid transition). This function provides the explicit
 * "claim" mechanism that assigns a branchId and deducts inventory for orders that
 * were auto-processed by the IPN.
 *
 * Preconditions:
 * - Order must be in PROCESSING status.
 * - Order must have no branchId (not yet claimed by any branch).
 * - Caller must provide a valid branchId.
 * - A verified completed Payment must exist for the order.
 *
 * @param {string} orderId     - Target Order ObjectId
 * @param {string} branchId    - Claiming branch ID from the authenticated staff member
 * @param {string} staffUserId - Authenticated staff user ID from JWT context
 * @returns {Promise<object>} Safe shaped order detail with items
 */
async function claimOrder(orderId, branchId, staffUserId) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new ValidationError(
      'Order ID must be a valid identifier.',
      [{ field: 'id', message: 'Order ID must be a valid MongoDB ObjectId.' }],
      'INVALID_ORDER_ID'
    );
  }

  if (!branchId || !mongoose.isValidObjectId(branchId)) {
    throw new ValidationError(
      'A valid branch ID is required to claim an order.',
      [{ field: 'branchId', message: 'branchId must be a valid MongoDB ObjectId.' }],
      'INVALID_BRANCH_ID'
    );
  }

  const branchObjectId = new mongoose.Types.ObjectId(branchId);

  const order = await Order.findById(orderId);
  if (!order) {
    throw new NotFoundError('Order not found.', null, ORDER_NOT_FOUND);
  }

  if (order.status !== ORDER_STATUS_VALUES.PROCESSING) {
    throw new ValidationError(
      `Only orders in PROCESSING status can be claimed. Current status: '${order.status}'.`,
      [{ field: 'status', message: 'Order must be in PROCESSING status to claim.' }],
      'ORDER_NOT_IN_PROCESSING'
    );
  }

  const alreadyClaimed =
    Boolean(order.claimedAt) ||
    (order.branchId && order.branchId.toString() !== branchObjectId.toString());

  if (alreadyClaimed) {
    throw new ConflictError(
      'This order has already been claimed by a branch.',
      null,
      'ORDER_ALREADY_CLAIMED'
    );
  }

  // Verified payment must exist for the order
  const verifiedPayment = await Payment.exists({
    orderId: order._id,
    status: PAYMENT_STATUS.COMPLETED,
  });
  if (!verifiedPayment) {
    throw new ValidationError(
      'Order cannot be claimed before verified payment.',
      [{ field: 'status', message: 'A verified completed Payment is required.' }],
      'PAYMENT_REQUIRED'
    );
  }

  const now = new Date();

  // Review Comment 2 – Atomicity: inventory allocation + order claim within one transaction
  const session = await mongoose.startSession();
  let claimedOrder;
  try {
    await session.withTransaction(async () => {
      // Allocate branch inventory first; throws ConflictError on insufficient stock
      await allocateBranchInventoryForOrder(order, branchId, session, {
        userId: staffUserId,
        role: ROLE_VALUES.BRANCH_MANAGER,
      });

      claimedOrder = await Order.findOneAndUpdate(
        {
          _id: orderId,
          status: ORDER_STATUS_VALUES.PROCESSING,
          $or: [{ branchId: null }, { branchId: branchObjectId }],
          claimedAt: null,
        },
        {
          $set: {
            branchId: branchObjectId,
            claimedAt: now,
            claimedBy: staffUserId,
            statusUpdatedAt: now,
          },
          $push: {
            statusHistory: {
              status: ORDER_STATUS_VALUES.PROCESSING,
              changedAt: now,
              changedBy: staffUserId,
              source: 'USER',
            },
          },
        },
        { session, new: true, runValidators: true }
      );

      if (!claimedOrder) {
        throw new ConflictError(
          'Order was claimed concurrently by another branch or its state changed.',
          null,
          'CONCURRENT_CLAIM_CONFLICT'
        );
      }
    });
  } finally {
    await session.endSession();
  }

  domainEvents.emit(ORDER_EVENTS.STATUS_CHANGED, {
    orderId: claimedOrder._id,
    previousStatus: ORDER_STATUS_VALUES.PROCESSING,
    targetStatus: ORDER_STATUS_VALUES.PROCESSING,
    orderAmount: claimedOrder.orderAmount,
    customerId: claimedOrder.customerId,
  });

  const items = await OrderItem.find({ orderId: claimedOrder._id }).lean();
  return shapeOrderDetail(claimedOrder, items, { isStaff: true });
}

/**
 * Updates an Order's canonical tracking status by authorized staff.
 *
 * Implements ADR-004 §9, §10, §11, §15, §16, §17:
 * - Validates requested status against canonical values.
 * - Prevents updates on terminal states (COMPLETED, CANCELLED).
 * - Enforces allowed transition matrix (ALLOWED_STATUS_TRANSITIONS).
 * - Atomic conditional update: prevents race conditions and stale writes during concurrent updates (Comment 1).
 * - Appends audit entry into embedded statusHistory array with timestamp and staff identity.
 * - Dispatches automated cancellation notification to customer when status changes to CANCELLED (Comment 2 & 3).
 *
 * Review Comment 2 – Inventory allocation (PROCESSING) and restoration (CANCELLATION from PROCESSING)
 * are performed within a shared MongoDB transaction together with the Order status update.
 *
 * Review Comment 3 – Staff without a valid branchId are rejected fail-closed.
 *
 * @param {string} orderId         - Target Order ObjectId
 * @param {string} requestedStatus - New canonical status requested
 * @param {string} staffUserId     - Authenticated staff user ID from JWT context
 * @param {object} [options]
 * @param {string|null} [options.branchId] - Staff member's authenticated branch
 * @returns {Promise<object>} Safe shaped order detail with items
 */
async function updateOrderStatus(orderId, requestedStatus, staffUserId, options = {}) {
  const { branchId: staffBranchId = null, role = null } = options;

  if (!mongoose.isValidObjectId(orderId)) {
    throw new ValidationError(
      'Order ID must be a valid identifier.',
      [{ field: 'id', message: 'Order ID must be a valid MongoDB ObjectId.' }],
      'INVALID_ORDER_ID'
    );
  }

  // Review Comment 3 – Fail-closed branch authorization for staff mutations
  const isBranchStaff =
    role && [ROLE_VALUES.BRANCH_ASSISTANT, ROLE_VALUES.BRANCH_MANAGER].includes(role);
  if (isBranchStaff && (!staffBranchId || !mongoose.isValidObjectId(staffBranchId))) {
    throw new ForbiddenError(
      'A valid branch assignment is required to update order status.',
      null,
      'BRANCH_REQUIRED'
    );
  }

  if (!requestedStatus || typeof requestedStatus !== 'string') {
    throw new ValidationError(
      'Order status is required.',
      [{ field: 'status', message: 'Order status must be provided as a non-empty string.' }],
      'MISSING_STATUS'
    );
  }

  const trimmedStatus = requestedStatus.trim();
  if (!isValidOrderStatus(trimmedStatus)) {
    throw new ValidationError(
      `Invalid order status '${trimmedStatus}'.`,
      [{ field: 'status', message: `Status must be one of: ${ORDER_STATUSES.join(', ')}.` }],
      'INVALID_STATUS'
    );
  }

  const order = await Order.findById(orderId);
  if (!order) {
    throw new NotFoundError('Order not found.', null, ORDER_NOT_FOUND);
  }

  // Reconcile IPN lifecycle (Review Comment 1): If order was auto-transitioned to PROCESSING
  // by PayHere IPN without a branch assigned, staff requesting PROCESSING claims the order
  // for their branch and allocates inventory.
  if (
    order.status === ORDER_STATUS_VALUES.PROCESSING &&
    trimmedStatus === ORDER_STATUS_VALUES.PROCESSING &&
    !order.branchId
  ) {
    if (!staffBranchId || !mongoose.isValidObjectId(staffBranchId)) {
      throw new ForbiddenError(
        'A valid branch assignment is required to claim and fulfill orders.',
        null,
        'BRANCH_REQUIRED'
      );
    }
    return claimOrder(orderId, staffBranchId, staffUserId);
  }

  // ADR-004 §9: Terminal states must not undergo any further transition
  if (isTerminalStatus(order.status)) {
    throw new ValidationError(
      `Cannot update status of an order in terminal state '${order.status}'.`,
      [
        {
          field: 'status',
          message: `Order is already in terminal state '${order.status}' and cannot transition further.`,
        },
      ],
      'TERMINAL_STATUS'
    );
  }

  // ADR-004 §9: Verify requested transition is legal in transition matrix
  if (!isValidStatusTransition(order.status, trimmedStatus)) {
    throw new ValidationError(
      `Transition from '${order.status}' to '${trimmedStatus}' is not allowed.`,
      [
        {
          field: 'status',
          message: `Invalid status transition from '${order.status}' to '${trimmedStatus}'.`,
        },
      ],
      'INVALID_STATUS_TRANSITION'
    );
  }

  // Branch isolation guard: If order is already assigned to a branch, verify caller belongs to that branch
  if (
    order.branchId &&
    staffBranchId &&
    mongoose.isValidObjectId(staffBranchId) &&
    order.branchId.toString() !== staffBranchId.toString()
  ) {
    throw new ForbiddenError(
      'You are not authorized to update orders assigned to another branch.',
      null,
      'BRANCH_ACCESS_DENIED'
    );
  }

  // Review Item 6: Prevent branch staff from cancelling unclaimed orders reserved from another branch
  if (!order.branchId && trimmedStatus === ORDER_STATUS_VALUES.CANCELLED && isBranchStaff) {
    const orderItems = await OrderItem.find({ orderId: order._id }).lean();
    for (const itm of orderItems) {
      const invId = itm.fulfilledInventoryId || itm.inventoryId;
      if (invId) {
        const sourceInv = await Inventory.findById(invId).lean();
        if (
          sourceInv &&
          sourceInv.branchId &&
          sourceInv.branchId.toString() !== staffBranchId.toString()
        ) {
          throw new ForbiddenError(
            'You are not authorized to cancel unclaimed orders containing inventory reserved from another branch.',
            null,
            'BRANCH_ACCESS_DENIED'
          );
        }
      }
    }
  }

  // Prevent an unclaimed PROCESSING order from advancing to downstream fulfillment without branch claiming
  if (
    order.status === ORDER_STATUS_VALUES.PROCESSING &&
    !order.branchId &&
    trimmedStatus !== ORDER_STATUS_VALUES.CANCELLED
  ) {
    throw new ValidationError(
      'Order must be claimed by a branch before advancing to fulfillment.',
      [{ field: 'branchId', message: 'A branch claim is required before advancing order status.' }],
      'UNCLAIMED_ORDER_FULFILLMENT_BLOCKED'
    );
  }

  // ADR-011 makes the first online-fulfillment transition payment-controlled.
  if (
    order.status === ORDER_STATUS_VALUES.ORDER_CREATED &&
    trimmedStatus === ORDER_STATUS_VALUES.PROCESSING
  ) {
    const verifiedPayment = await Payment.exists({
      orderId: order._id,
      status: PAYMENT_STATUS.COMPLETED,
    });
    if (!verifiedPayment) {
      throw new ValidationError(
        'Order cannot enter processing before verified payment.',
        [{ field: 'status', message: 'A verified completed Payment is required.' }],
        'PAYMENT_REQUIRED'
      );
    }
  }

  const previousStatus = order.status;
  const now = new Date();

  if (trimmedStatus === ORDER_STATUS_VALUES.COMPLETED) {
    // Completion and its award commit together, coordinated with callbacks/refunds
    // through the same Order write. Unknown legacy context fails closed, not zero.
    await LoyaltyTransaction.init();
    const session = await mongoose.startSession();
    let completed;
    try {
      await session.withTransaction(async () => {
        completed = await Order.findOneAndUpdate(
          { _id: orderId, status: previousStatus, statusUpdatedAt: order.statusUpdatedAt },
          {
            $inc: { __v: 1 },
            $set: { status: trimmedStatus, statusUpdatedAt: now },
            $push: {
              statusHistory: { status: trimmedStatus, changedAt: now, changedBy: staffUserId },
            },
          },
          { session, new: true, runValidators: true }
        );
        if (!completed)
          throw new ValidationError(
            'Order changed concurrently.',
            null,
            'CONCURRENT_STATUS_UPDATE'
          );
        const payment = await Payment.findOne({ orderId, status: PAYMENT_STATUS.COMPLETED })
          .session(session)
          .lean();
        if (!payment)
          throw new ConflictError(
            'Verified completed Payment required.',
            null,
            'LOYALTY_PAYMENT_INELIGIBLE'
          );
        await earnPurchasePoints({ paymentId: payment._id.toString(), session });
      });
    } finally {
      await session.endSession();
    }
    domainEvents.emit(ORDER_EVENTS.STATUS_CHANGED, {
      orderId: completed._id,
      previousStatus,
      targetStatus: trimmedStatus,
      orderAmount: completed.orderAmount,
      customerId: completed.customerId,
    });
    const items = await OrderItem.find({ orderId }).lean();
    return shapeOrderDetail(completed, items, { isStaff: true });
  }

  if (
    previousStatus === ORDER_STATUS_VALUES.ORDER_CREATED &&
    trimmedStatus === ORDER_STATUS_VALUES.CANCELLED
  ) {
    const outcome = await cancelUnpaidReservation({ orderId, now, staffUserId });
    if (outcome.action !== 'cancelled') {
      throw new ValidationError(
        'Cancellation transition is unsafe or the Order changed concurrently.',
        null,
        outcome.reason || 'CONCURRENT_STATUS_UPDATE'
      );
    }
    const items = await OrderItem.find({ orderId: outcome.order._id }).lean();
    return shapeOrderDetail(outcome.order, items, { isStaff: true });
  }

  // Review Comment 2 – Atomic cancellation: restore inventory + update order status
  // within a single MongoDB transaction session.
  if (
    previousStatus === ORDER_STATUS_VALUES.PROCESSING &&
    trimmedStatus === ORDER_STATUS_VALUES.CANCELLED
  ) {
    const session = await mongoose.startSession();
    let updatedOrder;
    try {
      await session.withTransaction(async () => {
        // Restore inventory first; then update order status atomically
        await restoreBranchInventoryForOrder(order, session, {
          userId: staffUserId,
          role: role || ROLE_VALUES.BRANCH_MANAGER,
        });

        updatedOrder = await Order.findOneAndUpdate(
          {
            _id: orderId,
            status: previousStatus,
            statusUpdatedAt: order.statusUpdatedAt,
          },
          {
            $set: { status: trimmedStatus, statusUpdatedAt: now },
            $push: {
              statusHistory: {
                status: trimmedStatus,
                changedAt: now,
                changedBy: staffUserId,
              },
            },
          },
          { session, new: true, runValidators: true }
        );

        if (!updatedOrder) {
          throw new ValidationError(
            'Order status was updated concurrently by another request.',
            null,
            'CONCURRENT_STATUS_UPDATE'
          );
        }
      });
    } finally {
      await session.endSession();
    }

    domainEvents.emit(ORDER_EVENTS.STATUS_CHANGED, {
      orderId: updatedOrder._id,
      previousStatus,
      targetStatus: trimmedStatus,
      orderAmount: updatedOrder.orderAmount,
      customerId: updatedOrder.customerId,
    });

    const items = await OrderItem.find({ orderId: updatedOrder._id }).lean();
    return shapeOrderDetail(updatedOrder, items, { isStaff: true });
  }

  // Review Comment 2 – Atomic PROCESSING transition: allocate inventory + update order
  // within a single MongoDB transaction session.
  if (
    previousStatus === ORDER_STATUS_VALUES.ORDER_CREATED &&
    trimmedStatus === ORDER_STATUS_VALUES.PROCESSING
  ) {
    const session = await mongoose.startSession();
    let updatedOrder;
    try {
      await session.withTransaction(async () => {
        // Allocate branch stock first; throws ConflictError on insufficient stock
        await allocateBranchInventoryForOrder(order, staffBranchId, session, {
          userId: staffUserId,
          role: role || ROLE_VALUES.BRANCH_ASSISTANT,
        });

        const updateSet = {
          status: trimmedStatus,
          statusUpdatedAt: now,
        };

        // Claim the order for the staff member's branch when branchId is valid
        if (staffBranchId && mongoose.isValidObjectId(staffBranchId)) {
          updateSet.branchId = new mongoose.Types.ObjectId(staffBranchId);
        }

        updatedOrder = await Order.findOneAndUpdate(
          {
            _id: orderId,
            status: previousStatus,
            statusUpdatedAt: order.statusUpdatedAt,
          },
          {
            $set: updateSet,
            $push: {
              statusHistory: {
                status: trimmedStatus,
                changedAt: now,
                changedBy: staffUserId,
              },
            },
          },
          { session, new: true, runValidators: true }
        );

        if (!updatedOrder) {
          throw new ValidationError(
            'Order status was updated concurrently by another request. Please refresh and try again.',
            [
              {
                field: 'status',
                message: 'Concurrent update conflict detected. Current order status has changed.',
              },
            ],
            'CONCURRENT_STATUS_UPDATE'
          );
        }
      });
    } finally {
      await session.endSession();
    }

    domainEvents.emit(ORDER_EVENTS.STATUS_CHANGED, {
      orderId: updatedOrder._id,
      previousStatus,
      targetStatus: trimmedStatus,
      orderAmount: updatedOrder.orderAmount,
      customerId: updatedOrder.customerId,
    });

    const items = await OrderItem.find({ orderId: updatedOrder._id }).lean();
    return shapeOrderDetail(updatedOrder, items, { isStaff: true });
  }

  // Generic status transitions (e.g. PROCESSING → READY_FOR_PICKUP, READY_FOR_PICKUP → PICKED_UP)
  // Atomic conditional update to protect against concurrent updates (Comment 1)
  const updatedOrder = await Order.findOneAndUpdate(
    {
      _id: orderId,
      status: previousStatus,
      statusUpdatedAt: order.statusUpdatedAt,
    },
    {
      $set: {
        status: trimmedStatus,
        statusUpdatedAt: now,
      },
      $push: {
        statusHistory: {
          status: trimmedStatus,
          changedAt: now,
          changedBy: staffUserId,
        },
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updatedOrder) {
    throw new ValidationError(
      'Order status was updated concurrently by another request. Please refresh and try again.',
      [
        {
          field: 'status',
          message: 'Concurrent update conflict detected. Current order status has changed.',
        },
      ],
      'CONCURRENT_STATUS_UPDATE'
    );
  }

  domainEvents.emit(ORDER_EVENTS.STATUS_CHANGED, {
    orderId: updatedOrder._id,
    previousStatus,
    targetStatus: trimmedStatus,
    orderAmount: updatedOrder.orderAmount,
    customerId: updatedOrder.customerId,
  });

  const items = await OrderItem.find({ orderId: updatedOrder._id }).lean();
  return shapeOrderDetail(updatedOrder, items, { isStaff: true });
}

module.exports = {
  getOrders,
  getOrderById,
  getCustomerOrders,
  getCustomerOrderById,
  updateOrderStatus,
  claimOrder,
  // Exported for unit testing of shaping logic
  shapeOrderSummary,
  shapeOrderDetail,
  shapeOrderItem,
  shapeCustomerSummary,
  shapeHistoryEntry,
};
