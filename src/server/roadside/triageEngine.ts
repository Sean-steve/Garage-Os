/**
 * GAR-014: Deterministic Safety & Roadside Triage Engine
 *
 * Rules:
 * 1. Zero guesswork: evaluates deterministic safety triggers, vehicle architecture constraints,
 *    and reported symptoms.
 * 2. If occupants are in active traffic / dangerous carriageway, immediately marks CRITICAL_HIGHWAY
 *    and mandates safety escalation guidance.
 * 3. AWD / 4WD / EV immobilized drivetrains strictly mandate TOW_FLATBED over wheel-lift to avoid
 *    drivetrain destruction.
 * 4. Puncture with no spare or missing locking nut key immediately trips tow_required.
 */

import {
  AssistanceType,
  DrivabilityState,
  IncidentSeverity,
  IncidentType,
  OccupantSafetyState,
} from './types';

export interface VehicleTriageContext {
  make?: string;
  model?: string;
  fuel_type?: string; // 'ELECTRIC', 'HYBRID', 'PETROL', 'DIESEL'
  drive_type?: string; // 'AWD', '4WD', 'FWD', 'RWD'
  transmission?: string; // 'AUTOMATIC', 'MANUAL', 'DCT', 'CVT'
  is_electric_or_hybrid?: boolean;
  has_known_faults?: boolean;
}

export interface TriageInputAnswers {
  // Safety flags
  is_live_highway_lane?: boolean;
  is_hard_shoulder?: boolean;
  is_dark_or_poor_visibility?: boolean;
  occupants_feel_unsafe?: boolean;
  injuries_present?: boolean;
  smoke_or_fire_detected?: boolean;
  fluid_leak_detected?: boolean;

  // Breakdown diagnostics
  engine_cranks?: boolean;
  lights_and_dash_work?: boolean;
  tyre_has_puncture?: boolean;
  has_inflated_spare_tyre?: boolean;
  has_locking_wheel_nut_key?: boolean;
  has_tyre_sealant_kit?: boolean;
  wrong_fuel_added?: boolean;
  fuel_tank_empty?: boolean;
  keys_locked_inside?: boolean;
  transmission_stuck_in_park?: boolean;
  vehicle_stuck_in_ditch_or_mud?: boolean;
  brakes_or_steering_unresponsive?: boolean;
  dashboard_warning_symbol?: string;
  notes?: string;
}

export interface TriageEvaluationResult {
  engine_version: string;
  triage_result: string;
  severity: IncidentSeverity;
  initial_drivability: DrivabilityState;
  occupant_safety_state: OccupantSafetyState;
  recommended_assistance_type: AssistanceType;
  safety_escalation_required: boolean;
  tow_required: boolean;
  guidance_notes: string;
  safety_instructions: string[];
  risk_factors: string[];
}

export class RoadsideTriageEngine {
  public static readonly VERSION = 'v1.4.0';

