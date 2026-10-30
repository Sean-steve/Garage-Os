/**
 * Canonical Identifier Normalization (GAR-003 §4, GAR-039 §8)
 *
 * Rules:
 * 1. Emails: Trim whitespace, lowercase, and validate RFC 5322 compliance.
 * 2. Phone numbers: Normalize to canonical E.164-compatible international format (+[country][national_number]).
 * 3. Never scatter normalization logic across individual controllers.
 */

import { CanonicalAppError, ErrorCode } from '../../shared/errors';

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Normalizes and validates an email address
 */
export function normalizeEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Email address is required', 400);
  }

  const trimmed = email.trim().toLowerCase();

  if (trimmed.length > 254) {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Email address exceeds maximum length of 254 characters', 400);
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid email address format', 400);
  }

  return trimmed;
}

/**
 * Normalizes and validates phone numbers to canonical international format (E.164)
 * Supports inputs like "+254 700 123 456", "0700123456" with default country code, etc.
 */
export function normalizePhone(phone: string, defaultCountryPrefix = '+254'): string {
  if (!phone || typeof phone !== 'string') {
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Phone number is required', 400);
  }

  const raw = phone.trim();
  // Strip all non-digit and non-plus characters
  let cleaned = raw.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  } else if (cleaned.startsWith('0')) {
    // Local prefix with leading zero
    cleaned = defaultCountryPrefix + cleaned.slice(1);
  } else if (!cleaned.startsWith('+')) {
    cleaned = defaultCountryPrefix + cleaned;
  }

  // Canonical E.164: + followed by 7 to 15 digits
  const E164_REGEX = /^\+[1-9]\d{6,14}$/;
  if (!E164_REGEX.test(cleaned)) {
    throw new CanonicalAppError(
      ErrorCode.VALIDATION_ERROR,
      `Invalid international phone number format: must conform to E.164 (+[country][number])`,
      400
    );
  }

  return cleaned;
}
