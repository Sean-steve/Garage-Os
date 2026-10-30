# ADR 0001: Repository & Layered Architecture

## Status
Accepted (Sprint 1 Baseline)

## Context
Garage OS encompasses multiple business domains across vehicle ownership, service provider operations, emergency response, commerce, and telemetry. To prevent spaghetti code, coupled schemas, and UI logic pollution, an explicit layered architectural standard is required by GAR-000 and GAR-002.

## Decision
We established a strict 4-tier separation:
1. **Domain Layer**: Independent of UI and external infrastructure. Encapsulates canonical entities, invariants, state machines, and data truth hierarchy.
2. **Application Layer**: Use cases, command execution, and unit-of-work transaction boundaries.
3. **Infrastructure Layer**: Concrete persistence engines, event dispatchers, background workers, and external adapters.
4. **Interface Layer**: HTTP endpoints, API envelopes, and frontend client views.

## Consequences
- Business rules are testable in complete isolation from HTTP frameworks or database engines.
- Domain models cannot be mutated across boundaries without public contracts or domain events.
- Foundation directly accommodates upcoming domains in Sprint 2 through Sprint 54 without architectural rewrites.
