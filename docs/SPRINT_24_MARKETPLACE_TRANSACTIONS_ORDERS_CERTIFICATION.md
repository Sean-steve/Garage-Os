# Sprint 24 — Marketplace Transactions & Orders

## Status

**GAR-DEV-S24 VERIFIED — implementation certification passed on PR #12**

Sprint 24 extends the GAR-021 marketplace into durable buyer transactions while preserving a strict payment boundary.

## Lifecycle

ACTIVE CART → CHECKOUT VALIDATION → AWAITING_PAYMENT ORDER → CANCELLED

Payment capture, settlement, refunds, seller payout and fulfillment progression are intentionally not implemented in this sprint.

## Delivered

- One active cart per buyer × storefront.
- Cart items snapshot listing ID, product ID, quantity, unit price, currency, listing version and title.
- Optional canonical vehicle context for fitment-aware checkout.
- Checkout blocks unavailable inventory, stale price/version, fitment conflict and explicit incompatibility.
- Non-confirmed fitment with vehicle context requires buyer acknowledgement.
- Fulfillment mode must be supported by every order line.
- Delivery/shipping requires recipient and structured address data.
- Orders are created only as AWAITING_PAYMENT with payment_status NOT_STARTED.
- Order items freeze SKU, title, quantity, price, currency, listing version and optional fitment decision evidence.
- Quantity-tracked inventory is reserved atomically at order placement.
- Buyer cancellation releases held inventory and restores listing stock.
- Sellers can read only their own storefront orders.
- Seller fulfillment remains locked while payment is not authoritative.

## Persistence

Migration 025_marketplace_transactions_orders adds:

- marketplace_carts
- marketplace_cart_items
- marketplace_orders
- marketplace_order_items
- marketplace_inventory_reservations
- marketplace_order_status_history

No marketplace_payments table is introduced in Sprint 24.

## Buyer APIs

- GET /api/v1/marketplace/carts
- POST /api/v1/marketplace/carts
- GET /api/v1/marketplace/carts/:cartId
- PATCH /api/v1/marketplace/carts/:cartId/vehicle
- POST /api/v1/marketplace/carts/:cartId/items
- PATCH /api/v1/marketplace/carts/:cartId/items/:itemId
- DELETE /api/v1/marketplace/carts/:cartId/items/:itemId
- POST /api/v1/marketplace/carts/:cartId/validate-checkout
- POST /api/v1/marketplace/carts/:cartId/place-order
- GET /api/v1/marketplace/orders
- GET /api/v1/marketplace/orders/:orderId
- POST /api/v1/marketplace/orders/:orderId/cancel

## Seller APIs

- GET /api/v1/marketplace/seller/stores/:storeId/orders
- GET /api/v1/marketplace/seller/stores/:storeId/orders/:orderId

## Events

- marketplace.cart.created
- marketplace.cart.item.updated
- marketplace.order.placed
- marketplace.order.cancelled

## UI

The new Orders workspace provides Shop, Carts, My Orders and Seller Orders views with explicit payment-state warnings.

## Certification

tests/integration/marketplaceTransactionsOrders.test.ts verifies schema, cart scoping, snapshot behavior, fitment acknowledgement, incompatibility blocking, stale price/version blocking, awaiting-payment truth, inventory reservation, delivery rules, cancellation restoration, seller isolation and duplicate checkout prevention.

Sprint 22 marketplace foundation tests were reconciled to the later architecture: order tables and checkout capability now legitimately exist, while payment remains unavailable.

Implementation certification run #204 passed repository hygiene, TypeScript typecheck, the complete automated test suite and production build.

A final exact-head certification run is required after this documentation/traceability promotion and before merge.

## Next

**Sprint 25 — Marketplace Payments & Settlement**