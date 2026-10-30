import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';
import { DataProvenanceClass, PROVENANCE_TRUST_ORDER } from '../../src/shared/provenance';
import { SafetyCriticalityClass, SafetyWorkflowState } from '../../src/shared/safety';
import { assertStateTransition, assertBusinessInvariant } from '../../src/server/domain/invariants';

describe('Canonical Validation & Invariant Architecture', () => {
  it('maps CanonicalAppError to appropriate HTTP status codes', () => {
    const valErr = new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid');
    assert.equal(valErr.statusCode, 400);

    const authErr = new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Forbidden');
    assert.equal(authErr.statusCode, 403);

    const notFoundErr = new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Missing');
    assert.equal(notFoundErr.statusCode, 404);

    const conflictErr = new CanonicalAppError(ErrorCode.CONFLICT, 'Conflict');
    assert.equal(conflictErr.statusCode, 409);

    const rateErr = new CanonicalAppError(ErrorCode.RATE_LIMITED, 'Throttled');
    assert.equal(rateErr.statusCode, 429);
  });

  it('enforces Data Truth Hierarchy trust rankings', () => {
    assert.ok(PROVENANCE_TRUST_ORDER[DataProvenanceClass.EXTERNALLY_VERIFIED] > PROVENANCE_TRUST_ORDER[DataProvenanceClass.PROVIDER_RECORDED]);
    assert.ok(PROVENANCE_TRUST_ORDER[DataProvenanceClass.PROVIDER_RECORDED] > PROVENANCE_TRUST_ORDER[DataProvenanceClass.DEVICE_OBSERVED]);
    assert.ok(PROVENANCE_TRUST_ORDER[DataProvenanceClass.DEVICE_OBSERVED] > PROVENANCE_TRUST_ORDER[DataProvenanceClass.OWNER_ASSERTED]);
    assert.ok(PROVENANCE_TRUST_ORDER[DataProvenanceClass.OWNER_ASSERTED] > PROVENANCE_TRUST_ORDER[DataProvenanceClass.AI_MODEL_INFERRED]);
  });

  it('validates allowed state transitions in state machines', () => {
    const allowed = {
      DRAFT: ['ACTIVE', 'ARCHIVED'] as const,
      ACTIVE: ['IN_SERVICE', 'SOLD'] as const,
      IN_SERVICE: ['ACTIVE'] as const,
      SOLD: [] as const,
      ARCHIVED: [] as const,
    };

    // Valid transition should pass
    assert.doesNotThrow(() => {
      assertStateTransition('DRAFT', 'ACTIVE', allowed, 'Vehicle');
    });

    // Invalid transition should throw CONFLICT/INVALID_STATE
    assert.throws(
      () => assertStateTransition('DRAFT', 'IN_SERVICE', allowed, 'Vehicle'),
      (err: unknown) => {
        assert.ok(err instanceof CanonicalAppError);
        assert.equal(err.code, ErrorCode.INVALID_STATE);
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });

  it('asserts business invariants', () => {
    assert.doesNotThrow(() => {
      assertBusinessInvariant(5 > 2, 'Should pass');
    });

    assert.throws(
      () => assertBusinessInvariant(2 > 5, 'Math failed'),
      (err: unknown) => {
        assert.ok(err instanceof CanonicalAppError);
        assert.equal(err.code, ErrorCode.CONFLICT);
        return true;
      }
    );
  });
});
