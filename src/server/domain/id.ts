/**
 * Canonical Identifier Strategy (GAR-000 §12, GAR-002 §4, GAR-033 §7)
 *
 * Rules:
 * 1. All business resources use opaque globally unique IDs; sequential DB IDs are never exposed.
 * 2. Public IDs remain stable across archival and ownership transfer.
 * 3. Consistent serialization and strict boundary validation.
 */

import crypto from 'node:crypto';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';

export type EntityIdPrefix =
  | 'usr'   // User
  | 'acc'   // Account
  | 'org'   // Organization
  | 'mem'   // Membership
  | 'inv'   // Organization Invitation
  | 'ses'   // Session
  | 'crd'   // Credential
  | 'chg'   // Verification Challenge / Reset
  | 'prf'   // Profile
  | 'rol'   // Role
  | 'prm'   // Permission
  | 'veh'   // Vehicle
  | 'vin'   // Vehicle Identifier
  | 'own'   // Vehicle Ownership
  | 'tl'    // Timeline event
  | 'srv'   // Service Provider
  | 'bkg'   // Booking
  | 'job'   // Job / Work order
  | 'inc'   // Incident (Roadside / SOS)
  | 'evt'   // Event envelope
  | 'pay'   // Payment / Ledger
  | 'fil'   // File object
  | 'flg'   // Feature flag
  | 'odo'   // Odometer observation
  | 'vdoc'  // Vehicle document
  | 'vrel'  // Vehicle relationship
  | 'vid'   // Vehicle identifier
  | 'rsa'   // Roadside assignment
  | 'rsl'   // Roadside location
  | 'rtr'   // Roadside triage
  | 'rsr'   // Roadside request
  | 'rpo'   // Roadside provider offer
  | 'rsi'   // Roadside intervention
  | 'tow'   // Tow handoff
  | 'cat';  // Catalog entry

/**
 * Generate a cryptographically secure canonical UUID v4
 */
export function generateCanonicalUuid(): string {
  return crypto.randomUUID();
}

/**
 * Generate a prefixed opaque canonical identifier (e.g. veh_12345678-1234-...)
 */
export function generatePrefixedId(prefix: EntityIdPrefix): string {
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return `${prefix}_${uuid}`;
}

export function generateCanonicalId(prefix: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return `${prefix}_${uuid}`;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREFIXED_ID_REGEX = /^[a-z]{2,4}_[0-9a-f]{32}$/i;

/**
 * Validate that an ID conforms to canonical opaque format
 */
export function isValidCanonicalId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  return UUID_REGEX.test(id) || PREFIXED_ID_REGEX.test(id);
}

/**
 * Assert canonical ID or throw standard VALIDATION_ERROR
 */
export function assertCanonicalId(id: string, fieldName = 'id'): void {
  if (!isValidCanonicalId(id)) {
    throw new CanonicalAppError(
      ErrorCode.VALIDATION_ERROR,
      `Invalid canonical identifier format for ${fieldName}: must be standard UUID or prefixed hex ID.`,
      400,
      [{ field: fieldName, message: 'Invalid ID format' }]
    );
  }
}
