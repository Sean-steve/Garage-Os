/**
 * Canonical Authentication & Account Service (GAR-003, GAR-033 §12A, GAR-039 §5)
 *
 * Implements:
 * 1. User registration with email/phone normalization & password policy.
 * 2. Secure credential establishing & verification challenges.
 * 3. Session management with SHA-256 token hashing at rest.
 * 4. Password reset workflows with full session revocation.
 * 5. Multi-tenant context loading & safe actor serialization.
 */

import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { generatePrefixedId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { DataProvenanceClass } from '../../shared/provenance';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { recordAuditEvent } from '../security/audit';
import { jobEngine } from '../jobs/jobEngine';
import { normalizeEmail, normalizePhone } from './normalizer';
import {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  hashOpaqueToken,
  generateSecureToken,
  generateNumericOtp,
} from './password';
import {
  AccountStatus,
  AuthenticatedActorContext,
  ChallengeType,
  MembershipRole,
  MembershipStatus,
  OrganizationStatus,
  OrganizationType,
  PlatformRole,
  SessionStatus,
  UserEntity,
  UserProfileEntity,
} from './types';
import { ROLE_PERMISSIONS } from './rbac';

export interface RegisterUserInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  correlationId?: string;
}

export interface LoginUserInput {
  email: string;
  password: string;
  deviceInfo?: string;
  ipAddress?: string;
  correlationId?: string;
}

export class AuthService {
  /**
   * Register a new user human identity and initial personal account
   */
  public registerUser(input: RegisterUserInput): {
    user: { id: string; email: string; fullName: string; accountStatus: AccountStatus };
    verificationToken?: string;
  } {
    const normalizedEmail = normalizeEmail(input.email);
    const normalizedPhone = input.phone ? normalizePhone(input.phone) : null;
    validatePasswordPolicy(input.password);

    if (!input.fullName || input.fullName.trim().length < 2) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Full name must be at least 2 characters', 400);
    }

    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?;').get(normalizedEmail);
    if (existing) {
      // In registration, throw conflict for clear UX in test & app
      throw new CanonicalAppError(ErrorCode.CONFLICT, 'An account with this email address already exists', 409);
    }

    if (normalizedPhone) {
      const existingPhone = db.prepare('SELECT id FROM users WHERE phone = ?;').get(normalizedPhone);
      if (existingPhone) {
        throw new CanonicalAppError(ErrorCode.CONFLICT, 'An account with this phone number already exists', 409);
      }
    }

    const userId = generatePrefixedId('usr');
    const accountId = generatePrefixedId('acc');
    const credentialId = generatePrefixedId('crd');
    const challengeId = generatePrefixedId('chg');
    const now = getCurrentUtcIsoString();
    const correlationId = input.correlationId || `reg_${Date.now()}`;

    const { hashString, saltHex } = hashPassword(input.password);
    const verificationCode = generateNumericOtp();
    const tokenHash = hashOpaqueToken(verificationCode);

