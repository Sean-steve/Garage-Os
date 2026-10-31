# Garage OS

Garage OS is a **Vehicle Ownership, Automotive Service, Mobility Safety and Vehicle Intelligence Operating System**.

The repository implements the canonical Garage OS architecture through **GAR-DEV-S22** and is governed by the GAR-000 technical constitution.

## Current engineering baseline

**Sprint 23 — Vehicle Compatibility & Fitment (GAR-022)**

Implemented domains:

- Platform foundation, migrations, outbox, jobs, storage, observability and audit
- Identity, authentication, organizations, RBAC and resource policy
- Canonical Vehicle domain
- Vehicle Timeline and Digital Vehicle Passport
- Maintenance and service intelligence
- Vehicle issues and persistent problems
- Fuel, expenses and total cost of ownership
- Tyres, parts and vehicle components
- Automotive service-provider network
- Garage operations
- Booking, scheduling and versioned service quotes
- Roadside assistance
- Towing and recovery with chain of custody
- Real-time dispatch, responder location, routing and matching
- Emergency Circle trusted-contact configuration and human-safety policy foundation
- Durable SOS countdown, backend acknowledgement, notification-attempt truth states and safety checks
- Scoped, expiring, revocable no-account trusted-contact portal with minimum-necessary incident projection
- Accident capture, private evidence, towing/repair handoffs and controlled Vehicle Passport accident projection
- Car Care Center guidance, warning/symptom education, owner missions and contextual next-step routing
- Personalized Car Care using owner-configured context and explainable deterministic rules
- Trip Guardian journey preparation, readiness review, check-ins, consented location snapshots and explicit SOS/Roadside handoff
- Contextual product × vehicle fitment, seller-vs-verified evidence, compatibility conflicts, My Car compatible-parts search and installation linkage

The next product sprint is **Sprint 24 — Marketplace Transactions & Orders**.

## Architecture

The application is a TypeScript full-stack application:

- React 19 + Vite frontend
- Express REST API
- SQLite/WAL development persistence with deterministic migrations
- Transactional outbox
- Durable background job engine
- Server-side authorization
- WebSocket/SSE dispatch tracking
- External integrations behind adapters

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/R1_SPRINT_1_TO_14_CERTIFICATION.md](docs/R1_SPRINT_1_TO_14_CERTIFICATION.md), and [docs/SPRINT_15_EMERGENCY_CIRCLE_CERTIFICATION.md](docs/SPRINT_15_EMERGENCY_CIRCLE_CERTIFICATION.md), plus [docs/SPRINT_16_SOS_ENGINE_CERTIFICATION.md](docs/SPRINT_16_SOS_ENGINE_CERTIFICATION.md) and [docs/SPRINT_17_TRUSTED_CONTACT_CERTIFICATION.md](docs/SPRINT_17_TRUSTED_CONTACT_CERTIFICATION.md), plus [docs/SPRINT_18_ACCIDENT_MANAGEMENT_CERTIFICATION.md](docs/SPRINT_18_ACCIDENT_MANAGEMENT_CERTIFICATION.md) and [docs/SPRINT_19_CAR_CARE_CENTER_CERTIFICATION.md](docs/SPRINT_19_CAR_CARE_CENTER_CERTIFICATION.md), plus [docs/SPRINT_20_PERSONALIZED_CAR_CARE_CERTIFICATION.md](docs/SPRINT_20_PERSONALIZED_CAR_CARE_CERTIFICATION.md) and [docs/SPRINT_21_TRIP_GUARDIAN_FOUNDATION_CERTIFICATION.md](docs/SPRINT_21_TRIP_GUARDIAN_FOUNDATION_CERTIFICATION.md), plus [docs/SPRINT_22_MARKETPLACE_FOUNDATION_CERTIFICATION.md](docs/SPRINT_22_MARKETPLACE_FOUNDATION_CERTIFICATION.md) and [docs/SPRINT_23_VEHICLE_COMPATIBILITY_FITMENT_CERTIFICATION.md](docs/SPRINT_23_VEHICLE_COMPATIBILITY_FITMENT_CERTIFICATION.md).

## Local development

Prerequisites:

- Node.js 22+

Install and run:

```bash
npm install
npm run dev
```

The development server uses the configured `PORT` and applies migrations automatically.

### Development seed accounts

Seed data is created only in development/test environments.

Owner:

```text
owner.demo@garageos.test
Password123!
```

Platform administrator:

```text
admin@garageos.test
Password123!
```

These credentials are development fixtures only and must never be used in production.

## Verification

Run:

```bash
npm run typecheck
npm test
npm run build
```

GitHub Actions runs the same certification gate on pull requests and `main`, plus repository-hygiene checks.

## Security baseline

R1 enforces the following:

- Actor identity comes from a canonical authenticated session.
- Development actor headers are disabled by default and require explicit non-production opt-in.
- Admin/operations APIs are role-gated.
- Vehicle and transaction resources are resource-authorized server-side.
- Evidence files require a valid signed token, owner access or platform-admin access.
- Real-time subscriptions authenticate before subscribing and re-check topic authorization.
- Customer/provider live location is scoped to a legitimate active service context.
- SQLite runtime/WAL files and local storage are not committed.

## Production note

The current repository is an engineering/development baseline. Production launch still requires the later Garage OS roadmap phases for production infrastructure, external adapters, security/privacy hardening, resilience, full-system certification and launch readiness.
