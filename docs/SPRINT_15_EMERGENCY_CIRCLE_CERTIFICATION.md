# Sprint 15 — Emergency Circle & Human Safety Foundation

## Status

**GAR-DEV-S15 VERIFIED**

Sprint 15 establishes the human-safety configuration foundation required before the SOS runtime is allowed to exist.

## Implemented scope

- Emergency Circle contacts owned by the authenticated user.
- Contact priority and non-destructive revocation.
- Contact channels using E.164 phone numbers and/or email.
- Explicit incident levels:
  - `ASSISTANCE`
  - `BREAKDOWN`
  - `SERIOUS_EMERGENCY`
- Per-contact/per-level sharing policy for:
  - incident type;
  - vehicle summary;
  - live location permission;
  - assistance status;
  - callback number.
- Global human-safety preferences:
  - Emergency Circle enabled;
  - master location-sharing permission;
  - safety-check preference;
  - safety-check timeout;
  - future SOS cancel countdown;
  - future escalation-sequence preference.
- Derived configuration readiness.
- Immutable configuration history.
- Transactional outbox events.
- Redacted audit records.
- Authenticated Safety API.
- Owner-facing Safety Center.

## Safety boundaries

Sprint 15 intentionally does **not** implement:

- SOS activation;
- emergency notification sending;
- delivery acknowledgement;
- provider dispatch from an SOS;
- live emergency-location streaming;
- trusted-contact temporary web access;
- automatic escalation;
- injury inference from non-response.

These capabilities remain unavailable until their owning later sprints are implemented and validated.

The system therefore reports:

- `sos_engine_active: false`
- `notification_engine_active: false`
- `trusted_contact_portal_active: false`

A configured Emergency Circle is configuration readiness only; it is never represented as proof that emergency services or trusted contacts were notified.

## Privacy invariants

1. Live location sharing defaults to **off**.
2. Contact-level location permission does not silently enable the global location-sharing permission.
3. Emergency contacts are scoped to their owning user.
4. Cross-user contact identifiers return not-found-or-not-accessible semantics.
5. Contact phone numbers and emails are not copied into safety outbox payloads.
6. Audit/configuration history stores channel presence, not raw contact values.
7. Revocation preserves history instead of deleting safety records.
8. Failure to respond to a future safety check must never be treated as proof of injury.

## Persistence

Migration `016_emergency_circle_human_safety_foundation` adds:

- `emergency_contacts`
- `emergency_contact_scopes`
- `human_safety_preferences`
- `safety_configuration_history`

Sprint 15 deliberately does **not** add an SOS incident runtime table.

## APIs

```text
GET    /api/v1/safety/emergency-circle
POST   /api/v1/safety/emergency-circle/contacts
PATCH  /api/v1/safety/emergency-circle/contacts/:id
DELETE /api/v1/safety/emergency-circle/contacts/:id
PUT    /api/v1/safety/emergency-circle/contacts/:id/scopes/:level
GET    /api/v1/safety/preferences
PUT    /api/v1/safety/preferences
GET    /api/v1/safety/readiness
```

No `/activate`, `/sos`, `/notify`, or trusted-contact token endpoint exists in Sprint 15.

## Events

- `safety.emergency_contact.added`
- `safety.emergency_contact.updated`
- `safety.emergency_contact.revoked`
- `safety.emergency_contact.scope_updated`
- `safety.preferences.updated`

All material mutations use the canonical transactional outbox.

## Certification evidence

GitHub Actions certification run:

- Run ID: **41173954934**
- Head: `8c944dfae4b37e9f24668c030f52c0dd18d0bd6c`
- Repository hygiene: **PASS**
- TypeScript typecheck: **PASS**
- Full test suite: **PASS**
- Production build: **PASS**
- Workflow URL: https://github.com/Sean-steve/Garage-Os/actions/runs/41173954934

The documentation/traceability commits following this code-head evidence are run through the same certification gate before merge.

## Sprint 16 readiness

Sprint 16 may proceed only after this branch is merged and the merged `main` certification run succeeds.

**Next:** Sprint 16 — SOS Engine & Emergency Activation.