    // 24 hour verification expiry
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const parts = input.fullName.trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    withTransaction((ctx) => {
      // 1. Insert User Identity
      ctx.db
        .prepare(`
          INSERT INTO users (
            id, email, phone, full_name, role, status, account_status,
            failed_login_attempts, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'VEHICLE_OWNER', 'ACTIVE', 'PENDING_VERIFICATION', 0, ?, ?);
        `)
        .run(userId, normalizedEmail, normalizedPhone, input.fullName.trim(), now, now);

      // 2. Insert Personal Account
      ctx.db
        .prepare(`
          INSERT INTO accounts (id, user_id, account_type, name, status, created_at, updated_at)
          VALUES (?, ?, 'PERSONAL', ?, 'ACTIVE', ?, ?);
        `)
        .run(accountId, userId, `${input.fullName.trim()}'s Garage Account`, now, now);

      // 3. Insert Profile
      ctx.db
        .prepare(`
          INSERT INTO user_profiles (
            user_id, display_name, first_name, last_name, preferred_language, timezone, country, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'en', 'Africa/Nairobi', 'KE', ?, ?);
        `)
        .run(userId, input.fullName.trim(), firstName, lastName, now, now);

      // 4. Insert Credentials
      ctx.db
        .prepare(`
          INSERT INTO credentials (id, user_id, credential_type, secret_hash, salt, created_at, updated_at)
          VALUES (?, ?, 'PASSWORD', ?, ?, ?, ?);
        `)
        .run(credentialId, userId, hashString, saltHex, now, now);

      // 5. Insert Verification Challenge
      ctx.db
        .prepare(`
          INSERT INTO verification_challenges (
            id, user_id, challenge_type, identifier, token_hash, attempts, max_attempts, expires_at, created_at
          ) VALUES (?, ?, 'EMAIL_VERIFICATION', ?, ?, 0, 5, ?, ?);
        `)
        .run(challengeId, userId, normalizedEmail, tokenHash, expiry, now);

      // 6. Transactional Outbox Event: UserRegistered
      const userRegisteredEvent = createCanonicalEventEnvelope({
        type: 'UserRegistered',
        correlation_id: correlationId,
        subject_ids: { user_id: userId, account_id: accountId },
        provenance_class: DataProvenanceClass.OWNER_ASSERTED,
        payload: {
          user_id: userId,
          email: normalizedEmail,
          full_name: input.fullName.trim(),
          account_status: AccountStatus.PENDING_VERIFICATION,
        },
      });
      enqueueOutboxEvent(userRegisteredEvent, ctx.db);

      // 7. Transactional Outbox Event: EmailVerificationRequested
      const verificationEvent = createCanonicalEventEnvelope({
        type: 'EmailVerificationRequested',
        correlation_id: correlationId,
        subject_ids: { user_id: userId },
        provenance_class: DataProvenanceClass.DERIVED_DETERMINISTIC,
        payload: {
          user_id: userId,
          email: normalizedEmail,
          expires_at: expiry,
        },
      });
      enqueueOutboxEvent(verificationEvent, ctx.db);

      // 8. Immutable Security Audit
      recordAuditEvent(
        {
          actor_id: userId,
          actor_type: 'USER',
          action: 'USER_REGISTERED',
          resource_type: 'user',
          resource_id: userId,
          correlation_id: correlationId,
          source: 'AUTH_API',
          after_state: { email: normalizedEmail, account_status: AccountStatus.PENDING_VERIFICATION },
        },
        ctx.db
      );
    });

    // Enqueue background email delivery job
    jobEngine.enqueue('identity.send_verification_email', {
      userId,
      email: normalizedEmail,
      tokenOrCode: verificationCode,
      expiresAt: expiry,
    });

