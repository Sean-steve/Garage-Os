# Sprint 25 — Marketplace Payments & Settlement

## Status

**GAR-DEV-S25 VERIFIED — implementation certification passed on PR #13**

Sprint 25 extends certified Sprint 24 orders into provider-authoritative financial transactions without allowing browser/client state to fabricate money movement.

## Financial truth boundary

- Buyer/client requests may create payment intents and refund requests.
- Only an HMAC-verified provider webhook may confirm payment capture or refund success.
- Invalid signatures are rejected before provider event IDs are persisted.
- Verified duplicate provider events are replay-safe and cannot double-credit or double-debit settlement.
- Verified fact mismatches are recorded for reconciliation instead of mutating balances.

## Payment provider registry

Platform finance/admin can register TEST or LIVE payment providers with:

- provider key and display name;
- lifecycle status;
- refund capability;
- the name of the runtime environment variable that holds the webhook signing secret.

Secrets themselves are never stored in the marketplace database.

No external provider is fabricated or seeded by the migration.

## Payment intents

Buyer payment intent creation is idempotent per order and Idempotency-Key.

An intent snapshots:

- order;
- provider;
- client reference;
- amount in integer minor units;
- currency;
- provider payment ID once known;
- lifecycle status.

Client intent creation produces PENDING truth only. It cannot set SUCCEEDED.

## Provider webhooks

The webhook canonical signature covers provider event ID, event type, provider payment ID, order ID, amount, currency and refund identifiers.

Supported authoritative events:

- PAYMENT_PENDING
- PAYMENT_SUCCEEDED
- PAYMENT_FAILED
- REFUND_PENDING
- REFUND_SUCCEEDED
- REFUND_FAILED

Late PAYMENT_PENDING/PAYMENT_FAILED callbacks are ignored after authoritative capture rather than downgrading paid financial truth.

## Inventory commitment

Sprint 24 reduced available stock and created HELD reservations at order placement.

Verified PAYMENT_SUCCEEDED creates an immutable marketplace_inventory_commitments record against those held reservations.

After capture, the Sprint 24 pre-payment cancellation route is prohibited, preventing a paid order from restoring stock.

## Refunds

Refund requests are durable but not financially effective until the provider confirms success.

Refund request safeguards include:

- refundable payment intent required;
- provider refund capability required;
- idempotency;
- amount cannot exceed captured minus confirmed/pending requested refund balance;
- verified provider refund facts must match the requested refund.

A confirmed financial refund does not restore physical stock. A refund is not proof that a part has physically returned to the seller; inventory restoration belongs to a later returns workflow.

## Settlement ledger

Verified capture creates a positive PAYMENT_CAPTURE seller ledger entry.

Verified refund creates a negative REFUND_ADJUSTMENT entry.

Seller settlement summaries expose:

- gross captured;
- refunds;
- net receivable;
- settled amount = 0;
- payout_available = false.

This gives an authoritative receivable ledger without falsely claiming that bank/mobile-money seller payout has occurred.

## Reconciliation

Verified but unmatched or fact-mismatched provider events produce marketplace_payment_reconciliation_issues.

Platform finance/admin can inspect recent verified provider events and reconciliation issues.

## Persistence

Migration 026_marketplace_payments_settlement adds:

- marketplace_payment_providers
- marketplace_payment_intents
- marketplace_refunds
- marketplace_payment_provider_events
- marketplace_inventory_commitments
- marketplace_settlement_ledger_entries
- marketplace_payment_reconciliation_issues

## APIs

Buyer:

- GET /api/v1/marketplace/payments/providers
- POST /api/v1/marketplace/orders/:orderId/payments/intents
- GET /api/v1/marketplace/orders/:orderId/finance
- POST /api/v1/marketplace/orders/:orderId/refunds

Provider:

- POST /api/v1/marketplace/payments/webhooks/:providerKey

Seller:

- GET /api/v1/marketplace/seller/stores/:storeId/settlement

Platform finance/admin:

- GET /api/v1/marketplace/admin/payments/providers
- POST /api/v1/marketplace/admin/payments/providers
- PATCH /api/v1/marketplace/admin/payments/providers/:providerId
- GET /api/v1/marketplace/admin/payments/reconciliation

## Events

- marketplace.payment.intent.created
- marketplace.payment.pending
- marketplace.payment.captured
- marketplace.payment.failed
- marketplace.refund.requested
- marketplace.refund.pending
- marketplace.refund.confirmed
- marketplace.refund.failed

## UI

The Payments workspace provides:

- Buyer Payments — financial status, provider selection, payment intent creation and refund requests.
- Seller Settlement — gross capture, refund adjustments and net receivable truth.
- Finance Ops — payment provider registration and reconciliation review for finance/admin roles.

The Orders workspace now projects provider-authoritative financial state and only exposes pre-payment cancellation before capture.

## Certification

tests/integration/marketplacePaymentsSettlement.test.ts verifies:

- payment/refund/settlement schema;
- no fabricated seeded transaction;
- payment intent idempotency;
- no client self-declared capture;
- invalid-signature rejection without event-ID consumption;
- verified capture and replay-safe duplicate handling;
- inventory commitment;
- seller fulfillment authorization after capture;
- cancellation prohibition after capture;
- amount/currency reconciliation rejection;
- stale failure callback ignored after capture;
- provider-confirmed refund;
- no inventory restoration from refund alone;
- refundable-balance enforcement;
- seller tenant isolation;
- finance reconciliation authorization.

Implementation certification run #208 passed:

- repository hygiene;
- TypeScript typecheck;
- complete automated test suite;
- production build.

A final exact-head certification run is required after this documentation/traceability promotion and before merge.

## Next

**Sprint 26 — Marketplace Fulfillment, Delivery & Returns**