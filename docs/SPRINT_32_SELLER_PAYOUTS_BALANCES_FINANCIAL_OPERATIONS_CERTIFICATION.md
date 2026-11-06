# Sprint 32 — Seller Payouts, Balances & Financial Operations

## Status

**GAR-DEV-S32 VERIFIED — implementation certification passed on PR #21**

Sprint 32 completes the marketplace seller-money state model from settlement-ledger receivable through provider-authoritative payout confirmation, while preserving the Sprint 25 rule that receivable is not payout.

## Financial truth model

Three distinct authorities are preserved:

1. **Settlement ledger** — buyer capture/refund truth and seller receivable.
2. **Payout request/batch state** — Garage OS operational intent and reserved balance.
3. **Verified payout provider event** — external transfer processing, success, failure or reversal.

A seller request, finance batch, or browser/API request cannot declare transfer success.

## Migration

`031_marketplace_seller_payouts_balances` adds:

- `marketplace_payout_providers`;
- `marketplace_payout_policies`;
- `marketplace_payout_accounts`;
- `marketplace_payouts`;
- `marketplace_payout_batches`;
- `marketplace_payout_batch_items`;
- `marketplace_payout_provider_events`;
- `marketplace_payout_reconciliation_issues`.

No fake provider, payout account, payout request or financial transfer is seeded.

## Payout provider registry

Finance roles may register payout providers with:

- provider key/display name;
- TEST or LIVE mode;
- ACTIVE/PAUSED/RETIRED state;
- webhook-secret **environment variable name**;
- provider reversal capability.

The secret value is never stored in marketplace tables.

Public/seller provider discovery does not expose the secret environment-variable name.

## Payout accounts

Seller organizations may register a payout destination using only:

- payout provider;
- currency;
- provider-issued account token/reference;
- seller-facing account label.

Plain numeric phone/account values are rejected from `provider_account_ref` to reduce accidental raw financial-detail storage.

New accounts enter `PENDING_REVIEW`.

Only Platform Admin or Finance Operator may move an account into ACTIVE/PAUSED/RETIRED state.

Provider-account references are redacted from seller and normal Finance Ops overview responses. They are exposed only inside the finance-only provider handoff payload because the provider requires the destination reference.

## Payout policy

Finance configures policy per provider + currency:

- minimum payout amount;
- required reserve amount.

A payout cannot be requested without an ACTIVE payout account, ACTIVE provider and configured policy.

## Balance projection

Balances are computed from canonical records rather than a competing mutable wallet balance.

For each store and currency:

- `net_receivable_minor` = settlement ledger captures + refund adjustments;
- `requested_minor` = payouts still REQUESTED;
- `processing_minor` = provider-confirmed PROCESSING payouts;
- `reserved_minor` = requested + processing;
- `paid_minor` = payouts currently SUCCEEDED;
- `reversed_history_minor` = payouts currently REVERSED;
- `unallocated_minor` = max(0, receivable - paid - reserved);
- `deficit_minor` = max(0, paid + reserved - receivable).

Provider-specific requestable amount additionally subtracts the configured reserve.

Different currencies are never combined.

## Payout request

Seller payout requests are:

- tenant-authorized;
- idempotent per store + idempotency key;
- bounded by the provider/currency minimum;
- bounded by available balance after active payout reservations and configured reserve.

Creating a request produces `REQUESTED` only.

It does not claim:

- provider acceptance;
- processing;
- bank/mobile-money transfer;
- success.

## Payout batches

Finance can group REQUESTED payouts when they:

- use the same payout provider;
- use the same currency;
- are not already assigned to another batch;
- still reference ACTIVE payout accounts.

Batch states:

- `DRAFT`;
- `HANDOFF_INITIATED`;
- `SETTLED`;
- `ATTENTION`.

Preparing provider handoff returns an explicit `EXTERNAL_PROVIDER_HANDOFF_REQUIRED` payload with `execution_performed: false`.

Batch handoff does **not** mark member payouts PROCESSING or SUCCEEDED.

Sprint 32 defines the payout-provider adapter contract. A concrete live outbound provider adapter is intentionally deferred to Sprint 40 — Marketplace External Adapter Activation & Production Integration.

## Provider webhook authority

Endpoint:

`POST /api/v1/marketplace/payouts/webhooks/:providerKey`

Authentication is HMAC SHA-256 using the registered environment-secret reference.

Invalid signatures are rejected **before** provider event IDs are persisted.

Provider events are idempotent by `(provider_id, provider_event_id)`.

Supported authoritative events:

- `PAYOUT_PROCESSING`;
- `PAYOUT_SUCCEEDED`;
- `PAYOUT_FAILED`;
- `PAYOUT_REVERSED`.

## State transitions

`PAYOUT_PROCESSING`:

