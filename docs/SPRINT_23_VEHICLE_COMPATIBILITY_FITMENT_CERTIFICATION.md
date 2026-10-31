# Sprint 23 — Vehicle Compatibility & Fitment (GAR-022)

## Status

**GAR-DEV-S23 VERIFIED — certification passed on PR #11**

Sprint 23 adds contextual vehicle compatibility and fitment on top of the Sprint 22 marketplace foundation without weakening the marketplace truth boundary.

## Core architectural rule

Compatibility belongs to:

```text
marketplace product × canonical vehicle × current evidence
```

It does **not** belong to a marketplace product globally.

Accordingly, the Sprint 22 field:

```text
marketplace_products.fitment_status = UNKNOWN
```

remains database-constrained to `UNKNOWN`.

Sprint 23 decisions are evaluated and persisted separately.

## Fitment decision states

```text
UNKNOWN
GENERIC
SELLER_CLAIMED
PROBABLE
CONFIRMED
CONFLICT
NOT_COMPATIBLE
```

### Meaning

- **UNKNOWN** — no structured evidence currently matches the selected vehicle.
- **GENERIC** — product is asserted as universal/generic, but installation requirements still need checking.
- **SELLER_CLAIMED** — seller-entered structured evidence matches; not independently verified.
- **PROBABLE** — structured catalog/verified evidence matches, but the source is not configured as final fitment authority.
- **CONFIRMED** — a VERIFIED rule from a source explicitly configured as a fitment verification authority matches.
- **CONFLICT** — matching include and exclude evidence disagree.
- **NOT_COMPATIBLE** — matching exclusion evidence explicitly rejects the selected vehicle.

No state is a purchase or installation guarantee.

## Non-guarantee law

Every fitment decision contains:

```json
{
  "guaranteed": false
}
```

The database enforces:

```sql
CHECK (guaranteed = 0)
```

Even `CONFIRMED` means only that current verified fitment-authority evidence matches the current canonical vehicle data.

## Vehicle matching dimensions

Sprint 23 supports structured matching over:

- make;
- model;
- model-year range;
- trim;
- variant;
- body type;
- engine type;
- fuel type;
- transmission;
- drive type.

Unspecified criteria operate as wildcards.

## Rule kinds

```text
INCLUDE
EXCLUDE
GENERIC
```

`INCLUDE` and `EXCLUDE` require at least one vehicle criterion.

`GENERIC` cannot carry vehicle-specific criteria.

## Evidence/source hierarchy

Source types:

```text
SELLER
MANUFACTURER
CATALOG_PROVIDER
GARAGE_VERIFIED
PLATFORM_CURATED
```

Verification states:

```text
SELLER_ASSERTED
UNVERIFIED
VERIFIED
```

Seller-created rules are always:

```text
source_type = SELLER
verification_status = SELLER_ASSERTED
```

A seller cannot promote its own claim to `VERIFIED`.

Platform-governed fitment sources carry:

- provider key;
- trust rank;
- verification-authority flag;
- lifecycle state;
- optional organization ownership.

This creates the integration boundary for future manufacturer/catalog-provider adapters.

## Conflict handling

When both an active matching inclusion and exclusion exist:

```text
decision = CONFLICT
confidence = 0
```

Conflicted products are excluded from **My Car → Compatible Parts**.

They remain directly evaluable so the user can see that evidence conflicts rather than receiving a false compatible/not-compatible answer.

## My Car → Compatible Parts

Authenticated owners can evaluate published marketplace inventory against one of their canonical Garage OS vehicles.

Default compatible search includes:

```text
GENERIC
SELLER_CLAIMED
PROBABLE
CONFIRMED
```

It excludes:

```text
CONFLICT
NOT_COMPATIBLE
UNKNOWN
```

`UNKNOWN` can be explicitly included by the user.

The response provides counts across all evaluated fitment states, so exclusion is visible rather than silent.

## Installation linkage

Sprint 23 records a historical link between:

