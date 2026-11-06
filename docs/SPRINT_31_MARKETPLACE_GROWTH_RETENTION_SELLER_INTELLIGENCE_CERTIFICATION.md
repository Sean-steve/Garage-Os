# Sprint 31 — Marketplace Growth, Retention & Seller Intelligence

## Status

**GAR-DEV-S31 VERIFIED — implementation certification passed on PR #19**

Sprint 31 adds read-only commercial growth, repeat-purchase cohort retention and deterministic seller intelligence on top of the certified Sprint 30 analytics boundary.

## Commercial growth authority

Growth uses provider-confirmed `PAYMENT_CAPTURE` entries in `marketplace_settlement_ledger_entries`.

Growth does not use:

- unpaid order totals;
- legacy `marketplace_orders.payment_status` as paid truth;
- page views;
- clicks;
- raw search history;
- hidden browsing history;
- inferred behavioral profiles.

The selected UTC window is compared with the immediately preceding equal-length UTC window.

Current and previous period metrics include:

- captured orders;
- distinct paid buyers;
- first-time paid buyers;
- returning paid buyers;
- buyers with at least two captured orders in the same period;
- in-period repeat-paid-buyer percentage.

If the previous-period denominator is zero, percentage change is `null`; the system does not fabricate infinity or a synthetic growth percentage.

## New vs returning paid buyers

A buyer is first-time for a seller when their first authoritative settlement capture for that store falls inside the selected period.

A buyer is returning when:

- they have at least one authoritative capture inside the selected period; and
- their first authoritative capture for that seller occurred before the selected period.

Platform-wide first-time/returning analysis uses first authoritative capture across the marketplace rather than exposing store-level buyer identity.

## 30/90-day repeat-purchase cohorts

Retention is implemented as repeat-purchase cohort analysis, not subscription retention.

Cohorts anchor on each buyer's first settlement capture.

For each first-time cohort:

- 30-day denominator includes only buyers whose first capture is at least 30 days before the observation cutoff;
- 90-day denominator includes only buyers whose first capture is at least 90 days before the observation cutoff;
- immature buyers are excluded from the corresponding denominator;
- a qualifying second settlement capture within the window counts as repeat purchase.

The system explicitly reports:

- eligible 30-day buyers;
- repeated within 30 days;
- 30-day repeat percentage;
- eligible 90-day buyers;
- repeated within 90 days;
- 90-day repeat percentage;
- monthly cohort breakdown.

No buyer is automatically labeled churned.

## Category demand

Seller/category demand combines two factual sources:

1. provider-confirmed captured order items in the selected period; and
2. explicit current saved-listing intent from Sprint 29.

Category metrics include:

- active published listing count;
- current saved instances;
- captured orders;
- captured units;
- captured order-item gross by currency;
- saved instances currently attached to out-of-stock published listings.

Captured-order-item gross is a demand/merchandise metric, not net seller revenue. Net financial truth remains the Sprint 25/Sprint 30 settlement-ledger view.

## Listing demand signals

Per listing, Sprint 31 exposes:

- category;
- listing/inventory state;
- current explicit save count;
- captured-order count;
- captured units;
- published verified-review coverage.

Unpaid order units are excluded.

## Deterministic seller opportunities

Seller intelligence is rule-based and evidence-bearing. Each opportunity returns:

- type;
- priority;
- listing ID when relevant;
- factual evidence;
- explanation;
- suggested action;
- `automatic_action: false`.

Implemented opportunity types:

- `RESTOCK_SAVED_DEMAND`;
- `LOW_STOCK_DEMAND`;
- `SAVED_DEMAND_NO_CAPTURE`;
- `REVIEW_COVERAGE`;
- `PAID_ORDER_FULFILLMENT_BACKLOG`;
- `BUYER_CONFIRMATION_PENDING`.

### Inventory opportunities

`RESTOCK_SAVED_DEMAND` requires:

- a published listing;
- current `OUT_OF_STOCK` inventory truth;
- at least one explicit current saved listing.

`LOW_STOCK_DEMAND` requires:

- a published listing;
- current `LOW_STOCK` inventory truth;
- explicit saved demand or captured units.

The UI never fabricates urgency or claims scarcity beyond current inventory truth.

### Saved demand without capture

`SAVED_DEMAND_NO_CAPTURE` identifies an available published listing with explicit current saves but no captured units in the selected period.

