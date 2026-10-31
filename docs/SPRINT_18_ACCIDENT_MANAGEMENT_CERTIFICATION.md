# Sprint 18 — Accident Management

## Status

**GAR-DEV-S18 VERIFIED**

Sprint 18 establishes canonical Accident Management on top of the certified vehicle, safety, roadside, towing, service, file-storage, Timeline and Digital Vehicle Passport foundations.

## Implemented capabilities

- owner-scoped accident draft lifecycle;
- explicit finalize and close transitions;
- structured severity and incident type;
- owner-recorded:
  - police-attendance status;
  - injury-reported flag;
  - vehicle-drivability status;
- private incident narrative;
- optional exact incident location stored only in the Accident domain;
- private other-party records;
- private witness records and contact-consent status;
- structured damage observations;
- file-backed private accident evidence using canonical Garage OS storage;
- police / insurer / inspection / legal reference records;
- explicit reference provenance:
  - `OWNER_REPORTED`;
  - `DOCUMENT_SUPPORTED`;
  - `EXTERNAL_VERIFIED` reserved for authoritative future integrations;
- validated links to:
  - towing requests;
  - roadside incidents;
  - service cases;
  - bookings;
- non-destructive post-finalization addenda;
- immutable status history;
- audit and transactional outbox records;
- owner Accident Management UI.

## State model

```text
DRAFT
  → RECORDED
  → REPAIR_IN_PROGRESS
  → CLOSED
```

Core accident facts may be edited only while `DRAFT`.

After finalization, history is not rewritten. New information is recorded as structured evidence, references, operational links or addenda.

## Digital Vehicle Passport projection

Finalizing an accident calls the canonical Timeline service rather than writing timeline tables directly.

The resulting `ACCIDENT_RECORDED` projection contains only:

- canonical accident ID;
- severity;
- number of structured damage observations;
- number of evidence items;
- neutral accident summary;
- owner/evidence-supported provenance state.

It deliberately excludes:

- participant names;
- participant phone/email;
- witness identities or contacts;
- policy numbers;
- police reference numbers;
- insurer claim numbers;
- exact latitude/longitude;
- private location description;
- injury-reported flag;
- private narrative;
- raw photos/videos/documents.

This keeps the Digital Vehicle Passport useful without turning it into a repository of personal incident data.

## Evidence

Accident media/documents use the existing Garage OS `file_objects` system.

The Accident domain stores only the canonical `file_id` and evidence metadata.

Evidence is private by default and the actor must own the referenced file before it can be attached.

Evidence-supported does **not** mean externally verified.

## External references

Owner-entered police or insurance references cannot self-assert `EXTERNAL_VERIFIED`.

Current supported owner states are:

```text
OWNER_REPORTED
DOCUMENT_SUPPORTED
```

Actual external verification remains owned by later police/insurance integration adapters.

## Operational handoffs

Accident Management does not duplicate authoritative towing, roadside, booking or workshop records.

It stores validated references only after verifying:

- the target exists;
- it belongs to the same vehicle;
- it belongs to the authenticated user.

Repair-related links may advance the accident from `RECORDED` to `REPAIR_IN_PROGRESS`, while the authoritative repair workflow remains in Garage Operations / Booking.

## APIs

```text
GET    /api/v1/accidents
POST   /api/v1/accidents
GET    /api/v1/accidents/:id
PATCH  /api/v1/accidents/:id/draft
POST   /api/v1/accidents/:id/finalize
POST   /api/v1/accidents/:id/participants
POST   /api/v1/accidents/:id/witnesses
POST   /api/v1/accidents/:id/damage-observations
POST   /api/v1/accidents/:id/evidence
POST   /api/v1/accidents/:id/external-references
POST   /api/v1/accidents/:id/handoffs
POST   /api/v1/accidents/:id/addenda
POST   /api/v1/accidents/:id/close
```

There is deliberately no generic accident-status PATCH endpoint.

## Persistence

Migration `019_accident_management` adds:

- `accident_incidents`;
- `accident_participants`;
- `accident_witnesses`;
- `accident_damage_observations`;
- `accident_evidence`;
- `accident_external_references`;
- `accident_handoffs`;
- `accident_addenda`;
- `accident_status_history`.

## Safety and truth boundaries

Sprint 18 does not claim:

- police notification or police attendance verification;
- insurance claim submission, acceptance or settlement;
- liability determination;
- medical diagnosis;
- emergency-service dispatch;
- automatic tow creation;
- automatic repair booking;
- automatic total-loss determination.

`TOTAL_LOSS_REPORTED` is an incident severity label, not an insurer decision.

Likewise, `injuries_reported = YES` records an owner-reported fact and is not a medical assessment.

## Certification evidence

Initial Sprint 18 code-head certification:

- GitHub Actions run: **41186899727**
- Head: `2610903eee765481f5c4f4e811d5fc65520220e9`
- Repository hygiene: **PASS**
- TypeScript typecheck: **PASS**
- Full test suite: **PASS**
- Production build: **PASS**
- Workflow URL: https://github.com/Sean-steve/Garage-Os/actions/runs/41186899727

The final documentation/traceability head is subjected to the same certification gate before merge.

## Sprint 19 readiness

Sprint 19 may begin only after:

- PR #6 passes the final exact-head certification;
- PR #6 is merged to `main`;
- the merged `main` certification workflow succeeds.

**Next:** Sprint 19 — Car Care Center (GAR-020).
