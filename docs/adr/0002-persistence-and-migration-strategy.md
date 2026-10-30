# ADR 0002: Persistence & Migration Strategy

## Status
Accepted (Sprint 1 Baseline)

## Context
GAR-033 mandates strict relational integrity, immutable globally unique identifiers, auditable timestamps, and deterministic schema migrations. The runtime container environment requires local, high-speed, and test-isolated persistence that also complies with forward-safe production evolution.

## Decision
1. Implemented Node 22 native SQLite (`node:sqlite DatabaseSync`) with Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) and enforced foreign keys (`PRAGMA foreign_keys = ON;`).
2. Created a deterministic migration framework with checksum verification, batch tracking, and reversible rollback capabilities.
3. Abstracted connections so that in-memory test databases (`:memory:`) can execute full integration suites in sub-second time without shared state contamination.

## Consequences
- ACID transactions are guaranteed.
- Zero external database installation is required for container preview and testing.
- Schema definitions adhere strictly to GAR-033 canonical schema families and can be ported directly to Cloud SQL PostgreSQL if relational multi-region clustering is provisioned in future phases.
