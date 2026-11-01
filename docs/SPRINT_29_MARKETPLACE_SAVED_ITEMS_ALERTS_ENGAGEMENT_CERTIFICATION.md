# Sprint 29 — Marketplace Saved Items, Alerts & Engagement

## Status

**GAR-DEV-S29 VERIFIED — implementation certification passed on PR #17**

Sprint 29 adds explicit marketplace saved state, durable in-app alerts and privacy-safe seller engagement without converting ordinary browsing/search activity into hidden behavioral tracking.

## Explicit saved intent

Garage OS persists marketplace engagement state only after an authenticated user explicitly saves:

- a marketplace listing; or
- a marketplace search.

Ordinary browsing and ordinary search activity remain unpersisted.

## Saved listings

A saved listing stores:

- listing ID;
- price at save time;
- inventory state at save time;
- last evaluated price;
- last evaluated inventory state;
- price-drop alert preference;
- restock alert preference;
- saved/updated timestamps.

Saving the same listing repeatedly is idempotent for the same user.

Saved items remain visible in the user's saved collection even if the listing later becomes unavailable/discoverability changes.

## Saved searches

A saved search stores only explicit criteria chosen by the user plus optional vehicle context.

On creation, canonical Sprint 28 discovery is evaluated and current matches are written as a baseline. Current matches do not generate alerts.

New-match evaluation reuses the canonical Sprint 28 discovery engine. If vehicle context was explicitly saved, Sprint 23 fitment boundaries continue to apply:

- CONFLICT is excluded;
- NOT_COMPATIBLE is excluded;
- UNKNOWN is excluded from vehicle-aware new-match alerts;
- compatibility is never guaranteed.

Saved searches can be ACTIVE or PAUSED and new-match alerts can be disabled independently.

## Alert types

Sprint 29 implements durable in-app alerts for:

- SAVED_LISTING_PRICE_DROP;
- SAVED_LISTING_RESTOCK;
- SAVED_SEARCH_NEW_MATCH.

Generated alerts are deterministic derived truth and use unique per-user fingerprints for deduplication.

## Durable evaluation

Listing price/inventory updates and listing publication enqueue the canonical background job:

`marketplace.engagement.alert.evaluate`

The worker reconstructs the user's canonical actor context internally and evaluates saved listings/searches using authoritative current marketplace state.

Users can also request evaluation from the authenticated engagement API.

## Rate limiting

Each user has a configurable in-app alert cap of 1–50 alerts per UTC day, default 20.

If the cap suppresses an eligible alert, the relevant unalerted state is not silently consumed, allowing later evaluation when capacity is available.

## Alert lifecycle

Alerts support:

- UNREAD;
- READ;
- DISMISSED.

Only the alert owner may change its state.

## Notification delivery truth

Sprint 29 does not configure a marketplace email, SMS or push provider.

Preferences may record that a user wants those future channels, but API/UI responses explicitly state:

- in-app delivery available: true;
- email delivery available: false;
- SMS delivery available: false;
- push delivery available: false;
- external delivery attempted: false.

Requested external-channel preferences never imply that a message was sent or delivered.

Quiet-hour settings are retained for future external delivery adapters; they do not suppress the authoritative in-app inbox.

## Seller engagement

Authorized sellers can see aggregate save counts for listings in their own storefront.

Seller engagement never exposes:

- user IDs of savers;
- saver names/emails;
- cross-tenant saved-state data.

## Persistence

Migration `030_marketplace_saved_items_alerts_engagement` adds:

- `marketplace_saved_listings`;
- `marketplace_saved_searches`;
- `marketplace_saved_search_matches`;
- `marketplace_alert_preferences`;
- `marketplace_alerts`.

No browsing-history, search-history or behavioral-profile table is added.

## APIs

Summary:

- `GET /api/v1/marketplace/engagement/summary`

Saved listings:

- `GET /api/v1/marketplace/saved-listings`
- `POST /api/v1/marketplace/listings/:listingId/save`
- `PATCH /api/v1/marketplace/saved-listings/:savedId`
- `DELETE /api/v1/marketplace/saved-listings/:savedId`

Saved searches:

- `GET /api/v1/marketplace/saved-searches`
- `POST /api/v1/marketplace/saved-searches`
- `PATCH /api/v1/marketplace/saved-searches/:searchId`
- `DELETE /api/v1/marketplace/saved-searches/:searchId`

Alerts/preferences:

- `GET /api/v1/marketplace/alerts/preferences`
- `PATCH /api/v1/marketplace/alerts/preferences`
- `GET /api/v1/marketplace/alerts`
- `PATCH /api/v1/marketplace/alerts/:alertId`
- `POST /api/v1/marketplace/alerts/evaluate`
- `POST /api/v1/marketplace/alerts/evaluate-now`

Seller engagement:

- `GET /api/v1/marketplace/seller/stores/:storeId/engagement`

## Events

- `marketplace.engagement.listing.saved`;
- `marketplace.engagement.search.saved`;
- `marketplace.engagement.alert.created`.

User save actions use owner-asserted provenance. Generated alert events use deterministic-derived provenance.

## UI

Discovery now supports explicit:

- Save listing;
- Save search.

The Saved & Alerts workspace provides:

- saved listing management;
- price-drop/restock toggles;
- saved-search activation/new-match toggles;
- alert inbox and read/dismiss actions;
- alert preference management;
- delivery-availability disclosure;
- seller aggregate engagement.

## Certification

`tests/integration/marketplaceSavedItemsAlertsEngagement.test.ts` verifies:

- schema with no fabricated engagement records;
- no browsing/search-history/behavioral-profile persistence;
- saved-listing snapshot and idempotency;
- price-drop alert generation/deduplication;
- durable evaluation job enqueue on listing changes;
- restock transition alerts;
- saved-search baseline suppression;
- later new-match alerts;
- vehicle saved-search fitment exclusion;
- daily alert cap without silently consuming suppressed state;
- external-channel preference honesty;
- background worker actor reconstruction;
- alert read/dismiss ownership isolation;
- seller aggregate-only privacy;
- seller tenant isolation;
- paused saved-search behavior.

Initial PR run #231 surfaced a pre-existing time-dependent Sprint 21 Trip Guardian certification fixture. Its planned journey had been hard-coded for November 1, 2026 05:00–08:00 UTC and became past during the certification run, correctly producing no future check-ins. The fixture was changed to future-relative times so the safety certification remains valid across calendar rollovers.

Implementation certification run #232 then passed:

- repository hygiene;
- TypeScript typecheck;
- complete automated test suite;
- production build.

A final exact-head certification is required after documentation and traceability promotion and before merge.

## Next

**Sprint 30 — Marketplace Operations Analytics & Seller Performance**