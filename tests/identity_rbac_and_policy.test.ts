import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy, assertAuthorized } from '../src/server/identity/policyEngine';
import { CanonicalPermission } from '../src/server/identity/rbac';
import {
  AccountStatus,
  AuthenticatedActorContext,
  MembershipRole,
  MembershipStatus,
  OrganizationStatus,
  OrganizationType,
  PlatformRole,
} from '../src/server/identity/types';
import { CanonicalAppError } from '../src/shared/errors';

describe('Identity: RBAC & Centralized Policy Engine (GAR-003 §8-§12, GAR-040)', () => {
  const baseConsumerActor: AuthenticatedActorContext = {
    id: 'usr_consumer_01',
    user_id: 'usr_consumer_01',
    email: 'consumer@garageos.test',
    account_status: AccountStatus.ACTIVE,
    profile: {
      user_id: 'usr_consumer_01',
      display_name: 'Consumer User',
      preferred_language: 'en',
      timezone: 'Africa/Nairobi',
      country: 'KE',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    platform_roles: [],
    memberships: [],
    session_id: 'ses_01',
  };

  test('Deny by default: consumer cannot perform administrative or arbitrary actions', () => {
    const result = evaluatePolicy(baseConsumerActor, CanonicalPermission.ADMIN_USERS_READ);
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes('Deny by default'));

    assert.throws(
      () => assertAuthorized(baseConsumerActor, CanonicalPermission.ADMIN_USERS_READ),
      (err: any) => err instanceof CanonicalAppError && err.statusCode === 403
    );
  });

  test('Personal resource ownership: users can read and update their own profile and sessions', () => {
    // Accessing own profile -> ALLOWED
    const ownResult = evaluatePolicy(baseConsumerActor, CanonicalPermission.USER_PROFILE_UPDATE, {
      ownerUserId: 'usr_consumer_01',
    });
    assert.equal(ownResult.allowed, true);

    // Accessing another user's profile -> DENIED
    const otherResult = evaluatePolicy(baseConsumerActor, CanonicalPermission.USER_PROFILE_UPDATE, {
      ownerUserId: 'usr_someone_else',
    });
    assert.equal(otherResult.allowed, false);
  });

  test('Platform Roles: PLATFORM_ADMIN can execute administrative operations', () => {
    const adminActor: AuthenticatedActorContext = {
      ...baseConsumerActor,
      id: 'usr_admin_01',
      platform_roles: [PlatformRole.PLATFORM_ADMIN],
    };

    const res1 = evaluatePolicy(adminActor, CanonicalPermission.ADMIN_USERS_READ);
    assert.equal(res1.allowed, true);

    const res2 = evaluatePolicy(adminActor, CanonicalPermission.ADMIN_USERS_SUSPEND);
    assert.equal(res2.allowed, true);
  });

  test('Multi-tenancy isolation: Garage A member CANNOT access Garage B resource', () => {
    const garageActor: AuthenticatedActorContext = {
      ...baseConsumerActor,
      id: 'usr_mechanic_01',
      memberships: [
        {
          membership_id: 'mem_garage_a',
          organization_id: 'org_garage_a',
          organization_name: 'Alpha Garage',
          organization_type: OrganizationType.GARAGE,
          organization_status: OrganizationStatus.ACTIVE,
          role: MembershipRole.MECHANIC,
          status: MembershipStatus.ACTIVE,
        },
      ],
    };

    // Accessing Garage A resource -> ALLOWED for mechanic permissions (e.g. VEHICLE_READ)
    const garageAResult = evaluatePolicy(garageActor, CanonicalPermission.VEHICLE_READ, {
      organizationId: 'org_garage_a',
    });
    assert.equal(garageAResult.allowed, true);

    // Cross-tenant access: Accessing Garage B resource -> STRICTLY DENIED
    const garageBResult = evaluatePolicy(garageActor, CanonicalPermission.VEHICLE_READ, {
      organizationId: 'org_garage_b',
    });
    assert.equal(garageBResult.allowed, false);
    assert.ok(garageBResult.reason.includes('Multi-tenancy isolation violation'));
  });

  test('Organization role hierarchy: MECHANIC cannot invite members, OWNER can', () => {
    const mechanicActor: AuthenticatedActorContext = {
      ...baseConsumerActor,
      id: 'usr_mech_01',
      memberships: [
        {
          membership_id: 'mem_01',
          organization_id: 'org_garage_a',
          organization_name: 'Alpha Garage',
          organization_type: OrganizationType.GARAGE,
          organization_status: OrganizationStatus.ACTIVE,
          role: MembershipRole.MECHANIC,
          status: MembershipStatus.ACTIVE,
        },
      ],
    };

    const ownerActor: AuthenticatedActorContext = {
      ...baseConsumerActor,
      id: 'usr_owner_01',
      memberships: [
        {
          membership_id: 'mem_02',
          organization_id: 'org_garage_a',
          organization_name: 'Alpha Garage',
          organization_type: OrganizationType.GARAGE,
          organization_status: OrganizationStatus.ACTIVE,
          role: MembershipRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
      ],
    };

    // Mechanic cannot invite
    const mechInvite = evaluatePolicy(mechanicActor, CanonicalPermission.ORG_MEMBERS_INVITE, {
      organizationId: 'org_garage_a',
    });
    assert.equal(mechInvite.allowed, false);

    // Owner can invite
    const ownerInvite = evaluatePolicy(ownerActor, CanonicalPermission.ORG_MEMBERS_INVITE, {
      organizationId: 'org_garage_a',
    });
    assert.equal(ownerInvite.allowed, true);
  });

  test('Membership state enforcement: REVOKED membership cannot access organization resources', () => {
    const revokedActor: AuthenticatedActorContext = {
      ...baseConsumerActor,
      id: 'usr_fired_01',
      memberships: [
        {
          membership_id: 'mem_03',
          organization_id: 'org_garage_a',
          organization_name: 'Alpha Garage',
          organization_type: OrganizationType.GARAGE,
          organization_status: OrganizationStatus.ACTIVE,
          role: MembershipRole.MECHANIC,
          status: MembershipStatus.REVOKED,
        },
      ],
    };

    const result = evaluatePolicy(revokedActor, CanonicalPermission.VEHICLE_READ, {
      organizationId: 'org_garage_a',
    });
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes('REVOKED'));
  });

  test('Account lifecycle: SUSPENDED account is universally blocked from all operations', () => {
    const suspendedActor: AuthenticatedActorContext = {
      ...baseConsumerActor,
      account_status: AccountStatus.SUSPENDED,
      platform_roles: [PlatformRole.PLATFORM_ADMIN], // even with admin role
    };

    const result = evaluatePolicy(suspendedActor, CanonicalPermission.ADMIN_USERS_READ);
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes('SUSPENDED'));
  });
});
