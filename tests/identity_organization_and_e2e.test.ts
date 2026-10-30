import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/server/database/migrations';
import { setDatabaseForTesting } from '../src/server/database/connection';
import { AuthService } from '../src/server/identity/authService';
import { OrganizationService } from '../src/server/identity/organizationService';
import { AdminService } from '../src/server/identity/adminService';
import { evaluatePolicy } from '../src/server/identity/policyEngine';
import { CanonicalPermission } from '../src/server/identity/rbac';
import {
  AccountStatus,
  MembershipRole,
  MembershipStatus,
  OrganizationType,
  PlatformRole,
} from '../src/server/identity/types';

describe('Identity: Organization, Tenancy & Demonstration Scenarios (Sprint 2 §89)', () => {
  let db: DatabaseSync;
  let authService: AuthService;
  let orgService: OrganizationService;
  let adminService: AdminService;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    setDatabaseForTesting(db);
    runMigrations(db);
    authService = new AuthService();
    orgService = new OrganizationService();
    adminService = new AdminService();
  });

  test('Scenario A: Consumer Identity Lifecycle', () => {
    // 1. Register
    const reg = authService.registerUser({
      email: 'consumer.flow@garageos.test',
      password: 'SecurePass123!',
      fullName: 'Brian Kariuki',
    });
    assert.equal(reg.user.accountStatus, AccountStatus.PENDING_VERIFICATION);

    // 2. Verify Email
    authService.verifyEmail(reg.user.id, reg.verificationToken!);

    // 3. Login
    const login = authService.loginUser({
      email: 'consumer.flow@garageos.test',
      password: 'SecurePass123!',
    });
    assert.ok(login.session_token);
    assert.equal(login.user.account_status, AccountStatus.ACTIVE);

    // 4. Authenticate session & update profile
    const actor = authService.authenticateSession(login.session_token)!;
    assert.ok(actor);

    const updatedProfile = authService.updateProfile(actor.id, {
      display_name: 'Brian K.',
      timezone: 'Africa/Nairobi',
    });
    assert.equal(updatedProfile.display_name, 'Brian K.');

    // 5. Logout
    authService.logout(login.session_token);
    const postLogoutActor = authService.authenticateSession(login.session_token);
    assert.equal(postLogoutActor, null);
  });

  test('Scenario B: Organization Creation & Member Invitation Lifecycle', () => {
    // 1. Create Owner User
    const ownerReg = authService.registerUser({
      email: 'owner@garageos.test',
      password: 'OwnerPass123!',
      fullName: 'Chief Mechanic',
    });
    authService.verifyEmail(ownerReg.user.id, ownerReg.verificationToken!);
    const ownerLogin = authService.loginUser({ email: 'owner@garageos.test', password: 'OwnerPass123!' });
    let ownerActor = authService.authenticateSession(ownerLogin.session_token)!;

    // 2. Create Organization
    const { organization, membership } = orgService.createOrganization(ownerActor, {
      name: 'Speedy Repairs Nairobi',
      type: OrganizationType.GARAGE,
    });
    assert.equal(organization.name, 'Speedy Repairs Nairobi');
    assert.equal(membership.role, MembershipRole.OWNER);

    // Refresh ownerActor context with newly established organization
    ownerActor = authService.authenticateSession(ownerLogin.session_token, organization.id)!;

    // 3. Create Invitee User
    const inviteeReg = authService.registerUser({
      email: 'colleague@garageos.test',
      password: 'ColleaguePass123!',
      fullName: 'Junior Mechanic',
    });
    authService.verifyEmail(inviteeReg.user.id, inviteeReg.verificationToken!);
    const inviteeLogin = authService.loginUser({ email: 'colleague@garageos.test', password: 'ColleaguePass123!' });
    const inviteeActor = authService.authenticateSession(inviteeLogin.session_token)!;

    // 4. Owner invites colleague
    const invite = orgService.inviteMember(
      ownerActor,
      organization.id,
      'colleague@garageos.test',
      MembershipRole.MECHANIC
    );
    assert.ok(invite.devInvitationToken);

    // 5. Colleague accepts invitation
    const newMembership = orgService.acceptInvitation(inviteeActor, invite.devInvitationToken!);
    assert.equal(newMembership.organization_id, organization.id);
    assert.equal(newMembership.role, MembershipRole.MECHANIC);
    assert.equal(newMembership.status, MembershipStatus.ACTIVE);

    // 6. Verify list members
    const members = orgService.listMembers(ownerActor, organization.id);
    assert.equal(members.length, 2);
  });

  test('Scenario C: Strict Multi-Tenant Isolation (Garage A vs Garage B)', () => {
    // Setup Garage A & Owner A
    const ownerAReg = authService.registerUser({ email: 'owner.a@garageos.test', password: 'Pass12345!', fullName: 'Owner A' });
    authService.verifyEmail(ownerAReg.user.id, ownerAReg.verificationToken!);
    const ownerALogin = authService.loginUser({ email: 'owner.a@garageos.test', password: 'Pass12345!' });
    const ownerAActor = authService.authenticateSession(ownerALogin.session_token)!;
    const { organization: orgA } = orgService.createOrganization(ownerAActor, { name: 'Garage Alpha', type: OrganizationType.GARAGE });

    // Setup Garage B & Owner B
    const ownerBReg = authService.registerUser({ email: 'owner.b@garageos.test', password: 'Pass12345!', fullName: 'Owner B' });
    authService.verifyEmail(ownerBReg.user.id, ownerBReg.verificationToken!);
    const ownerBLogin = authService.loginUser({ email: 'owner.b@garageos.test', password: 'Pass12345!' });
    const ownerBActor = authService.authenticateSession(ownerBLogin.session_token)!;
    const { organization: orgB } = orgService.createOrganization(ownerBActor, { name: 'Garage Beta', type: OrganizationType.GARAGE });

    // Reload actor contexts with organization memberships
    const freshOwnerA = authService.authenticateSession(ownerALogin.session_token, orgA.id)!;
    const freshOwnerB = authService.authenticateSession(ownerBLogin.session_token, orgB.id)!;

    // Owner A accessing Org A -> ALLOWED
    const evalAonA = evaluatePolicy(freshOwnerA, CanonicalPermission.ORG_READ, { organizationId: orgA.id });
    assert.equal(evalAonA.allowed, true);

    // Owner A accessing Org B -> STRICTLY DENIED
    const evalAonB = evaluatePolicy(freshOwnerA, CanonicalPermission.ORG_READ, { organizationId: orgB.id });
    assert.equal(evalAonB.allowed, false);
    assert.ok(evalAonB.reason.includes('Multi-tenancy isolation violation'));

    // Owner B accessing Org A -> STRICTLY DENIED
    const evalBonA = evaluatePolicy(freshOwnerB, CanonicalPermission.ORG_READ, { organizationId: orgA.id });
    assert.equal(evalBonA.allowed, false);
  });

  test('Scenario D: Membership Revocation Blocks Access', () => {
    // Owner creates org and invites member
    const ownerReg = authService.registerUser({ email: 'boss@garageos.test', password: 'Pass12345!', fullName: 'Boss' });
    authService.verifyEmail(ownerReg.user.id, ownerReg.verificationToken!);
    const ownerLogin = authService.loginUser({ email: 'boss@garageos.test', password: 'Pass12345!' });
    let ownerActor = authService.authenticateSession(ownerLogin.session_token)!;
    const { organization: org } = orgService.createOrganization(ownerActor, { name: 'Auto Clinic', type: OrganizationType.GARAGE });
    ownerActor = authService.authenticateSession(ownerLogin.session_token, org.id)!;

    const workerReg = authService.registerUser({ email: 'worker@garageos.test', password: 'Pass12345!', fullName: 'Worker' });
    authService.verifyEmail(workerReg.user.id, workerReg.verificationToken!);
    const workerLogin = authService.loginUser({ email: 'worker@garageos.test', password: 'Pass12345!' });
    const workerActor = authService.authenticateSession(workerLogin.session_token)!;

    const invite = orgService.inviteMember(ownerActor, org.id, 'worker@garageos.test', MembershipRole.MECHANIC);
    const workerMembership = orgService.acceptInvitation(workerActor, invite.devInvitationToken!);

    // Worker can access org resource before revocation
    const activeWorkerActor = authService.authenticateSession(workerLogin.session_token, org.id)!;
    const preRevokeEval = evaluatePolicy(activeWorkerActor, CanonicalPermission.VEHICLE_READ, { organizationId: org.id });
    assert.equal(preRevokeEval.allowed, true);

    // Owner revokes worker's membership
    orgService.revokeMembership(ownerActor, org.id, workerMembership.id);

    // Reload worker actor
    const revokedWorkerActor = authService.authenticateSession(workerLogin.session_token, org.id)!;
    const postRevokeEval = evaluatePolicy(revokedWorkerActor, CanonicalPermission.VEHICLE_READ, { organizationId: org.id });
    assert.equal(postRevokeEval.allowed, false);
    assert.ok(postRevokeEval.reason.includes('REVOKED'));
  });

  test('Scenario E: Administrative Account Suspension & Immediate Invalidation', () => {
    // 1. Admin setup
    const adminReg = authService.registerUser({ email: 'superadmin@garageos.test', password: 'AdminPass123!', fullName: 'Platform Admin' });
    authService.verifyEmail(adminReg.user.id, adminReg.verificationToken!);
    // Direct DB platform role grant for test
    db.prepare("INSERT INTO user_platform_roles (user_id, role, assigned_by, assigned_at) VALUES (?, 'PLATFORM_ADMIN', 'SYSTEM', datetime('now'));").run(adminReg.user.id);
    const adminLogin = authService.loginUser({ email: 'superadmin@garageos.test', password: 'AdminPass123!' });
    const adminActor = authService.authenticateSession(adminLogin.session_token)!;

    // 2. Regular user setup & login
    const userReg = authService.registerUser({ email: 'baduser@garageos.test', password: 'UserPass123!', fullName: 'Bad Actor' });
    authService.verifyEmail(userReg.user.id, userReg.verificationToken!);
    const userLogin = authService.loginUser({ email: 'baduser@garageos.test', password: 'UserPass123!' });
    assert.ok(authService.authenticateSession(userLogin.session_token));

    // 3. Admin suspends user
    adminService.updateAccountStatus(
      adminActor,
      userReg.user.id,
      AccountStatus.SUSPENDED,
      'Fraudulent activity detected on marketplace'
    );

    // 4. Verify existing session was immediately invalidated
    const suspendedActor = authService.authenticateSession(userLogin.session_token);
    assert.equal(suspendedActor, null);

    // 5. Subsequent login attempt is blocked
    assert.throws(
      () => authService.loginUser({ email: 'baduser@garageos.test', password: 'UserPass123!' }),
      (err: any) => err.statusCode === 403 && err.message.includes('suspended')
    );
  });
});
