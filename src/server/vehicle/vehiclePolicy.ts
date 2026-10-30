/**
 * Canonical Vehicle Domain Access Policy Engine (GAR-004 §12, GAR-034, GAR-039 §9)
 *
 * Enforces:
 * - Relationship-based access control (Owner, Co-Owner, Custodian, Driver, Authorized User)
 * - Fleet / Organization-based membership access
 * - Platform administrator and support operator access
 * - Strict IDOR prevention
 */

import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { AuthenticatedActorContext, PlatformRole, AccountStatus } from '../identity/types';
import { CanonicalPermission, ROLE_PERMISSIONS } from '../identity/rbac';
import { vehicleRepository } from './vehicleRepository';
import { VehicleRelationshipType } from './types';

export class VehiclePolicyEngine {
  /**
   * Asserts whether an actor has permission to access or mutate a specific vehicle.
   * Throws CanonicalAppError (403 or 404) if unauthorized.
   */
  assertVehicleAccess(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    permission: CanonicalPermission
  ): void {
    const isAllowed = this.canActorAccessVehicle(actor, vehicleId, permission);
    if (!isAllowed) {
      throw new CanonicalAppError(
        ErrorCode.NOT_AUTHORIZED,
        `Actor ${actor.user_id} is not authorized for ${permission} on vehicle ${vehicleId}`,
        403
      );
    }
  }

  /**
   * Evaluates if an actor is authorized for a permission on a vehicle.
   */
  canActorAccessVehicle(
    actor: AuthenticatedActorContext,
    vehicleId: string,
    permission: CanonicalPermission
  ): boolean {
    // 0. Account Status check: suspended/locked/disabled accounts are universally blocked
    if (
      actor.account_status === AccountStatus.SUSPENDED ||
      actor.account_status === AccountStatus.LOCKED ||
      actor.account_status === AccountStatus.DISABLED ||
      actor.account_status === AccountStatus.DELETED
    ) {
      return false;
    }

    // 1. Platform Global Roles override
    if (actor.platform_roles.includes(PlatformRole.PLATFORM_ADMIN)) {
      return true;
    }
    if (
      actor.platform_roles.includes(PlatformRole.SUPPORT_AGENT) &&
      (permission === CanonicalPermission.VEHICLE_READ ||
        permission === CanonicalPermission.VEHICLE_ODOMETER_READ ||
        permission === CanonicalPermission.VEHICLE_RELATIONSHIP_READ ||
        permission === CanonicalPermission.VEHICLE_DOCUMENT_READ)
    ) {
      return true;
    }

    // 2. Direct Vehicle Relationship Evaluation
    const relationship = vehicleRepository.getUserRelationshipForVehicle(vehicleId, actor.user_id);
    if (relationship && relationship.status === 'ACTIVE') {
      // Full ownership / co-ownership grants all vehicle operations
      if (
        relationship.relationship_type === VehicleRelationshipType.OWNER ||
        relationship.relationship_type === VehicleRelationshipType.CO_OWNER
      ) {
        return true;
      }

      // Operational delegates (Drivers, Custodians, Authorized Users)
      if (
        relationship.relationship_type === VehicleRelationshipType.PRIMARY_DRIVER ||
        relationship.relationship_type === VehicleRelationshipType.CUSTODIAN ||
        relationship.relationship_type === VehicleRelationshipType.FLEET_CUSTODIAN ||
        relationship.relationship_type === VehicleRelationshipType.AUTHORIZED_USER
      ) {
        const allowedPermissions: CanonicalPermission[] = [
          CanonicalPermission.VEHICLE_READ,
          CanonicalPermission.VEHICLE_ODOMETER_READ,
          CanonicalPermission.VEHICLE_ODOMETER_CREATE,
          CanonicalPermission.VEHICLE_DOCUMENT_READ,
          CanonicalPermission.VEHICLE_RELATIONSHIP_READ,
          CanonicalPermission.VEHICLE_FUEL_READ,
          CanonicalPermission.VEHICLE_FUEL_RECORD,
          CanonicalPermission.VEHICLE_COMPONENT_READ,
          CanonicalPermission.VEHICLE_COMPONENT_RECORD,
          CanonicalPermission.VEHICLE_TYRE_READ,
          CanonicalPermission.VEHICLE_TYRE_INSPECT,
        ];
        if (allowedPermissions.includes(permission)) {
          return true;
        }
      }
    }

    // 3. Organization Membership Evaluation
    // Check if vehicle belongs to or is managed by the actor's active organization
    if (actor.active_organization_id) {
      const activeOrgRole = actor.active_membership?.role;
      if (activeOrgRole) {
        const relationships = vehicleRepository.getVehicleRelationships(vehicleId);
        const isOrgVehicle = relationships.some(
          (r) => r.organization_id === actor.active_organization_id && r.status === 'ACTIVE'
        );

        if (isOrgVehicle) {
          const rolePermissions = ROLE_PERMISSIONS[activeOrgRole] || [];
          if (rolePermissions.includes(permission)) {
            return true;
          }
        }
      }
    }

    return false;
  }
}

export const vehiclePolicy = new VehiclePolicyEngine();
