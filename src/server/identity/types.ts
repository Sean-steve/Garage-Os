/**
 * Canonical Identity & Access Architecture Types (GAR-003, GAR-033 §12A, GAR-039)
 */

import { CanonicalActorType } from '../../shared/types';

export enum AccountStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  LOCKED = 'LOCKED',
  SUSPENDED = 'SUSPENDED',
  DISABLED = 'DISABLED',
  DELETION_PENDING = 'DELETION_PENDING',
  DELETED = 'DELETED',
}

export enum OrganizationType {
  GARAGE = 'GARAGE',
  TOWING_PROVIDER = 'TOWING_PROVIDER',
  AUTOMOTIVE_SERVICE_PROVIDER = 'AUTOMOTIVE_SERVICE_PROVIDER',
  MARKETPLACE_SELLER = 'MARKETPLACE_SELLER',
  FLEET_OPERATOR = 'FLEET_OPERATOR',
  PARTNER = 'PARTNER',
}

export enum OrganizationStatus {
  DRAFT = 'DRAFT',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DISABLED = 'DISABLED',
}

export enum MembershipRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  SERVICE_ADVISOR = 'SERVICE_ADVISOR',
  MECHANIC = 'MECHANIC',
  TECHNICIAN = 'TECHNICIAN',
  DISPATCHER = 'DISPATCHER',
  SELLER_MANAGER = 'SELLER_MANAGER',
  FLEET_ADMIN = 'FLEET_ADMIN',
  FLEET_OPERATOR = 'FLEET_OPERATOR',
  VIEWER = 'VIEWER',
}

export enum MembershipStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REVOKED = 'REVOKED',
}

export enum PlatformRole {
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
  SUPPORT_AGENT = 'SUPPORT_AGENT',
  TRUST_AND_SAFETY = 'TRUST_AND_SAFETY',
  FINANCE_OPERATOR = 'FINANCE_OPERATOR',
  OPERATIONS = 'OPERATIONS',
}

export enum ChallengeType {
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  PHONE_OTP = 'PHONE_OTP',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export interface UserEntity {
  id: string;
  email: string;
  phone?: string | null;
  account_status: AccountStatus;
  email_verified_at?: string | null;
  phone_verified_at?: string | null;
  last_authenticated_at?: string | null;
  failed_login_attempts: number;
  locked_until?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface UserProfileEntity {
  user_id: string;
  display_name: string;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  preferred_language: string;
  timezone: string;
  country: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationEntity {
  id: string;
  organization_type: OrganizationType;
  name: string;
  status: OrganizationStatus;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMembershipEntity {
  id: string;
  user_id: string;
  organization_id: string;
  role: MembershipRole;
  status: MembershipStatus;
  invited_at?: string | null;
  accepted_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationInvitationEntity {
  id: string;
  organization_id: string;
  inviter_user_id: string;
  email: string;
  role: MembershipRole;
  token_hash: string;
  status: 'PENDING' | 'ACCEPTED' | 'CANCELLED' | 'EXPIRED';
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface SessionEntity {
  id: string;
  user_id: string;
  token_hash: string;
  device_info?: string | null;
  ip_address?: string | null;
  status: SessionStatus;
  last_activity_at: string;
  expires_at: string;
  created_at: string;
}

export interface VerificationChallengeEntity {
  id: string;
  user_id: string;
  challenge_type: ChallengeType;
  identifier: string;
  token_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  used_at?: string | null;
  created_at: string;
}

export interface AuthenticatedActorContext {
  id: string;
  user_id: string;
  type?: CanonicalActorType;
  roles?: string[];
  email: string;
  account_status: AccountStatus;
  profile: UserProfileEntity;
  platform_roles: PlatformRole[];
  memberships: Array<{
    membership_id: string;
    organization_id: string;
    organization_name: string;
    organization_type: OrganizationType;
    organization_status: OrganizationStatus;
    role: MembershipRole;
    status: MembershipStatus;
  }>;
  active_organization_id?: string;
  active_membership?: {
    membership_id: string;
    organization_id: string;
    organization_name: string;
    organization_type: OrganizationType;
    organization_status: OrganizationStatus;
    role: MembershipRole;
    status: MembershipStatus;
    permissions: string[];
  };
  session_id: string;
}
