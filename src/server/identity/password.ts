/**
 * Canonical Password Security & Policy Enforcement (GAR-003 §6, GAR-039 §5)
 *
 * Requirements:
 * 1. Industry-standard password hashing with PBKDF2-HMAC-SHA512 (100,000 rounds, 64-byte salt).
 * 2. Timing-safe comparison to resist timing attacks.
 * 3. Strict password policy (min 8 chars, max 128 chars, non-empty, complexity checks).
 * 4. Zero plaintext logging; zero reversible storage.
 * 5. Cryptographic token generation & hashing for sessions, resets, and challenges.
 */

import crypto from 'node:crypto';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';

const HASH_ITERATIONS = 100000;
const HASH_KEY_LENGTH = 64;
const HASH_DIGEST = 'sha512';
const SALT_BYTES = 32;

/**
 * Validate password against canonical security policy
 */
export function validatePasswordPolicy(password: string): void {
  if (!password || typeof password !== 'string') {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Password is required', 400);
  }

  if (password.length < 8) {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Password must be at least 8 characters long', 400);
  }

  if (password.length > 128) {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Password must not exceed 128 characters', 400);
  }

  // Must contain at least one letter and at least one number or special character
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password);

  if (!hasLetter || !hasNumberOrSymbol) {
    throw new CanonicalAppError(
      ErrorCode.VALIDATION_ERROR,
      'Password must contain at least one letter and at least one number or special character',
      400
    );
  }
}

/**
 * Hash a password using PBKDF2-HMAC-SHA512
 * Returns serialized format: $pbkdf2$iterations$saltHex$hashHex
 */
export function hashPassword(password: string): { hashString: string; saltHex: string } {
  validatePasswordPolicy(password);

  const salt = crypto.randomBytes(SALT_BYTES);
  const derivedKey = crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_DIGEST);

  const saltHex = salt.toString('hex');
  const hashHex = derivedKey.toString('hex');
  const hashString = `$pbkdf2$${HASH_ITERATIONS}$${saltHex}$${hashHex}`;

  return { hashString, saltHex };
}

/**
 * Verify a candidate password against stored serialized hash using timing-safe comparison
 */
export function verifyPassword(candidatePassword: string, storedHashString: string): boolean {
  if (!candidatePassword || !storedHashString) return false;

  try {
    const parts = storedHashString.split('$');
    // Format: ["", "pbkdf2", iterations, saltHex, hashHex]
    if (parts.length !== 5 || parts[1] !== 'pbkdf2') {
      return false;
    }

    const iterations = parseInt(parts[2], 10);
    const salt = Buffer.from(parts[3], 'hex');
    const expectedKey = Buffer.from(parts[4], 'hex');

    const derivedKey = crypto.pbkdf2Sync(candidatePassword, salt, iterations, expectedKey.length, HASH_DIGEST);

    return crypto.timingSafeEqual(derivedKey, expectedKey);
  } catch {
    return false;
  }
}

/**
 * Hash an opaque token (such as session token, reset challenge, or API key) for safe storage at rest
 */
export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a cryptographically secure random opaque token
 */
export function generateSecureToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * Generate a 6-digit cryptographically secure numeric OTP
 */
export function generateNumericOtp(): string {
  const num = crypto.randomInt(100000, 999999);
  return String(num);
}
