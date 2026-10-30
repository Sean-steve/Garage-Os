import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { featureFlagManager } from '../../src/server/featureFlags/flags';
import { getDatabase } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';

describe('Feature Flag Engine (GAR-046 §4.x & §7)', () => {
  it('initializes flags and checks enabled state by role', () => {
    const db = getDatabase({ memory: true });
    runMigrations(db);
    featureFlagManager.init();

    // Default canonical flags should be present
    const flags = featureFlagManager.getAllFlags();
    assert.ok(flags.length >= 5);

    // Test role restriction
    const isOwnerAllowed = featureFlagManager.isEnabled('marketplace_v3', { id: 'usr_1', role: 'VEHICLE_OWNER' });
    assert.equal(isOwnerAllowed, true);

    const isGuestAllowed = featureFlagManager.isEnabled('marketplace_v3', { id: 'usr_2', role: 'UNKNOWN_ROLE' });
    assert.equal(isGuestAllowed, false);
  });
});
