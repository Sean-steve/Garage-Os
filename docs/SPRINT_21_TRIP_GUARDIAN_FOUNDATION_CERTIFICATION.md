# Sprint 21 — Pre-Trip & Trip Guardian Foundation

## Status

**GAR-DEV-S21 VERIFIED**

Sprint 21 establishes the Garage OS Trip Guardian foundation on top of certified Car Care, Maintenance, Issues, Emergency Circle and SOS domains.

## Core architectural rule

Trip Guardian owns:

- journey state;
- journey-specific sharing consent;
- check-in scheduling/state;
- temporary journey-location snapshots;
- explicit links to safety escalation.

Trip Guardian does **not** own:

- vehicle maintenance truth;
- vehicle issue truth;
- SOS truth;
- Roadside dispatch truth;
- trusted-contact delivery truth;
- route navigation or route ETA;
- crash detection;
- injury inference.

## Journey lifecycle

```text
PREPARED
  → IN_PROGRESS
  → ARRIVED

PREPARED / IN_PROGRESS
  → CANCELLED
```

Only one open journey may exist per owner/vehicle.

Journey status is not a safety certification.

## Pre-trip integration

Creating a journey starts or reuses the canonical Car Care:

```text
PRE_TRIP_CHECK
```

mission.

Trip Guardian stores the mission ID and reads its authoritative progress.

If a journey is abandoned or ends with an incomplete checklist, cancellation occurs through the Car Care service rather than direct table mutation.

## Readiness projection

Readiness is deliberately separate from journey lifecycle.

States:

```text
CANONICAL_STOP_DRIVING
ATTENTION_RECORDED
CHECKLIST_INCOMPLETE
REVIEWED
```

`REVIEWED` means the recorded pre-trip review is complete.

It does **not** mean:

- vehicle certified safe;
- route certified safe;
- driver certified fit;
- weather certified safe;
- journey guaranteed safe.

A canonical Issue next action of:

```text
STOP_DRIVING_SAFETY_WARNING
```

blocks journey start.

Other recorded warnings/incomplete checks require explicit owner acknowledgement before start.

## Check-ins

Trip check-ins are durable records.

States:

```text
PENDING
RESPONDED
MISSED
CANCELLED
```

Responses:

```text
OKAY
DELAYED
NEED_HELP
```

A check-in is scheduled, then a worker may mark the prompt due.

After the grace period, an unanswered check-in becomes `MISSED`.

A missed check-in means only:

> No response was received.

It does **not** infer:

- crash;
- injury;
- unconsciousness;
- emergency;
- SOS activation.

`NEED_HELP` is also a recorded owner response and does not automatically activate SOS.

## Emergency Circle journey context

The owner may select active Emergency Circle contacts for journey context.

Sprint 21 stores only the configured relationship and sharing scope.

It does not claim that a contact was:

- notified;
- reached;
- delivered a message;
- acknowledged the journey.

Normal-journey trusted-contact notifications remain unimplemented in this foundation sprint.

## Location privacy

Trip Guardian location is opt-in twice:

1. the user's global Safety preference must allow location sharing;
2. the specific journey must enable location sharing.

Location snapshots are:

- one-time snapshots;
- not continuous tracking;
- purpose-bound to Trip Guardian;
- retained for a maximum of 24 hours;
- revoked immediately when a journey arrives or is cancelled.

Exact coordinates are not written into:

- outbox event payloads;
- audit metadata;
- logs/metrics by the Trip Guardian implementation.

Sprint 21 explicitly reports:

```text
live_tracking_active = false
```

## SOS handoff

SOS activation is an explicit owner action.

Trip Guardian calls the existing SOS service and records only the resulting SOS reference.

If the journey has a current, consented location snapshot, that snapshot may be passed into the explicit SOS activation request.

Truth remains separated:

- backend acknowledgement;
- trusted-contact delivery;
- assistance requested;
- assistance accepted;
- assistance arrived.

Trip Guardian never converts SOS backend acknowledgement into a claim that help is on the way.

## Roadside handoff

The UI provides direct navigation into the existing Roadside workflow.

Trip Guardian does not fabricate a Roadside incident simply because the owner taps a navigation link.

## Persistence

Migration `022_trip_guardian_foundation` adds:

- `trip_guardian_journeys`;
- `trip_guardian_contact_shares`;
- `trip_guardian_checkins`;
- `trip_guardian_location_snapshots`;
- `trip_guardian_escalation_links`;
- `trip_guardian_status_history`.

## Background jobs

Sprint 21 adds workers for:

- check-in prompt due processing;
- check-in timeout / missed-state processing;
- location-retention cleanup.

Check-in prompting is idempotent.

## APIs

```text
GET    /api/v1/trip-guardian/journeys
POST   /api/v1/trip-guardian/journeys
GET    /api/v1/trip-guardian/journeys/:id
PATCH  /api/v1/trip-guardian/journeys/:id
GET    /api/v1/trip-guardian/journeys/:id/readiness
POST   /api/v1/trip-guardian/journeys/:id/start
POST   /api/v1/trip-guardian/journeys/:id/arrive
POST   /api/v1/trip-guardian/journeys/:id/cancel
POST   /api/v1/trip-guardian/journeys/:id/location
POST   /api/v1/trip-guardian/journeys/:id/checkins/:checkinId/respond
POST   /api/v1/trip-guardian/journeys/:id/escalate/sos
```

## UI

The Trip Guardian workspace supports:

- journey preparation;
- vehicle selection;
- origin/destination labels;
- owner-entered expected-arrival time;
- Emergency Circle context selection;
- optional check-ins;
- optional one-time location sharing;
- readiness summary;
- pre-trip checklist navigation;
- explicit readiness-warning acknowledgement;
- journey start/arrival/cancellation;
- one-time location snapshot;
- check-in responses;
- explicit SOS activation;
- Roadside navigation.

Expected arrival is owner-entered context, not a route-generated ETA.

## Certification tests

Sprint 21 tests verify:

- normalized Trip Guardian schema;
- real PRE_TRIP_CHECK linkage;
- one-open-journey invariant;
- acknowledgement requirement;
- canonical stop-driving enforcement;
- REVIEWED is not safety certification;
- durable check-in scheduling;
- prompt idempotency;
- missed-check-in non-inference;
- NEED_HELP does not auto-SOS;
- global + journey location consent;
- no coordinates in outbox/audit;
- Emergency Circle context without notification claims;
- explicit SOS handoff truth separation;
- arrival cleanup and location revocation;
- no automatic Passport/Timeline projection;
- cross-user isolation.

## Implementation-head certification

Green implementation head:

- GitHub Actions run: **41195518720**
- Head: `bf1765df531c263dbe32867e9c41cce15e517617`
- Repository hygiene: **PASS**
- TypeScript typecheck: **PASS**
- Full test suite: **PASS**
- Production build: **PASS**
- Workflow URL: https://github.com/Sean-steve/Garage-Os/actions/runs/41195518720

The final documentation/traceability head must independently pass the same certification workflow before merge.

## Explicitly deferred

Sprint 21 does not implement:

- continuous live journey tracking;
- route navigation;
- route-generated ETA;
- automatic trusted-contact notifications for normal journeys;
- automatic emergency escalation;
- crash detection;
- anomaly-triggered crash inference;
- injury inference;
- unattended escalation.

These remain for later Trip Guardian productionization and research-gated safety work.

## Sprint 22 readiness

Sprint 22 may begin only after:

- PR #9 passes final exact-head certification;
- PR #9 is merged into `main`;
- merged `main` passes certification.

**Next:** Sprint 22 — Marketplace Foundation (GAR-021).
