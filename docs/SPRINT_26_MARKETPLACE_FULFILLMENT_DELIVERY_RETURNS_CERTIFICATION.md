# Sprint 26 — Marketplace Fulfillment, Delivery & Returns

## Status

**GAR-DEV-S26 VERIFIED — implementation certification passed on PR #14**

Sprint 26 extends certified Sprint 25 financial authority into physical order fulfillment, delivery truth, buyer receipt confirmation and return handling.

## Core truth model

Financial, delivery and inventory facts remain separate:

- verified payment authorizes fulfillment;
- seller dispatch is not buyer receipt;
- seller delivery report is not buyer receipt;
- refund is not physical return;
- physical return is not automatically restockable;
- only seller-recorded received quantities assessed RESTOCKABLE may return to available inventory.

## Fulfillment gate

A storefront may start fulfillment only when:

- the order has full provider-authoritative capture;
- captured amount covers the order total;
- no refund has reduced the paid order;
- the seller is authorized for the order storefront.

Existing partially refunded orders are therefore not eligible to begin a new fulfillment.

## Fulfillment lifecycle

### Pickup

PREPARING → READY_FOR_HANDOFF → COMPLETED

The seller prepares and marks the order ready. The buyer confirms physical pickup to complete fulfillment.

### Local delivery / shipping

PREPARING → READY_FOR_HANDOFF → IN_TRANSIT → DELIVERY_REPORTED → COMPLETED

Shipping requires a tracking reference at dispatch. Local delivery may use an optional tracking reference.

DELIVERY_REPORTED is explicitly seller-recorded. COMPLETED requires buyer receipt confirmation. A buyer may also confirm receipt directly while the order is IN_TRANSIT if they physically received it before a seller delivery report was recorded.

## Provenance

Fulfillment events distinguish:

- SELLER_RECORDED;
- BUYER_CONFIRMED;
- SYSTEM_DERIVED.

This prevents a seller-reported handoff or proof reference from being presented as buyer-confirmed receipt.

## Returns

Returns are available only after buyer-confirmed fulfillment completion.

A buyer return request is item-level and includes:

- order item;
- requested quantity;
- reason.

Garage OS rejects duplicate items in the same request and quantities above the remaining returnable purchased quantity.

Only one active return flow can place the fulfillment into RETURN_IN_PROGRESS at a time. Rejected returns return the fulfillment to COMPLETED when no other open return exists.

## Return review and transport

The seller may APPROVE or REJECT a REQUESTED return.

An approved return may be marked IN_TRANSIT by the buyer with an optional return tracking reference.

The seller may also physically receive an approved return directly, supporting in-person/drop-off returns.

## Physical receipt inspection

Receipt inspection must explicitly record every return item:

- received quantity;
- restock quantity;
- condition;
- optional notes.

Supported condition facts:

- RESTOCKABLE;
- OPENED;
- DAMAGED;
- DEFECTIVE.

Restock quantity cannot exceed physically received quantity, and non-RESTOCKABLE conditions cannot increase available inventory.

Returned quantity drives the actual refundable merchandise value. Missing/not-received requested units are not included in the refund request.

## Inventory restoration

For quantity-tracked listings, physically received RESTOCKABLE units:

1. increase stock quantity;
2. recalculate inventory state;
3. increment listing version;
4. rebuild marketplace discovery projection.

A financial refund event never performs this inventory restoration.

## Refund handoff

After physical receipt, the authorized seller may request the financial refund through Sprint 25.

The return becomes REFUND_REQUESTED but is not complete until the payment provider confirms REFUND_SUCCEEDED through the signed webhook.

Buyer direct refunds remain available before fulfillment starts. Once fulfillment exists, buyers are directed to the Returns workflow.

## Return completion

Verified provider refund confirmation:

- completes the linked return;
- appends a SYSTEM_DERIVED fulfillment event;
- emits marketplace.return.completed;
- derives the fulfillment state.

If all purchased units have been physically received through completed returns, fulfillment becomes RETURNED. For a partial return, fulfillment returns to COMPLETED.

## Persistence

Migration 027_marketplace_fulfillment_delivery_returns adds:

- marketplace_fulfillments;
- marketplace_fulfillment_events;
- marketplace_returns;
- marketplace_return_items.

## Buyer APIs

- GET /api/v1/marketplace/fulfillments
- GET /api/v1/marketplace/orders/:orderId/fulfillment
- POST /api/v1/marketplace/orders/:orderId/fulfillment/confirm-receipt
- POST /api/v1/marketplace/orders/:orderId/returns
- GET /api/v1/marketplace/returns/:returnId
- POST /api/v1/marketplace/returns/:returnId/ship

## Seller APIs

- GET /api/v1/marketplace/seller/stores/:storeId/fulfillments
- POST /api/v1/marketplace/seller/stores/:storeId/orders/:orderId/fulfillment
- POST /api/v1/marketplace/seller/stores/:storeId/fulfillments/:fulfillmentId/ready
- POST /api/v1/marketplace/seller/stores/:storeId/fulfillments/:fulfillmentId/dispatch
- POST /api/v1/marketplace/seller/stores/:storeId/fulfillments/:fulfillmentId/report-delivery
- GET /api/v1/marketplace/seller/stores/:storeId/returns
- POST /api/v1/marketplace/seller/stores/:storeId/returns/:returnId/review
- POST /api/v1/marketplace/seller/stores/:storeId/returns/:returnId/receive
- POST /api/v1/marketplace/seller/stores/:storeId/returns/:returnId/request-refund

## Events

- marketplace.fulfillment.started
- marketplace.fulfillment.ready
- marketplace.delivery.dispatched
- marketplace.delivery.reported
- marketplace.fulfillment.completed
- marketplace.return.requested
- marketplace.return.approved
- marketplace.return.rejected
- marketplace.return.in_transit
- marketplace.return.received
- marketplace.return.refund_requested
- marketplace.return.completed

## UI

The Fulfillment workspace provides:

- Buyer fulfillment timeline and provenance;
- buyer receipt confirmation;
- item-level return creation;
- return tracking;
- seller paid-order fulfillment queue;
- preparation/ready/dispatch/delivery reporting;
- seller return approval/rejection;
- physical inspection and restocking;
- provider refund handoff.

The Payments workspace now hides direct buyer refund controls after fulfillment has started and directs the user to physical returns.

## Certification

tests/integration/marketplaceFulfillmentDeliveryReturns.test.ts verifies:

- schema without fabricated fulfillment;
- payment gate before fulfillment;
- refunded-order fulfillment block;
- pickup seller-ready/buyer-confirmed flow;
- seller delivery report versus buyer receipt truth;
- shipping tracking requirement;
- item-level return quantity ceiling;
- physical receipt before restocking;
- RESTOCKABLE-only inventory restoration;
- damaged goods not restored to available inventory;
- no automatic refund at physical receipt;
- seller refund request after receipt;
- provider-confirmed full return completion;
- full returned order → RETURNED;
- direct buyer refund blocked after fulfillment starts;
- seller tenant isolation.

Implementation certification run #212 passed repository hygiene, TypeScript typecheck, the complete automated test suite and production build.

Subsequent UI/test reconciliation remains subject to a final exact-head certification before merge.

## Next

**Sprint 27 — Marketplace Trust, Reviews & Disputes**