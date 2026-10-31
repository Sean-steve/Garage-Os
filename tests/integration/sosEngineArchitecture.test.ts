/**
 * Sprint 16 — SOS Engine & Emergency Activation (GAR-017)
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { safetyService } from '../../src/server/safety/safetyService';
import { sosService } from '../../src/server/safety/sosService';
import { sosRepository } from '../../src/server/safety/sosRepository';
import { setSafetyNotificationAdapter } from '../../src/server/safety/safetyNotificationAdapter';
import {
  SafetyIncidentLevel,
  SosIncidentStatus,
  SosNotificationStatus,
  SosSafetyCheckResponse,
} from '../../src/server/safety/types';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';

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

describe('SOS Engine & Emergency Activation (GAR-017)', () => {
  let db: any;
  const owner = actor('usr_sos_owner', 'owner@sos.test');
  const other = actor('usr_sos_other', 'other@sos.test');

  beforeEach(() => {
    resetDatabaseInstance();
    db = getDatabase({ memory: true });
    runMigrations(db);
    setSafetyNotificationAdapter(null);

    const insertUser = db.prepare(`
      INSERT INTO users (
        id, email, full_name, role, status, account_status, phone, created_at, updated_at
      ) VALUES (?, ?, ?, 'VEHICLE_OWNER', 'ACTIVE', 'ACTIVE', ?, ?, ?)
    `);
    insertUser.run(owner.user_id, owner.email, 'SOS Owner', '+254700000001', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');
    insertUser.run(other.user_id, other.email, 'Other Owner', '+254700000002', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');
  });

  function addTrustedContact() {
    return safetyService.addContact(owner, {
      display_name: 'Mary Wanjiku',
      relationship_label: 'Sister',
      phone_e164: '+254711111111',
      priority: 1,
    });
  }

  function afterDeadline(incident: { cancel_deadline_at: string }) {
    return new Date(new Date(incident.cancel_deadline_at).getTime() + 1000).toISOString();
  }

  it('creates the SOS runtime schema and keeps acknowledgement states separate', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).all().map((row: any) => row.name);

    for (const table of [
      'sos_incidents',
      'sos_activation_attempts',
      'sos_location_snapshots',
      'sos_contact_notification_attempts',
      'sos_safety_checks',
      'sos_status_history',
    ]) {
      assert.ok(tables.includes(table), `${table} must exist`);
    }
  });

  it('acknowledges an SOS attempt durably without claiming activation, delivery or assistance', () => {
    addTrustedContact();

    const aggregate = sosService.initiate(owner, {
      incident_type: 'USER_REQUESTED_SOS',
      incident_level: SafetyIncidentLevel.SERIOUS_EMERGENCY,
      activation_source: 'USER_SOS_BUTTON',
    });

    assert.equal(aggregate.incident.status, SosIncidentStatus.COUNTDOWN);
    assert.equal(aggregate.acknowledgement.backend_acknowledged, true);
    assert.equal(aggregate.acknowledgement.activation_complete, false);
    assert.equal(aggregate.acknowledgement.trusted_contact_delivery_confirmed, false);
    assert.equal(aggregate.acknowledgement.assistance_requested, false);
    assert.equal(aggregate.incident.assistance_state, 'NOT_REQUESTED');
    assert.equal(aggregate.notification_attempts.length, 0);

    const attempts = db.prepare(
      'SELECT status FROM sos_activation_attempts WHERE incident_id = ?'
    ).all(aggregate.incident.id) as any[];
    assert.deepEqual(attempts.map((row) => row.status), ['ACKNOWLEDGED']);

    const jobs = db.prepare(
      "SELECT job_name FROM job_instances WHERE correlation_id = ? ORDER BY created_at"
    ).all(aggregate.incident.id) as any[];
    assert.ok(jobs.some((row) => row.job_name === 'safety.sos.finalize_activation'));
  });

  it('returns the same active incident for repeated activation attempts instead of creating duplicates', () => {
    const first = sosService.initiate(owner, { incident_type: 'SOS' });
    const second = sosService.initiate(owner, { incident_type: 'SOS_AGAIN' });

    assert.equal(first.incident.id, second.incident.id);
    const count = db.prepare(
      "SELECT COUNT(*) AS count FROM sos_incidents WHERE user_id = ? AND status IN ('COUNTDOWN','ACTIVATED')"
    ).get(owner.user_id) as any;
    assert.equal(Number(count.count), 1);
  });

  it('allows accidental cancellation during countdown and never queues contact notifications', () => {
    addTrustedContact();
    const aggregate = sosService.initiate(owner, { incident_type: 'ACCIDENTAL_TEST' });

    const cancelled = sosService.cancel(owner, aggregate.incident.id, 'Accidental press');
    assert.equal(cancelled.incident.status, SosIncidentStatus.CANCELLED);
    assert.equal(cancelled.notification_attempts.length, 0);

    const postWorker = sosService.finalizeActivation(
      aggregate.incident.id,
      afterDeadline(aggregate.incident)
    );
    assert.equal(postWorker?.status, SosIncidentStatus.CANCELLED);

    const notificationCount = db.prepare(
      'SELECT COUNT(*) AS count FROM sos_contact_notification_attempts WHERE incident_id = ?'
    ).get(aggregate.incident.id) as any;
    assert.equal(Number(notificationCount.count), 0);
  });

  it('automatically activates after the server countdown and creates a safety check plus notification attempt', () => {
    addTrustedContact();
    const aggregate = sosService.initiate(owner, { incident_type: 'SERIOUS_EMERGENCY' });

    const activated = sosService.finalizeActivation(
      aggregate.incident.id,
      afterDeadline(aggregate.incident)
    );
    assert.equal(activated?.status, SosIncidentStatus.ACTIVATED);

    const current = sosService.getAggregateForOwner(owner, aggregate.incident.id);
    assert.equal(current.acknowledgement.activation_complete, true);
    assert.equal(current.incident.notification_state, 'QUEUED');
    assert.equal(current.notification_attempts.length, 1);
    assert.equal(current.notification_attempts[0].status, SosNotificationStatus.QUEUED);
    assert.equal(current.safety_check?.status, 'PENDING');
    assert.equal(current.incident.assistance_state, 'NOT_REQUESTED');
    assert.equal(current.acknowledgement.assistance_requested, false);
  });

  it('does not fake contact delivery when no production notification provider is configured', async () => {
    addTrustedContact();
    const aggregate = sosService.initiate(owner, { incident_type: 'SERIOUS_EMERGENCY' });
    sosService.finalizeActivation(aggregate.incident.id, afterDeadline(aggregate.incident));

    const queued = sosRepository.listNotificationAttempts(aggregate.incident.id)[0];
    const processed = await sosService.processNotificationAttempt(queued.id);

    assert.equal(processed?.status, SosNotificationStatus.NOT_CONFIGURED);
    assert.equal(processed?.delivered_at, null);

    const current = sosService.getAggregateForOwner(owner, aggregate.incident.id);
    assert.equal(current.acknowledgement.trusted_contact_delivery_confirmed, false);
    assert.equal(current.incident.notification_state, 'NO_CONFIRMED_DELIVERY');
  });

  it('marks delivery confirmed only from an authoritative adapter result and uses an idempotency key', async () => {
    addTrustedContact();
    let capturedRequest: any = null;

    setSafetyNotificationAdapter({
      async send(request) {
        capturedRequest = request;
        return {
          outcome: 'DELIVERED',
          provider_name: 'test-sms-provider',
          provider_message_id: 'msg_123',
        };
      },
    });

    const aggregate = sosService.initiate(owner, { incident_type: 'COLLISION' });
    sosService.finalizeActivation(aggregate.incident.id, afterDeadline(aggregate.incident));
    const queued = sosRepository.listNotificationAttempts(aggregate.incident.id)[0];

    const processed = await sosService.processNotificationAttempt(queued.id);
    assert.equal(processed?.status, SosNotificationStatus.DELIVERED);
    assert.ok(processed?.delivered_at);
    assert.equal(capturedRequest.idempotency_key, queued.id);
    assert.match(capturedRequest.message, /External assistance has not been confirmed/i);

    const current = sosService.getAggregateForOwner(owner, aggregate.incident.id);
    assert.equal(current.acknowledgement.trusted_contact_delivery_confirmed, true);
    assert.equal(current.incident.notification_state, 'DELIVERY_CONFIRMED_ALL');
    assert.equal(current.acknowledgement.assistance_requested, false);
  });

  it('stores SOS location only after explicit master opt-in and expires it purposefully', () => {
    addTrustedContact();

    const noLocation = sosService.initiate(owner, {
      incident_type: 'NO_LOCATION_PERMISSION',
      location: { latitude: -1.286389, longitude: 36.817223, accuracy_meters: 10 },
    });
    assert.equal(noLocation.location, null);
    sosService.cancel(owner, noLocation.incident.id, 'test reset');

    safetyService.updatePreferences(owner, { allow_location_sharing: true });
    const withLocation = sosService.initiate(owner, {
      incident_type: 'LOCATION_ALLOWED',
      location: { latitude: -1.286389, longitude: 36.817223, accuracy_meters: 10 },
    });

    assert.ok(withLocation.location);
    assert.equal(withLocation.location?.sharing_authorized, true);
    assert.ok(new Date(withLocation.location!.expires_at).getTime() > Date.now());

    // Malformed location never blocks a later SOS attempt; it is simply not retained.
    sosService.cancel(owner, withLocation.incident.id, 'test reset');
    const invalid = sosService.initiate(owner, {
      incident_type: 'BAD_LOCATION',
      location: { latitude: 999, longitude: 999, captured_at: 'not-a-date' },
    });
    assert.equal(invalid.acknowledgement.backend_acknowledged, true);
    assert.equal(invalid.location, null);
  });

  it('records NEED_HELP without fabricating external provider request or acceptance', () => {
    addTrustedContact();
    const aggregate = sosService.initiate(owner, { incident_type: 'NEED_HELP_TEST' });
    sosService.finalizeActivation(aggregate.incident.id, afterDeadline(aggregate.incident));

    const answered = sosService.respondSafetyCheck(
      owner,
      aggregate.incident.id,
      SosSafetyCheckResponse.NEED_HELP
    );

    assert.equal(answered.safety_check?.response, 'NEED_HELP');
    assert.equal(answered.acknowledgement.assistance_requested, false);
    assert.equal(answered.acknowledgement.assistance_accepted, false);
    assert.equal(answered.acknowledgement.assistance_arrived, false);
    assert.equal(answered.incident.assistance_state, 'NOT_REQUESTED');
  });

  it('treats safety-check timeout as no response, never as injury evidence', () => {
    addTrustedContact();
    const aggregate = sosService.initiate(owner, { incident_type: 'NO_RESPONSE_TEST' });
    sosService.finalizeActivation(aggregate.incident.id, afterDeadline(aggregate.incident));

    const current = sosService.getAggregateForOwner(owner, aggregate.incident.id);
    assert.ok(current.safety_check);
    const afterDue = new Date(new Date(current.safety_check!.due_at).getTime() + 1000).toISOString();

    assert.equal(
      sosService.timeoutSafetyCheck(current.safety_check!.id, aggregate.incident.id, afterDue),
      true
    );

    const timedOut = sosService.getAggregateForOwner(owner, aggregate.incident.id);
    assert.equal(timedOut.safety_check?.status, 'TIMED_OUT');
    assert.equal(timedOut.incident.safety_check_state, 'TIMED_OUT_NO_RESPONSE');
    assert.equal(timedOut.acknowledgement.assistance_requested, false);

    const event = db.prepare(
      "SELECT payload FROM outbox_events WHERE type = 'safety.sos.safety_check.timed_out' ORDER BY created_at DESC LIMIT 1"
    ).get() as any;
    assert.ok(event);
    assert.equal(JSON.parse(event.payload).injury_inferred, false);
  });

  it('prevents cross-user incident access and revokes location access on closure', () => {
    safetyService.updatePreferences(owner, { allow_location_sharing: true });
    const aggregate = sosService.initiate(owner, {
      incident_type: 'PRIVATE_SOS',
      location: { latitude: -1.286389, longitude: 36.817223 },
    });

    assert.throws(
      () => sosService.getAggregateForOwner(other, aggregate.incident.id),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
    );

    sosService.finalizeActivation(aggregate.incident.id, afterDeadline(aggregate.incident));
    const closed = sosService.close(owner, aggregate.incident.id, 'Situation resolved');
    assert.equal(closed.incident.status, SosIncidentStatus.CLOSED);
    assert.equal(closed.location, null);
    assert.equal(sosService.getActive(owner), null);
  });
});
