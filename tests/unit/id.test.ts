import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCanonicalUuid, generatePrefixedId, isValidCanonicalId, assertCanonicalId } from '../../src/server/domain/id';
import { CanonicalAppError } from '../../src/shared/errors';

describe('Canonical ID Architecture (GAR-000 §12, GAR-033 §7)', () => {
  it('generates valid UUIDv4 strings', () => {
    const id = generateCanonicalUuid();
    assert.equal(typeof id, 'string');
    assert.equal(isValidCanonicalId(id), true);
  });

  it('generates valid prefixed canonical IDs', () => {
    const vehicleId = generatePrefixedId('veh');
    assert.ok(vehicleId.startsWith('veh_'));
    assert.equal(isValidCanonicalId(vehicleId), true);

    const eventId = generatePrefixedId('evt');
    assert.ok(eventId.startsWith('evt_'));
    assert.equal(isValidCanonicalId(eventId), true);
  });

  it('rejects sequential numbers and malformed IDs', () => {
    assert.equal(isValidCanonicalId('1234'), false);
    assert.equal(isValidCanonicalId('admin'), false);
    assert.equal(isValidCanonicalId(''), false);
    assert.equal(isValidCanonicalId('select * from vehicles'), false);
  });

  it('throws CanonicalAppError when assertCanonicalId fails', () => {
    assert.throws(
      () => assertCanonicalId('invalid_id', 'vehicle_id'),
      (err: unknown) => {
        assert.ok(err instanceof CanonicalAppError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });
});
