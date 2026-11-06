# Marketplace Roadmap Reconciliation — Sprint 32 Onward

## Status

**CANONICAL ROADMAP — reconciled after certified Sprint 31**

This roadmap begins from the verified Marketplace baseline through Sprints 22–31. It finishes the marketplace without duplicating already-certified fitment, checkout, payment, fulfillment, trust, search, engagement, analytics or seller-intelligence authority.

## Reconciliation findings

Material gaps remaining after Sprint 31:

1. Seller payouts are not implemented; Sprint 25 stops at receivable truth.
2. External marketplace messaging remains unavailable; Sprint 29 records preferences only.
3. Carrier integration is not real; fulfillment is canonical but carrier state is not provider-backed.
4. Promotions/coupons and pricing governance are not implemented.
5. Seller catalog/inventory operations are not yet built for production scale.
6. Services, installation and modification commerce remain outside the physical-goods marketplace.
7. Marketplace support/case operations need a governed layer above returns/disputes.
8. Production tax, receipts, invoicing and fiscal-provider integration are missing.
9. Production adapters, hardening, full certification and controlled launch remain outstanding.

---

# Sprint 32 — Seller Payouts, Balances & Financial Operations

**Implementation status: COMPLETE & VERIFIED**

## Objective
Complete the financial lifecycle from provider-confirmed buyer payment to provider-confirmed seller payout without treating receivable as payout.

## Scope
- seller payout-account registration through provider references/tokens;
- seller balance projection from authoritative settlement-ledger facts;
- pending, available, reserved and paid balance states;
- payout requests and batches;
- payout provider adapter contract;
- signed/verified payout events;
- REQUESTED, PROCESSING, SUCCEEDED, FAILED and provider-supported REVERSED states;
- payout reconciliation;
- seller payout history;
- finance/admin payout operations;
- reserve/minimum-payout policies;
- no raw bank/mobile-money secrets in marketplace tables.

## Truth boundaries
- net seller receivable is not payout;
- only verified provider evidence confirms payout;
- clients cannot self-mark payout success;
- refunds remain settlement adjustments;
- currencies stay separate;
- no fake payout provider.

## Exit gate
Seller money is traceable from capture/refund ledger entries through an externally verifiable payout lifecycle.

---

# Sprint 33 — Buyer–Seller Messaging, Notifications & Seller CRM Foundation

## Objective
Add governed transactional communication and consent-aware seller relationship tooling without hidden behavioral profiling or spam.

## Scope
- in-app buyer–seller conversations;
- listing inquiries;
- order/return/dispute-linked conversations;
- transactional notification templates;
- seller messaging permissions and tenant isolation;
- buyer communication preferences and opt-out;
- email/SMS/push adapter interfaces;
- attempted, accepted, delivered, failed and bounced external delivery truth where supported;
- quiet hours for non-urgent commercial messages;
- transactional vs promotional message classification;
- seller CRM summaries from legitimate transaction relationships.

## Truth boundaries
- requested channel != sent != delivered;
- seller cannot infer consent;
- external delivery requires real provider evidence;
- no hidden browsing/search profile;
- no automatic mass outreach from Sprint 31 opportunities;
- no opaque customer score.

---

# Sprint 34 — Promotions, Coupons & Pricing Governance

## Objective
Support seller-controlled promotions without corrupting canonical price history, organic ranking or buyer trust.

## Scope
- coupon codes;
- listing/category/store promotions;
- fixed/percentage discounts;
- validity windows and usage limits;
- per-buyer limits and minimum basket rules;
- deterministic eligibility and checkout discount calculation;
- immutable order discount snapshots;
- promotion audit history;
- seller and platform promotion governance;
- explicit promotional labeling.

## Truth boundaries
- promotions never alter organic ranking;
- no hidden paid placement;
- no fabricated scarcity/countdowns;
- no discriminatory personalized pricing;
- no silent price rewrite after checkout.

---

