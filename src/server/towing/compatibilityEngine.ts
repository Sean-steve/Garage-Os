/**
 * Canonical Towing Compatibility & Triage Engine (GAR-015)
 * Sprint 13 — Mobility Safety / Recovery Operations
 */

import {
  TowCompatibilityStatus,
  RecoveryType,
  RecoveryUnitType,
  EquipmentType,
  TowVehicleClass,
  VehicleMobilityState,
  VehicleConditionState,
  RecoveryUnitEntity,
  RecoveryUnitEquipmentEntity,
  VehicleCompatibilityEvaluation,
} from './types';
import { VehicleType, DriveType, FuelType, TransmissionType } from '../vehicle/types';

export interface VehicleSpecsForTowing {
  vehicle_id?: string;
  vehicle_type?: VehicleType | string | null;
  fuel_type?: FuelType | string | null;
  drive_type?: DriveType | string | null;
  transmission?: TransmissionType | string | null;
  curb_weight_kg?: number | null;
  mobility_state?: VehicleMobilityState | string | null;
  condition_state?: VehicleConditionState | string | null;
  recovery_type?: RecoveryType | string | null;
}

export function mapVehicleTypeToTowClass(vType?: VehicleType | string | null): TowVehicleClass {
  if (!vType) return TowVehicleClass.PASSENGER;
  const normalized = vType.toUpperCase();
  if (normalized.includes('SUV') || normalized.includes('CROSSOVER')) return TowVehicleClass.SUV;
  if (normalized.includes('PICKUP')) return TowVehicleClass.PICKUP;
  if (normalized.includes('VAN') || normalized.includes('MINIVAN')) return TowVehicleClass.VAN;
  if (normalized.includes('MOTORCYCLE')) return TowVehicleClass.MOTORCYCLE;
  if (normalized.includes('COMMERCIAL') || normalized.includes('TRUCK') || normalized.includes('BUS')) {
    return TowVehicleClass.LIGHT_COMMERCIAL;
  }
  return TowVehicleClass.PASSENGER;
}

