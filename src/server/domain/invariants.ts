/**
 * Domain Invariant Enforcement (GAR-000 §2, GAR-002 §6)
 */

import { CanonicalAppError, ErrorCode } from '../../shared/errors';

/**
 * Validates state machine transition according to allowed exit rules
 */
export function assertStateTransition<TState extends string>(
  currentState: TState,
  targetState: TState,
  allowedTransitions: Record<TState, readonly TState[]>,
  entityName: string
): void {
  const allowed = allowedTransitions[currentState];
  if (!allowed || !allowed.includes(targetState)) {
    throw new CanonicalAppError(
      ErrorCode.INVALID_STATE,
      `Invalid state transition for ${entityName}: Cannot transition from ${currentState} to ${targetState}. Allowed: [${allowed ? allowed.join(', ') : 'none'}]`,
      409
    );
  }
}

/**
 * Asserts a business invariant condition or throws CONFLICT/INVALID_STATE
 */
export function assertBusinessInvariant(
  condition: boolean,
  message: string,
  code: ErrorCode = ErrorCode.CONFLICT
): asserts condition {
  if (!condition) {
    throw new CanonicalAppError(code, message, 409);
  }
}
