/**
 * Sprint 17 — Trusted Contact Experience (GAR-017)
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { safetyService } from '../../src/server/safety/safetyService';
import { sosService } from '../../src/server/safety/sosService';
import { sosRepository } from '../../src/server/safety/sosRepository';
import {
  setSafetyNotificationAdapter,
  SafetyNotificationRequest,
} from '../../src/server/safety/safetyNotificationAdapter';
import { trustedContactService } from '../../src/server/safety/trustedContactService';
import { trustedContactRepository } from '../../src/server/safety/trustedContactRepository';
import {
  SafetyIncidentLevel,
  SosNotificationStatus,
  TrustedContactGrantStatus,
  TrustedContactResponse,
} from '../../src/server/safety/types';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';
import { vehicleService } from '../../src/server/vehicle/vehicleService';

function actor(userId: string, email: string) {
  return {
    id: userId,
    user_id: userId,
    email,
    account_status: 'ACTIVE',
    platform_roles: [],
    memberships: [],
    profile: {
      user_id: userId,
      display_name: email.split('@')[0],
      preferred_language: 'en',
      timezone: 'Africa/Nairobi',
      country: 'KE',
      created_at: '2026-10-31T00:00:00.000Z',
      updated_at: '2026-10-31T00:00:00.000Z',
    },
    session_id: `ses_${userId}`,
  } as any;
}

function tokenFromPortalUrl(url: string): string {
  const hash = new URL(url).hash.replace(/^#/, '');
  return new URLSearchParams(hash).get('token') || '';
}

describe('Trusted Contact Experience (GAR-017)', () => {
  let db: any;
  let capturedNotification: SafetyNotificationRequest | null;
  let vehicleId: string;
  const owner = actor('usr_tc_owner', 'owner@trusted.test');
  const other = actor('usr_tc_other', 'other@trusted.test');

  beforeEach(() => {
    resetDatabaseInstance();
    db = getDatabase({ memory: true });
    runMigrations(db);
    capturedNotification = null;

    const insertUser = db.prepare(`
      INSERT INTO users (
        id, email, full_name, role, status, account_status, phone, created_at, updated_at
      ) VALUES (?, ?, ?, 'VEHICLE_OWNER', 'ACTIVE', 'ACTIVE', ?, ?, ?)
    `);
    insertUser.run(
      owner.user_id,
      owner.email,
      'Amina Njeri',
      '+254700000001',
      '2026-10-31T00:00:00.000Z',
      '2026-10-31T00:00:00.000Z'
    );
    insertUser.run(
      other.user_id,
      other.email,
      'Other User',
      '+254700000002',
      '2026-10-31T00:00:00.000Z',
      '2026-10-31T00:00:00.000Z'
    );

    const createdVehicle = vehicleService.createVehicle(owner, {
      make: 'Toyota',
      model: 'Axio',
      model_year: 2018,
      registration_number: 'KDA 123A',
    });
    vehicleId = createdVehicle.vehicle.id;

    setSafetyNotificationAdapter({
      async send(request) {
        capturedNotification = request;
        return {
          outcome: 'DELIVERED',
          provider_name: 'test-notification-provider',
          provider_message_id: 'msg_tc_01',
        };
      },
    });
  });

  function addContact() {
    const contact = safetyService.addContact(owner, {
      display_name: 'David Mwangi',
      relationship_label: 'Brother',
      phone_e164: '+254711111111',
      priority: 1,
    });

    safetyService.updateContactScope(owner, contact.id, {
      incident_level: SafetyIncidentLevel.SERIOUS_EMERGENCY,
      notify_contact: true,
      share_incident_type: true,
      share_vehicle_summary: true,
      share_live_location: true,
      share_assistance_status: true,
      share_callback_number: true,
    });

    return contact;
  }

  async function activateAndNotify() {
    const contact = addContact();
    safetyService.updatePreferences(owner, { allow_location_sharing: true });

    const aggregate = sosService.initiate(owner, {
      vehicle_id: vehicleId,
      incident_type: 'COLLISION',
      incident_level: SafetyIncidentLevel.SERIOUS_EMERGENCY,
      location: {
        latitude: -1.286389,
        longitude: 36.817223,
        accuracy_meters: 8,
      },
    });

    sosService.finalizeActivation(
      aggregate.incident.id,
      new Date(new Date(aggregate.incident.cancel_deadline_at).getTime() + 1000).toISOString()
    );

    const attempt = sosRepository.listNotificationAttempts(aggregate.incident.id)[0];
    assert.ok(attempt);
    const processed = await sosService.processNotificationAttempt(attempt.id);
    assert.equal(processed?.status, SosNotificationStatus.DELIVERED);
    assert.ok(capturedNotification);

    const token = tokenFromPortalUrl(capturedNotification!.portal_url);
    assert.ok(token);

    return { contact, incidentId: aggregate.incident.id, attempt, token };
  }

  it('adds the trusted-contact grant, response and access-audit schema', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).all().map((row: any) => row.name);

    assert.ok(tables.includes('trusted_contact_access_grants'));
    assert.ok(tables.includes('trusted_contact_responses'));
    assert.ok(tables.includes('trusted_contact_access_audit'));
  });

  it('issues a signed expiring portal link without persisting the raw token', async () => {
    const { attempt, token } = await activateAndNotify();

    assert.ok(capturedNotification!.portal_url.includes('/trusted-contact#token='));
    assert.ok(capturedNotification!.message.includes('Trusted contact view:'));
    assert.equal(capturedNotification!.idempotency_key, attempt.id);

    const grant = trustedContactRepository.getGrantByNotificationAttempt(attempt.id);
    assert.ok(grant);
    assert.equal(grant!.status, TrustedContactGrantStatus.ACTIVE);
    assert.notEqual(grant!.token_digest, token);
    assert.equal(grant!.token_digest.includes(token), false);
    assert.ok(new Date(grant!.expires_at).getTime() > Date.now());

    const rawLeak = db.prepare(
      "SELECT COUNT(*) AS count FROM trusted_contact_access_grants WHERE token_digest = ?"
    ).get(token) as any;
    assert.equal(Number(rawLeak.count), 0);
  });

  it('projects only the authorized incident, vehicle, location, callback and assistance fields', async () => {
    const { token } = await activateAndNotify();

    const view = trustedContactService.resolvePortal(token);

    assert.equal(view.owner.display_name, 'Amina Njeri');
    assert.equal(view.owner.callback_number, '+254700000001');
    assert.equal(view.incident.incident_type, 'COLLISION');
    assert.equal(view.vehicle?.make, 'Toyota');
    assert.equal(view.vehicle?.model, 'Axio');
    assert.equal(view.vehicle?.registration_number, 'KDA 123A');
    assert.equal(view.location?.latitude, -1.286389);
    assert.equal(view.location?.longitude, 36.817223);
    assert.equal(view.assistance?.state, 'NOT_REQUESTED');
    assert.equal(view.safety_truth.assistance_requested, false);
    assert.equal(view.safety_truth.assistance_accepted, false);
    assert.equal(view.safety_truth.assistance_arrived, false);
    assert.equal(view.safety_truth.trusted_contact_delivery_confirmed, true);

    const grant = trustedContactRepository.getGrantByNotificationAttempt(
      sosRepository.listNotificationAttempts(view.incident.id)[0].id
    );
    assert.ok(grant?.first_accessed_at);

    const audit = db.prepare(
      "SELECT action FROM trusted_contact_access_audit WHERE grant_id = ? ORDER BY occurred_at"
    ).all(grant!.id) as any[];
    assert.ok(audit.some((row) => row.action === 'PORTAL_VIEWED'));
  });

  it('enforces the notification-time scope snapshot and never broadens hidden fields', async () => {
    const contact = safetyService.addContact(owner, {
      display_name: 'Privacy Contact',
      phone_e164: '+254722222222',
      priority: 1,
    });
    safetyService.updatePreferences(owner, { allow_location_sharing: true });
    safetyService.updateContactScope(owner, contact.id, {
      incident_level: SafetyIncidentLevel.SERIOUS_EMERGENCY,
      notify_contact: true,
      share_incident_type: false,
      share_vehicle_summary: false,
      share_live_location: false,
      share_assistance_status: false,
      share_callback_number: false,
    });

    const aggregate = sosService.initiate(owner, {
      vehicle_id: vehicleId,
      incident_type: 'PRIVATE_INCIDENT',
      location: { latitude: -1.28, longitude: 36.81 },
    });
    sosService.finalizeActivation(
      aggregate.incident.id,
      new Date(new Date(aggregate.incident.cancel_deadline_at).getTime() + 1000).toISOString()
    );
    const attempt = sosRepository.listNotificationAttempts(aggregate.incident.id)[0];
    await sosService.processNotificationAttempt(attempt.id);
    const token = tokenFromPortalUrl(capturedNotification!.portal_url);

    // Broaden the current contact configuration after activation. The already-issued
    // grant must continue using the immutable notification-attempt snapshot.
    safetyService.updateContactScope(owner, contact.id, {
      incident_level: SafetyIncidentLevel.SERIOUS_EMERGENCY,
      notify_contact: true,
      share_incident_type: true,
      share_vehicle_summary: true,
      share_live_location: true,
      share_assistance_status: true,
      share_callback_number: true,
    });

    const view = trustedContactService.resolvePortal(token);
    assert.equal(view.incident.incident_type, null);
    assert.equal(view.vehicle, null);
    assert.equal(view.location, null);
    assert.equal(view.assistance, null);
    assert.equal(view.owner.callback_number, null);
    assert.deepEqual(view.permissions, {
      incident_type: false,
      vehicle_summary: false,
      live_location: false,
      assistance_status: false,
      callback_number: false,
    });
  });

  it('rejects tampered tokens and never falls back to account authentication', async () => {
    const { token } = await activateAndNotify();
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');

    assert.throws(
      () => trustedContactService.resolvePortal(tampered),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.NOT_AUTHORIZED
    );

    assert.throws(
      () => trustedContactService.resolvePortal(''),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.NOT_AUTHORIZED
    );
  });

  it('records trusted-contact acknowledgement without mutating professional assistance state', async () => {
    const { incidentId, token } = await activateAndNotify();

    const view = trustedContactService.recordResponse(
      token,
      TrustedContactResponse.CONTACTING_USER
    );

    assert.equal(view.latest_response?.response, TrustedContactResponse.CONTACTING_USER);
    const incident = sosRepository.getIncidentById(incidentId);
    assert.equal(incident?.assistance_state, 'NOT_REQUESTED');
    assert.equal(view.safety_truth.assistance_requested, false);

    // Exact retries are idempotent at the domain level.
    trustedContactService.recordResponse(token, TrustedContactResponse.CONTACTING_USER);
    const count = db.prepare(
      "SELECT COUNT(*) AS count FROM trusted_contact_responses WHERE incident_id = ? AND response = 'CONTACTING_USER'"
    ).get(incidentId) as any;
    assert.equal(Number(count.count), 1);

    const event = db.prepare(
      "SELECT payload FROM outbox_events WHERE type = 'safety.trusted_contact.response.recorded' ORDER BY created_at DESC LIMIT 1"
    ).get() as any;
    assert.ok(event);
    assert.equal(JSON.parse(event.payload).provider_assistance_state_changed, false);
  });

  it('lets the owner revoke active trusted-contact links immediately', async () => {
    const { incidentId, token } = await activateAndNotify();

    const before = trustedContactService.listOwnerIncidentGrants(owner.user_id, incidentId);
    assert.equal(before.length, 1);
    assert.equal(before[0].status, TrustedContactGrantStatus.ACTIVE);

    const revoked = trustedContactService.revokeOwnerIncidentGrants(owner.user_id, incidentId);
    assert.equal(revoked, 1);

    assert.throws(
      () => trustedContactService.resolvePortal(token),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.NOT_AUTHORIZED
    );
  });

  it('revokes portal access when the Emergency Circle contact is revoked', async () => {
    const { contact, token } = await activateAndNotify();

    safetyService.revokeContact(owner, contact.id);

    assert.throws(
      () => trustedContactService.resolvePortal(token),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.NOT_AUTHORIZED
    );
  });

  it('expires grants and records expiration evidence', async () => {
    const { attempt, token } = await activateAndNotify();
    const grant = trustedContactRepository.getGrantByNotificationAttempt(attempt.id)!;
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    db.prepare(
      'UPDATE trusted_contact_access_grants SET expires_at = ? WHERE id = ?'
    ).run(expiredAt, grant.id);

    assert.equal(trustedContactService.expireGrantIfDue(grant.id), true);

    const expired = trustedContactRepository.getGrantById(grant.id);
    assert.equal(expired?.status, TrustedContactGrantStatus.EXPIRED);

    assert.throws(
      () => trustedContactService.resolvePortal(token),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.NOT_AUTHORIZED
    );

    const event = db.prepare(
      "SELECT payload FROM outbox_events WHERE type = 'safety.trusted_contact.access_grant.expired' ORDER BY created_at DESC LIMIT 1"
    ).get() as any;
    assert.ok(event);
    assert.equal(JSON.parse(event.payload).grant_id, grant.id);
  });

  it('revokes all incident grants when the owner closes the SOS', async () => {
    const { incidentId, token } = await activateAndNotify();

    const closed = sosService.close(owner, incidentId, 'Situation resolved');
    assert.equal(closed.incident.status, 'CLOSED');

    const grants = trustedContactRepository.listIncidentGrants(incidentId);
    assert.equal(grants.length, 1);
    assert.equal(grants[0].status, TrustedContactGrantStatus.REVOKED);

    assert.throws(
      () => trustedContactService.resolvePortal(token),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.NOT_AUTHORIZED
    );
  });

  it('keeps owner grant administration strictly owner-scoped', async () => {
    const { incidentId } = await activateAndNotify();

    assert.throws(
      () => trustedContactService.listOwnerIncidentGrants(other.user_id, incidentId),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
    );

    assert.throws(
      () => trustedContactService.revokeOwnerIncidentGrants(other.user_id, incidentId),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
    );
  });
});