# Sprint 35 — Carrier Integrations, Shipment Tracking & Delivery Operations

## Objective
Add provider-backed commercial delivery operations while preserving seller, carrier and buyer truth separately.

## Scope
- carrier registry and adapter contract;
- shipment creation/service selection;
- labels/tracking references where supported;
- signed carrier webhooks;
- tracking events and delivery exceptions;
- failed-delivery/return-to-sender states;
- seller shipment dashboard;
- buyer tracking;
- carrier reconciliation and SLA facts.

## Truth boundaries
- seller dispatch != carrier acceptance;
- carrier delivered != buyer-confirmed receipt;
- carrier events cannot mutate payment/refund truth;
- roadside/towing dispatch remains separate from marketplace delivery.

---

# Sprint 36 — Seller Operations, Catalog Scale & Inventory Control

## Objective
Make the seller workspace operational at real catalog and order volume.

## Scope
- bulk product/listing import and validation;
- bulk listing updates/publish/pause;
- stock adjustments with reason codes;
- stock movement history;
- multi-location inventory foundation where justified;
- low/out-of-stock queues;
- SKU/catalog quality checks;
- canonical organization-based seller staff roles;
- batch order operations preserving per-order authorization;
- inventory reconciliation and exports.

## Truth boundaries
- bulk operations cannot bypass fitment, price, inventory or tenancy;
- stock changes require provenance;
- reservations/commitments stay authoritative;
- no shadow seller identity system.

---

# Sprint 37 — Services, Installation & Modification Marketplace

## Objective
Complete the original marketplace vision beyond physical goods using existing Garage OS provider and booking domains.

## Scope
- service/modification marketplace offerings;
- installation-eligible product links;
- provider/service discovery;
- vehicle-aware service compatibility;
- parts + installation packages;
- quote/request handoff to canonical booking/quote;
- scheduling integration;
- service order linkage;
- installation completion evidence;
- provider reviews tied to completed service;
- governed modification projection to Vehicle Passport.

## Truth boundaries
- product fitment does not guarantee installation success;
- quote != accepted booking != completed service;
- seller claim != provider verification;
- no duplicate service-booking authority.

---

# Sprint 38 — Marketplace Support, Claims & Case Operations

## Objective
Create a unified support case layer without replacing returns, disputes or financial authority.

## Scope
- buyer/seller support cases;
- linked order/payment/fulfillment/return/dispute context;
- case timeline, SLA, escalation and assignment;
- internal-only notes;
- evidence attachments;
- fraud/abuse and account-action referral;
- finance/return/dispute routing;
- support analytics.

## Truth boundaries
- support case != dispute outcome;
- support cannot fabricate payment/refund success;
- support cannot restore inventory without return authority;
- support cannot mark buyer receipt;
- sanctions require separate governed authority.

---

# Sprint 39 — Marketplace Tax, Receipts, Invoicing & Commerce Compliance

## Objective
Add production-grade fiscal documents and configurable fiscal-provider integration.

## Scope
- seller tax profile/configuration;
- tax-inclusive/exclusive price configuration;
- immutable order tax snapshots;
- receipts/invoices;
- refund/credit-note linkage;
- fiscal numbering rules;
- accounting export;
- tax-provider adapter boundary;
- jurisdiction configuration;
- Kenya eTIMS adapter path where activated and applicable;
- audit and reconciliation.

## Truth boundaries
- jurisdiction/tax rules are configurable;
- generated invoice != tax-authority acceptance;
- external fiscal states distinguish submitted/accepted/rejected/unavailable;
- fiscal records remain linked to immutable commercial facts.

---

# Sprint 40 — Marketplace External Adapter Activation & Production Integration

## Objective
Activate production-capable providers behind Garage OS adapter boundaries.

## Scope
- live payment provider;
- live payout provider;
- live email/SMS/push;
- live carrier;
- fiscal adapter where required;
- production secrets/configuration;
- webhook secret rotation;
- provider health checks;
- retries/circuit breakers/idempotency;
- dead-letter/replay tooling;
- reconciliation dashboards;
- sandbox/live separation.

