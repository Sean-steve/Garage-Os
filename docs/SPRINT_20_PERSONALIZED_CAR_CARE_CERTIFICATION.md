# Sprint 20 — Personalized Car Care

## Status

**GAR-DEV-S20 VERIFIED**

Sprint 20 extends the certified Car Care Center with deterministic, explainable personalization based on recorded vehicle evidence and owner-configured context.

## Core rule

Personalization is guidance, not a new source of vehicle truth.

It may use:

- vehicle model year;
- canonical odometer;
- maintenance due-state;
- active/persistent issue state;
- tyre inspection records;
- fuel-efficiency anomaly observations;
- owner-configured usage context.

It may not:

- infer precise location;
- store GPS/address/city in the care profile;
- use hidden AI inference;
- diagnose faults from environment/profile data;
- change maintenance intervals or due-state;
- replace issue, tyre, fuel, maintenance or inspection authority.

## Owner-configured care profile

The profile supports:

- usage pattern;
- annual distance band;
- road exposure;
- parking context;
- environmental exposure;
- long-trip frequency;
- heavy-load frequency.

Every profile is:

- `OWNER_CONFIGURED`;
- versioned;
- resource-authorized;
- audited;
- emitted through the transactional outbox.

The profile schema deliberately contains no latitude, longitude, GPS, address, city or coordinate fields.

## Deterministic rule engine

Rule version:

```text
GAR020-S20-RULES-1
```

Implemented rule families include:

- vehicle-age review;
- high-odometer review;
- rough/mixed-road owner checks;
- dust-exposure review;
- hot-condition awareness;
- heavy-rain readiness;
- coastal/salt exposure awareness;
- exposed-outdoor parking checks;
- long-distance preparation;
- frequent-load care;
- recorded poor/critical tyre condition surfacing;
- recorded fuel-efficiency anomaly surfacing.

Each recommendation includes:

- rule ID;
- priority;
- explanation;
- structured evidence;
- actions;
- `is_diagnosis: false`;
- `changes_maintenance_schedule: false`;
- rule version.

## Vehicle evidence boundaries

### Maintenance

Sprint 20 reads the canonical Maintenance Service.

Personalization does not write:

- due date;
- due distance;
- maintenance cycle status;
- maintenance completion.

### Issues

Critical issue records retain priority over routine personalization.

Car Care does not transform a profile/environment signal into an Issue diagnosis.

### Tyres

Personalization may surface an existing tyre inspection status such as `POOR` or `CRITICAL`.

It does not predict remaining tyre life or invent a failure mode.

### Fuel

A canonical fuel-efficiency anomaly may be surfaced.

The UI/service always states that the anomaly is an **observation, not a diagnosis** of an engine, tyre or fuel-system fault.

## Location and AI privacy boundary

Every generated plan reports:

```json
{
  "location_inference_used": false,
  "ai_inference_used": false
}
```

The profile API rejects precise-location keys such as:

- location;
- latitude;
- longitude;
- GPS;
- coordinates;
- address;
- city.

Environmental context is explicitly selected by the owner as broad exposure categories.

## Derived evaluation snapshots

Users may explicitly refresh/evaluate the personalized care plan.

The derived evaluation stores:

- rule version;
- input fingerprint;
- recommendation count;
- recommendations;
- evidence summary;
- generation timestamp.

Evaluation provenance is:

```text
DERIVED_DETERMINISTIC
```

These records are rebuildable analytical artifacts and are not canonical vehicle truth.

## APIs

```text
GET   /api/v1/vehicles/:id/car-care/profile
PATCH /api/v1/vehicles/:id/car-care/profile
GET   /api/v1/vehicles/:id/car-care/personalized
POST  /api/v1/vehicles/:id/car-care/personalized/evaluate
GET   /api/v1/vehicles/:id/car-care/personalized/evaluations
```

Sprint 19 Car Care APIs remain unchanged.

## Persistence

Migration `021_personalized_car_care` adds:

- `vehicle_care_profiles`;
- `car_care_personalization_evaluations`.

## UI

The Car Care workspace now includes:

- Personalized for this vehicle;
- care profile configuration;
- explicit no-location-inference notice;
- recommendation priority;
- evidence behind each recommendation;
- rule ID;
- diagnosis = NO;
- maintenance schedule changed = NO;
- contextual next-step actions;
- explicit refresh of the evidence-based plan.

## Certification tests

Sprint 20 tests verify:

- profile/evaluation schema exists;
- no precise-location profile columns;
- unconfigured-profile behavior is transparent;
- `location_inference_used=false`;
- `ai_inference_used=false`;
- profile versioning;
- audit and outbox events;
- invalid profile/exposure values rejected;
- deterministic profile-specific recommendations;
- recommendations include evidence;
- recommendations do not diagnose;
- recommendations do not mutate maintenance schedules;
- fuel anomaly remains an observation;
- critical Issue authority remains separate;
- deterministic evaluation fingerprinting;
- evaluation history authorization;
- cross-user vehicle access denial.

## Implementation-head certification

Green implementation head:

- GitHub Actions run: **41193410877**
- Head: `bea8440bae4fcf61e5eba73e420ffa9a1b49a9f6`
- Repository hygiene: **PASS**
- TypeScript typecheck: **PASS**
- Full test suite: **PASS**
- Production build: **PASS**
- Workflow URL: https://github.com/Sean-steve/Garage-Os/actions/runs/41193410877

The final documentation/traceability head must independently pass the same certification gate before merge.

## Sprint 21 readiness

Sprint 21 may begin only after:

- PR #8 passes final exact-head certification;
- PR #8 is merged into `main`;
- merged `main` passes certification.

**Next:** Sprint 21 — Pre-Trip & Trip Guardian Foundation (GAR-019).