export class TowingCompatibilityEngine {
  /**
   * Deterministically evaluates compatibility between vehicle requirements and a recovery unit + its equipment.
   */
  public static evaluate(
    vehicle: VehicleSpecsForTowing,
    unit: RecoveryUnitEntity,
    equipmentList: RecoveryUnitEquipmentEntity[] = [],
    supportedClasses: TowVehicleClass[] = []
  ): VehicleCompatibilityEvaluation {
    const reasons: string[] = [];
    let hasIncompatibility = false;
    let hasUnknownFactors = false;

    // 1. Vehicle Class Support Check
    const targetClass = mapVehicleTypeToTowClass(vehicle.vehicle_type);
    if (vehicle.vehicle_type && targetClass !== TowVehicleClass.UNKNOWN && supportedClasses.length > 0) {
      const matchesClass = supportedClasses.some(cls => {
        if (cls === targetClass) return true;
        if (
          (cls === TowVehicleClass.PASSENGER_CAR || cls === TowVehicleClass.PASSENGER) &&
          (targetClass === TowVehicleClass.PASSENGER_CAR || targetClass === TowVehicleClass.PASSENGER)
        ) {
          return true;
        }
        if (
          (cls === TowVehicleClass.SUV_CROSSOVER || cls === TowVehicleClass.SUV) &&
          (targetClass === TowVehicleClass.SUV_CROSSOVER || targetClass === TowVehicleClass.SUV)
        ) {
          return true;
        }
        return false;
      });
      if (!matchesClass) {
        hasIncompatibility = true;
        reasons.push(`Recovery unit does not support vehicle class: ${targetClass}`);
      }
    }

    // 2. Weight Capacity Validation
    if (unit.max_vehicle_weight_kg != null) {
      if (vehicle.curb_weight_kg != null) {
        if (vehicle.curb_weight_kg > unit.max_vehicle_weight_kg) {
          hasIncompatibility = true;
          reasons.push(
            `Vehicle weight (${vehicle.curb_weight_kg} kg) exceeds recovery unit maximum limit of ${unit.max_vehicle_weight_kg} kg`
          );
        }
      } else {
        hasUnknownFactors = true;
        reasons.push('Vehicle curb weight is not recorded; weight capacity cannot be definitively verified');
      }
    }

    // 3. Operational Equipment Inventory
    const operationalEquipment = equipmentList.filter((eq) => eq.is_operational === 1 || eq.is_operational === true);
    const hasWinch = operationalEquipment.some((eq) => eq.equipment_type === EquipmentType.WINCH);
    const hasDollies = operationalEquipment.some(
      (eq) => eq.equipment_type === EquipmentType.DOLLIES || eq.equipment_type === EquipmentType.TOW_DOLLIES
    );

    // 4. Drive Type / Drivetrain Constraints & Electric Powertrain
    const isAwdOr4Wd =
      vehicle.drive_type === DriveType.AWD ||
      vehicle.drive_type === DriveType.FOUR_WD ||
      vehicle.drive_type === '4WD' ||
      vehicle.drive_type === 'AWD';

    if (isAwdOr4Wd) {
      if (unit.unit_type === RecoveryUnitType.WHEEL_LIFT && !hasDollies) {
        hasIncompatibility = true;
        reasons.push(
          'AWD/4WD vehicles cannot be towed with standard wheel-lift without dollies due to risk of severe transmission and transfer-case damage'
        );
      }
    }

    const isElectric = (vehicle as any).fuel_type === 'ELECTRIC';
    if (isElectric && unit.unit_type === RecoveryUnitType.WHEEL_LIFT && !hasDollies) {
      hasIncompatibility = true;
      reasons.push(
        'Electric vehicles cannot be towed on wheel-lift without dollies due to motor regenerative voltage back-feed and battery inverter risks'
      );
    }

    // 5. Mobility State & Mechanical Conditions
    const mobility = vehicle.mobility_state || VehicleMobilityState.UNKNOWN;
    const isLockedOrDamaged =
      mobility === VehicleMobilityState.WHEELS_LOCKED ||
      mobility === VehicleMobilityState.DAMAGED_SUSPENSION ||
      mobility === VehicleMobilityState.IMMOBILE ||
      mobility === VehicleMobilityState.NON_ROLLING;

    if (isLockedOrDamaged) {
      if (unit.unit_type === RecoveryUnitType.WHEEL_LIFT && !hasDollies) {
        hasIncompatibility = true;
        reasons.push(
          `Vehicle has state '${mobility}'. Wheel-lift unit requires auxiliary dollies to safely transport non-rolling or suspension-damaged vehicles`
        );
      }

      if (unit.unit_type === RecoveryUnitType.FLATBED && !hasWinch) {
        hasIncompatibility = true;
        reasons.push(
          `Vehicle has state '${mobility}'. Loading onto a flatbed requires an operational winch for immobilized vehicles`
        );
      }
    }

    // 6. Hook and chain restrictions
    if (unit.unit_type === RecoveryUnitType.HOOK_AND_CHAIN) {
      if (targetClass !== TowVehicleClass.LIGHT_COMMERCIAL && targetClass !== TowVehicleClass.HEAVY_COMMERCIAL) {
        hasIncompatibility = true;
        reasons.push('Hook and chain recovery units are restricted from passenger car and SUV towing to prevent body damage');
      }
    }

    // Recommended recovery type
    let recommendedType = RecoveryType.STANDARD_TOW;
    if (isAwdOr4Wd || mobility === VehicleMobilityState.WHEELS_LOCKED || mobility === VehicleMobilityState.IMMOBILE || mobility === VehicleMobilityState.NON_ROLLING) {
      recommendedType = RecoveryType.FLATBED_TRANSPORT;
    }
    if (targetClass === TowVehicleClass.MOTORCYCLE) {
      recommendedType = RecoveryType.MOTORCYCLE_RECOVERY;
    }

    if (hasIncompatibility) {
      return {
        status: TowCompatibilityStatus.INCOMPATIBLE,
        compatible: false,
        reasons,
        recommended_recovery_type: recommendedType,
        unit_id: unit.id,
        unit_type: unit.unit_type,
      };
    }

    if (hasUnknownFactors) {
      return {
        status: TowCompatibilityStatus.UNKNOWN,
        compatible: true,
        reasons: reasons.length > 0 ? reasons : ['Certain vehicle specifications require on-site confirmation'],
        recommended_recovery_type: recommendedType,
        unit_id: unit.id,
        unit_type: unit.unit_type,
      };
    }

    reasons.push('Vehicle specifications and mobility requirements fully compatible with recovery unit and equipment');
    return {
      status: TowCompatibilityStatus.CONFIRMED,
      compatible: true,
      reasons,
      recommended_recovery_type: recommendedType,
      unit_id: unit.id,
      unit_type: unit.unit_type,
    };
  }
}
