# Sprint 33 — Buyer–Seller Messaging, Notifications & Seller CRM Foundation

## Status

**GAR-DEV-S33 VERIFIED — implementation certification**

Sprint 33 adds governed transactional communication and consent-aware seller relationship tooling without hidden behavioral profiling, inferred consent or fabricated external-delivery truth.

## Implemented scope

### Context-bound buyer–seller conversations

Marketplace conversations are durable and explicitly bound to one commercial context:

- published listing inquiry;
- order;
- return;
- dispute.

The conversation stores the authoritative buyer and seller store relationship. Seller access is evaluated against the store organization, so another seller tenant cannot read or send into the thread.

Dispute-domain messages remain separate. Sprint 33 links a general conversation to a dispute but does not replace the Sprint 27 dispute timeline or internal trust-and-safety notes.

### Messaging and classification

Each message records the conversation, sender user, sender role (BUYER or SELLER), explicit classification (TRANSACTIONAL or PROMOTIONAL), body and creation time.

Buyer messages cannot be relabeled as seller promotion.

Seller promotional messaging requires a legitimate transaction relationship rather than a listing inquiry alone, explicit buyer promotional in-app opt-in, and a time outside configured promotional quiet hours.

There is deliberately no seller mass-outreach endpoint and no automatic messaging action from Sprint 31 opportunity signals.

### Communication preferences

Buyer communication preferences distinguish requested transactional email/SMS/push, promotional in-app/email/SMS/push opt-in, quiet hours and IANA timezone.

A requested channel is consent/configuration. It is not evidence that an outbound notification was attempted, accepted or delivered.

### In-app notifications

Messages create durable recipient-scoped in-app notifications. Seller notifications target a seller store; buyer notifications target a buyer user.

Recipients may mark their own notifications read or dismissed. Cross-tenant notification access is denied.

### External notification adapter foundation

Sprint 33 defines the email/SMS/push adapter contract and registry.

No live external adapter is fabricated or seeded. Concrete live provider activation remains **Sprint 40 — Marketplace External Adapter Activation & Production Integration**.

The external-delivery model separates ATTEMPTED, ACCEPTED, DELIVERED, FAILED and BOUNCED.

No delivery row is created when a requested channel has no configured adapter.

Provider final-state events must be verified by the registered adapter before they can create delivery-event evidence or change a delivery into DELIVERED, FAILED or BOUNCED. Invalid signatures are rejected before provider event IDs are consumed.

Recipient email addresses, phone numbers and push tokens are passed only to adapter execution and are not stored in marketplace external-delivery tables.

### Seller CRM foundation

The seller CRM projection uses legitimate marketplace order and direct-conversation facts only.

Per buyer relationship it exposes buyer user ID, first/last order timestamps, order count, ordered value by currency, open conversation count and most recent message time.

It deliberately does **not** expose buyer email, buyer phone, browsing history, search history, saved-intent identities, hidden behavioral profiles or opaque customer scores.

Ordered value is labeled as commercial order value, not payment, settlement or revenue truth.

## Migration

032_marketplace_messaging_notifications_crm adds:

- marketplace_conversations;
- marketplace_messages;
- marketplace_communication_preferences;
- marketplace_notification_templates;
- marketplace_notifications;
- marketplace_external_deliveries;
- marketplace_external_delivery_events.

The seeded notification template is configuration only. No provider, provider message, external attempt or delivery success is seeded.

## API surface

Buyer communication:

- GET /api/v1/marketplace/communications/adapters
- GET /api/v1/marketplace/communications/preferences
- PATCH /api/v1/marketplace/communications/preferences
- GET /api/v1/marketplace/communications/conversations
- POST /api/v1/marketplace/communications/conversations
- GET /api/v1/marketplace/communications/conversations/:conversationId
- PATCH /api/v1/marketplace/communications/conversations/:conversationId
- POST /api/v1/marketplace/communications/conversations/:conversationId/messages
- GET /api/v1/marketplace/communications/notifications
- PATCH /api/v1/marketplace/communications/notifications/:notificationId

Seller communication and CRM:

- GET /api/v1/marketplace/seller/stores/:storeId/communications/conversations
- GET /api/v1/marketplace/seller/stores/:storeId/communications/notifications
- PATCH /api/v1/marketplace/seller/stores/:storeId/communications/notifications/:notificationId
- GET /api/v1/marketplace/seller/stores/:storeId/crm

External adapter dispatch and verified provider-event processing are internal service boundaries in Sprint 33. Public provider webhooks remain part of live adapter activation in Sprint 40.

## Certification coverage

tests/integration/marketplaceBuyerSellerMessagingNotificationsCrm.test.ts verifies normalized schema, conversation contexts, tenant isolation, durable notifications, default-deny promotional messaging, explicit opt-in, quiet hours, CRM privacy, adapter absence, acceptance-versus-delivery truth, provider signature verification and event idempotency.

## Truth boundaries certified

- requested channel **!=** attempted;
- attempted **!=** accepted;
- accepted **!=** delivered;
- seller cannot infer consent;
- promotional outreach requires explicit opt-in;
- external final delivery requires provider evidence;
- CRM order totals are not payment or revenue truth;
- saved/search/browsing behavior is not converted into a hidden customer profile;
- no automatic mass outreach is created from seller intelligence.

## Exit gate

**PASSED for the Sprint 33 implementation boundary.**

Buyer and seller can communicate in a governed marketplace context, in-app notifications are durable, promotional consent is explicit, seller CRM is relationship-grounded and privacy-safe, and external provider delivery truth has a non-fabricated adapter boundary ready for later production activation.

## Next execution

**Sprint 34 — Promotions, Coupons & Pricing Governance**
