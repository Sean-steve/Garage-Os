# Sprint 22 — Marketplace Foundation

## Status

**GAR-DEV-S22 VERIFIED**

Sprint 22 establishes the Garage OS physical-goods marketplace foundation on top of the certified identity, provider, component, storage, security and audit layers.

## Core architectural rule

Sprint 22 owns:

- seller storefront identity;
- physical automotive product catalog;
- marketplace categories;
- commercial listings;
- price snapshots;
- inventory state;
- fulfillment-mode metadata;
- listing media references;
- buyer discovery/search projection.

Sprint 22 does **not** own:

- vehicle compatibility/fitment decisions;
- checkout;
- cart/order lifecycle;
- payment;
- seller payout;
- product authenticity verification;
- seller trust/reputation;
- services/modifications marketplace.

## Seller tenancy

Marketplace stores belong to an existing Garage OS organization.

Eligible organization types:

```text
MARKETPLACE_SELLER
AUTOMOTIVE_SERVICE_PROVIDER
GARAGE
```

Seller management is enforced through the existing canonical policy engine and:

```text
marketplace.products.read
marketplace.products.manage
```

No parallel marketplace identity or seller-auth system was introduced.

Cross-organization seller access is denied.

## Storefront lifecycle

```text
DRAFT
ACTIVE
PAUSED
SUSPENDED
```

Seller-controlled transitions in Sprint 22 support:

```text
DRAFT → ACTIVE
ACTIVE → PAUSED
PAUSED → ACTIVE
```

`SUSPENDED` is reserved for platform-governed future trust/safety controls.

A non-active storefront is excluded from buyer discovery.

## Product catalog

Physical product types:

```text
PART
TYRE
ACCESSORY
CONSUMABLE
TOOL
ELECTRONICS
OTHER
```

Conditions:

```text
NEW
USED
REMANUFACTURED
```

Each product includes:

- seller SKU;
- category;
- product type;
- title/description;
- brand;
- optional manufacturer part number;
- condition;
- seller authenticity claim;
- warranty summary;
- lifecycle state.

## Compatibility / fitment boundary

Sprint 22 deliberately cannot confirm fitment.

Every marketplace product is persisted with:

```text
fitment_status = UNKNOWN
```

The database constraint prevents another value.

Sprint 22 seller APIs reject compatibility-oriented fields such as:

- fitment;
- fitment status;
- compatible vehicle(s);
- vehicle make;
- vehicle model;
- model year.

Public marketplace responses explicitly report:

```json
{
  "fitment_confirmed": false,
  "compatibility_status": "UNKNOWN"
}
```

Structured vehicle compatibility is owned by **Sprint 23 / GAR-022**.

## Authenticity boundary

Seller claims may be recorded as:

```text
SELLER_CLAIMED_OEM
SELLER_CLAIMED_AFTERMARKET
GENERIC
UNKNOWN
```

However, Sprint 22 persists:

```text
authenticity_verification_status = NOT_VERIFIED
```

The database prevents Sprint 22 from marking authenticity as verified.

Public UI differentiates:

- seller claim;
- verification state.

A seller claim is never rendered as platform verification.

## Listing lifecycle

```text
DRAFT
PUBLISHED
PAUSED
RETIRED
```

Publication requires:

- active storefront;
- non-retired product;
- positive integer-minor-unit price;
- valid ISO currency;
- at least one fulfillment mode.

Only listings satisfying all discovery conditions are visible:

- organization ACTIVE;
- storefront ACTIVE;
- product PUBLISHED;
- listing PUBLISHED.

## Money

Marketplace money follows the Garage OS technical constitution:

- integer minor units only;
- ISO 4217 three-letter currency code;
- no floating-point canonical money.

Example:

```text
KES 1,250.00 → price_minor = 125000
```

## Price snapshots

Listing price/inventory snapshots are persisted for:

```text
CREATED
UPDATED
PUBLISHED
```

Snapshots store:

- listing version;
- price minor units;
- compare-at price;
- currency;
- inventory state;
- actor;
- capture reason/time.

This provides the historical commercial basis needed before transaction/order snapshots arrive in Sprint 24.

## Inventory truth

Tracking modes:

```text
NONE
QUANTITY
```

When `QUANTITY` tracking is enabled, inventory status is derived:

- quantity = 0 → `OUT_OF_STOCK`;
- quantity 1–3 → `LOW_STOCK`;
- quantity > 3 → `IN_STOCK`.

Seller-supplied contradictory stock labels do not override quantity truth.

When quantity tracking is disabled, supported explicit states are:

```text
IN_STOCK
LOW_STOCK
OUT_OF_STOCK
MADE_TO_ORDER
UNKNOWN
```

## Fulfillment foundation

Sprint 22 records seller fulfillment metadata:

```text
PICKUP
LOCAL_DELIVERY
SHIPPING
```

These are listing capabilities only.

They do not create:

- shipping labels;
- delivery jobs;
- checkout choices;
- fulfillment transactions.

## Media

Marketplace media references canonical `file_objects`.

Media requires:

- existing available file;
- seller actor ownership or privileged platform authorization;
- image content type for `IMAGE` media.

