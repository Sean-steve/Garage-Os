import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, normalizePhone } from '../src/server/identity/normalizer';
import {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  hashOpaqueToken,
  generateSecureToken,
  generateNumericOtp,
} from '../src/server/identity/password';
import { CanonicalAppError } from '../src/shared/errors';

describe('Identity: Normalizer & Password Security (GAR-003 §4-§6)', () => {
  describe('Identifier Normalization', () => {
    test('normalizes email: trim, lowercase, and RFC 5322 validation', () => {
      const email = '  Jane.Doe+Test@GarageOS.TEST  ';
      const normalized = normalizeEmail(email);
      assert.equal(normalized, 'jane.doe+test@garageos.test');
    });

    test('rejects invalid email formats', () => {
      assert.throws(() => normalizeEmail(''), CanonicalAppError);
      assert.throws(() => normalizeEmail('not-an-email'), CanonicalAppError);
      assert.throws(() => normalizeEmail('@domain.com'), CanonicalAppError);
      assert.throws(() => normalizeEmail('user@'), CanonicalAppError);
    });

    test('normalizes phone numbers to canonical international E.164 format', () => {
      assert.equal(normalizePhone('+254 700 123 456'), '+254700123456');
      assert.equal(normalizePhone('0700123456'), '+254700123456');
      assert.equal(normalizePhone('00254700123456'), '+254700123456');
    });

    test('rejects invalid phone numbers', () => {
      assert.throws(() => normalizePhone('123'), CanonicalAppError);
      assert.throws(() => normalizePhone('abc'), CanonicalAppError);
    });
  });

  describe('Password Policy & Hashing', () => {
    test('validates password policy (min 8 chars, letter + number/symbol)', () => {
      assert.doesNotThrow(() => validatePasswordPolicy('ValidPass1!'));
      assert.throws(() => validatePasswordPolicy('short1!'), CanonicalAppError); // < 8
      assert.throws(() => validatePasswordPolicy('alllettersonly'), CanonicalAppError); // no number or symbol
      assert.throws(() => validatePasswordPolicy('1234567890'), CanonicalAppError); // no letter
    });

    test('hashes password using PBKDF2 with unique salt and verifies correctly', () => {
      const password = 'StrongPassword123!';
      const { hashString, saltHex } = hashPassword(password);

      assert.ok(hashString.startsWith('$pbkdf2$100000$'));
      assert.ok(saltHex.length > 16);

      // Verify correct password
      assert.equal(verifyPassword(password, hashString), true);

      // Verify incorrect password
      assert.equal(verifyPassword('WrongPassword123!', hashString), false);
    });

    test('hashes opaque tokens with SHA-256 for secure storage at rest', () => {
      const token = generateSecureToken(32);
      const hash1 = hashOpaqueToken(token);
      const hash2 = hashOpaqueToken(token);

      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64); // SHA-256 hex length
    });

    test('generates valid 6-digit numeric OTPs', () => {
      const otp = generateNumericOtp();
      assert.equal(otp.length, 6);
      assert.ok(/^\d{6}$/.test(otp));
    });
  });
});
