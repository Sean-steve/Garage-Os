# Sprint 16 — SOS Engine & Emergency Activation

## Status

**GAR-DEV-S16 VERIFIED**

Sprint 16 establishes the durable SOS runtime on top of the Sprint 15 Emergency Circle foundation.

## Core state model

Garage OS keeps these states explicitly separate:

1. user activation attempt;
2. backend acknowledgement;
3. countdown completion / SOS activation;
4. trusted-contact notification queued;
5. notification attempted;
6. notification provider accepted;
7. notification delivered, only when authoritatively confirmed;
8. external assistance requested;
9. external assistance accepted;
10. assistance arrived;
11. incident closed.

Sprint 16 implements items 1–7 and 11. It deliberately leaves external assistance request/acceptance/arrival as `NOT_REQUESTED` until later integration work actually performs those actions.

## Implemented capabilities

- durable SOS incident aggregate;
- one active SOS per user;
- backend acknowledgement persisted before response;
- configurable short cancel countdown;
- durable activation-finalizer job;
- accidental cancellation before activation;
- optional initial location snapshot only after explicit master opt-in;
- purpose-bound 24-hour location retention;
- location access revocation on cancellation/closure;
- Emergency Circle scope snapshot at activation;
- notification-attempt queue;
- provider idempotency key for notification sends;
- default unconfigured transport that never fakes message delivery;
- authoritative provider acceptance and delivery states;
- safety-check prompt;
- `OKAY`, `NEED_HELP`, and `CANNOT_CONFIRM` responses;
- safety-check timeout with `injury_inferred: false`;
- owner-only SOS access;
- immutable status history;
- canonical audit and transactional outbox events;
- Safety Center countdown/status UI.

## Persistence

Migration `017_sos_engine_emergency_activation` adds:

- `sos_incidents`
- `sos_activation_attempts`
- `sos_location_snapshots`
- `sos_contact_notification_attempts`
- `sos_safety_checks`
- `sos_status_history`

A partial unique index prevents multiple simultaneous `COUNTDOWN` / `ACTIVATED` incidents for one user.

## API

```text
POST /api/v1/safety/sos/attempts
GET  /api/v1/safety/sos/active
GET  /api/v1/safety/sos/incidents
GET  /api/v1/safety/sos/incidents/:id
POST /api/v1/safety/sos/incidents/:id/cancel
POST /api/v1/safety/sos/incidents/:id/safety-check-response
POST /api/v1/safety/sos/incidents/:id/close
```

There is no external-emergency-service dispatch endpoint in Sprint 16.

## Durable jobs

- `safety.sos.finalize_activation`
- `safety.sos.notification_attempt`
- `safety.sos.safety_check_timeout`
- `safety.sos.location_retention`

Notification providers receive the notification-attempt ID as an idempotency key so retries do not require unsafe duplicate-send semantics.

## Safety truth rules

- Backend acknowledgement is never presented as trusted-contact delivery.
- Trusted-contact provider acceptance is never presented as delivery.
- Trusted-contact delivery is never presented as external assistance dispatch.
- `NEED_HELP` records user intent but does not fabricate a provider request.
- Safety-check timeout means no response only; it is never evidence of injury.
- Invalid or unavailable GPS must not block SOS acknowledgement.
- Emergency Circle configuration gaps do not block SOS acknowledgement.
- Location remains opt-in and purpose-limited.
- Contact phone/email values are not copied into canonical SOS event payloads.

## Notification transport

The default runtime adapter returns:

```text
NOT_CONFIGURED
```

rather than pretending to send a message. A production SMS/email provider must implement the adapter contract and return authoritative `PROVIDER_ACCEPTED` or `DELIVERED` evidence before Garage OS exposes those states.

## Deferred capabilities

Sprint 16 does not implement:

- trusted-contact temporary web portal;
- trusted-contact scoped access tokens;
- automatic escalation sequence;
- continuous emergency live-location streaming;
- emergency-services integration;
- automatic roadside/towing dispatch from SOS;
- crash-detection automatic activation.

Those remain owned by later safety/dispatch sprints.

## Certification evidence

Initial code-head certification:

- GitHub Actions run: **41175252523**
- Head: `79c5d3151a3e36bb258e2d29e3517103a9cf65d4`
- Repository hygiene: **PASS**
- TypeScript typecheck: **PASS**
- Full test suite: **PASS**
- Production build: **PASS**
- Workflow URL: https://github.com/Sean-steve/Garage-Os/actions/runs/41175252523

The final documentation/traceability head is subjected to the same gate before merge.

## Sprint 17 readiness

Sprint 17 may begin only after:

- PR #4 receives a successful final certification run;
- PR #4 is merged to `main`;
- merged `main` passes the certification workflow.

**Next:** Sprint 17 — Trusted Contact Experience.
