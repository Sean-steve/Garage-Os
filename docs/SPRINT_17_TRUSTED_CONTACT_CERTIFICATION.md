# Sprint 17 — Trusted Contact Experience

## Status

**GAR-DEV-S17 VERIFIED**

Sprint 17 adds the temporary no-account trusted-contact experience on top of the certified Emergency Circle and SOS runtime.

## Implemented capabilities

- temporary trusted-contact access grants bound to:
  - one SOS incident;
  - one Emergency Circle contact;
  - one notification attempt;
- signed access tokens with server-side digest verification;
- raw tokens are never persisted;
- token secrets remain in the URL fragment rather than the request path/query string;
- configurable expiry with durable expiry jobs;
- immediate owner revocation;
- automatic revocation when:
  - the SOS closes;
  - the SOS is cancelled;
  - the Emergency Circle contact is revoked;
  - the associated notification transport fails or is not configured;
- no Garage OS account/login required for trusted contacts;
- minimum-necessary incident projection;
- permission snapshotting from the notification attempt;
- optional vehicle summary;
- optional callback number;
- optional purpose-bound location;
- optional assistance-status projection;
- trusted-contact responses:
  - `ACKNOWLEDGED`
  - `CONTACTING_USER`
  - `CANNOT_ASSIST`
- immutable trusted-contact access audit;
- owner-facing trusted-access status and revocation controls;
- dedicated trusted-contact web portal.

## Privacy and security invariants

1. A portal token grants access only to its bound incident/contact/notification-attempt scope.
2. Portal permissions come from the immutable notification-time sharing snapshot.
3. Later changes to Emergency Circle sharing preferences cannot broaden an existing token.
4. Location is exposed only when:
   - the notification-attempt scope allowed location;
   - the owner globally allowed location sharing;
   - a non-expired SOS location snapshot still exists.
5. Raw portal tokens are not persisted in the database.
6. Trusted-contact endpoints do not accept or require the owner’s authenticated session.
7. Owner APIs never expose the raw trusted-contact token.
8. Revoked or expired grants return unauthorized/no-longer-active semantics.
9. Closing the SOS revokes all active trusted-contact links.
10. Revoking an Emergency Circle contact invalidates its active grants.
11. Portal responses never mutate professional roadside/towing/dispatch assistance state.
12. A trusted contact choosing `CONTACTING_USER` is not evidence that professional assistance was requested or accepted.
13. Public portal responses use no-store/no-cache, no-referrer and no-index response headers.

## Persistence

Migration `018_trusted_contact_experience` adds:

- `trusted_contact_access_grants`
- `trusted_contact_responses`
- `trusted_contact_access_audit`

## Public portal APIs

```text
GET  /api/v1/safety/trusted-contact/access
POST /api/v1/safety/trusted-contact/response
```

The trusted-contact token is supplied through `X-Trusted-Contact-Token` after the browser reads it from the URL fragment.

## Owner APIs

```text
GET  /api/v1/safety/sos/incidents/:id/trusted-contact-access
POST /api/v1/safety/sos/incidents/:id/trusted-contact-access/revoke
```

These owner endpoints remain protected by the canonical Garage OS session and incident ownership boundary.

## Notification integration

A trusted-contact link is generated for an eligible notification attempt and passed into the notification adapter as `portal_url`.

The link is included only in the message sent to the configured Emergency Circle contact. If the transport is unavailable or returns a terminal failure, the unused portal grant is revoked.

## Safety truth boundaries

The trusted-contact portal may display:

- SOS backend acknowledgement;
- notification delivery evidence for that contact;
- scoped incident details;
- scoped vehicle summary;
- scoped location;
- scoped assistance status.

It must never convert a trusted-contact response into:

- professional assistance requested;
- professional assistance accepted;
- provider en route;
- provider arrived;
- incident resolved.

Those states remain owned by their authoritative later integrations.

## Deferred capabilities

Sprint 17 does not implement:

- automatic trusted-contact escalation order;
- continuous emergency location streaming;
- emergency-services integration;
- automatic roadside/towing dispatch from SOS;
- crash-detection automatic activation.

## Certification evidence

The implementation head `2d31ba931f1b562ce08f8e8c4bad60725ec563d2` passed the Garage OS certification workflow repeatedly, including:

- Run **41178269802**
- Repository hygiene: **PASS**
- TypeScript typecheck: **PASS**
- Full test suite: **PASS**
- Production build: **PASS**

Workflow:
https://github.com/Sean-steve/Garage-Os/actions/runs/41178269802

The final documentation and consistency head is subjected to the same certification gate before merge.

## Sprint 18 readiness

Sprint 18 may begin only after:

- PR #5 passes the final exact-head certification;
- PR #5 is merged to `main`;
- the merged `main` certification run succeeds.

**Next:** Sprint 18 — Accident Management (GAR-018).
