#!/usr/bin/env node
/**
 * Safe, read-only diagnostic script for investigating Orders affected by
 * Issue #97 (AC7, AC8).
 *
 * This script:
 * 1. Executes strictly read-only queries against MongoDB.
 * 2. Does NOT modify, update, or delete any records.
 * 3. Does NOT output Customer PII (names, emails, phones, addresses).
 * 4. Does NOT output payment credentials or sensitive provider data.
 * 5. Identifies Orders currently at PICKED_UP with defective snapshots
 *    or data inconsistencies that block transition to COMPLETED under
 *    src/services/loyaltyEligibility.service.js rules:
 *      - Orders without OrderItems
 *      - Missing classification snapshots
 *      - Invalid snapshot sources (source !== 'Inventory')
 *      - UNKNOWN or unsupported classifications
 *      - Missing inventory references
 *      - Mismatched sourceInventoryId and inventoryId
 *      - Inconsistent loyalty eligibility mappings
 *      - Invalid stored item quantities
 *      - Line item amounts sum mismatch with Order total
 *
 * Usage:
 *   node scripts/diagnose-affected-orders-97.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { formatAmount } = require('../src/services/adapters/PayHerePaymentAdapter');
const { toMinor, fromMinor } = require('../src/utils/loyaltyDecimal');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/osms';

async function runDiagnostic() {
  console.log('='.repeat(75));
  console.log(' OSMS Diagnostic Tool: Issue #97 (AC7 Comprehensive Read-Only Audit)');
  console.log('='.repeat(75));

  try {
    await mongoose.connect(MONGODB_URI, {
      readPreference: 'secondaryPreferred', // Prefer read-only replica if available
    });
    console.log(`[INFO] Connected to MongoDB (Read-Only Mode)`);

    const Order = mongoose.connection.collection('orders');
    const OrderItem = mongoose.connection.collection('orderitems');

    // Find orders in PICKED_UP status
    const pickedUpOrders = await Order.find(
      { status: 'PICKED_UP' },
      {
        projection: {
          _id: 1,
          status: 1,
          orderAmount: 1,
          orderDate: 1,
          statusUpdatedAt: 1,
          branchId: 1,
        },
      }
    ).toArray();

    console.log(`[INFO] Total Orders currently at PICKED_UP status: ${pickedUpOrders.length}`);

    if (pickedUpOrders.length === 0) {
      console.log('[INFO] No orders in PICKED_UP status found. System is clean.');
      return;
    }

    const orderIds = pickedUpOrders.map((o) => o._id);
    const orderItems = await OrderItem.find(
      { orderId: { $in: orderIds } },
      {
        projection: {
          _id: 1,
          orderId: 1,
          inventoryId: 1,
          price: 1,
          quantity: 1,
          classificationSnapshot: 1,
        },
      }
    ).toArray();

    const itemsByOrder = new Map();
    for (const item of orderItems) {
      const oid = item.orderId.toString();
      if (!itemsByOrder.has(oid)) itemsByOrder.set(oid, []);
      itemsByOrder.get(oid).push(item);
    }

    let affectedCount = 0;
    const defectSummary = {
      emptyOrderItems: 0,
      missingSnapshot: 0,
      invalidSnapshotSource: 0,
      unknownClassification: 0,
      unsupportedClassification: 0,
      missingInventoryRef: 0,
      mismatchedInventoryRef: 0,
      invalidEligibilityMapping: 0,
      invalidItemQuantity: 0,
      orderAmountMismatch: 0,
    };

    console.log('\n--- SCANNING ORDER ITEMS FOR CLASSIFICATION & INTEGRITY DEFECTS ---');

    for (const order of pickedUpOrders) {
      const oid = order._id.toString();
      const items = itemsByOrder.get(oid) || [];
      const orderDefects = [];

      // Check 1: Order has no OrderItems
      if (items.length === 0) {
        defectSummary.emptyOrderItems++;
        orderDefects.push({
          scope: 'ORDER',
          defect: 'EMPTY_ORDER_ITEMS',
          details: 'Order contains no authoritative line items.',
        });
      }

      let lineTotalCents = 0n;
      let calculationError = false;

      for (const item of items) {
        const snap = item.classificationSnapshot;

        // Check 2: Missing snapshot
        if (!snap) {
          defectSummary.missingSnapshot++;
          orderDefects.push({ itemId: item._id, defect: 'MISSING_SNAPSHOT' });
          continue;
        }

        // Check 3: Invalid snapshot source
        if (snap.source !== 'Inventory') {
          defectSummary.invalidSnapshotSource++;
          orderDefects.push({
            itemId: item._id,
            defect: 'INVALID_SNAPSHOT_SOURCE',
            val: snap.source,
          });
        }

        // Check 4: Missing Inventory reference
        if (!snap.sourceInventoryId || !item.inventoryId) {
          defectSummary.missingInventoryRef++;
          orderDefects.push({ itemId: item._id, defect: 'MISSING_INVENTORY_REF' });
        } else if (snap.sourceInventoryId.toString() !== item.inventoryId.toString()) {
          // Check 5: Mismatched sourceInventoryId and inventoryId
          defectSummary.mismatchedInventoryRef++;
          orderDefects.push({
            itemId: item._id,
            defect: 'MISMATCHED_INVENTORY_REF',
            details: `sourceInventoryId (${snap.sourceInventoryId}) !== inventoryId (${item.inventoryId})`,
          });
        }

        // Check 6: UNKNOWN or unsupported classification
        if (snap.itemClassification === 'UNKNOWN') {
          defectSummary.unknownClassification++;
          orderDefects.push({ itemId: item._id, defect: 'UNKNOWN_CLASSIFICATION' });
        } else if (!['MERCHANDISE', 'CLINICAL'].includes(snap.itemClassification)) {
          defectSummary.unsupportedClassification++;
          orderDefects.push({
            itemId: item._id,
            defect: 'UNSUPPORTED_CLASSIFICATION',
            val: snap.itemClassification,
          });
        }

        // Check 7: Inconsistent loyalty eligibility mapping
        const expectedEligibility =
          snap.itemClassification === 'MERCHANDISE'
            ? 'ELIGIBLE'
            : snap.itemClassification === 'CLINICAL'
              ? 'INELIGIBLE'
              : 'UNKNOWN';

        if (snap.loyaltyEligibility !== expectedEligibility) {
          defectSummary.invalidEligibilityMapping++;
          orderDefects.push({
            itemId: item._id,
            defect: 'INVALID_ELIGIBILITY_MAPPING',
            expected: expectedEligibility,
            actual: snap.loyaltyEligibility,
          });
        }

        // Check 8: Invalid stored item quantity
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
          defectSummary.invalidItemQuantity++;
          orderDefects.push({
            itemId: item._id,
            defect: 'INVALID_ITEM_QUANTITY',
            val: item.quantity,
          });
          calculationError = true;
        } else if (
          typeof item.price === 'number' &&
          Number.isFinite(item.price) &&
          item.price >= 0
        ) {
          try {
            lineTotalCents += toMinor(formatAmount(item.price)) * BigInt(item.quantity);
          } catch {
            calculationError = true;
          }
        } else {
          calculationError = true;
        }
      }

      // Check 9: OrderItem amounts sum mismatch with Order total
      if (items.length > 0 && !calculationError && typeof order.orderAmount === 'number') {
        try {
          const authoritativeOrderCents = toMinor(formatAmount(order.orderAmount));
          if (lineTotalCents !== authoritativeOrderCents) {
            defectSummary.orderAmountMismatch++;
            orderDefects.push({
              scope: 'ORDER',
              defect: 'ORDER_AMOUNT_MISMATCH',
              details: `Calculated sum (${fromMinor(lineTotalCents)}) !== Stored total (${fromMinor(authoritativeOrderCents)})`,
            });
          }
        } catch {
          defectSummary.orderAmountMismatch++;
          orderDefects.push({
            scope: 'ORDER',
            defect: 'ORDER_AMOUNT_MISMATCH',
            details: 'Could not parse authoritative orderAmount into decimal precision.',
          });
        }
      }

      if (orderDefects.length > 0) {
        affectedCount++;
        console.log(`[ALERT] Affected Order ID: ${order._id}`);
        console.log(`        Order Date: ${order.orderDate}`);
        console.log(`        Amount: ${order.orderAmount}`);
        console.log(`        Defects Found (${orderDefects.length}):`);
        for (const d of orderDefects) {
          const idInfo = d.itemId ? `Item ${d.itemId}: ` : '';
          const valInfo = d.val ? `(Value: ${d.val}) ` : '';
          const detailsInfo = d.details ? `- ${d.details}` : '';
          console.log(`          - ${idInfo}${d.defect} ${valInfo}${detailsInfo}`);
        }
      }
    }

    console.log('\n' + '='.repeat(75));
    console.log(' SUMMARY AUDIT REPORT (SANITIZED / ZERO PII)');
    console.log('='.repeat(75));
    console.log(`Total Orders at PICKED_UP:                 ${pickedUpOrders.length}`);
    console.log(`Total Affected Orders with Defects:        ${affectedCount}`);
    console.log(`- Orders with No OrderItems:               ${defectSummary.emptyOrderItems}`);
    console.log(`- Missing Snapshot Defects:                ${defectSummary.missingSnapshot}`);
    console.log(
      `- Invalid Snapshot Source (!= Inventory):  ${defectSummary.invalidSnapshotSource}`
    );
    console.log(
      `- UNKNOWN Classification Defects:          ${defectSummary.unknownClassification}`
    );
    console.log(
      `- Unsupported Classification Defects:      ${defectSummary.unsupportedClassification}`
    );
    console.log(`- Missing Inventory References:            ${defectSummary.missingInventoryRef}`);
    console.log(
      `- Mismatched Inventory References:         ${defectSummary.mismatchedInventoryRef}`
    );
    console.log(
      `- Inconsistent Loyalty Eligibility:        ${defectSummary.invalidEligibilityMapping}`
    );
    console.log(`- Invalid Item Quantity (< 1 or non-int):  ${defectSummary.invalidItemQuantity}`);
    console.log(`- Order Amount vs Items Mismatch:          ${defectSummary.orderAmountMismatch}`);
    console.log('='.repeat(75));
    console.log('[NOTE] In accordance with AC8, NO historical mutations were performed.');
    console.log('       Refer to docs/investigation-affected-orders-classification-97.md');
    console.log('       for controlled business exception and proposed governance procedures.');
  } catch (err) {
    console.error('[ERROR] Diagnostic run encountered an error:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('[INFO] Disconnected from database.');
  }
}

if (require.main === module) {
  runDiagnostic();
}

module.exports = { runDiagnostic };
