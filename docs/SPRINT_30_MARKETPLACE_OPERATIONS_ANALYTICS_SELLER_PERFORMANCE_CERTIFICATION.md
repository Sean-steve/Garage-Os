# Sprint 30 — Marketplace Operations Analytics & Seller Performance

## Status

**GAR-DEV-S30 VERIFIED — implementation certification passed on PR #18**

Sprint 30 introduces read-only marketplace operations analytics for sellers and platform administrators without creating a new transactional authority or an opaque seller score.

## Analytics authority

Analytics projects existing authoritative marketplace facts from Sprints 24–29.

No analytics write model is used to override:

- orders;
- payment/capture/refund truth;
- fulfillment;
- physical returns;
- reviews;
- disputes;
- inventory;
- saved-item engagement.

No migration is required for Sprint 30 because the analytics layer intentionally reads canonical historical/operational tables rather than duplicating them into a competing source of truth.

## Financial truth

Money cards use only `marketplace_settlement_ledger_entries`.

Per currency, analytics exposes:

- captured gross minor units;
- refund-adjustment minor units;
- net seller receivable;
- captured-order count.

Rules:

- order totals are not labeled revenue;
- unpaid order totals never enter money analytics;
- currencies are never summed together;
- refund adjustments reduce seller receivable;
- seller receivable is explicitly not payout;
- no payout rail is inferred.

## Seller cohort funnel

The selected UTC period defines cart/order creation cohorts.

Metrics include:

- carts created;
- checked-out carts;
- orders placed;
- pre-payment cancellations;
- orders with authoritative settlement-ledger capture;
- fulfillment started;
- buyer-confirmed completed orders;
- distinct paid buyers;
- repeat paid buyers.

Explainable cohort ratios:

- cart → order;
- order → captured;
- captured → buyer-confirmed completed.

Later authoritative outcomes are evaluated as of the time the analytics query is run.

Legacy `marketplace_orders.payment_status` is not used as paid truth.

## Current operations attention

Current workload is kept separate from period performance.

Operational attention includes:

- unpaid awaiting-payment orders;
- captured orders with no fulfillment record;
- fulfillment in progress;
- seller delivery-reported orders still waiting for buyer confirmation;
- open return workflows;
- open disputes;
- low-stock published listings;
- out-of-stock published listings.

`DELIVERY_REPORTED` is never treated as buyer-confirmed receipt.

Dispute workload is not treated as seller guilt.

## Fulfillment and returns

Period metrics include:

- completed fulfillments;
- average authoritative capture → buyer-confirmed completion hours;
- return requests;
- completed returns;
- physically received return units;
- physically restocked return units.

Physical return quantities remain independent from financial refund truth.

## Trust facts

Trust analytics includes only:

- PUBLISHED;
- verified-purchase reviews.

Metrics include:

- verified review count;
- average rating;
- rating distribution;
- disputes opened in period;
- currently open disputes from the period.

Hidden, removed and under-review reviews do not contribute to published rating analytics.

No trust score or seller-quality score is generated.

## Engagement

Seller engagement exposes:

- current saved-listing instances;
- number of listings currently saved by at least one user.

These are aggregate counts only.

Buyer/saver identities are not exposed.

Historical save-event trend is explicitly unavailable because Sprint 29 stores current explicit saved state rather than hidden browsing history.

## Listing performance

Per listing, analytics can show:

- listing/inventory state;
- captured-order count;
- captured units;
- captured-order gross by currency;
- current save count;
- published verified product-review count;
- published verified average rating.

Unpaid order units are excluded from captured-unit performance.

Net refund amounts are intentionally not arbitrarily allocated to individual products when authoritative item-level financial attribution does not exist.

## Daily operations series

UTC daily points include:

- orders placed;
- authoritative captured orders;
- completed fulfillments;
- return requests;
- disputes opened;
- captured money by currency;
- refunded money by currency.

Only dates with marketplace activity are emitted.

## Platform operations analytics

Platform Admin receives aggregate marketplace operations for the selected window:

- stores total / active;
- orders placed;
- captured orders;
- completed fulfillments;
- published verified reviews;
- settlement-ledger money by currency;
- per-store operations rows;
- current open returns/disputes;
- daily marketplace activity.

No platform store ranking is calculated.

Open disputes/returns are workload facts, not punitive rank inputs.

## Authorization and privacy

Seller endpoint:

- requires canonical `marketplace.orders.read` authorization against the store organization;
- is tenant-scoped.

Platform endpoint:

- requires `PLATFORM_ADMIN`.

Responses do not expose buyer IDs, buyer names, buyer email addresses or saver identities.

Analytics access is written to the canonical audit log.

## Date windows

Analytics uses explicit UTC calendar-day windows.

- default: last 30 UTC days;
- maximum: 366 days;
- `from` and `to`: `YYYY-MM-DD`;
- invalid/reversed/overlong windows are rejected.

## APIs

- `GET /api/v1/marketplace/seller/stores/:storeId/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/v1/marketplace/admin/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD`

## UI

The Analytics workspace provides:

- seller storefront selector;
- UTC period controls;
- settlement-ledger money cards;
- cohort funnel;
- fulfillment/return operations;
- current attention queue;
- trust facts;
- daily activity;
- listing performance;
- Platform Admin cross-store operations view.

Every surface states the key truth boundaries: no seller score, no fabricated revenue, receivable is not payout, disputes are context, and buyer identities are not exposed.

## Certification

`tests/integration/marketplaceOperationsAnalyticsSellerPerformance.test.ts` verifies:

- settlement-ledger-only financial KPIs;
- unpaid order totals excluded from money;
- refunds reduce receivable;
- receivable is not payout;
- currencies remain separate;
- cohort funnel uses ledger capture rather than legacy payment status;
- current operational state separation;
- seller delivery-reported is not buyer-confirmed completion;
- capture-to-completion timing;
- physical return/restore quantities;
- published verified review filtering;
- disputes remain contextual facts;
- absence of direct opaque seller/trust score fields;
- captured listing units exclude unpaid order units;
- engagement is aggregate-only;
- buyer IDs are absent from seller analytics;
- seller tenant isolation;
- Platform Admin-only platform analytics;
- platform output contains no buyer identities;
- date-window filtering;
- invalid/overlong window rejection.

PR certification history:

- run #237: failed because the Platform Admin test fixture used obsolete platform-role column names;
- run #238: fixture corrected; two remaining certification fixture defects surfaced;
- run #239: return fixture fixed; one score-field assertion was overly broad because it matched explicit `opaque_*_score:false` truth flags;
- run #240: all repository hygiene, TypeScript, complete automated tests and production build passed.

A final exact-head certification is required after documentation/traceability promotion and before merge.

## Next

**Sprint 31 — Marketplace Growth, Retention & Seller Intelligence**