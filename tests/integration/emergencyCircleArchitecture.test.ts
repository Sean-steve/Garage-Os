/**
 * Sprint 15 — Emergency Circle & Human Safety Foundation (GAR-017)
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { safetyService } from '../../src/server/safety/safetyService';
import { safetyRepository } from '../../src/server/safety/safetyRepository';
import { SafetyIncidentLevel } from '../../src/server/safety/types';
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

describe('Emergency Circle & Human Safety Foundation (GAR-017)', () => {
  let db: any;
  const owner = actor('usr_safety_owner', 'owner@safety.test');
  const other = actor('usr_safety_other', 'other@safety.test');

  beforeEach(() => {
    resetDatabaseInstance();
    db = getDatabase({ memory: true });
    runMigrations(db);

    const insertUser = db.prepare(`
      INSERT INTO users (
        id, email, full_name, role, status, account_status, created_at, updated_at
      ) VALUES (?, ?, ?, 'VEHICLE_OWNER', 'ACTIVE', 'ACTIVE', ?, ?)
    `);
    insertUser.run(owner.user_id, owner.email, 'Safety Owner', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');
    insertUser.run(other.user_id, other.email, 'Other Owner', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');
  });

  it('applies the canonical Sprint 15 safety schema without creating the SOS engine', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).all().map((row: any) => row.name);

    assert.ok(tables.includes('emergency_contacts'));
    assert.ok(tables.includes('emergency_contact_scopes'));
    assert.ok(tables.includes('human_safety_preferences'));
    assert.ok(tables.includes('safety_configuration_history'));

    // Sprint 15 deliberately does not implement activation/runtime SOS incident state.
    assert.equal(tables.includes('sos_incidents'), false);
  });

  it('uses privacy-safe defaults and never reports execution engines as active', () => {
    const circle = safetyService.getEmergencyCircle(owner);

    assert.equal(circle.preferences.allow_location_sharing, false);
    assert.equal(circle.preferences.emergency_circle_enabled, true);
    assert.equal(circle.readiness.state, 'INCOMPLETE');
    assert.equal(circle.execution_capabilities.sos_activation, false);
    assert.equal(circle.execution_capabilities.trusted_contact_notifications, false);
    assert.equal(circle.execution_capabilities.live_location_streaming, false);
    assert.match(circle.readiness.notes.join(' '), /not active yet/i);
  });

  it('adds a prioritized contact with three explicit incident scopes and no location sharing by default', () => {
    const contact = safetyService.addContact(owner, {
      display_name: 'Mary Wanjiku',
      relationship_label: 'Sister',
      phone_e164: '+254700111222',
      email: 'mary@example.com',
      priority: 1,
    });

    assert.equal(contact.priority, 1);
    assert.equal(contact.verification_status, 'UNVERIFIED');
    assert.equal(contact.scopes.length, 3);

    for (const level of Object.values(SafetyIncidentLevel)) {
      const scope = contact.scopes.find((item) => item.incident_level === level);
      assert.ok(scope);
      assert.equal(scope?.notify_contact, true);
      assert.equal(scope?.share_live_location, false);
      assert.equal(scope?.share_incident_type, true);
      assert.equal(scope?.share_assistance_status, true);
    }

    const readiness = safetyService.getReadiness(owner);
    assert.equal(readiness.state, 'CONFIGURED');
    assert.equal(readiness.active_contact_count, 1);

    const outbox = db.prepare(
      "SELECT type, payload FROM outbox_events WHERE type = 'safety.emergency_contact.added'"
    ).get() as any;
    assert.ok(outbox);
    assert.equal(String(outbox.payload).includes('+254700111222'), false);
    assert.equal(String(outbox.payload).includes('mary@example.com'), false);

    const history = db.prepare(
      'SELECT change_type, summary_json FROM safety_configuration_history WHERE user_id = ?'
    ).all(owner.user_id) as any[];
    assert.equal(history.length, 1);
    assert.equal(String(history[0].summary_json).includes('+254700111222'), false);
  });

  it('keeps Emergency Circle resources strictly user-scoped', () => {
    const contact = safetyService.addContact(owner, {
      display_name: 'Trusted Person',
      phone_e164: '+254711111111',
      priority: 1,
    });

    assert.throws(
      () => safetyService.updateContact(other, contact.id, { priority: 2 }),
      (err: any) => {
        assert.ok(err instanceof CanonicalAppError);
        assert.equal(err.code, ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE);
        return true;
      }
    );

    assert.equal(safetyRepository.listContacts(other.user_id).length, 0);
    assert.equal(safetyRepository.listContacts(owner.user_id).length, 1);
  });

  it('supports explicit per-incident location permission and a separate master location-sharing gate', () => {
    const contact = safetyService.addContact(owner, {
      display_name: 'Peter Kamau',
      phone_e164: '+254722222222',
      priority: 1,
    });

    const serious = contact.scopes.find(
      (scope) => scope.incident_level === SafetyIncidentLevel.SERIOUS_EMERGENCY
    )!;

    const updated = safetyService.updateContactScope(owner, contact.id, {
      incident_level: SafetyIncidentLevel.SERIOUS_EMERGENCY,
      notify_contact: true,
      share_incident_type: true,
      share_vehicle_summary: true,
      share_live_location: true,
      share_assistance_status: true,
      share_callback_number: true,
    });
    assert.equal(
      updated.scopes.find((scope) => scope.incident_level === SafetyIncidentLevel.SERIOUS_EMERGENCY)
        ?.share_live_location,
      true
    );

    // Contact scope does not silently enable the global master permission.
    assert.equal(safetyService.getPreferences(owner).allow_location_sharing, false);

    const preferences = safetyService.updatePreferences(owner, {
      allow_location_sharing: true,
      safety_check_timeout_seconds: 180,
      sos_cancel_countdown_seconds: 5,
    });
    assert.equal(preferences.allow_location_sharing, true);
    assert.equal(preferences.safety_check_timeout_seconds, 180);
  });

  it('revokes contacts without destructive deletion and preserves configuration history', () => {
    const contact = safetyService.addContact(owner, {
      display_name: 'Jane Doe',
      phone_e164: '+254733333333',
      priority: 2,
    });

    safetyService.revokeContact(owner, contact.id);

    assert.equal(safetyRepository.listContacts(owner.user_id).length, 0);
    const historical = safetyRepository.getContact(owner.user_id, contact.id);
    assert.equal(historical?.status, 'REVOKED');
    assert.ok(historical?.revoked_at);

    const history = db.prepare(
      'SELECT change_type FROM safety_configuration_history WHERE user_id = ? ORDER BY created_at'
    ).all(owner.user_id) as any[];
    assert.ok(history.some((row) => row.change_type === 'EMERGENCY_CONTACT_REVOKED'));
  });

  it('rejects unsafe or ambiguous configuration values', () => {
    assert.throws(
      () => safetyService.addContact(owner, { display_name: 'No Channel' }),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.VALIDATION_ERROR
    );

    assert.throws(
      () =>
        safetyService.addContact(owner, {
          display_name: 'Bad Phone',
          phone_e164: '0700000000',
        }),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.VALIDATION_ERROR
    );

    assert.throws(
      () => safetyService.updatePreferences(owner, { safety_check_timeout_seconds: 5 }),
      (err: any) => err instanceof CanonicalAppError && err.code === ErrorCode.VALIDATION_ERROR
    );
  });
});
