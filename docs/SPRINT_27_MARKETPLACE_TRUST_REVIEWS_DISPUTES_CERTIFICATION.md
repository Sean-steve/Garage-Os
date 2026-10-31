# Sprint 27 — Marketplace Trust, Reviews & Disputes

## Status

**GAR-DEV-S27 VERIFIED — implementation certification passed on PR #15**

Sprint 27 adds verified-purchase reviews, factual marketplace trust views, seller participation, Trust & Safety moderation, and auditable buyer-seller dispute cases without allowing trust workflows to fabricate financial, inventory, or account-state changes.

## Trust model

Garage OS does not persist an opaque marketplace trust score.

Trust surfaces expose separate factual signals:

- verified-purchase review count;
- average verified rating;
- rating distribution;
- completed fulfillment count;
- fully returned fulfillment count;
- return request count;
- dispute count;
- open dispute count;
- resolved/closed dispute count.

Dispute counts are explicitly contextual facts and are not treated as proof of seller wrongdoing.

## Verified-purchase reviews

A review can be created only when:

- the authenticated buyer owns the order;
- provider-authoritative payment capture exists;
- buyer-confirmed fulfillment has completed;
- the review target belongs to the purchased order.

Supported review targets:

- STORE — one review per completed order;
- PRODUCT — one review per purchased product target in the order.

Review records are database-constrained to verified_purchase = 1.

Ratings are integer values from 1–5.

## Seller participation

Authorized seller users may:

- publish/update one public response per published review;
- report a review to Trust & Safety;
- view storefront trust facts;
- participate in disputes for their own storefront.

Cross-tenant seller access is denied by organization-scoped marketplace order permissions.

## Review moderation

A seller report moves a review to UNDER_REVIEW and removes it from published trust aggregates while moderation is pending.

Only Platform Admin or Trust & Safety may decide moderation:

- PUBLISH — restore/retain public visibility;
- HIDE — hide the review;
- REMOVE — remove the review from public trust views.

Moderation decisions store a rationale and resolve/dismiss associated open reports.

## Disputes

A buyer may open a dispute only against an order with captured payment.

Supported categories:

- ORDER_NOT_RECEIVED;
- ITEM_NOT_AS_DESCRIBED;
- DAMAGED;
- FITMENT_MISMATCH;
- PAYMENT_REFUND;
- RETURN_REFUND;
- SELLER_CONDUCT;
- OTHER.

Only one unresolved dispute may exist per order at a time.

Dispute lifecycle:

SELLER_RESPONSE_REQUIRED → UNDER_REVIEW → RESOLVED → CLOSED

Buyer and seller party messages remain visible to both parties. Trust & Safety may add:

- PARTIES messages visible to buyer/seller;
- INTERNAL notes visible only in the Trust & Safety console.

## Resolution boundary

Trust & Safety resolution actions are routing/decision facts:

- NO_ACTION;
- PARTIES_AGREED;
- RETURN_WORKFLOW;
- FINANCE_REVIEW;
- ACCOUNT_ACTION_REVIEW.

A dispute resolution itself never:

- captures or refunds money;
- creates a marketplace refund row;
- restores or decrements inventory;
- changes seller or buyer account status;
- bypasses the existing Return, Finance, or account-action authority.

## Persistence

Migration 028_marketplace_trust_reviews_disputes adds:

- marketplace_reviews;
- marketplace_review_responses;
- marketplace_review_reports;
- marketplace_disputes;
- marketplace_dispute_messages.

## Permissions

Sprint 27 adds:

- marketplace.reviews.moderate;
- marketplace.disputes.moderate.

These are granted to Platform Admin and Trust & Safety platform roles.

Seller participation continues to use tenant-scoped marketplace order read/manage permissions.

## APIs

Trust/reviews:

- GET /api/v1/marketplace/stores/:storeId/trust
- GET /api/v1/marketplace/reviews/me
- POST /api/v1/marketplace/orders/:orderId/reviews
- PATCH /api/v1/marketplace/reviews/:reviewId
- POST /api/v1/marketplace/seller/stores/:storeId/reviews/:reviewId/respond
- POST /api/v1/marketplace/seller/stores/:storeId/reviews/:reviewId/report

Buyer/seller disputes:

- POST /api/v1/marketplace/orders/:orderId/disputes
- GET /api/v1/marketplace/disputes/me
- GET /api/v1/marketplace/disputes/:disputeId
- POST /api/v1/marketplace/disputes/:disputeId/messages
- GET /api/v1/marketplace/seller/stores/:storeId/disputes
- GET /api/v1/marketplace/seller/stores/:storeId/disputes/:disputeId
- POST /api/v1/marketplace/seller/stores/:storeId/disputes/:disputeId/messages

Trust & Safety:

- GET /api/v1/marketplace/admin/trust/review-reports
- POST /api/v1/marketplace/admin/trust/reviews/:reviewId/moderate
- GET /api/v1/marketplace/admin/trust/disputes
- POST /api/v1/marketplace/admin/trust/disputes/:disputeId/take
- POST /api/v1/marketplace/admin/trust/disputes/:disputeId/messages
- POST /api/v1/marketplace/admin/trust/disputes/:disputeId/resolve
- POST /api/v1/marketplace/admin/trust/disputes/:disputeId/close

## Events

- marketplace.review.created
- marketplace.review.response.published
- marketplace.review.reported
- marketplace.review.moderated
- marketplace.dispute.opened
- marketplace.dispute.resolved

## UI

The Trust workspace provides:

- Buyer Trust — verified-purchase review creation and dispute case interaction;
- Seller Trust — factual trust signals, verified reviews, seller responses/reports and dispute inbox;
- Trust & Safety — review moderation, dispute assignment, case evidence/messages and resolution routing.

## Certification

tests/integration/marketplaceTrustReviewsDisputes.test.ts verifies:

- schema without fabricated reviews/disputes;
- reviews blocked without captured payment and buyer-confirmed fulfillment;
- verified store/product review provenance and uniqueness;
- purchased-target enforcement;
- factual rating/trust aggregation with no opaque score;
- seller response tenant isolation;
- review reporting/moderation authority;
- dispute payment gate;
- one active dispute per order;
- seller dispute tenant isolation;
- seller response transition into review;
- internal Trust & Safety note privacy;
- Trust & Safety resolution authority;
- dispute resolution leaves money unchanged;
- dispute resolution leaves stock unchanged;
- dispute resolution leaves account status unchanged;
- dispute counts remain contextual and do not alter review averages.

Initial run #219 identified and rejected a TypeScript seller-response store binding typo before tests/build. The binding was corrected.

Implementation certification run #220 then passed:

- repository hygiene;
- TypeScript typecheck;
- complete automated test suite;
- production build.

A final exact-head certification run is required after documentation/traceability promotion and before merge.

## Next

**Sprint 28 — Marketplace Search Quality, Merchandising & Recommendations**