  public static evaluate(
    incidentType: IncidentType,
    vehicle: VehicleTriageContext,
    answers: TriageInputAnswers
  ): TriageEvaluationResult {
    const riskFactors: string[] = [];
    const safetyInstructions: string[] = [];
    let severity = IncidentSeverity.ROUTINE;
    let drivability = DrivabilityState.UNKNOWN;
    let safetyState = OccupantSafetyState.SAFE;
    let safetyEscalationRequired = false;
    let towRequired = false;
    let recommendedAssistance: AssistanceType = AssistanceType.ROADSIDE_MOBILE_REPAIR;

    const isEvOrHybrid =
      vehicle.is_electric_or_hybrid ||
      vehicle.fuel_type?.toUpperCase().includes('ELECTRIC') ||
      vehicle.fuel_type?.toUpperCase().includes('HYBRID');

    const isAwdOr4wd =
      vehicle.drive_type?.toUpperCase() === 'AWD' ||
      vehicle.drive_type?.toUpperCase() === '4WD' ||
      vehicle.drive_type?.toUpperCase() === 'ALL_WHEEL_DRIVE';

    // --- 1. SAFETY & LIFE-SAFETY CHECK ---
    if (answers.injuries_present) {
      safetyState = OccupantSafetyState.INJURIES_REPORTED;
      severity = IncidentSeverity.CRITICAL_HIGHWAY;
      safetyEscalationRequired = true;
      riskFactors.push('Injuries reported on scene');
      safetyInstructions.push('CALL EMERGENCY SERVICES (999 / 911 / 112) IMMEDIATELY.');
      safetyInstructions.push('Do not attempt to move seriously injured persons unless there is immediate danger of fire.');
    } else if (answers.is_live_highway_lane) {
      safetyState = OccupantSafetyState.HAZARDOUS_CARRIAGEWAY;
      severity = IncidentSeverity.CRITICAL_HIGHWAY;
      safetyEscalationRequired = true;
      riskFactors.push('Vehicle is stranded in a live traffic lane');
      safetyInstructions.push('Turn on vehicle hazard warning lights immediately.');
      safetyInstructions.push('If safe to exit, all occupants should exit via passenger-side doors.');
      safetyInstructions.push('Step behind the crash barrier or well off the highway shoulder.');
      safetyInstructions.push('Never stand directly behind or in front of the stranded vehicle.');
    } else if (answers.smoke_or_fire_detected) {
      safetyState = OccupantSafetyState.UNSAFE_ENVIRONMENT;
      severity = IncidentSeverity.CRITICAL_HIGHWAY;
      safetyEscalationRequired = true;
      riskFactors.push('Smoke or fire observed emanating from vehicle');
      safetyInstructions.push('Evacuate all occupants immediately and move at least 50 meters away upwind.');
      safetyInstructions.push('Call the fire brigade immediately.');
    } else if (answers.occupants_feel_unsafe || answers.is_dark_or_poor_visibility) {
      safetyState = OccupantSafetyState.UNSAFE_ENVIRONMENT;
      severity = IncidentSeverity.URGENT_UNSAFE;
      riskFactors.push('Occupants in vulnerable or dark/low-visibility environment');
      safetyInstructions.push('Keep hazard lights on and vehicle doors locked from the inside.');
      safetyInstructions.push('Monitor surroundings and contact local dispatch if situation deteriorates.');
    } else if (answers.is_hard_shoulder) {
      severity = IncidentSeverity.ELEVATED;
      safetyInstructions.push('Keep hazards on. If standing outside, wait behind the motorway safety barrier.');
    }

    // --- 2. DRIVABILITY & TECHNICAL TRIAGE ---
    switch (incidentType) {
      case IncidentType.PUNCTURE_OR_FLAT_TYRE: {
        if (answers.has_inflated_spare_tyre && answers.has_locking_wheel_nut_key !== false) {
          recommendedAssistance = AssistanceType.TYRE_CHANGE_OR_INFLATE;
          drivability = DrivabilityState.NON_DRIVABLE;
          towRequired = false;
        } else if (answers.has_tyre_sealant_kit && !answers.tyre_has_puncture) {
          recommendedAssistance = AssistanceType.TYRE_CHANGE_OR_INFLATE;
          drivability = DrivabilityState.NON_DRIVABLE;
          towRequired = false;
        } else {
          // No spare, tyre shredded, or locking wheel key missing -> tow mandated
          towRequired = true;
          drivability = DrivabilityState.NON_DRIVABLE;
          recommendedAssistance = isAwdOr4wd || isEvOrHybrid ? AssistanceType.TOW_FLATBED : AssistanceType.TOW_WHEEL_LIFT;
          riskFactors.push('No usable spare tyre or missing wheel lock key; recovery tow required');
        }
        break;
      }

      case IncidentType.BATTERY_DEAD: {
        if (isEvOrHybrid && answers.dashboard_warning_symbol?.toUpperCase().includes('HYBRID')) {
          // High-voltage fault
          towRequired = true;
          drivability = DrivabilityState.DANGEROUS_TO_OPERATE;
          recommendedAssistance = AssistanceType.TOW_FLATBED;
          riskFactors.push('High-voltage EV/Hybrid powertrain lockout detected; jump-start prohibited');
        } else {
          recommendedAssistance = AssistanceType.JUMP_START;
          drivability = DrivabilityState.NON_DRIVABLE;
          towRequired = false;
        }
        break;
      }

      case IncidentType.FUEL_STARVATION_OR_CONTAMINATION: {
        if (answers.wrong_fuel_added) {
          towRequired = true;
          drivability = DrivabilityState.DANGEROUS_TO_OPERATE;
          recommendedAssistance = isAwdOr4wd || isEvOrHybrid ? AssistanceType.TOW_FLATBED : AssistanceType.TOW_WHEEL_LIFT;
          riskFactors.push('Misfuel reported (diesel/petrol contamination). Engine must NOT be turned on.');
          safetyInstructions.push('DO NOT turn on ignition or start engine to prevent catastrophic fuel pump & injector failure.');
        } else {
          recommendedAssistance = AssistanceType.FUEL_DELIVERY;
          drivability = DrivabilityState.NON_DRIVABLE;
          towRequired = false;
        }
        break;
      }

      case IncidentType.LOCKOUT: {
        recommendedAssistance = AssistanceType.LOCKOUT_ENTRY;
        drivability = DrivabilityState.RESTRICTED_LIMP;
        towRequired = false;
        break;
      }

      case IncidentType.COLLISION_OR_DITCH: {
        drivability = DrivabilityState.NON_DRIVABLE;
        towRequired = true;
        if (answers.vehicle_stuck_in_ditch_or_mud) {
          recommendedAssistance = AssistanceType.WINCH_OR_RECOVERY;
          riskFactors.push('Vehicle trapped off-road or in ditch; specialist winch recovery required');
        } else {
          recommendedAssistance = AssistanceType.TOW_FLATBED;
          riskFactors.push('Collision structural damage; flatbed recovery mandatory');
        }
        if (severity === IncidentSeverity.ROUTINE) {
          severity = IncidentSeverity.ELEVATED;
        }
        break;
      }

      case IncidentType.ENGINE_OVERHEAT: {
        if (answers.fluid_leak_detected) {
          towRequired = true;
          drivability = DrivabilityState.DANGEROUS_TO_OPERATE;
          recommendedAssistance = isAwdOr4wd || isEvOrHybrid ? AssistanceType.TOW_FLATBED : AssistanceType.TOW_WHEEL_LIFT;
          riskFactors.push('Coolant dumping or severe overheating; continued operation risks cylinder head warp');
        } else {
          recommendedAssistance = AssistanceType.FLUID_TOP_UP;
          drivability = DrivabilityState.RESTRICTED_LIMP;
          towRequired = false;
        }
        break;
      }

      case IncidentType.MECHANICAL_BREAKDOWN:
      case IncidentType.ELECTRICAL_OR_STARTER:
      default: {
        if (answers.brakes_or_steering_unresponsive || answers.transmission_stuck_in_park) {
          towRequired = true;
          drivability = DrivabilityState.DANGEROUS_TO_OPERATE;
          recommendedAssistance = AssistanceType.TOW_FLATBED;
          riskFactors.push('Steering, braking, or transmission failure');
        } else if (!answers.engine_cranks && !answers.lights_and_dash_work) {
          recommendedAssistance = AssistanceType.JUMP_START;
          drivability = DrivabilityState.NON_DRIVABLE;
          towRequired = false;
        } else {
          recommendedAssistance = AssistanceType.ROADSIDE_MOBILE_REPAIR;
          drivability = DrivabilityState.NON_DRIVABLE;
          towRequired = false;
        }
        break;
      }
    }

    // AWD / EV recovery safety override: Always Flatbed
    if (towRequired && (isAwdOr4wd || isEvOrHybrid)) {
      if (recommendedAssistance === AssistanceType.TOW_WHEEL_LIFT) {
        recommendedAssistance = AssistanceType.TOW_FLATBED;
        riskFactors.push('AWD/EV drivetrain protection: Upgraded to Flatbed Tow to prevent center differential/motor winding damage');
      }
    }

    const triageResultSummary = towRequired
      ? `Recovery Required: Vehicle is non-drivable. Recommended: ${recommendedAssistance}.`
      : `Mobile Intervention Recommended: ${recommendedAssistance}. Vehicle may be field-repaired.`;

    const guidanceNotes = [
      triageResultSummary,
      riskFactors.length > 0 ? `Risk Factors: ${riskFactors.join('; ')}` : '',
      safetyInstructions.length > 0 ? `Safety Guidance: ${safetyInstructions.join(' ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      engine_version: RoadsideTriageEngine.VERSION,
      triage_result: triageResultSummary,
      severity,
      initial_drivability: drivability,
      occupant_safety_state: safetyState,
      recommended_assistance_type: recommendedAssistance,
      safety_escalation_required: safetyEscalationRequired,
      tow_required: towRequired,
      guidance_notes: guidanceNotes,
      safety_instructions: safetyInstructions,
      risk_factors: riskFactors,
    };
  }
}
