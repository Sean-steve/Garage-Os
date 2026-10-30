/**
 * Canonical Digital Vehicle Passport Builder & Materialization Service (GAR-005 §22-§26)
 *
 * Rules:
 * 1. Passport is a deterministic view/projection compiled from canonical vehicle domain records.
 * 2. It never duplicates source of truth or creates parallel mutable state.
 * 3. Never claim "No accident history" — strictly specify "No accident records are currently recorded in Garage OS".
 * 4. Strictly omit personal owner identification (GDPR/Data Privacy).
 * 5. Generates deterministic SHA-256 integrity hash for tamper verification.
 */

import crypto from 'node:crypto';
import { vehicleRepository } from '../vehicle/vehicleRepository';
import { timelineRepository } from './timelineRepository';
import { componentRepository } from '../components/componentRepository';
import { getCurrentUtcIsoString } from '../domain/time';
import {
  VehiclePassportDTO,
  VehicleTimelineEntryEntity,
  TimelineCategory,
  TimelineSourceType,
  TimelineVerificationStatus,
} from './types';
import {
  VehicleIdentifierType,
  OdometerObservationStatus,
  OdometerUnit,
  VehicleRelationshipType,
} from '../vehicle/types';

export class PassportBuilder {
  /**
   * Compiles the full canonical Digital Vehicle Passport for a vehicle.
   */
  buildPassport(vehicleId: string): VehiclePassportDTO {
    const vehicle = vehicleRepository.getVehicleById(vehicleId);
    if (!vehicle) {
      throw new Error(`Vehicle ${vehicleId} not found`);
    }

    const identifiers = vehicleRepository.getVehicleIdentifiers(vehicleId);
    const relationships = vehicleRepository.getVehicleRelationships(vehicleId);
    const odometerReadings = vehicleRepository.listOdometerObservations(vehicleId, 100, 0);
    const timelineEntries = timelineRepository.getAllVehicleTimelineEntries(vehicleId);

    const now = getCurrentUtcIsoString();

    // 1. Vehicle Identity
    const primaryVin = identifiers.find((i) => i.type === VehicleIdentifierType.VIN);
    const chassis = identifiers.find((i) => i.type === VehicleIdentifierType.CHASSIS_NUMBER);
    const primaryPlate = identifiers.find((i) => i.type === VehicleIdentifierType.REGISTRATION_NUMBER);

    const rawVin = primaryVin ? primaryVin.value : (chassis ? chassis.value : null);
    const vinMasked = rawVin && rawVin.length > 8 ? `${rawVin.substring(0, 5)}...${rawVin.substring(rawVin.length - 4)}` : rawVin;

    // 2. Ownership Summary (Strictly Anonymized - GAR-005 §22B)
    const ownerRelationships = relationships.filter(
      (r) => r.relationship_type === VehicleRelationshipType.OWNER || r.relationship_type === VehicleRelationshipType.CO_OWNER
    );
    const activeOwnerRel = ownerRelationships.find((r) => r.status === 'ACTIVE');
    const ownershipType = activeOwnerRel?.organization_id ? 'COMMERCIAL_ORGANIZATION' : 'PRIVATE_INDIVIDUAL';

    // 3. Mileage History Analysis
    const validReadings = odometerReadings
      .filter((o) => o.status === OdometerObservationStatus.VALID)
      .sort((a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime());

    const flaggedReadings = odometerReadings.filter((o) => o.status === OdometerObservationStatus.FLAGGED);

    const earliestReading = validReadings.length > 0 ? {
      reading_km: validReadings[0].reading_km,
      reading_value: validReadings[0].reading_value,
      unit: validReadings[0].unit,
      observed_at: validReadings[0].observed_at,
    } : null;

    const latestReading = validReadings.length > 0 ? {
      reading_km: validReadings[validReadings.length - 1].reading_km,
      reading_value: validReadings[validReadings.length - 1].reading_value,
      unit: validReadings[validReadings.length - 1].unit,
      observed_at: validReadings[validReadings.length - 1].observed_at,
    } : null;

    // 4. Categorized History Records from Active Timeline Entries
    const activeEntries = timelineEntries.filter((e) => e.is_active);

    const maintenanceEntries = activeEntries.filter(
      (e) => e.category === TimelineCategory.MAINTENANCE || e.category === TimelineCategory.SERVICE
    );
    const verifiedMaintenance = maintenanceEntries.filter(
      (e) => e.verification_status === TimelineVerificationStatus.VERIFIED || e.verification_status === TimelineVerificationStatus.PROVIDER_RECORDED
    );

    const repairEntries = activeEntries.filter((e) => e.category === TimelineCategory.REPAIR);
    const issueEntries = activeEntries.filter((e) => e.category === TimelineCategory.ISSUE);
    const partEntries = activeEntries.filter((e) => e.category === TimelineCategory.PARTS);
    const tyreEntries = activeEntries.filter((e) => e.category === TimelineCategory.TYRES);
    const accidentEntries = activeEntries.filter((e) => e.category === TimelineCategory.ACCIDENT);
    const roadsideEntries = activeEntries.filter((e) => e.category === TimelineCategory.ROADSIDE);
    const modEntries = activeEntries.filter((e) => e.category === TimelineCategory.MODIFICATION);
    const inspectionEntries = activeEntries.filter(
      (e) => e.category === TimelineCategory.IDENTITY || e.category === TimelineCategory.DIAGNOSTIC
    );

    // 5. Data Coverage Calculation
    const allDates: string[] = [vehicle.created_at];
    if (earliestReading) allDates.push(earliestReading.observed_at);
    activeEntries.forEach((e) => allDates.push(e.occurred_at));
    allDates.sort();

    const dataCoverageStart = allDates[0] || vehicle.created_at;
    const dataCoverageEnd = now;

    // 6. Source Breakdown & Verification Metrics
    let externallyVerifiedCount = 0;
    let providerRecordedCount = 0;
    let ownerAssertedCount = 0;
    let deviceObservedCount = 0;
    let systemDerivedCount = 0;

    activeEntries.forEach((e) => {
      switch (e.source_type) {
        case TimelineSourceType.EXTERNAL_VERIFIED:
        case TimelineSourceType.GARAGE_VERIFIED:
          externallyVerifiedCount++;
          break;
        case TimelineSourceType.PROVIDER_RECORDED:
          providerRecordedCount++;
          break;
        case TimelineSourceType.OWNER_ENTERED:
          ownerAssertedCount++;
          break;
        case TimelineSourceType.DEVICE_TELEMETRY:
          deviceObservedCount++;
          break;
        case TimelineSourceType.SYSTEM_DERIVED:
        case TimelineSourceType.PLATFORM_OPERATOR:
        default:
          systemDerivedCount++;
          break;
      }
    });

    // 7. Query Canonical Physical Components, Tyres & Modifications (GAR-010 §9, §29, §52)
    const canonicalComponents = componentRepository.findComponentsByVehicleId(vehicleId);
    const canonicalTyres = componentRepository.findTyresByVehicleId(vehicleId);
    const currentTyrePositions = componentRepository.findCurrentTyrePositions(vehicleId);
    const tyrePositionMap = new Map(currentTyrePositions.map((p) => [p.vehicle_tyre_id, p.position]));
    const canonicalModifications = componentRepository.findModificationsByVehicleId(vehicleId);

    // 8. Assemble Canonical Sections
    const partialDto: Omit<VehiclePassportDTO, 'metadata'> = {
      vehicle_identity: {
        vehicle_id: vehicle.id,
        display_name: vehicle.display_name,
        make: vehicle.make,
        model: vehicle.model,
        model_year: vehicle.model_year,
        trim: vehicle.trim,
        vin: rawVin,
        vin_masked: vinMasked,
        chassis_number: chassis ? chassis.value : null,
        registration_number: primaryPlate ? primaryPlate.value : null,
        color: vehicle.color,
        fuel_type: vehicle.fuel_type,
        transmission: vehicle.transmission,
        drive_type: vehicle.drive_type,
        body_type: vehicle.body_type,
        country_of_registration: vehicle.country_of_registration,
        status: vehicle.status,
        verification_status: vehicle.verification_status,
      },
      ownership_summary: {
        total_ownership_periods: Math.max(ownerRelationships.length, 1),
        current_ownership_type: ownershipType,
        current_period_start_date: activeOwnerRel ? activeOwnerRel.valid_from : vehicle.created_at,
        privacy_note:
          'Prior and current owner personal identities are protected and omitted from the public passport in compliance with the Garage OS Privacy Charter (GAR-000 §5).',
      },
      mileage_history: {
        earliest_reading: earliestReading,
        latest_reading: latestReading,
        total_observations_count: odometerReadings.length,
        flagged_anomalies_count: flaggedReadings.length,
        has_rollback_warning: flaggedReadings.length > 0,
        observations: odometerReadings.slice(0, 50).map((o) => ({
          id: o.id,
          reading_km: o.reading_km,
          reading_value: o.reading_value,
          unit: o.unit,
          observed_at: o.observed_at,
          source_class: o.source_class,
          verification_status: o.status === OdometerObservationStatus.VALID ? 'VERIFIED' : 'UNVERIFIED',
          status: o.status,
          flag_reason: o.flag_reason,
        })),
      },
      maintenance_history: {
        records_count: maintenanceEntries.length,
        verified_records_count: verifiedMaintenance.length,
        records: maintenanceEntries.map((m) => ({
          id: m.id,
          title: m.title,
          summary: m.summary,
          occurred_at: m.occurred_at,
          odometer_km: m.odometer_value,
          provider_name: (m.metadata.provider_name as string) || null,
          verification_status: m.verification_status,
        })),
      },
      repair_history: {
        records_count: repairEntries.length,
        records: repairEntries.map((r) => ({
          id: r.id,
          title: r.title,
          summary: r.summary,
          occurred_at: r.occurred_at,
          odometer_km: r.odometer_value,
          verification_status: r.verification_status,
        })),
      },
      known_issues_history: {
        open_count: issueEntries.filter((i) => i.entry_type === 'ISSUE_REPORTED').length,
        resolved_count: issueEntries.filter((i) => i.entry_type === 'ISSUE_RESOLVED').length,
        records: issueEntries.map((i) => ({
          id: i.id,
          title: i.title,
          status: i.entry_type === 'ISSUE_RESOLVED' ? 'RESOLVED' : 'OPEN',
          reported_at: i.occurred_at,
          resolved_at: (i.metadata.resolved_at as string) || null,
        })),
      },
      installed_parts: {
        parts_count: partEntries.length,
        records: partEntries.map((p) => ({
          id: p.id,
          name: p.title,
          category: (p.metadata.part_category as string) || 'GENERAL',
          installed_at: p.occurred_at,
          odometer_km: p.odometer_value,
        })),
      },
      tyres: {
        installed_records_count: tyreEntries.length,
        records: tyreEntries.map((t) => ({
          id: t.id,
          brand: (t.metadata.brand as string) || 'Standard',
          size: (t.metadata.size as string) || 'OEM',
          position: (t.metadata.position as string) || 'ALL',
          installed_at: t.occurred_at,
        })),
      },
      accident_history: {
        known_records_count: accidentEntries.length,
        statement:
          accidentEntries.length === 0
            ? `No accident records are currently recorded in Garage OS. Timeline coverage for this vehicle started on ${new Date(dataCoverageStart).toLocaleDateString()}.`
            : `${accidentEntries.length} accident incident record(s) logged.`,
        records: accidentEntries.map((a) => ({
          id: a.id,
          incident_date: a.occurred_at,
          severity: (a.metadata.severity as string) || 'UNKNOWN',
          summary: a.summary,
        })),
      },
      roadside_towing_history: {
        incidents_count: roadsideEntries.length,
        records: roadsideEntries.map((r) => ({
          id: r.id,
          date: r.occurred_at,
          incident_type: (r.metadata.incident_type as string) || 'ROADSIDE_ASSISTANCE',
          summary: r.summary,
        })),
      },
      modifications: {
        modifications_count: modEntries.length,
        records: modEntries.map((m) => ({
          id: m.id,
          title: m.title,
          installed_at: m.occurred_at,
          summary: m.summary,
        })),
      },
      inspections: {
        inspections_count: inspectionEntries.length,
        records: inspectionEntries.map((i) => ({
          id: i.id,
          inspection_type: i.title,
          conducted_at: i.occurred_at,
          result: (i.metadata.result as string) || 'COMPLETED',
          inspector: (i.metadata.inspector as string) || null,
        })),
      },
      verification_summary: {
        vin_status: vehicle.verification_status,
        data_sources_breakdown: {
          externally_verified: externallyVerifiedCount,
          provider_recorded: providerRecordedCount,
          owner_asserted: ownerAssertedCount,
          device_observed: deviceObservedCount,
          system_derived: systemDerivedCount,
        },
        total_timeline_entries: activeEntries.length,
        coverage_statement: `Data history compiled from verified service providers, device observations, and owner records. Earliest recorded observation date: ${new Date(dataCoverageStart).toLocaleDateString()}.`,
      },
    };

    // 8. Deterministic Hash Calculation
    const deterministicString = JSON.stringify(partialDto);
    const integrityHash = crypto.createHash('sha256').update(deterministicString).digest('hex');

    const passport: VehiclePassportDTO = {
      metadata: {
        vehicle_id: vehicle.id,
        passport_version: 1,
        generated_at: now,
        data_coverage_start: dataCoverageStart,
        data_coverage_end: dataCoverageEnd,
        record_count: activeEntries.length,
        last_updated_at: vehicle.updated_at,
        integrity_hash: integrityHash,
        is_projection_current: true,
      },
      ...partialDto,
    };

    // 9. Materialize / Upsert Projection Cache
    timelineRepository.upsertPassportProjection({
      vehicle_id: vehicle.id,
      version: 1,
      passport_payload: JSON.stringify(passport),
      integrity_hash: integrityHash,
      source_version: vehicle.version,
      is_stale: false,
      last_projected_at: now,
      created_at: now,
      updated_at: now,
    });

    return passport;
  }

  /**
   * Retrieves the materialized projection if available and fresh,
   * otherwise rebuilds it deterministically.
   */
  getOrBuildPassport(vehicleId: string): VehiclePassportDTO {
    const projection = timelineRepository.getPassportProjection(vehicleId);
    if (projection && !projection.is_stale) {
      try {
        const parsed = JSON.parse(projection.passport_payload) as VehiclePassportDTO;
        parsed.metadata.is_projection_current = true;
        return parsed;
      } catch {
        // Fall back to rebuild on JSON parse issue
      }
    }
    return this.buildPassport(vehicleId);
  }
}

export const passportBuilder = new PassportBuilder();
