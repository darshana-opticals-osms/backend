#!/usr/bin/env node
/**
 * Safe, read-only diagnostic script for investigating Orders affected by
 * Issue #97 (AC7, AC8).
 *
 * This script:
 * 1. Executes strictly read-only queries.
 * 2. Does NOT modify, update, or delete any records.
 * 3. Does NOT output Customer PII (names, emails, phones, addresses).
 * 4. Does NOT output payment credentials or sensitive provider data.
 * 5. Identifies Orders currently at PICKED_UP with defective snapshots.
 *
 * Usage:
 *   node scripts/diagnose-affected-orders-97.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/osms';

async function runDiagnostic() {
  console.log('='.repeat(70));
  console.log(' OSMS Diagnostic Tool: Issue #97 (AC7 Read-Only Investigation)');
  console.log('='.repeat(70));

  try {
    await mongoose.connect(MONGODB_URI, {
      readPreference: 'secondaryPreferred', // Prefer read-only replica if available
    });
    console.log(`[INFO] Connected to MongoDB (Read-Only Mode)`);

    const Order = mongoose.connection.collection('orders');
    const OrderItem = mongoose.connection.collection('orderitems');

    // Find orders in PICKED_UP status
    const pickedUpOrders = await Order.find({ status: 'PICKED_UP' }, {
      projection: {
        _id: 1,
        status: 1,
        orderAmount: 1,
        orderDate: 1,
        statusUpdatedAt: 1,
        branchId: 1,
      },
    }).toArray();

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
      missingSnapshot: 0,
      unknownClassification: 0,
      unsupportedClassification: 0,
      missingInventoryRef: 0,
      invalidEligibilityMapping: 0,
    };

    console.log('\n--- SCANNING ORDER ITEMS FOR CLASSIFICATION DEFECTS ---');

    for (const order of pickedUpOrders) {
      const oid = order._id.toString();
      const items = itemsByOrder.get(oid) || [];
      const orderDefects = [];

      for (const item of items) {
        const snap = item.classificationSnapshot;

        if (!snap) {
          defectSummary.missingSnapshot++;
          orderDefects.push({ itemId: item._id, defect: 'MISSING_SNAPSHOT' });
          continue;
        }

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

        if (!snap.sourceInventoryId || !item.inventoryId) {
          defectSummary.missingInventoryRef++;
          orderDefects.push({ itemId: item._id, defect: 'MISSING_INVENTORY_REF' });
        }

        const expectedEligibility =
          snap.itemClassification === 'MERCHANDISE'
            ? 'ELIGIBLE'
            : snap.itemClassification === 'CLINICAL'
              ? 'INELIGIBLE'
              : 'UNKNOWN';

        if (snap.loyaltyEligibility !== expectedEligibility) {
          defectSummary.invalidEligibilityMapping++;
          orderDefects.push({ itemId: item._id, defect: 'INVALID_ELIGIBILITY_MAPPING' });
        }
      }

      if (orderDefects.length > 0) {
        affectedCount++;
        console.log(`[ALERT] Affected Order ID: ${order._id}`);
        console.log(`        Order Date: ${order.orderDate}`);
        console.log(`        Amount: ${order.orderAmount}`);
        console.log(`        Defects Found (${orderDefects.length}):`);
        for (const d of orderDefects) {
          console.log(`          - Item ${d.itemId}: ${d.defect} ${d.val ? `(${d.val})` : ''}`);
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log(' SUMMARY REPORT (SANITIZED / ZERO PII)');
    console.log('='.repeat(70));
    console.log(`Total Orders at PICKED_UP:                 ${pickedUpOrders.length}`);
    console.log(`Total Affected Orders with Defects:        ${affectedCount}`);
    console.log(`- Missing Snapshot Defects:                ${defectSummary.missingSnapshot}`);
    console.log(`- UNKNOWN Classification Defects:          ${defectSummary.unknownClassification}`);
    console.log(`- Unsupported Classification Defects:      ${defectSummary.unsupportedClassification}`);
    console.log(`- Missing/Inconsistent Inventory Ref:      ${defectSummary.missingInventoryRef}`);
    console.log(`- Inconsistent Loyalty Eligibility:        ${defectSummary.invalidEligibilityMapping}`);
    console.log('='.repeat(70));
    console.log('[NOTE] In accordance with AC8, NO historical mutations were performed.');
    console.log('       Refer to docs/investigation-affected-orders-classification-97.md');
    console.log('       for controlled business exception procedures.');
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
