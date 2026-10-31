# Sprint 19 — Car Care Center

## Status

**GAR-DEV-S19 VERIFIED**

Sprint 19 establishes the Garage OS Car Care Center as the owner-guidance and education layer over the certified vehicle, maintenance, issue, roadside, booking and provider domains.

## Core architectural rule

Car Care does **not** own vehicle-health truth.

It may:

- explain warning lights and owner-observed symptoms;
- surface authoritative maintenance due-state;
- surface authoritative active/persistent issue state;
- provide owner-safe checklists;
- route the owner into Maintenance, Issues, Roadside, Providers and Bookings.

It may **not**:

- diagnose a failed component from a warning light/noise alone;
- rewrite maintenance state;
- rewrite vehicle issue state;
- certify roadworthiness;
- certify professional inspection;
- create Passport history merely because an owner completed a checklist.

## Implemented capabilities

- curated Car Care education catalog;
- warning-light explainers;
- symptom explainers;
- long-trip preparation guidance;
- explicit source labels and content versions;
- structured risk level:
  - `INFO`
  - `CAUTION`
  - `URGENT`
- deterministic Car Care dashboard;
- maintenance-derived guidance;
- issue-derived guidance;
- explicit `is_diagnosis: false` on guidance cards;
- contextual next-step actions;
- owner care mission templates;
- weekly owner check;
- pre-trip check;
- long-trip preparation;
- structured item progress;
- concern reporting state;
- professional-help-required state;
- owner checklist completion truth statement;
- audit and transactional outbox events;
- dedicated owner Car Care UI.

## Guidance truth model

Dashboard guidance is derived from authoritative domain state.

### Maintenance

Car Care reads the canonical Maintenance Service due-state:

- `OVERDUE`
- `DUE`
- `APPROACHING_DUE`

Car Care does not calculate a second due-state.

### Vehicle issues

Car Care reads active issue records and the canonical issue next-action projection.

If a critical issue already has:

```text
STOP_DRIVING_SAFETY_WARNING
```

Car Care surfaces that authoritative state and offers direct navigation to the Issue and Roadside workflows.

It does not generate a new diagnosis.

## Owner missions

Mission states:

```text
ACTIVE
COMPLETED
CANCELLED
```

Mission item states:

```text
PENDING
COMPLETED
CONCERN_REPORTED
SKIPPED
PROFESSIONAL_HELP_REQUIRED
```

Check levels:

```text
OWNER_SAFE_CHECK
PROFESSIONAL_INSPECTION_ONLY
```

An owner cannot mark a `PROFESSIONAL_INSPECTION_ONLY` item as professionally completed.

They may only leave it pending, skip it where appropriate, or record that professional help is required.

## Mission completion statement

Every mission returns:

> Owner checklist completed. This does not certify the vehicle as safe, roadworthy, defect-free, or professionally inspected.

The `car_care.mission.completed` event also records:

```json
{
  "professional_inspection_certified": false
}
```

## Passport boundary

Car Care mission completion does not automatically create:

- Vehicle Timeline entries;
- Digital Vehicle Passport entries;
- maintenance completions;
- issue resolutions;
- inspection records.

If a real service, inspection, repair or maintenance event occurs, its owning domain remains responsible for canonical persistence and Passport projection.

## APIs

```text
GET  /api/v1/car-care/articles
GET  /api/v1/car-care/articles/:slug
GET  /api/v1/vehicles/:id/car-care/dashboard
GET  /api/v1/vehicles/:id/car-care/missions
POST /api/v1/vehicles/:id/car-care/missions
GET  /api/v1/vehicles/:id/car-care/missions/:missionId
POST /api/v1/vehicles/:id/car-care/missions/:missionId/items/:itemId/progress
```

## Persistence

Migration `020_car_care_center` adds:

- `car_care_articles`;
- `car_care_mission_templates`;
- `car_care_mission_items`;
- `vehicle_care_missions`;
- `vehicle_care_mission_item_progress`.

The migration also seeds curated Car Care content and baseline mission templates.

## Initial curated explainers

Sprint 19 includes:

- check-engine light;
- oil-pressure warning;
- engine-temperature / overheating warning;
- brake warning;
- battery / charging warning;
- tyre-pressure warning;
- grinding-noise guidance;
- long-trip preparation.

These explain observations and appropriate next actions without claiming a diagnosis.

## Contextual routing

Car Care can route the owner to:

- Maintenance;
- Issues;
- Roadside;
- Providers;
- Bookings.

Routing does not mutate the destination domain.

## Authorization

Car Care dashboard and mission APIs remain behind canonical authentication and vehicle-resource authorization.

A user who cannot access a vehicle cannot access or start Car Care missions for it.

## Certification evidence

Initial green implementation-head certification:

- GitHub Actions run: **41188518916**
- Head: `2bc5db1085adfc6918857a99a6062b1f88ddaa37`
- Repository hygiene: **PASS**
- TypeScript typecheck: **PASS**
- Full test suite: **PASS**
- Production build: **PASS**
- Workflow URL: https://github.com/Sean-steve/Garage-Os/actions/runs/41188518916

The acceptance suite verifies:

- curated content schema and seed data;
- warning-light content remains explicitly non-diagnostic;
- critical issue state is surfaced rather than re-diagnosed;
- Car Care does not fabricate maintenance urgency;
- only one active mission per template;
- professional-only items cannot be self-certified by the owner;
- mission completion never claims professional inspection;
- completed missions are immutable;
- cross-user vehicle access is denied;
- mission completion does not create Passport/Timeline history.

The final documentation/traceability head must independently pass the same certification workflow before merge.

## Sprint 20 readiness

Sprint 20 may begin only after:

- PR #7 passes final exact-head certification;
- PR #7 is merged to `main`;
- merged `main` passes the certification workflow.

**Next:** Sprint 20 — Personalized Car Care (GAR-020).
