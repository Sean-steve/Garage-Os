import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { issueService } from '../../src/server/issues/issueService';
import { issueRepository } from '../../src/server/issues/issueRepository';
import {
  IssueCategory,
  IssueSeverity,
  IssueStatus,
  IssuePersistenceState,
  SymptomCategory,
  IssueInterventionType,
  IssueResolutionType,
} from '../../src/server/issues/types';
import { CanonicalActorType } from '../../src/shared/types';

describe('Vehicle Issue, Fault & Persistent Problem Architecture (GAR-008)', () => {
  const vehicleId = 'veh_prado_tx_2018';
  const ownerId = 'usr_owner_01';
  const providerId = 'usr_provider_01';

  beforeEach(() => {
    resetDatabaseInstance();
    const db = getDatabase({ memory: true });
    runMigrations(db);

    // Seed vehicle
    db.prepare(`
      INSERT OR REPLACE INTO vehicles (
        id, owner_id, display_name, make, model, model_year, status, created_at, updated_at
      ) VALUES (
        '${vehicleId}', '${ownerId}', '2018 Toyota Land Cruiser Prado TX-L', 'Toyota', 'Land Cruiser Prado', 2018, 'ACTIVE', datetime('now'), datetime('now')
      );
    `).run();
  });

  it('reports a symptom without conflating it with a diagnosis (Invariant 1)', () => {
    const result = issueService.reportIssue(
      vehicleId,
      {
        title: 'Front-end shimmy vibration at highway speeds',
        category: IssueCategory.STEERING,
        severity: IssueSeverity.MODERATE,
        summary: 'Steering wheel oscillation between 85-95 km/h on smooth tarmac.',
        symptom_category: SymptomCategory.VIBRATION,
        symptom_description: 'Steering wheel wobbles side to side when cruising at 90 km/h.',
        odometer_value: 142000,
        speed_range: '85-95 km/h',
        driving_condition: 'HIGHWAY_CRUISE',
      },
      ownerId,
      CanonicalActorType.VEHICLE_OWNER
    );

    assert.ok(result.id);
    assert.equal(result.status, IssueStatus.REPORTED);
    assert.equal(result.occurrence_count, 1);
    assert.equal(result.persistence_state, IssuePersistenceState.SINGLE_OCCURRENCE);
    assert.equal(result.occurrences.length, 1);

    // Verify diagnosis list is EMPTY (Symptom ≠ Diagnosis)
    const diagnoses = issueRepository.listDiagnosesForIssue(result.id);
    assert.equal(diagnoses.length, 0);
  });

  it('tracks repeat occurrences and transitions persistence state to REPEATED / PERSISTENT', () => {
    const initial = issueService.reportIssue(
      vehicleId,
      {
        title: 'Cold engine squeal on startup',
        category: IssueCategory.ENGINE,
        severity: IssueSeverity.LOW,
        summary: 'High pitch screech on cold morning start.',
        symptom_category: SymptomCategory.NOISE,
        symptom_description: 'Screech lasts 4 seconds after turning ignition key.',
      },
      ownerId,
      CanonicalActorType.VEHICLE_OWNER
    );

    assert.equal(initial.occurrence_count, 1);
    assert.equal(initial.persistence_state, IssuePersistenceState.SINGLE_OCCURRENCE);

    // Occurrence 2
    const occ2 = issueService.recordOccurrence(
      vehicleId,
      initial.id,
      {
        description: 'Screeched again on damp rainy morning.',
        symptom_category: SymptomCategory.NOISE,
      },
      ownerId,
      CanonicalActorType.VEHICLE_OWNER
    );

    assert.equal(occ2.occurrence_count, 2);
    assert.equal(occ2.persistence_state, IssuePersistenceState.REPEATED);
    assert.equal(occ2.occurrences.length, 2);

    // Occurrence 3
    const occ3 = issueService.recordOccurrence(
      vehicleId,
      initial.id,
      {
        description: 'Third screech, louder this time.',
        symptom_category: SymptomCategory.NOISE,
      },
      ownerId,
      CanonicalActorType.VEHICLE_OWNER
    );

    assert.equal(occ3.occurrence_count, 3);
    assert.equal(occ3.persistence_state, IssuePersistenceState.PERSISTENT);
  });

  it('records an intervention and transitions issue to MONITORING without automatically resolving (Invariant 2)', () => {
    const issue = issueService.reportIssue(
      vehicleId,
      {
        title: 'Front brake pulsation',
        category: IssueCategory.BRAKES,
        severity: IssueSeverity.MODERATE,
        summary: 'Pulsing brake pedal under moderate deceleration.',
        symptom_category: SymptomCategory.VIBRATION,
        symptom_description: 'Brake pedal pulses back and forth.',
      },
      ownerId,
      CanonicalActorType.VEHICLE_OWNER
    );

    // Record professional diagnosis
    const diag = issueService.recordDiagnosis(
      vehicleId,
      issue.id,
      {
        provider_name: 'Braking Specialists Nairobi',
        diagnosis_summary: 'Front brake discs lateral runout measured 0.12mm (exceeds 0.05mm max)',
        diagnosis_details: 'Dial gauge test confirmed warped front vented rotors.',
        confirmed_component: 'Front Brake Rotors & Pads',
      },
      providerId,
      CanonicalActorType.GARAGE_STAFF
    );

    assert.equal(diag.status, IssueStatus.DIAGNOSED);
    assert.equal(diag.diagnoses.length, 1);

    // Record repair intervention
    const intv = issueService.recordIntervention(
      vehicleId,
      issue.id,
      {
        diagnosis_id: diag.diagnoses[0].id,
        intervention_type: IssueInterventionType.REPLACEMENT,
        description: 'Replaced front rotors with OEM Toyota discs and ceramic pads.',
        provider_name: 'Braking Specialists Nairobi',
        replaced_part_names: ['Toyota Front Rotors 43512-60191', 'Brake Pads Set 04465-60320'],
        cost_total: 28500,
        currency: 'KES',
        schedule_followup_days: 14,
      },
      providerId,
      CanonicalActorType.GARAGE_STAFF
    );

    // CRITICAL INVARIANT: Repair must NOT auto-resolve; it transitions to MONITORING
    assert.notEqual(intv.status, IssueStatus.RESOLVED);
    assert.equal(intv.status, IssueStatus.MONITORING);
    assert.equal(intv.intervention_count, 1);
    assert.equal(intv.interventions.length, 1);
    assert.ok(intv.followups.length > 0);
  });

  it('resolves issue with verification record, and allows proper recurrence reopening if symptom returns', () => {
    const issue = issueService.reportIssue(
      vehicleId,
      {
        title: 'Rear suspension knock over speed bumps',
        category: IssueCategory.SUSPENSION,
        severity: IssueSeverity.LOW,
        summary: 'Metallic thud from rear axle.',
        symptom_category: SymptomCategory.NOISE,
        symptom_description: 'Thud heard over rubber bumps.',
      },
      ownerId,
      CanonicalActorType.VEHICLE_OWNER
    );

    // Intervene
    issueService.recordIntervention(
      vehicleId,
      issue.id,
      {
        intervention_type: IssueInterventionType.REPLACEMENT,
        description: 'Replaced rear sway bar end links.',
        replaced_part_names: ['Rear Stabilizer Link RH & LH'],
      },
      providerId,
      CanonicalActorType.GARAGE_STAFF
    );

    // Explicit resolution after test drive
    const resolved = issueService.resolveIssue(
      vehicleId,
      issue.id,
      {
        resolution_type: IssueResolutionType.REPAIR_CONFIRMED,
        resolution_summary: 'Verified on test route over multiple bumps; knock fully eliminated.',
        resolved_odometer_km: 145000,
      },
      ownerId,
      CanonicalActorType.VEHICLE_OWNER
    );

    assert.equal(resolved.status, IssueStatus.RESOLVED);
    assert.ok(resolved.resolution);

    // Suppose later, symptom returns!
    const recurred = issueService.recurIssue(
      vehicleId,
      issue.id,
      {
        description: 'Knocking noise returned when loaded with rear passengers.',
        odometer_value: 149500,
      },
      ownerId,
      CanonicalActorType.VEHICLE_OWNER
    );

    assert.equal(recurred.status, IssueStatus.RECURRED);
    assert.equal(recurred.persistence_state, IssuePersistenceState.RECURRENT_AFTER_RESOLUTION);
    assert.equal(recurred.occurrence_count, 2);

    // Verify all history (initial symptom, intervention, resolution, recurrence) is retained
    const enriched = issueService.getEnrichedIssue(issue.id);
    assert.ok(enriched);
    assert.equal(enriched.occurrences.length, 2);
    assert.equal(enriched.interventions.length, 1);
    assert.ok(enriched.resolution);
  });
});