- REQUESTED → PROCESSING;
- ignored after payout has left REQUESTED.

`PAYOUT_SUCCEEDED`:

- REQUESTED/PROCESSING → SUCCEEDED;
- duplicate/late success after SUCCEEDED is ignored;
- success after FAILED/REVERSED is routed to reconciliation rather than silently rewriting terminal truth.

`PAYOUT_FAILED`:

- REQUESTED/PROCESSING → FAILED;
- late failure cannot downgrade SUCCEEDED or REVERSED.

`PAYOUT_REVERSED`:

- requires provider reversal capability;
- only SUCCEEDED → REVERSED is accepted;
- reversal before success is rejected to reconciliation.

Verified reversal removes the payout from current paid balance and makes the amount available again subject to current receivable/reserve facts.

## Reconciliation

Verified contradictory or mismatched provider facts create payout reconciliation issues, including:

- unknown payout;
- payout amount/currency/ID mismatch;
- provider payout reference mismatch;
- reversal unsupported;
- reversal before success;
- late success after a terminal failed/reversed state.

Mismatches do not silently mutate seller money state.

## Existing settlement integration

Sprint 25 seller settlement remains the canonical receivable view.

It now additionally projects:

- provider-confirmed `settled_minor` from SUCCEEDED payouts;
- whether an ACTIVE account/policy currently makes payout request possible;
- whether a provider-confirmed transfer has occurred.

The API explicitly states `receivable_is_payout: false`.

## Authorization

Seller operations use canonical organization authorization:

- payout dashboard — marketplace order read;
- payout-account registration — marketplace order manage;
- payout request — marketplace order manage.

Platform Admin / Finance Operator exclusively control:

- provider registry;
- payout policy;
- account activation/pause/retirement;
- payout batching;
- provider handoff;
- finance/reconciliation overview.

Cross-store seller access is denied.

## APIs

Seller:

- `GET /api/v1/marketplace/payouts/providers`;
- `GET /api/v1/marketplace/seller/stores/:storeId/payouts`;
- `POST /api/v1/marketplace/seller/stores/:storeId/payout-accounts`;
- `POST /api/v1/marketplace/seller/stores/:storeId/payouts`.

Finance:

- `GET /api/v1/marketplace/admin/payouts`;
- `POST /api/v1/marketplace/admin/payouts/providers`;
- `PATCH /api/v1/marketplace/admin/payouts/providers/:providerId`;
- `PUT /api/v1/marketplace/admin/payouts/providers/:providerId/policy`;
- `PATCH /api/v1/marketplace/admin/payouts/accounts/:accountId`;
- `POST /api/v1/marketplace/admin/payouts/batches`;
- `POST /api/v1/marketplace/admin/payouts/batches/:batchId/handoff`.

Provider:

- `POST /api/v1/marketplace/payouts/webhooks/:providerKey`.

## UI

`BentoMarketplacePayouts` adds:

- per-currency seller balance cards;
- receivable/reserved/provider-confirmed paid visibility;
- payout-account registration;
- account review status;
- provider/minimum/reserve payout options;
- payout requests;
- payout history;
- finance provider registry;
- policy management;
- payout-account review;
- requested-payout batch creation;
- provider handoff preparation;
- provider-event and reconciliation views.

The Sprint 25 Payments workspace is reconciled to direct payout operations to Sprint 32 instead of claiming payouts are unavailable.

## Certification tests

`tests/integration/marketplaceSellerPayoutsBalances.test.ts` verifies:

- normalized schema and no fake payout seed data;
- raw numeric destination rejection;
- Finance-only account activation;
- payout-account reference redaction;
- settlement-ledger balance derivation;
- KES/USD separation;
- minimum/reserve policy;
- request idempotency;
- request reservation without payout success;
- overdraw prevention;
- invalid signature consumes no provider event;
- batch handoff remains non-authoritative;
- provider PROCESSING;
- provider SUCCEEDED;
- webhook replay idempotency;
- late failure cannot downgrade success;
- settlement view reflects provider-confirmed paid amount;
- provider-confirmed reversal restores availability;
- fact mismatches route to reconciliation;
- late success after FAILED routes to reconciliation;
- seller tenant isolation;
- Finance-only batch/overview controls;
- no webhook secret value exposure;
- no fabricated live outbound provider execution.

## CI history

- Run #253: failed before tests due missing migration-array separator.
- Run #254: migration fixed; TypeScript caught batch ID inference ambiguity.
- Run #255: typecheck passed; tests caught an incorrectly escaped raw-numeric reference regex.
- Run #256: repository hygiene, TypeScript typecheck, complete automated test suite and production build all **PASS**.

A final exact-head certification is required after this documentation/traceability promotion and before merge.

## Next

**Sprint 33 — Buyer–Seller Messaging, Notifications & Seller CRM Foundation**.