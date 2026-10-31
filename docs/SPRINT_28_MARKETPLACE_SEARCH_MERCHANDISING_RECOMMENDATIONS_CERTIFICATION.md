# Sprint 28 — Marketplace Search Quality, Merchandising & Recommendations

## Status

**GAR-DEV-S28 VERIFIED — implementation certification passed on PR #16**

Sprint 28 upgrades Garage OS marketplace discovery with deterministic explainable organic ranking, explicit merchandising surfaces, and contextual recommendations that preserve Sprint 23 fitment truth.

## Search quality

The canonical `GET /api/v1/marketplace/search` endpoint now uses the Sprint 28 discovery engine.

Search supports:

- title, brand, category, description and store relevance;
- seller SKU indexing;
- manufacturer part-number indexing;
- automotive spelling aliases such as tyre/tire, windscreen/windshield and headlamp/headlight;
- price, brand, category, condition, inventory and storefront filters;
- relevance, price and verified-rating sorts;
- optional vehicle context.

Every result exposes its organic score and rank components.

## Organic ranking

Organic ranking is deterministic.

Current explainable components:

- QUERY — title/brand/category/description/part-reference relevance;
- AVAILABILITY — current inventory state;
- TRUST — published verified-purchase review average and count;
- FITMENT — current product × vehicle fitment evidence when a vehicle is supplied;
- RELATEDNESS — category/brand proximity for related-item recommendations.

Stable listing ID ordering breaks otherwise equal scores.

## Merchandising boundary

Merchandising is a separate surface and does not alter organic search score or rank.

Sprint 28 does not implement paid placement.

Every merchandising response includes:

- source label;
- `paid_placement: false`;
- `affects_organic_ranking: false`.

## Seller merchandising

Sellers can create curated storefront shelves only.

Rules:

- seller collection owner type is STORE;
- seller collection surface must be STORE;
- seller may include only currently discoverable listings from that same store;
- seller cannot create HOME or CATEGORY global shelves;
- cross-store listing insertion is rejected.

Seller shelves are labeled `SELLER_CURATED`.

## Platform merchandising

Platform Admin can create:

- HOME curated collections;
- CATEGORY curated collections.

Platform curation may include any currently discoverable marketplace listing and is labeled `PLATFORM_CURATED`.

Platform curation still does not modify organic ranking.

## Scheduling

Collections can define optional start/end timestamps.

Only ACTIVE collections within the current scheduling window are returned to marketplace merchandising surfaces.

## Vehicle-aware search

When a vehicle is selected, discovery evaluates current Sprint 23 fitment evidence.

`CONFLICT` and `NOT_COMPATIBLE` listings are excluded from vehicle-context search results.

`UNKNOWN` may be included in search only when the caller permits it.

Fitment contributes to ranking using explicit status-based components.

Compatibility remains non-guaranteed.

## Vehicle recommendations

Vehicle recommendations:

- require explicit vehicle context;
- include only positive fitment states: GENERIC, SELLER_CLAIMED, PROBABLE or CONFIRMED;
- exclude UNKNOWN;
- exclude CONFLICT;
- exclude NOT_COMPATIBLE;
- preserve the fitment disclaimer and `guaranteed: false` truth.

No hidden behavioral profile is used.

## Related-item recommendations

Related recommendations use current listing context:

- same category;
- same brand where available;
- optional vehicle fitment context.

They do not use merchandising boosts and do not persist behavioral profiles.

## Privacy boundary

Sprint 28 deliberately does not persist:

- raw search history;
- behavioral recommendation profiles;
- opaque personalization profiles.

Search/recommendation responses declare these boundaries explicitly.

## Persistence

Migration `029_marketplace_search_merchandising_recommendations` adds:

- `marketplace_merchandising_collections`;
- `marketplace_merchandising_items`.

No search-history or behavioral-profile table is added.

The existing marketplace search projection is extended to index SKU and manufacturer part number in its search text.

## APIs

Canonical ranked search:

- `GET /api/v1/marketplace/search`

Recommendations:

- `GET /api/v1/marketplace/recommendations/vehicle/:vehicleId`
- `GET /api/v1/marketplace/recommendations/listings/:listingId`

Public merchandising:

- `GET /api/v1/marketplace/merchandising`

Seller merchandising:

- `GET /api/v1/marketplace/seller/stores/:storeId/merchandising`
- `POST /api/v1/marketplace/seller/stores/:storeId/merchandising`
- `PATCH /api/v1/marketplace/seller/stores/:storeId/merchandising/:collectionId`
- `PUT /api/v1/marketplace/seller/stores/:storeId/merchandising/:collectionId/items`

Platform merchandising:

- `GET /api/v1/marketplace/admin/merchandising`
- `POST /api/v1/marketplace/admin/merchandising`
- `PATCH /api/v1/marketplace/admin/merchandising/:collectionId`
- `PUT /api/v1/marketplace/admin/merchandising/:collectionId/items`

## Events and audit

Merchandising mutations emit:

- `marketplace.merchandising.collection.created`;
- `marketplace.merchandising.collection.updated`;
- `marketplace.merchandising.items.replaced`.

Actor-created merchandising events use owner-asserted provenance and mutation actions are written to the immutable audit log.

## UI

The Discovery workspace provides:

- explainable search rankings;
- vehicle-context search;
- visible rank components;
- related recommendations;
- vehicle recommendations;
- explicitly disclosed curated HOME shelves;
- seller storefront shelf management;
- platform merchandising management.

## Certification

`tests/integration/marketplaceSearchMerchandisingRecommendations.test.ts` verifies:

- merchandising schema with no fabricated shelves;
- absence of search-history/behavioral-profile storage;
- SKU search;
- manufacturer part-number search;
- tyre/tire alias matching;
- exact/title relevance above description-only matches;
- rank-component explainability;
- merchandising does not change organic ranking;
- seller curation disclosure;
- seller STORE-only merchandising;
- own-listing tenant isolation;
- cross-store access rejection;
- platform curation disclosure;
- no paid placement;
- vehicle search excludes fitment conflicts;
- vehicle search never claims fitment guarantee;
- vehicle recommendations exclude UNKNOWN/conflict/incompatible results;
- related recommendations are contextual;
- related recommendations remain independent from merchandising;
- recommendations do not persist behavioral profiles.

Implementation certification run #225 passed repository hygiene, TypeScript typecheck, the complete automated test suite and production build.

After the run, merchandising mutation audit coverage and actor provenance were tightened. A final exact-head certification is required before merge.

## Next

**Sprint 29 — Marketplace Saved Items, Alerts & Engagement**