- canonical vehicle;
- marketplace product;
- optional marketplace listing;
- optional installed `vehicle_component`;
- fitment decision known at installation time.

The linkage does not retroactively verify compatibility.

Owner-recorded installations default to:

```text
verification_status = UNVERIFIED
```

## Persistence

Migration `024_vehicle_compatibility_fitment` adds:

- `marketplace_fitment_sources`;
- `marketplace_product_fitment_rules`;
- `marketplace_fitment_decisions`;
- `marketplace_fitment_installations`.

A seeded platform source establishes the governed source model without importing fabricated external catalog data.

## APIs

### Owner / buyer

```text
GET  /api/v1/marketplace/fitment/vehicles/:vehicleId/search
GET  /api/v1/marketplace/listings/:listingId/fitment?vehicle_id=:vehicleId
GET  /api/v1/marketplace/fitment/vehicles/:vehicleId/installations
POST /api/v1/marketplace/fitment/vehicles/:vehicleId/installations
```

### Seller Fitment Studio

```text
GET  /api/v1/marketplace/seller/stores/:storeId/products/:productId/fitment/rules
POST /api/v1/marketplace/seller/stores/:storeId/products/:productId/fitment/rules
POST /api/v1/marketplace/seller/stores/:storeId/products/:productId/fitment/rules/:ruleId/revoke
```

Embedded compatibility fields remain rejected by the Sprint 22 product create/update endpoints. Structured fitment must use the GAR-022 rule APIs.

### Platform source governance

```text
GET  /api/v1/marketplace/admin/fitment/sources
POST /api/v1/marketplace/admin/fitment/sources
POST /api/v1/marketplace/admin/fitment/rules
```

These endpoints require `PLATFORM_ADMIN`.

## Events

Sprint 23 emits:

```text
marketplace.fitment.source.created
marketplace.fitment.rule.created
marketplace.fitment.rule.revoked
marketplace.fitment.evaluated
marketplace.fitment.installation.recorded
```

Events preserve source/verification truth and never claim a guarantee.

## UI

The new **Fitment** workspace contains two primary experiences.

### My Car

- canonical vehicle selector;
- published marketplace evaluation;
- product search;
- explicit fitment badges;
- evidence confidence;
- seller-claim warning;
- optional inclusion of UNKNOWN results;
- fitment-state summary counts.

### Fitment Studio

Authorized marketplace sellers can:

- select organization, storefront and product;
- create INCLUDE / EXCLUDE / GENERIC rules;
- enter make/model/year/trim/variant criteria;
- retain evidence reference/summary;
- inspect active and revoked rules;
- revoke seller rules.

The UI explicitly states that seller claims are not verified.

## Certification suite

`tests/integration/vehicleCompatibilityFitment.test.ts` verifies:

- normalized fitment schema;
- global marketplace product fitment remains UNKNOWN;
- seller claims remain SELLER_ASSERTED;
- seller claim → SELLER_CLAIMED;
- verified fitment authority → CONFIRMED;
- CONFIRMED remains non-guaranteed;
- database rejection of `guaranteed = 1`;
- non-authoritative catalog source → PROBABLE;
- generic fitment → GENERIC;
- include/exclude conflict → CONFLICT;
- conflicts excluded from compatible-part search;
- UNKNOWN excluded by default and explicitly opt-in;
- installation linkage snapshots current fitment state;
- seller organization tenant isolation.

## Sprint 22 boundaries preserved

Sprint 23 still does **not** implement:

- cart;
- checkout;
- marketplace orders;
- marketplace payment;
- refunds;
- shipping execution;
- seller payouts;
- product authenticity verification;
- seller reputation/reviews.

## Certification gate

PR: **#11**

Certification run **#199** validated the implementation head after the migration-registry correction:

- repository hygiene: PASS;
- TypeScript typecheck: PASS;
- complete automated test suite: PASS;
- production build: PASS.

This documentation/traceability promotion is followed by one final exact-head certification run before merge.
