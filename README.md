# Garage OS

Garage OS is a **Vehicle Ownership, Automotive Service, Mobility Safety and Vehicle Intelligence Operating System**.

The canonical product loop is:

```text
Vehicle
→ understand condition
→ determine need
→ educate owner
→ find provider
→ book / dispatch
→ perform work
→ record verified history
→ improve future intelligence
```

## Current engineering baseline

This repository implements the Garage OS foundation through **Sprint 14** and is undergoing **Phase R1 — Sprint 1–14 Repository Reconciliation & Certification** before Sprint 15 begins.

Implemented domains include:

- platform foundation, configuration, audit, outbox, background jobs and idempotency;
- identity, authentication, organizations and authorization;
- canonical vehicle registry and odometer history;
- Vehicle Timeline and Digital Vehicle Passport;
- maintenance and service intelligence;
- vehicle issues and persistent problems;
- fuel, expenses and total cost of ownership;
- tyres, parts and vehicle components;
- automotive service providers, branches, capabilities and service areas;
- garage operations, inspections, work orders and quality control;
- bookings, capacity, quotes and service authorization;
- roadside assistance and deterministic triage;
- towing, recovery units and chain of custody;
- real-time dispatch, responder presence/location, routing abstraction and tracking.

**Sprint 15 — Emergency Circle & Human Safety Foundation is intentionally not implemented yet.**

## Architecture

The canonical engineering rules are summarized in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Important system laws include:

- canonical Vehicle-first data ownership;
- append-oriented history and superseding corrections;
- explicit provenance and verification;
- server-side authorization;
- truthful safety/dispatch state transitions;
- domain ownership across cross-domain writes;
- transactional outbox and durable background workflows;
- purpose-bound precise location and evidence access.

## Local development

### Requirements

- Bun or Node.js
- a local environment file copied from `.env.example`

### Install and run

```bash
bun install
cp .env.example .env
bun run dev
```

The development/test environments seed deterministic local data. Production does **not** enable synthetic actor headers or development seed authentication.

## Verification

```bash
bun run typecheck
bun run test
bun run build
```

Pull requests and R1 branch pushes run the GitHub Actions certification workflow in:

```text
.github/workflows/certification.yml
```

The certification gate also rejects committed runtime SQLite files.

## Security notes

- Protected API routes require canonical session authentication.
- `X-Actor-Id` / `X-User-Id` impersonation is disabled by default and cannot be used in production.
- Dispatch WebSocket/SSE subscriptions are authorized server-side per topic/resource.
- Evidence downloads require signed access tokens.
- Runtime `*.db`, WAL/SHM files and local object storage are ignored by Git.
- Production requires a strong JWT/file-signing secret and explicit CORS origins.
- Location and dispatch access are scoped to the active customer/provider service context.

## Development integrations

External systems are adapter-backed. Local configuration can use sandbox/mock adapters for payments, messaging, maps and telemetry. A mock adapter is not equivalent to a production integration and must never be represented as a completed external action.

## Repository layout

```text
src/
├── client/       React owner/engineering experience
├── server/
│   ├── api/
│   ├── booking/
│   ├── components/
│   ├── dispatch/
│   ├── finance/
│   ├── identity/
│   ├── issues/
│   ├── maintenance/
│   ├── operations/
│   ├── providers/
│   ├── roadside/
│   ├── timeline/
│   ├── towing/
│   └── vehicle/
└── shared/

tests/
├── contract/
├── integration/
└── unit/
```

## R1 certification

The R1 reconciliation report is maintained in:

```text
docs/R1_SPRINT_1_14_CERTIFICATION.md
```

R1 must be green before development advances to Sprint 15.
