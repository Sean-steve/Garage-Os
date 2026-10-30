# Garage OS Architecture Documentation

## Canonical System Definition
Garage OS is a **Vehicle Ownership, Automotive Service, Mobility Safety, and Vehicle Intelligence Operating System**.
The platform is governed by the **GAR-000 Technical Constitution**, joining owner records, vehicle health, maintenance, service providers, roadside/towing, emergency contacts, automotive commerce, telemetry, AI assistance, fleet operations, and a controlled Digital Vehicle Passport.

---

## 1. Enterprise System Topology (GAR-002)

Garage OS implements a strict layered architecture:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           Interface Layer                               │
│  • React 19 Frontend Shell (Owner / Provider / Admin / Trusted Contact) │
│  • REST API Controllers (/api/v1/*, /health/*, /metrics)                │
│  • Transactional Outbox Worker & Background Job Processor               │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                          Application Layer                              │
│  • Commands, Queries & Orchestration Services                           │
│  • Transaction Boundaries (Unit of Work)                                │
│  • Server-Side Authorization & Actor Context                            │
│  • Idempotency Middleware & Rate Limiting                               │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                            Domain Layer                                 │
│  • Canonical Entities & Aggregates (Vehicle, User, Booking, etc.)       │
│  • Data Truth Hierarchy (Provenance Law: 6 Trust Classes)               │
│  • Safety Truth Law (4-State Acknowledged Workflows)                    │
│  • Domain Invariants & State Machine Transition Rules                   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                        Infrastructure Layer                             │
│  • Persistence Engine (node:sqlite WAL mode / ACID transactions)        │
│  • Transactional Outbox Store (outbox_events table)                     │
│  • Background Job Engine (job_instances, leases, dead_letter_jobs)      │
│  • Object Storage Abstraction (MIME validation, signed access tokens)   │
│  • Structured Logger & Prometheus-compatible Metrics Collector          │
│  • Integration Adapters (Payments, Messaging, Maps, Telemetry Gateways) │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Constitutional Architecture Laws (GAR-000 §2)

1. **Vehicle-First Law**: Business features reference a canonical Vehicle aggregate. No feature invents a parallel vehicle identity model.
2. **History Law**: Service, repair, issue, accident, part, and evidence history is append-oriented. Corrections supersede; they never destructively overwrite history.
3. **Provenance Law**: All records distinguish 6 canonical trust classes:
   - `EXTERNALLY_VERIFIED`
   - `PROVIDER_RECORDED`
   - `DEVICE_OBSERVED`
   - `DERIVED_DETERMINISTIC`
   - `OWNER_ASSERTED`
   - `AI_MODEL_INFERRED`
4. **Authorization Law**: Possession of an identifier or URL never grants access; every protected read/write is authorized server-side.
5. **Safety Truth Law**: The platform never represents an emergency, provider dispatch, notification, or payment as completed merely because a client attempted it. Workflows distinguish:
   `LOCAL_ACTION` → `SERVER_ACKNOWLEDGED` → `EXTERNAL_DELIVERY_OR_ACCEPTANCE` → `FINAL_COMPLETION`.
6. **No Fabricated Certainty Law**: Health, DTC, AI, and predictive outputs must expose confidence, uncertainty, and freshness.
7. **Domain Ownership Law**: Only the owning domain mutates canonical state; cross-domain mutation uses contracts and events.
8. **External Isolation Law**: External APIs (Maps, Payments, SMS, OBD) sit behind integration adapters.
9. **Audit Law**: Privileged, financial, safety, trust, and material history changes are immutably audited.
10. **Privacy Minimization Law**: Precise location, emergency data, and personal data are purpose-bound and minimized.
11. **Resilience Law**: Retryable workflows are durable and idempotent.
12. **Completion Law**: A feature requires schema, API, authorization, failure handling, tests, and operations before production release.

---

## 3. Directory & Package Structure

```text
src/
├── server/
│   ├── config/          # Typed env validation with fail-fast guarantees
│   ├── domain/          # Canonical IDs, time normalization, domain invariants
│   ├── database/        # SQLite connection, transaction unit of work, migrations
│   ├── events/          # Event envelopes, EventBus, Transactional Outbox worker
│   ├── jobs/            # Job engine, leases, exponential backoff, dead letters
│   ├── storage/         # Object storage driver, MIME filter, signed access tokens
│   ├── observability/   # Structured logger, metrics collector, health probes
│   ├── security/        # Security headers, rate limiting, correlation ID, audit
│   ├── featureFlags/    # Staged rollouts, percentage & role filtering
│   ├── api/             # Standard envelopes, error handler, API v1 routes
│   └── seed/            # Deterministic development/test seed
├── shared/              # Shared contracts, enums, errors, and traceability matrix
├── client/              # React 19 Frontend Shell & GAR-042 Design System
└── tests/               # Unit, integration, and contract test suites
```