## Truth boundaries
- external actions retain attempted/acknowledged/final states;
- no provider simulation in production;
- secrets remain outside marketplace domain data;
- adapters cannot bypass canonical authorization.

---

# Sprint 41 — Marketplace Security, Privacy, Abuse Prevention & Resilience Hardening

## Objective
Harden the completed marketplace before release.

## Scope
- threat model and tenant-isolation audit;
- webhook/payment/payout abuse hardening;
- spam and promotion abuse controls;
- inventory race testing;
- account takeover protections;
- rate limits;
- data minimization and retention/deletion controls;
- audit integrity;
- dependency/security scanning;
- backup/recovery;
- queue/outbox resilience;
- provider outage behavior;
- load/performance/accessibility hardening;
- operational runbooks.

## Truth boundaries
- no opaque buyer/seller risk score as sole sanction authority;
- resilience never fabricates external success.

---

# Sprint 42 — Full Marketplace End-to-End Certification & Launch Readiness

## Objective
Certify the marketplace as one coherent production system.

## Golden journeys
1. seller onboarding → product → fitment → listing → discovery;
2. buyer search → vehicle-aware decision → cart → checkout;
3. payment capture → inventory commitment → fulfillment;
4. carrier delivery → buyer receipt;
5. return → physical receipt → restock decision → provider refund;
6. verified review;
7. dispute/support escalation;
8. settlement → seller payout;
9. saved intent → alert → governed communication;
10. promotion → discounted checkout → immutable snapshot;
11. parts + installation/service;
12. fiscal receipt/invoice;
13. provider outage/retry/reconciliation;
14. cross-tenant authorization denial;
15. privacy/export/deletion obligations where applicable.

## Certification gates
- full automated regression;
- security/red-team validation;
- financial/inventory reconciliation;
- real external-adapter evidence;
- accessibility/performance/load;
- backup/restore and disaster recovery;
- observability/alerting;
- production configuration audit;
- rollback procedure;
- zero launch-critical unresolved defects.

---

# Sprint 43 — Controlled Marketplace Rollout & Post-Launch Operations

## Objective
Launch safely with limited exposure before general availability.

## Scope
- controlled seller/buyer cohorts;
- feature flags;
- live transaction/payout/provider monitoring;
- support runbooks and incident management;
- kill switches/rollback;
- reconciliation cadence;
- authoritative launch metrics;
- post-launch defect triage;
- launch review and general-availability gate.

---

# Canonical sequence

| Sprint | Canonical title | Primary closure |
|---|---|---|
| 32 | Seller Payouts, Balances & Financial Operations | Financial lifecycle |
| 33 | Buyer–Seller Messaging, Notifications & Seller CRM Foundation | Communication |
| 34 | Promotions, Coupons & Pricing Governance | Commercial promotion |
| 35 | Carrier Integrations, Shipment Tracking & Delivery Operations | Delivery integration |
| 36 | Seller Operations, Catalog Scale & Inventory Control | Seller scale |
| 37 | Services, Installation & Modification Marketplace | Original marketplace scope completion |
| 38 | Marketplace Support, Claims & Case Operations | Operational support |
| 39 | Marketplace Tax, Receipts, Invoicing & Commerce Compliance | Fiscal/compliance |
| 40 | Marketplace External Adapter Activation & Production Integration | Real external systems |
| 41 | Marketplace Security, Privacy, Abuse Prevention & Resilience Hardening | Production hardening |
| 42 | Full Marketplace End-to-End Certification & Launch Readiness | Release certification |
| 43 | Controlled Marketplace Rollout & Post-Launch Operations | Controlled launch |

## Immediate next execution

**Sprint 32 — Seller Payouts, Balances & Financial Operations**

This comes before CRM/growth automation because Sprint 25 deliberately stops at seller receivable. Closing the payout lifecycle is more fundamental to a functioning marketplace.