The suggested action is to review listing clarity, price, fitment evidence and fulfillment options.

No automatic discount is recommended or executed.

### Review coverage

`REVIEW_COVERAGE` requires multiple captured orders and zero published verified-purchase review coverage.

The intelligence recommends reviewing the post-purchase review experience.

It does not:

- expose buyer identities;
- create reviews;
- fabricate review activity;
- directly message buyers.

### Fulfillment backlog

`PAID_ORDER_FULFILLMENT_BACKLOG` requires the order's current settlement-ledger net amount to equal the immutable order total and no fulfillment record.

This deliberately excludes partially or fully refunded orders, preserving the Sprint 25/26 fulfillment/payment boundary.

Analytics never starts fulfillment itself.

### Buyer confirmation pending

`BUYER_CONFIRMATION_PENDING` surfaces fulfillment records in `DELIVERY_REPORTED`.

Seller delivery report remains distinct from buyer-confirmed receipt.

The intelligence cannot confirm receipt on the buyer's behalf.

## Privacy

Seller responses do not expose:

- buyer user IDs;
- buyer names;
- buyer email addresses;
- saver identities;
- raw saved-search queries;
- raw browsing history.

Sprint 31 uses current saved listings only as aggregate explicit intent.

Seller access remains tenant-scoped through canonical marketplace order-read authorization.

Platform growth aggregation requires `PLATFORM_ADMIN`.

Growth/intelligence access is written to the canonical audit log.

## Read-only boundary

Sprint 31 does not mutate:

- orders;
- settlement ledger;
- payment/refund state;
- fulfillment;
- buyer receipt state;
- listings;
- inventory;
- saved items;
- reviews.

No new migration is required. Sprint 31 intentionally projects existing canonical records instead of creating a competing analytics truth store.

## APIs

- `GET /api/v1/marketplace/seller/stores/:storeId/growth?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/v1/marketplace/admin/growth?from=YYYY-MM-DD&to=YYYY-MM-DD`

Date rules:

- UTC calendar-day windows;
- default: last 90 UTC days;
- maximum: 366 days;
- immediate prior equal-length comparison;
- invalid or reversed windows rejected.

## UI

The Growth workspace provides:

- seller storefront selector;
- UTC period controls;
- current/prior commercial growth cards;
- first-time and returning paid-buyer facts;
- in-period repeat buyer percentage;
- 30/90-day mature repeat-purchase cohort table;
- category demand;
- deterministic seller opportunity cards;
- listing demand signals;
- Platform Admin aggregate marketplace/store growth view.

UI disclosure explicitly states:

- no growth score;
- no churn score;
- no hidden behavioral profile;
- no page-view/search-history tracking;
- no automatic seller actions.

## Certification

`tests/integration/marketplaceGrowthRetentionSellerIntelligence.test.ts` verifies:

- current vs previous equal-period growth;
- unpaid orders excluded from growth;
- new vs returning paid-buyer classification;
- in-period repeat paid buyers;
- mature 30/90-day cohort denominators;
- immature cohort exclusion;
- no churn inference;
- null percentage change for zero comparison baseline;
- current explicit saves as demand;
- no browsing/search-history use;
- no buyer IDs in seller responses;
- out-of-stock saved-demand opportunity;
- saved-demand-without-capture opportunity;
- low-stock demand opportunity;
- review-coverage opportunity without review fabrication;
- fully-paid fulfillment backlog;
- partially refunded order exclusion from fulfillment backlog;
- seller delivery-reported != buyer-confirmed receipt;
- all opportunities are non-automatic;
- category/listing demand excludes unpaid units;
- tenant isolation;
- Platform Admin-only platform aggregation;
- no platform buyer IDs;
- no store ranking;
- read-only behavior;
- no direct growth/churn score fields;
- reversed/overlong window rejection.

Implementation certification:

- run #245: typecheck caught an overly broad test fixture product-type field;
- run #246: repository hygiene, TypeScript typecheck, complete automated test suite and production build all passed.

A final exact-head certification is required after documentation and traceability promotion and before merge.

## Next

The reconciled marketplace roadmap is documented in `docs/MARKETPLACE_ROADMAP_SPRINT_32_ONWARD.md`. The canonical next sprint is **Sprint 32 — Seller Payouts, Balances & Financial Operations**.