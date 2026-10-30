/**
 * Canonical Maintenance Catalog & Demo Plan Seeder (GAR-006 §6-§17)
 */

import { maintenanceRepository } from './maintenanceRepository';
import {
  MaintenanceRequirementEntity,
  MaintenanceRuleEntity,
  VehicleMaintenancePlanEntity,
  VehicleMaintenancePlanEntryEntity,
  MaintenanceCategory,
  MaintenanceIntervalType,
  MaintenanceTriggerPolicy,
  MaintenanceRuleSourceType,
  MaintenanceVerificationStatus,
  MaintenancePlanStatus,
  MaintenancePlanSource,
  MaintenanceSeverity,
  MaintenanceCompletionEntity,
} from './types';
import { OdometerUnit } from '../vehicle/types';
import { getCurrentUtcIsoString } from '../domain/time';
import { evaluateMaintenanceDueState } from './dueStateEngine';
import { logger } from '../observability/logger';
import { vehicleRepository } from '../vehicle/vehicleRepository';

export const STANDARD_REQUIREMENTS: Array<{
  req: Omit<MaintenanceRequirementEntity, 'created_at' | 'updated_at'>;
  rule: Omit<MaintenanceRuleEntity, 'id' | 'requirement_id' | 'created_at' | 'updated_at'>;
}> = [
  {
    req: {
      id: 'mreq_engine_oil',
      code: 'ENGINE_OIL_REPLACEMENT',
      name: 'Engine Oil & Filter Replacement',
      description: 'Drain engine oil, replace oil filter element, refill with manufacturer-spec synthetic engine oil.',
      category: MaintenanceCategory.FLUIDS,
      component_system: 'ENGINE',
      default_severity: MaintenanceSeverity.CRITICAL,
      default_priority: 95,
      recommended_action: 'Replace full synthetic oil and OEM oil filter cartridge.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 10000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 6,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 1000,
      approaching_time_threshold_days: 30,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
  {
    req: {
      id: 'mreq_engine_air_filter',
      code: 'AIR_FILTER_INSPECTION',
      name: 'Engine Air Filter Inspection & Renewal',
      description: 'Inspect air induction filter for dust loading, clean housing, or replace filter element.',
      category: MaintenanceCategory.FILTERS,
      component_system: 'ENGINE_AIR_INTAKE',
      default_severity: MaintenanceSeverity.MEDIUM,
      default_priority: 70,
      recommended_action: 'Replace air filter if pleated media is contaminated or air restriction indicated.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 20000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 12,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 1500,
      approaching_time_threshold_days: 30,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
  {
    req: {
      id: 'mreq_cabin_filter',
      code: 'CABIN_AC_FILTER',
      name: 'Cabin Air Conditioner Microfilter Replacement',
      description: 'Replace interior pollen and allergen microfilter behind glove compartment.',
      category: MaintenanceCategory.AIR_CONDITIONING,
      component_system: 'HVAC',
      default_severity: MaintenanceSeverity.LOW,
      default_priority: 50,
      recommended_action: 'Install activated-carbon cabin microfilter for optimal in-cabin air quality.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 15000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 12,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 1000,
      approaching_time_threshold_days: 30,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
  {
    req: {
      id: 'mreq_brake_inspection',
      code: 'BRAKE_INSPECTION',
      name: 'Brake Pads, Rotors & Caliper Inspection',
      description: 'Measure front and rear brake pad friction thickness, rotor runout, and caliper slide pin movement.',
      category: MaintenanceCategory.BRAKES,
      component_system: 'BRAKING',
      default_severity: MaintenanceSeverity.HIGH,
      default_priority: 90,
      recommended_action: 'Measure pad lining thickness; flag replacement if pad material is below 3.0mm.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 15000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 12,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 1500,
      approaching_time_threshold_days: 30,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
  {
    req: {
      id: 'mreq_brake_fluid',
      code: 'BRAKE_FLUID_FLUSH',
      name: 'Brake Fluid Hydraulic Flush & Renewal',
      description: 'Flush brake master cylinder and hydraulic lines with fresh DOT 4 brake fluid; bleed all 4 calipers.',
      category: MaintenanceCategory.FLUIDS,
      component_system: 'BRAKING',
      default_severity: MaintenanceSeverity.HIGH,
      default_priority: 85,
      recommended_action: 'Flush and replace hygroscopic brake fluid to prevent vapor lock and internal corrosion.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 40000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 24,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 2000,
      approaching_time_threshold_days: 45,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
  {
    req: {
      id: 'mreq_tyre_rotation',
      code: 'TYRE_ROTATION',
      name: 'Tyre Rotation, Balancing & Pressure Check',
      description: 'Rotate tyres in cross-pattern to even out tread wear, balance wheels, and adjust cold pressures.',
      category: MaintenanceCategory.TYRES,
      component_system: 'RUNNING_GEAR',
      default_severity: MaintenanceSeverity.MEDIUM,
      default_priority: 75,
      recommended_action: 'Rotate front to rear and re-torque lug nuts to factory specification.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 10000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 6,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 1000,
      approaching_time_threshold_days: 20,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
  {
    req: {
      id: 'mreq_battery_service',
      code: 'BATTERY_INSPECTION',
      name: '12V Auxiliary Battery Health Test & Terminal Service',
      description: 'Conduct conductance load test, verify State of Health (SOH) and State of Charge (SOC), clean terminal posts.',
      category: MaintenanceCategory.BATTERY,
      component_system: 'ELECTRICAL',
      default_severity: MaintenanceSeverity.HIGH,
      default_priority: 80,
      recommended_action: 'Clean corrosion, apply anti-corrosion grease, replace if CCA capacity drops below 70%.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 20000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 12,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 1500,
      approaching_time_threshold_days: 30,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
  {
    req: {
      id: 'mreq_coolant_flush',
      code: 'COOLANT_CHECK',
      name: 'Engine Cooling System Flush & Long-Life Antifreeze',
      description: 'Drain old ethylene glycol coolant, flush heater core and radiator, refill with 50/50 OAT coolant.',
      category: MaintenanceCategory.COOLING,
      component_system: 'THERMAL_MANAGEMENT',
      default_severity: MaintenanceSeverity.HIGH,
      default_priority: 80,
      recommended_action: 'Vacuum bleed cooling system to eliminate air pockets and inspect water pump weep hole.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 80000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 48,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 3000,
      approaching_time_threshold_days: 60,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
  {
    req: {
      id: 'mreq_transmission_fluid',
      code: 'TRANSMISSION_FLUID_SERVICE',
      name: 'Automatic Transmission & Transfer Case Fluid Service',
      description: 'Renew transmission fluid (ATF), clean oil pan magnets, and replace transmission sump filter.',
      category: MaintenanceCategory.TRANSMISSION,
      component_system: 'DRIVETRAIN',
      default_severity: MaintenanceSeverity.CRITICAL,
      default_priority: 85,
      recommended_action: 'Refill with OEM-approved low-viscosity ATF; perform transmission adaptation level check.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 60000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 36,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 3000,
      approaching_time_threshold_days: 60,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
  {
    req: {
      id: 'mreq_spark_plugs',
      code: 'SPARK_PLUG_REPLACEMENT',
      name: 'Iridium / Platinum Spark Plug Replacement',
      description: 'Remove coil packs, inspect electrode gap, and replace spark plugs with factory heat-range plugs.',
      category: MaintenanceCategory.ELECTRICAL,
      component_system: 'IGNITION',
      default_severity: MaintenanceSeverity.MEDIUM,
      default_priority: 65,
      recommended_action: 'Torque spark plugs to 20-25 Nm using torque wrench; apply dielectric grease to boots.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 60000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 36,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 3000,
      approaching_time_threshold_days: 45,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
  {
    req: {
      id: 'mreq_suspension_check',
      code: 'SUSPENSION_INSPECTION',
      name: 'Suspension, Steering Linkage & Ball Joint Inspection',
      description: 'Inspect front and rear dampers for oil leaks, test control arm bushings, tie rod ends, and CV boots.',
      category: MaintenanceCategory.SUSPENSION,
      component_system: 'CHASSIS',
      default_severity: MaintenanceSeverity.HIGH,
      default_priority: 75,
      recommended_action: 'Pry-test lower ball joints; inspect rubber boots for tears or grease expulsion.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 20000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 12,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 1500,
      approaching_time_threshold_days: 30,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
  {
    req: {
      id: 'mreq_safety_inspection',
      code: 'MULTI_POINT_INSPECTION',
      name: 'Annual Multi-Point Safety & Roadworthiness Inspection',
      description: 'Comprehensive 40-point safety check covering lights, horn, seatbelts, wipers, exhaust, and undercarriage.',
      category: MaintenanceCategory.SAFETY,
      component_system: 'SAFETY_SYSTEMS',
      default_severity: MaintenanceSeverity.HIGH,
      default_priority: 85,
      recommended_action: 'Record multi-point checklist with digital photo evidence.',
      recurring: true,
      active: true,
    },
    rule: {
      interval_type: MaintenanceIntervalType.DISTANCE_OR_TIME,
      distance_interval: 10000,
      distance_unit: OdometerUnit.KM,
      time_interval_value: 6,
      time_interval_unit: 'MONTHS',
      trigger_policy: MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: null,
      initial_time_offset_days: null,
      approaching_distance_threshold: 1000,
      approaching_time_threshold_days: 20,
      applicability_conditions: {},
      source_type: MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: 'Garage OS Standard Passenger Schedule',
      verification_status: MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_until: null,
    },
  },
];

/**
 * Seeds canonical maintenance catalog and bootstraps vehicle plans
 */
export function seedMaintenanceCatalog(): void {
  const now = getCurrentUtcIsoString();

  // 1. Seed Requirements and Default Rules
  for (const item of STANDARD_REQUIREMENTS) {
    const existing = maintenanceRepository.getRequirementById(item.req.id);
    if (!existing) {
      maintenanceRepository.insertRequirement({
        ...item.req,
        created_at: now,
        updated_at: now,
      });

      maintenanceRepository.insertRule({
        id: `mrule_${item.req.code.toLowerCase()}`,
        requirement_id: item.req.id,
        ...item.rule,
        created_at: now,
        updated_at: now,
      });
    }
  }

  // 2. Bootstrap default maintenance plans for demo vehicles
  bootstrapVehiclePlans();

  logger.info('Maintenance catalog and default plans successfully seeded');
}

/**
 * Ensures demo vehicles have active maintenance plans with realistic cycle states
 */
function bootstrapVehiclePlans(): void {
  const now = getCurrentUtcIsoString();

  const demoVehicles = [
    {
      vehicleId: 'veh_seed_car_01',
      planName: 'Factory Scheduled Maintenance — 2021 Toyota Prado TX-L',
      baseOdo: 54200,
      history: [
        {
          reqId: 'mreq_engine_oil',
          ruleId: 'mrule_engine_oil_replacement',
          completedKm: 50000,
          completedAt: '2026-02-15T09:30:00.000Z',
          provider: 'Apex Motors & Service Centre',
          parts: [{ name: 'Toyota 0W-30 Premium Synthetic 7.5L', quantity: 1, unitPrice: 8500 }, { name: 'Toyota OEM Oil Filter 90915-YZZD4', quantity: 1, unitPrice: 1800 }],
          cost: 13500,
        },
        {
          reqId: 'mreq_tyre_rotation',
          ruleId: 'mrule_tyre_rotation',
          completedKm: 45000,
          completedAt: '2025-08-20T11:00:00.000Z',
          provider: 'Yaya Quick-Tyre Centre',
          parts: [],
          cost: 2500,
        },
        {
          reqId: 'mreq_brake_inspection',
          ruleId: 'mrule_brake_inspection',
          completedKm: 40000,
          completedAt: '2025-04-10T14:00:00.000Z',
          provider: 'Apex Motors & Service Centre',
          parts: [{ name: 'Brake Fluid Top-up', quantity: 1, unitPrice: 1200 }],
          cost: 4800,
        },
      ],
    },
    {
      vehicleId: 'veh_seed_car_02',
      planName: 'Standard Schedule — 2019 Subaru Outback 2.5i',
      baseOdo: 88450,
      history: [
        {
          reqId: 'mreq_engine_oil',
          ruleId: 'mrule_engine_oil_replacement',
          completedKm: 78000,
          completedAt: '2025-07-10T10:00:00.000Z',
          provider: 'Subaru Kenya Approved Service',
          parts: [{ name: 'Motul 5W-30 Full Synthetic 5L', quantity: 1, unitPrice: 6500 }, { name: 'Subaru OEM Tokyo Roki Oil Filter', quantity: 1, unitPrice: 2200 }],
          cost: 11500,
        },
        {
          reqId: 'mreq_cabin_filter',
          ruleId: 'mrule_cabin_ac_filter',
          completedKm: 72000,
          completedAt: '2025-01-15T15:00:00.000Z',
          provider: 'Subaru Kenya Approved Service',
          parts: [{ name: 'Subaru Cabin Pollen Filter', quantity: 1, unitPrice: 3200 }],
          cost: 4500,
        },
      ],
    },
  ];

  for (const demo of demoVehicles) {
    // Check if vehicle exists in vehicles table
    const veh = vehicleRepository.getVehicleById(demo.vehicleId);
    if (!veh) continue;

    let plan = maintenanceRepository.getActivePlanForVehicle(demo.vehicleId);
    if (!plan) {
      const planId = `vmp_${demo.vehicleId}`;
      plan = {
        id: planId,
        vehicle_id: demo.vehicleId,
        name: demo.planName,
        status: MaintenancePlanStatus.ACTIVE,
        source: MaintenancePlanSource.GARAGE_OS_CATALOG,
        notes: 'Canonical manufacturer-derived maintenance schedule',
        created_at: now,
        activated_at: now,
        updated_at: now,
      };
      maintenanceRepository.insertPlan(plan);

      // Add plan entries for standard requirements
      for (const item of STANDARD_REQUIREMENTS) {
        const ruleId = `mrule_${item.req.code.toLowerCase()}`;
        const entryId = `vmpe_${demo.vehicleId}_${item.req.code.toLowerCase()}`;

        const entry: VehicleMaintenancePlanEntryEntity = {
          id: entryId,
          plan_id: planId,
          requirement_id: item.req.id,
          rule_id: ruleId,
          enabled: true,
          priority_override: null,
          custom_distance_interval: null,
          custom_time_interval_value: null,
          custom_time_interval_unit: null,
          last_known_completion_id: null,
          notes: null,
          created_at: now,
          updated_at: now,
        };
        maintenanceRepository.insertPlanEntry(entry);

        // Check if there is historical completion for this requirement
        const hist = demo.history.find((h) => h.reqId === item.req.id);
        const rule = maintenanceRepository.getRuleById(ruleId);
        if (!rule) continue;

        let baselineDistanceKm = 0;
        let baselineDate = '2024-01-01T00:00:00.000Z';
        let completionId: string | null = null;

        if (hist) {
          completionId = `mcomp_${demo.vehicleId}_${item.req.code.toLowerCase()}_init`;
          const comp: MaintenanceCompletionEntity = {
            id: completionId,
            vehicle_id: demo.vehicleId,
            plan_entry_id: entryId,
            requirement_id: item.req.id,
            cycle_id: null,
            completed_at: hist.completedAt,
            odometer_value: hist.completedKm,
            odometer_unit: OdometerUnit.KM,
            service_provider_id: 'srv_seed_garage_01',
            service_provider_name: hist.provider,
            service_record_id: 'rec_initial_service',
            performed_actions: [`Completed scheduled ${item.req.name}`],
            replaced_parts: hist.parts,
            cost_total: hist.cost,
            currency: 'KES',
            notes: 'Verified historical workshop service record.',
            recorded_by: 'usr_seed_owner_01',
            verification_status: MaintenanceVerificationStatus.PROVIDER_CONFIRMED,
            document_id: null,
            created_at: hist.completedAt,
            updated_at: hist.completedAt,
          };
          maintenanceRepository.insertCompletion(comp);
          baselineDistanceKm = hist.completedKm;
          baselineDate = hist.completedAt;

          maintenanceRepository.updatePlanEntry(entryId, { last_known_completion_id: completionId });
        } else {
          // If no history, assume baseline is initial registration or vehicle start
          baselineDistanceKm = Math.max(0, demo.baseOdo - (rule.distance_interval ? rule.distance_interval * 0.8 : 5000));
          baselineDate = '2025-06-01T00:00:00.000Z';
        }

        // Evaluate active cycle
        const evalResult = evaluateMaintenanceDueState({
          baselineDistanceKm,
          baselineDate,
          currentOdometerKm: demo.baseOdo,
          rule,
          planEntry: entry,
        });

        const cycleId = `mc_${demo.vehicleId}_${item.req.code.toLowerCase()}_c1`;
        maintenanceRepository.insertCycle({
          id: cycleId,
          vehicle_id: demo.vehicleId,
          plan_entry_id: entryId,
          requirement_id: item.req.id,
          rule_id: ruleId,
          cycle_number: 1,
          baseline_distance_km: baselineDistanceKm,
          baseline_date: baselineDate,
          due_distance_km: evalResult.dueDistanceKm,
          due_date: evalResult.dueDate,
          status: evalResult.status,
          trigger_reason: evalResult.triggerReason,
          distance_remaining_km: evalResult.distanceRemainingKm,
          days_remaining: evalResult.daysRemaining,
          deferred_until_date: null,
          deferred_until_distance_km: null,
          deferral_reason: null,
          completed_at: null,
          completion_id: null,
          last_evaluated_at: now,
          created_at: now,
          updated_at: now,
        });
      }
    }
  }
}
