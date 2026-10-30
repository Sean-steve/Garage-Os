import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/server/database/migrations';
import { setDatabaseForTesting } from '../src/server/database/connection';
import { AuthService } from '../src/server/identity/authService';
import { AccountStatus } from '../src/server/identity/types';
import { CanonicalAppError } from '../src/shared/errors';

describe('Identity: AuthService & Session Lifecycle (GAR-003, GAR-033 §12A)', () => {
  let db: DatabaseSync;
  let authService: AuthService;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    setDatabaseForTesting(db);
    runMigrations(db);
    authService = new AuthService();
  });

  test('registers new user with email, profile, account, credentials and verification challenge', () => {
    const res = authService.registerUser({
      email: 'user.test@garageos.test',
      password: 'SecurePassword123!',
      fullName: 'Alice Muthoni',
      phone: '+254711223344',
    });

    assert.ok(res.user.id.startsWith('usr_'));
    assert.equal(res.user.email, 'user.test@garageos.test');
    assert.equal(res.user.accountStatus, AccountStatus.PENDING_VERIFICATION);
    assert.ok(res.verificationToken);

    // Verify DB state
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?;').get(res.user.id) as any;
    assert.equal(userRow.email, 'user.test@garageos.test');
    assert.equal(userRow.phone, '+254711223344');

    const profileRow = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?;').get(res.user.id) as any;
    assert.equal(profileRow.display_name, 'Alice Muthoni');
  });

  test('rejects registration with duplicate email', () => {
    authService.registerUser({
      email: 'dup@garageos.test',
      password: 'Password123!',
      fullName: 'First Person',
    });

    assert.throws(
      () =>
        authService.registerUser({
          email: 'DUP@garageos.test', // Case-normalized match
          password: 'Password123!',
          fullName: 'Second Person',
        }),
      (err: any) => err instanceof CanonicalAppError && err.statusCode === 409
    );
  });

  test('verifies email challenge and transitions account to ACTIVE', () => {
    const reg = authService.registerUser({
      email: 'verify.me@garageos.test',
      password: 'Password123!',
      fullName: 'Charlie Otieno',
    });

    assert.equal(reg.user.accountStatus, AccountStatus.PENDING_VERIFICATION);

    // Verify with invalid code -> throws
    assert.throws(
      () => authService.verifyEmail(reg.user.id, '000000'),
      CanonicalAppError
    );

    // Verify with correct code
    const verified = authService.verifyEmail(reg.user.id, reg.verificationToken!);
    assert.equal(verified, true);

    const userRow = db.prepare('SELECT account_status, email_verified_at FROM users WHERE id = ?;').get(reg.user.id) as any;
    assert.equal(userRow.account_status, AccountStatus.ACTIVE);
    assert.ok(userRow.email_verified_at);
  });

  test('logs in user with correct credentials and returns session token', () => {
    authService.registerUser({
      email: 'login.user@garageos.test',
      password: 'Password123!',
      fullName: 'David Wekesa',
    });

    const loginRes = authService.loginUser({
      email: 'login.user@garageos.test',
      password: 'Password123!',
      deviceInfo: 'Test Device',
    });

    assert.ok(loginRes.session_token);
    assert.ok(loginRes.expires_at);
    assert.equal(loginRes.user.email, 'login.user@garageos.test');

    // Authenticate session via token
    const actor = authService.authenticateSession(loginRes.session_token);
    assert.ok(actor);
    assert.equal(actor.email, 'login.user@garageos.test');
  });

  test('locks account after 5 consecutive failed login attempts', () => {
    authService.registerUser({
      email: 'lockout@garageos.test',
      password: 'RealPassword123!',
      fullName: 'Eva Njoki',
    });

    for (let i = 1; i <= 4; i++) {
      assert.throws(
        () => authService.loginUser({ email: 'lockout@garageos.test', password: 'WrongPassword!' }),
        (err: any) => err.statusCode === 401
      );
    }

    // 5th attempt triggers lockout
    assert.throws(
      () => authService.loginUser({ email: 'lockout@garageos.test', password: 'WrongPassword!' }),
      (err: any) => err.statusCode === 401
    );

    // 6th attempt is blocked by lockout
    assert.throws(
      () => authService.loginUser({ email: 'lockout@garageos.test', password: 'RealPassword123!' }),
      (err: any) => err.statusCode === 429
    );
  });

  test('password reset challenge updates password and invalidates all existing sessions', () => {
    const reg = authService.registerUser({
      email: 'reset.me@garageos.test',
      password: 'InitialPassword123!',
      fullName: 'Frank Kimani',
    });

    // Login to create active session
    const initialLogin = authService.loginUser({
      email: 'reset.me@garageos.test',
      password: 'InitialPassword123!',
    });
    assert.ok(authService.authenticateSession(initialLogin.session_token));

    // Request reset
    const resetReq = authService.requestPasswordReset('reset.me@garageos.test');
    assert.ok(resetReq.devResetToken);

    // Complete reset
    authService.resetPassword(resetReq.devResetToken!, 'BrandNewPassword123!');

    // Existing session MUST be revoked
    const revokedActor = authService.authenticateSession(initialLogin.session_token);
    assert.equal(revokedActor, null);

    // Login with new password succeeds
    const newLogin = authService.loginUser({
      email: 'reset.me@garageos.test',
      password: 'BrandNewPassword123!',
    });
    assert.ok(newLogin.session_token);
  });

  test('logout revokes current session, logout-all revokes all sessions', () => {
    authService.registerUser({
      email: 'logout.user@garageos.test',
      password: 'Password123!',
      fullName: 'Grace Achieng',
    });

    const ses1 = authService.loginUser({ email: 'logout.user@garageos.test', password: 'Password123!' });
    const ses2 = authService.loginUser({ email: 'logout.user@garageos.test', password: 'Password123!' });

    assert.ok(authService.authenticateSession(ses1.session_token));
    assert.ok(authService.authenticateSession(ses2.session_token));

    // Logout ses1
    authService.logout(ses1.session_token);
    assert.equal(authService.authenticateSession(ses1.session_token), null);
    assert.ok(authService.authenticateSession(ses2.session_token));

    // Logout all
    authService.logoutAll(ses2.user.id);
    assert.equal(authService.authenticateSession(ses2.session_token), null);
  });
});