Search projections include the primary image file reference only.

## Buyer discovery

Sprint 22 implements a rebuildable search projection over published marketplace truth.

Buyer filters include:

- free-text query;
- category;
- product type;
- condition;
- brand;
- currency;
- min/max integer-minor-unit price;
- in-stock-only;
- store slug.

Draft, paused, retired or inactive-organization records do not appear.

Fitment is not a search dimension in Sprint 22.

## Public listing truth

Every listing detail explicitly reports:

```json
{
  "fitment_confirmed": false,
  "compatibility_status": "UNKNOWN",
  "checkout_available": false,
  "order_creation_available": false,
  "payment_available": false,
  "authenticity_verified": false
}
```

## APIs

Buyer/discovery:

```text
GET /api/v1/marketplace/categories
GET /api/v1/marketplace/search
GET /api/v1/marketplace/listings/:id
GET /api/v1/marketplace/stores/:slug
```

Seller:

```text
GET  /api/v1/marketplace/seller/stores
POST /api/v1/marketplace/seller/stores
PATCH /api/v1/marketplace/seller/stores/:storeId

GET  /api/v1/marketplace/seller/stores/:storeId/products
POST /api/v1/marketplace/seller/stores/:storeId/products
PATCH /api/v1/marketplace/seller/stores/:storeId/products/:productId

POST /api/v1/marketplace/seller/stores/:storeId/products/:productId/listing
GET  /api/v1/marketplace/seller/stores/:storeId/listings
GET  /api/v1/marketplace/seller/stores/:storeId/listings/:listingId
PATCH /api/v1/marketplace/seller/stores/:storeId/listings/:listingId
POST /api/v1/marketplace/seller/stores/:storeId/listings/:listingId/publish
POST /api/v1/marketplace/seller/stores/:storeId/listings/:listingId/pause
POST /api/v1/marketplace/seller/stores/:storeId/listings/:listingId/media
```

## Persistence

Migration `023_marketplace_foundation` adds:

- `marketplace_stores`;
- `marketplace_categories`;
- `marketplace_products`;
- `marketplace_listings`;
- `marketplace_listing_media`;
- `marketplace_listing_price_snapshots`;
- `marketplace_listing_search_projection`.

The migration seeds the initial automotive category taxonomy.

Rollback certification includes safe removal of self-referencing category children before dropping the category table.

## UI

The Marketplace workspace contains:

### Shop

- buyer search;
- category/product filters;
- published listing cards;
- price/inventory;
- seller storefront identity;
- listing details;
- explicit UNKNOWN fitment state;
- explicit NOT VERIFIED authenticity state.

### Seller Studio

For authorized marketplace organizations:

- create storefront;
- activate/pause storefront;
- create catalog product;
- create listing;
- truthful quantity inventory;
- select fulfillment modes;
- publish listings;
- inspect seller listing state.

No cart or checkout control is rendered.

## Events

Sprint 22 emits:

```text
marketplace.store.created
marketplace.store.updated
marketplace.product.created
marketplace.product.updated
marketplace.listing.created
marketplace.listing.updated
marketplace.listing.published
marketplace.listing.paused
marketplace.listing.media.added
```

Publication events explicitly carry:

- fitment = UNKNOWN;
- authenticity = NOT_VERIFIED;
- checkout unavailable;
- order creation unavailable;
- payment unavailable.

## Certification tests

The Sprint 22 suite verifies:

- normalized marketplace tables;
- category taxonomy;
- no marketplace order/payment tables;
- draft/private storefront behavior;
- fitment database constraint;
- authenticity verification constraint;
- integer minor-unit money;
- initial price snapshot;
- truthful quantity stock state;
- publication prerequisites;
- explicit no-fitment/no-checkout truth;
- price versioning and search rebuild;
- buyer search filters;
- listing/store pause removes discovery;
- actor-owned media policy;
- primary image projection;
- cross-organization isolation;
- publication event truth boundaries;
- migration rollback safety.

## Implementation-head certification

Green implementation head:

- GitHub Actions run: **41200712743**
- Head: `f852912b4248a043f3e0ff6b3559b46ddcdf3aef`
- Repository hygiene: **PASS**
- TypeScript typecheck: **PASS**
- Full test suite: **PASS**
- Production build: **PASS**
- Workflow URL: https://github.com/Sean-steve/Garage-Os/actions/runs/41200712743

The final documentation/traceability head must independently pass the same certification workflow before merge.

## Explicitly deferred

Sprint 22 does not implement:

- confirmed/probable fitment;
- VIN/make/model/year compatibility matching;
- fitment evidence/conflicts;
- cart;
- checkout;
- orders;
- payment;
- refunds;
- shipping execution;
- seller payouts;
- ratings/reviews;
- platform authenticity verification;
- service/modification marketplace.

## Sprint 23 readiness

Sprint 23 may begin only after:

- PR #10 passes final exact-head certification;
- PR #10 is merged into `main`;
- merged `main` passes certification.

**Next:** Sprint 23 — Vehicle Compatibility & Fitment (GAR-022).