    return {
      user: {
        id: userId,
        email: normalizedEmail,
        fullName: input.fullName.trim(),
        accountStatus: AccountStatus.PENDING_VERIFICATION,
      },
      verificationToken: verificationCode,
    };
  }

  /**
   * Authenticate user with password credential
   */
  public loginUser(input: LoginUserInput): {
    session_token: string;
    expires_at: string;
    user: { id: string; email: string; account_status: AccountStatus; full_name: string };
    profile: UserProfileEntity;
    memberships: Array<Record<string, unknown>>;
    platform_roles: PlatformRole[];
  } {
    const normalizedEmail = normalizeEmail(input.email);
    const db = getDatabase();
    const correlationId = input.correlationId || `auth_${Date.now()}`;
    const now = getCurrentUtcIsoString();

    const userRow = db.prepare('SELECT * FROM users WHERE email = ?;').get(normalizedEmail) as any;

    // Protection against user enumeration / generic error
    if (!userRow) {
      recordAuditEvent({
        action: 'AUTHENTICATION_FAILED',
        actor_type: 'ANONYMOUS',
        resource_type: 'user',
        correlation_id: correlationId,
        source: 'AUTH_API',
        metadata: { reason: 'USER_NOT_FOUND', email_masked: normalizedEmail.slice(0, 3) + '***' },
      });
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Invalid identifier or password', 401);
    }

    const userId = userRow.id;
    const accountStatus = userRow.account_status as AccountStatus;

    // Check account lifecycle states
    if (accountStatus === AccountStatus.SUSPENDED) {
      recordAuditEvent({
        actor_id: userId,
        actor_type: 'USER',
        action: 'AUTHENTICATION_DENIED_SUSPENDED',
        resource_type: 'user',
        resource_id: userId,
        correlation_id: correlationId,
        source: 'AUTH_API',
      });
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Account is suspended. Please contact customer operations.', 403);
    }

    if (accountStatus === AccountStatus.DISABLED || accountStatus === AccountStatus.DELETED) {
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Account is disabled or deactivated', 403);
    }

    // Check lockout
    if (userRow.locked_until && new Date(userRow.locked_until).getTime() > Date.now()) {
      recordAuditEvent({
        actor_id: userId,
        actor_type: 'USER',
        action: 'AUTHENTICATION_DENIED_LOCKED',
        resource_type: 'user',
        resource_id: userId,
        correlation_id: correlationId,
        source: 'AUTH_API',
      });
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Account is temporarily locked due to repeated failed logins. Try again later.', 429);
    }

    // Lookup password credential
    const credRow = db.prepare("SELECT * FROM credentials WHERE user_id = ? AND credential_type = 'PASSWORD';").get(userId) as any;
    if (!credRow) {
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Invalid identifier or password', 401);
    }

    const isValid = verifyPassword(input.password, credRow.secret_hash);
    if (!isValid) {
      const attempts = (userRow.failed_login_attempts || 0) + 1;
      let lockUntil: string | null = null;
      let newStatus = accountStatus;

      // Lock after 5 consecutive failed attempts for 15 minutes
      if (attempts >= 5) {
        lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        newStatus = AccountStatus.LOCKED;
      }

      db.prepare(`
        UPDATE users
        SET failed_login_attempts = ?, locked_until = ?, account_status = ?, updated_at = ?
        WHERE id = ?;
      `).run(attempts, lockUntil, newStatus, now, userId);

      recordAuditEvent({
        actor_id: userId,
        actor_type: 'USER',
        action: 'AUTHENTICATION_FAILED',
        resource_type: 'user',
        resource_id: userId,
        correlation_id: correlationId,
        source: 'AUTH_API',
        metadata: { attempts, locked: Boolean(lockUntil) },
      });

      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Invalid identifier or password', 401);
    }

    // Password is valid - reset failed attempts & update last_authenticated_at
    const currentStatus = accountStatus === AccountStatus.LOCKED ? AccountStatus.ACTIVE : accountStatus;
    db.prepare(`
      UPDATE users
      SET failed_login_attempts = 0, locked_until = NULL, account_status = ?, last_authenticated_at = ?, updated_at = ?
      WHERE id = ?;
    `).run(currentStatus, now, now, userId);

    // Create session (7 days duration)
    const sessionId = generatePrefixedId('ses');
    const rawSessionToken = generateSecureToken(32);
    const tokenHash = hashOpaqueToken(rawSessionToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, device_info, ip_address, status, last_activity_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?);
    `).run(sessionId, userId, tokenHash, input.deviceInfo || 'Standard Browser Client', input.ipAddress || '127.0.0.1', now, expiresAt, now);

    // Fetch profile
    let profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?;').get(userId) as any;
    if (!profile) {
      profile = {
        user_id: userId,
        display_name: userRow.full_name || 'Garage OS User',
        first_name: '',
        last_name: '',
        avatar_url: null,
        preferred_language: 'en',
        timezone: 'Africa/Nairobi',
        country: 'KE',
        created_at: now,
        updated_at: now,
      };
    }

    // Fetch platform roles
    const platRoleRows = db.prepare('SELECT role FROM user_platform_roles WHERE user_id = ?;').all(userId) as Array<{ role: PlatformRole }>;
    const platformRoles = platRoleRows.map((r) => r.role);

    // Fetch memberships
    const memberships = db.prepare(`
      SELECT m.id as membership_id, m.organization_id, m.role, m.status, o.name as organization_name, o.organization_type, o.status as organization_status
      FROM organization_memberships m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ? AND m.status = 'ACTIVE' AND o.status = 'ACTIVE';
    `).all(userId) as any[];

    // Record audit event
    recordAuditEvent({
      actor_id: userId,
      actor_type: 'USER',
      action: 'AUTHENTICATION_SUCCEEDED',
      resource_type: 'session',
      resource_id: sessionId,
      correlation_id: correlationId,
      source: 'AUTH_API',
    });

    return {
      session_token: rawSessionToken,
      expires_at: expiresAt,
      user: {
        id: userId,
        email: normalizedEmail,
        account_status: currentStatus,
        full_name: profile.display_name || userRow.full_name,
      },
      profile,
      memberships,
      platform_roles: platformRoles,
    };
  }

  /**
   * Authenticate incoming request via session token and active organization context
   */
  public authenticateSession(token: string, activeOrgId?: string): AuthenticatedActorContext | null {
    if (!token) return null;

    const tokenHash = hashOpaqueToken(token);
    const db = getDatabase();
    const now = getCurrentUtcIsoString();

    const session = db.prepare(`
      SELECT * FROM sessions WHERE token_hash = ? AND status = 'ACTIVE' AND expires_at > ?;
    `).get(tokenHash, now) as any;

    if (!session) return null;

    // Update last activity
    db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?;').run(now, session.id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?;').get(session.user_id) as any;
    if (!user) return null;

    const profile = (db.prepare('SELECT * FROM user_profiles WHERE user_id = ?;').get(session.user_id) as unknown) as UserProfileEntity;

    const platRoleRows = db.prepare('SELECT role FROM user_platform_roles WHERE user_id = ?;').all(session.user_id) as Array<{ role: PlatformRole }>;
    const platformRoles = platRoleRows.map((r) => r.role);

    const membershipRows = db.prepare(`
      SELECT m.id as membership_id, m.organization_id, m.role, m.status, o.name as organization_name, o.organization_type, o.status as organization_status
      FROM organization_memberships m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ?;
    `).all(session.user_id) as any[];

    const memberships = membershipRows.map((r) => ({
      membership_id: r.membership_id,
      organization_id: r.organization_id,
      organization_name: r.organization_name,
      organization_type: r.organization_type as OrganizationType,
      organization_status: r.organization_status as OrganizationStatus,
      role: r.role as MembershipRole,
      status: r.status as MembershipStatus,
    }));

    let activeMembership: AuthenticatedActorContext['active_membership'];
    let effectiveActiveOrgId: string | undefined;

    if (activeOrgId) {
      const match = memberships.find((m) => m.organization_id === activeOrgId);
      if (match && match.status === MembershipStatus.ACTIVE) {
        effectiveActiveOrgId = activeOrgId;
        activeMembership = {
          ...match,
          permissions: (ROLE_PERMISSIONS[match.role] || []) as string[],
        };
      }
    } else if (memberships.length > 0) {
      // Pick first active organization
      const firstActive = memberships.find((m) => m.status === MembershipStatus.ACTIVE && m.organization_status === OrganizationStatus.ACTIVE);
      if (firstActive) {
        effectiveActiveOrgId = firstActive.organization_id;
        activeMembership = {
          ...firstActive,
          permissions: (ROLE_PERMISSIONS[firstActive.role] || []) as string[],
        };
      }
    }

    return {
      id: user.id,
      user_id: user.id,
      email: user.email,
      account_status: user.account_status as AccountStatus,
      profile: profile || {
        user_id: user.id,
        display_name: user.full_name || 'Garage OS User',
        preferred_language: 'en',
        timezone: 'Africa/Nairobi',
        country: 'KE',
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      platform_roles: platformRoles,
      memberships,
      active_organization_id: effectiveActiveOrgId,
      active_membership: activeMembership,
      session_id: session.id,
    };
  }

  /**
   * Helper to retrieve actor context by user ID directly (useful for background jobs & testing)
   */
  public getActorContextById(userId: string, activeOrgId?: string): AuthenticatedActorContext | null {
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?;').get(userId) as any;
    if (!user) return null;

    const profile = (db.prepare('SELECT * FROM user_profiles WHERE user_id = ?;').get(userId) as unknown) as UserProfileEntity;
    const platRoleRows = db.prepare('SELECT role FROM user_platform_roles WHERE user_id = ?;').all(userId) as Array<{ role: PlatformRole }>;
    const platformRoles = platRoleRows.map((r) => r.role);

    const membershipRows = db.prepare(`
      SELECT m.id as membership_id, m.organization_id, m.role, m.status, o.name as organization_name, o.organization_type, o.status as organization_status
      FROM organization_memberships m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ?;
    `).all(userId) as any[];

    const memberships = membershipRows.map((r) => ({
      membership_id: r.membership_id,
      organization_id: r.organization_id,
      organization_name: r.organization_name,
      organization_type: r.organization_type as OrganizationType,
      organization_status: r.organization_status as OrganizationStatus,
      role: r.role as MembershipRole,
      status: r.status as MembershipStatus,
    }));

    let activeMembership: AuthenticatedActorContext['active_membership'];
    let effectiveActiveOrgId: string | undefined;

    if (activeOrgId) {
      const match = memberships.find((m) => m.organization_id === activeOrgId);
      if (match && match.status === MembershipStatus.ACTIVE) {
        effectiveActiveOrgId = activeOrgId;
        activeMembership = {
          ...match,
          permissions: (ROLE_PERMISSIONS[match.role] || []) as string[],
        };
      }
    } else if (memberships.length > 0) {
      const firstActive = memberships.find((m) => m.status === MembershipStatus.ACTIVE && m.organization_status === OrganizationStatus.ACTIVE);
      if (firstActive) {
        effectiveActiveOrgId = firstActive.organization_id;
        activeMembership = {
          ...firstActive,
          permissions: (ROLE_PERMISSIONS[firstActive.role] || []) as string[],
        };
      }
    }

    return {
      id: user.id,
      user_id: user.id,
      email: user.email,
      account_status: user.account_status as AccountStatus,
      profile: profile || {
        user_id: user.id,
        display_name: user.full_name || 'Garage OS User',
        preferred_language: 'en',
        timezone: 'Africa/Nairobi',
        country: 'KE',
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      platform_roles: platformRoles,
      memberships,
      active_organization_id: effectiveActiveOrgId,
      active_membership: activeMembership,
      session_id: `ses_direct_${userId}`,
    };
  }

  /**
   * Logout current session
   */
  public logout(token: string, correlationId?: string): void {
    if (!token) return;
    const tokenHash = hashOpaqueToken(token);
    const db = getDatabase();

    const session = db.prepare('SELECT id, user_id FROM sessions WHERE token_hash = ?;').get(tokenHash) as any;
    if (session) {
      db.prepare("UPDATE sessions SET status = 'REVOKED' WHERE id = ?;").run(session.id);
      recordAuditEvent({
        actor_id: session.user_id,
        actor_type: 'USER',
        action: 'SESSION_REVOKED',
        resource_type: 'session',
        resource_id: session.id,
        correlation_id: correlationId || `logout_${Date.now()}`,
        source: 'AUTH_API',
      });
    }
  }

  /**
   * Invalidate all sessions for a user (Logout all devices)
   */
  public logoutAll(userId: string, correlationId?: string): void {
    const db = getDatabase();
    const now = getCurrentUtcIsoString();

    const result = db.prepare("UPDATE sessions SET status = 'REVOKED' WHERE user_id = ? AND status = 'ACTIVE';").run(userId);

    recordAuditEvent({
      actor_id: userId,
      actor_type: 'USER',
      action: 'ALL_SESSIONS_REVOKED',
      resource_type: 'user',
      resource_id: userId,
      correlation_id: correlationId || `logout_all_${Date.now()}`,
      source: 'AUTH_API',
      metadata: { revoked_count: result.changes, timestamp: now },
    });
  }

  /**
   * Verify email challenge
   */
  public verifyEmail(userId: string, codeOrToken: string, correlationId?: string): boolean {
    if (!codeOrToken) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Verification code is required', 400);
    }

    const tokenHash = hashOpaqueToken(codeOrToken.trim());
    const db = getDatabase();
    const now = getCurrentUtcIsoString();

    const challenge = db.prepare(`
      SELECT * FROM verification_challenges
      WHERE user_id = ? AND challenge_type = 'EMAIL_VERIFICATION' AND used_at IS NULL AND expires_at > ?;
    `).get(userId, now) as any;

    if (!challenge) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid or expired verification challenge', 400);
    }

    if (challenge.token_hash !== tokenHash) {
      db.prepare('UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = ?;').run(challenge.id);
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid verification code', 400);
    }

    withTransaction((ctx) => {
      ctx.db.prepare('UPDATE verification_challenges SET used_at = ? WHERE id = ?;').run(now, challenge.id);
      ctx.db.prepare(`
        UPDATE users
        SET email_verified_at = ?, account_status = 'ACTIVE', updated_at = ?
        WHERE id = ?;
      `).run(now, now, userId);

      recordAuditEvent(
        {
          actor_id: userId,
          actor_type: 'USER',
          action: 'EMAIL_VERIFIED',
          resource_type: 'user',
          resource_id: userId,
          correlation_id: correlationId || `verify_${Date.now()}`,
          source: 'AUTH_API',
        },
        ctx.db
      );
    });

    return true;
  }

  /**
   * Request password reset challenge
   */
  public requestPasswordReset(email: string, correlationId?: string): { message: string; devResetToken?: string } {
    const normalizedEmail = normalizeEmail(email);
    const db = getDatabase();
    const now = getCurrentUtcIsoString();

    const user = db.prepare('SELECT id, account_status FROM users WHERE email = ?;').get(normalizedEmail) as any;

    // Always return safe message regardless of user existence (Section 18 enumeration prevention)
    const responseMessage = 'If this email address is registered, a password reset challenge has been generated.';

    if (!user || user.account_status === AccountStatus.DELETED) {
      return { message: responseMessage };
    }

    const challengeId = generatePrefixedId('chg');
    const rawResetToken = generateSecureToken(32);
    const tokenHash = hashOpaqueToken(rawResetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    db.prepare(`
      INSERT INTO verification_challenges (
        id, user_id, challenge_type, identifier, token_hash, attempts, max_attempts, expires_at, created_at
      ) VALUES (?, ?, 'PASSWORD_RESET', ?, ?, 0, 5, ?, ?);
    `).run(challengeId, user.id, normalizedEmail, tokenHash, expiresAt, now);

    jobEngine.enqueue('identity.send_password_reset_email', {
      userId: user.id,
      email: normalizedEmail,
      token: rawResetToken,
      expiresAt,
    });

    recordAuditEvent({
      actor_id: user.id,
      actor_type: 'USER',
      action: 'PASSWORD_RESET_REQUESTED',
      resource_type: 'user',
      resource_id: user.id,
      correlation_id: correlationId || `reset_${Date.now()}`,
      source: 'AUTH_API',
    });

    return {
      message: responseMessage,
      devResetToken: rawResetToken,
    };
  }

  /**
   * Complete password reset using challenge token
   */
  public resetPassword(token: string, newPassword: string, correlationId?: string): void {
    if (!token) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Reset token is required', 400);
    }
    validatePasswordPolicy(newPassword);

    const tokenHash = hashOpaqueToken(token);
    const db = getDatabase();
    const now = getCurrentUtcIsoString();

    const challenge = db.prepare(`
      SELECT * FROM verification_challenges
      WHERE token_hash = ? AND challenge_type = 'PASSWORD_RESET' AND used_at IS NULL AND expires_at > ?;
    `).get(tokenHash, now) as any;

    if (!challenge) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Invalid or expired password reset challenge', 400);
    }

    const { hashString, saltHex } = hashPassword(newPassword);

    withTransaction((ctx) => {
      // 1. Mark challenge as used
      ctx.db.prepare('UPDATE verification_challenges SET used_at = ? WHERE id = ?;').run(now, challenge.id);

      // 2. Update credentials
      ctx.db.prepare(`
        UPDATE credentials SET secret_hash = ?, salt = ?, updated_at = ?
        WHERE user_id = ? AND credential_type = 'PASSWORD';
      `).run(hashString, saltHex, now, challenge.user_id);

      // 3. Section 18: Invalidate all existing sessions
      ctx.db.prepare("UPDATE sessions SET status = 'REVOKED' WHERE user_id = ? AND status = 'ACTIVE';").run(challenge.user_id);

      // 4. Record audit
      recordAuditEvent(
        {
          actor_id: challenge.user_id,
          actor_type: 'USER',
          action: 'PASSWORD_RESET_COMPLETED',
          resource_type: 'user',
          resource_id: challenge.user_id,
          correlation_id: correlationId || `pwd_reset_${Date.now()}`,
          source: 'AUTH_API',
        },
        ctx.db
      );
    });
  }

  /**
   * Change password for authenticated user
   */
  public changePassword(userId: string, currentPass: string, newPass: string, correlationId?: string): void {
    validatePasswordPolicy(newPass);
    const db = getDatabase();
    const cred = db.prepare("SELECT * FROM credentials WHERE user_id = ? AND credential_type = 'PASSWORD';").get(userId) as any;

    if (!cred || !verifyPassword(currentPass, cred.secret_hash)) {
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Current password is incorrect', 401);
    }

    const { hashString, saltHex } = hashPassword(newPass);
    const now = getCurrentUtcIsoString();

    withTransaction((ctx) => {
      ctx.db.prepare(`
        UPDATE credentials SET secret_hash = ?, salt = ?, updated_at = ?
        WHERE user_id = ? AND credential_type = 'PASSWORD';
      `).run(hashString, saltHex, now, userId);

      recordAuditEvent(
        {
          actor_id: userId,
          actor_type: 'USER',
          action: 'PASSWORD_CHANGED',
          resource_type: 'user',
          resource_id: userId,
          correlation_id: correlationId || `pwd_change_${Date.now()}`,
          source: 'AUTH_API',
        },
        ctx.db
      );
    });
  }

  /**
   * List sessions for a user
   */
  public listSessions(userId: string, currentSessionId?: string): Array<Record<string, unknown>> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, device_info, ip_address, status, last_activity_at, expires_at, created_at
      FROM sessions
      WHERE user_id = ?
      ORDER BY last_activity_at DESC
      LIMIT 20;
    `).all(userId) as any[];

    return rows.map((r) => ({
      ...r,
      is_current: r.id === currentSessionId,
    }));
  }

  /**
   * Revoke a specific session
   */
  public revokeSession(userId: string, sessionId: string, correlationId?: string): void {
    const db = getDatabase();
    const session = db.prepare('SELECT user_id FROM sessions WHERE id = ?;').get(sessionId) as any;

    if (!session || session.user_id !== userId) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Session not found or inaccessible', 404);
    }

    db.prepare("UPDATE sessions SET status = 'REVOKED' WHERE id = ?;").run(sessionId);

    recordAuditEvent({
      actor_id: userId,
      actor_type: 'USER',
      action: 'SESSION_REVOKED',
      resource_type: 'session',
      resource_id: sessionId,
      correlation_id: correlationId || `ses_rev_${Date.now()}`,
      source: 'AUTH_API',
    });
  }

  /**
   * Update profile
   */
  public updateProfile(
    userId: string,
    updates: Partial<Pick<UserProfileEntity, 'display_name' | 'first_name' | 'last_name' | 'avatar_url' | 'preferred_language' | 'timezone' | 'country'>>,
    correlationId?: string
  ): UserProfileEntity {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?;').get(userId) as any;
    const now = getCurrentUtcIsoString();

    const displayName = updates.display_name !== undefined ? updates.display_name : (existing?.display_name || 'User');
    const firstName = updates.first_name !== undefined ? updates.first_name : (existing?.first_name || '');
    const lastName = updates.last_name !== undefined ? updates.last_name : (existing?.last_name || '');
    const avatarUrl = updates.avatar_url !== undefined ? updates.avatar_url : (existing?.avatar_url || null);
    const preferredLang = updates.preferred_language !== undefined ? updates.preferred_language : (existing?.preferred_language || 'en');
    const tz = updates.timezone !== undefined ? updates.timezone : (existing?.timezone || 'Africa/Nairobi');
    const country = updates.country !== undefined ? updates.country : (existing?.country || 'KE');

    if (existing) {
      db.prepare(`
        UPDATE user_profiles
        SET display_name = ?, first_name = ?, last_name = ?, avatar_url = ?,
            preferred_language = ?, timezone = ?, country = ?, updated_at = ?
        WHERE user_id = ?;
      `).run(displayName, firstName, lastName, avatarUrl, preferredLang, tz, country, now, userId);
    } else {
      db.prepare(`
        INSERT INTO user_profiles (
          user_id, display_name, first_name, last_name, avatar_url, preferred_language, timezone, country, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `).run(userId, displayName, firstName, lastName, avatarUrl, preferredLang, tz, country, now, now);
    }

    recordAuditEvent({
      actor_id: userId,
      actor_type: 'USER',
      action: 'USER_PROFILE_UPDATED',
      resource_type: 'user_profile',
      resource_id: userId,
      correlation_id: correlationId || `prof_${Date.now()}`,
      source: 'AUTH_API',
      after_state: { display_name: displayName, timezone: tz, country },
    });

    return {
      user_id: userId,
      display_name: displayName,
      first_name: firstName,
      last_name: lastName,
      avatar_url: avatarUrl,
      preferred_language: preferredLang,
      timezone: tz,
      country,
      created_at: existing?.created_at || now,
      updated_at: now,
    };
  }
}

export const authService = new AuthService();
