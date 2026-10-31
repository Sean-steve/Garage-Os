/**
 * Sprint 20 — Personalized Car Care (GAR-020)
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { carCareService } from '../../src/server/carCare/carCareService';
import { fuelExpenseRepository } from '../../src/server/finance/fuelExpenseRepository';
import { issueService } from '../../src/server/issues/issueService';
import { IssueCategory, IssueSeverity, SymptomCategory } from '../../src/server/issues/types';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';

function actor(userId:string,email:string){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:[],memberships:[],
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-10-31T00:00:00.000Z',updated_at:'2026-10-31T00:00:00.000Z'},
    session_id:'ses_'+userId,
  } as any;
}

describe('Personalized Car Care (GAR-020 / Sprint 20)',()=>{
  let db:any;
  const owner=actor('usr_personal_care_owner','owner@personal-care.test');
  const other=actor('usr_personal_care_other','other@personal-care.test');
  let vehicleId:string;

  beforeEach(()=>{
    resetDatabaseInstance();
    db=getDatabase({memory:true});
    runMigrations(db);

    const insert=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    insert.run(owner.user_id,owner.email,'Personal Care Owner','+254700100001','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    insert.run(other.user_id,other.email,'Other Care Owner','+254700100002','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    vehicleId=vehicleService.createVehicle(owner,{
      make:'Toyota',
      model:'Harrier',
      model_year:2012,
      registration_number:'KDE 220P',
      initial_odometer_value:168000
    }).vehicle.id;
  });

  it('adds owner-configured profile and derived evaluation storage without precise-location columns',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
    assert.ok(tables.includes('vehicle_care_profiles'));
    assert.ok(tables.includes('car_care_personalization_evaluations'));

    const columns=db.prepare("PRAGMA table_info(vehicle_care_profiles)").all().map((r:any)=>String(r.name).toLowerCase());
    for(const forbidden of ['latitude','longitude','gps','address','city','coordinates']){
      assert.equal(columns.includes(forbidden),false,forbidden+' must not be stored in care profile');
    }
  });

  it('returns transparent non-AI/non-location personalization even before a profile is configured',()=>{
    const plan=carCareService.getPersonalizedPlan(owner,vehicleId,false);
    assert.equal(plan.profile,null);
    assert.equal(plan.profile_completeness,'NOT_CONFIGURED');
    assert.equal(plan.location_inference_used,false);
    assert.equal(plan.ai_inference_used,false);
    assert.ok(plan.recommendations.some(r=>r.rule_id==='PROFILE_NOT_CONFIGURED'));
    assert.ok(plan.recommendations.every(r=>r.is_diagnosis===false));
    assert.ok(plan.recommendations.every(r=>r.changes_maintenance_schedule===false));
  });

  it('versions owner-configured profile changes and emits auditable profile events',()=>{
    const first=carCareService.updateCareProfile(owner,vehicleId,{
      usage_pattern:'LONG_DISTANCE',
      annual_distance_band:'KM_20000_30000',
      road_exposure:'ROUGH_ROADS_FREQUENT',
      parking_context:'OUTDOOR_EXPOSED',
      climate_exposures:['HOT','DUSTY','HEAVY_RAIN'],
      long_trip_frequency:'MONTHLY',
      heavy_load_frequency:'OCCASIONAL',
    });

    assert.equal(first.profile_version,1);
    assert.equal(first.source_type,'OWNER_CONFIGURED');

    const second=carCareService.updateCareProfile(owner,vehicleId,{
      heavy_load_frequency:'FREQUENT'
    });
    assert.equal(second.id,first.id);
    assert.equal(second.profile_version,2);
    assert.equal(second.heavy_load_frequency,'FREQUENT');

    const event=db.prepare("SELECT payload FROM outbox_events WHERE type='car_care.profile.updated' ORDER BY created_at DESC LIMIT 1").get() as any;
    assert.ok(event);
    assert.equal(JSON.parse(event.payload).location_inference_used,false);

    const audit=db.prepare("SELECT action FROM audit_events WHERE resource_type='vehicle_care_profile' ORDER BY created_at DESC LIMIT 1").get() as any;
    assert.equal(audit.action,'CAR_CARE_PROFILE_UPDATED');
  });

  it('rejects invalid exposure combinations rather than silently inferring context',()=>{
    assert.throws(
      ()=>carCareService.updateCareProfile(owner,vehicleId,{
        climate_exposures:['NONE_REPORTED','HOT']
      }),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.VALIDATION_ERROR
    );

    assert.throws(
      ()=>carCareService.updateCareProfile(owner,vehicleId,{
        road_exposure:'MOUNTAIN_TRAILS' as any
      }),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.VALIDATION_ERROR
    );
  });

  it('generates explainable profile-specific recommendations with explicit evidence and mission routing',()=>{
    carCareService.updateCareProfile(owner,vehicleId,{
      usage_pattern:'LONG_DISTANCE',
      annual_distance_band:'OVER_30000_KM',
      road_exposure:'ROUGH_ROADS_FREQUENT',
      parking_context:'OUTDOOR_EXPOSED',
      climate_exposures:['HOT','DUSTY','HEAVY_RAIN'],
      long_trip_frequency:'FREQUENT',
      heavy_load_frequency:'FREQUENT',
    });

    const plan=carCareService.getPersonalizedPlan(owner,vehicleId,false);
    const rules=new Set(plan.recommendations.map(r=>r.rule_id));

    assert.ok(rules.has('VEHICLE_AGE_REVIEW_10Y'));
    assert.ok(rules.has('HIGH_ODOMETER_REVIEW_150K'));
    assert.ok(rules.has('ROUGH_ROAD_OWNER_CHECK'));
    assert.ok(rules.has('DUST_EXPOSURE_REVIEW'));
    assert.ok(rules.has('HOT_CONDITIONS_REVIEW'));
    assert.ok(rules.has('HEAVY_RAIN_VISIBILITY_TYRES'));
    assert.ok(rules.has('FREQUENT_LONG_TRIP_PREPARATION'));
    assert.ok(rules.has('FREQUENT_LOAD_CARE'));
    assert.ok(plan.recommended_mission_codes.includes('WEEKLY_OWNER_CHECK'));
    assert.ok(plan.recommended_mission_codes.includes('PRE_TRIP_CHECK'));
    assert.ok(plan.recommended_mission_codes.includes('LONG_TRIP_PREPARATION'));

    for(const rec of plan.recommendations){
      assert.equal(rec.is_diagnosis,false);
      assert.equal(rec.changes_maintenance_schedule,false);
      assert.ok(rec.rule_id.length>0);
      assert.ok(rec.evidence.length>0);
    }
  });

  it('does not mutate canonical maintenance due-state when profile or personalization changes',()=>{
    const before=carCareService.getDashboard(owner,vehicleId).maintenance;
    const beforeRows=db.prepare(
      "SELECT id,status,due_date,due_distance_km FROM maintenance_cycles WHERE vehicle_id=? ORDER BY id"
    ).all(vehicleId);

    carCareService.updateCareProfile(owner,vehicleId,{
      road_exposure:'ROUGH_ROADS_FREQUENT',
      climate_exposures:['DUSTY'],
      usage_pattern:'DAILY_COMMUTE'
    });
    const plan=carCareService.getPersonalizedPlan(owner,vehicleId,true);
    assert.ok(plan.recommendations.every(r=>r.changes_maintenance_schedule===false));

    const after=carCareService.getDashboard(owner,vehicleId).maintenance;
    const afterRows=db.prepare(
      "SELECT id,status,due_date,due_distance_km FROM maintenance_cycles WHERE vehicle_id=? ORDER BY id"
    ).all(vehicleId);

    assert.equal(after.overall_status,before.overall_status);
    assert.equal(after.overdue_count,before.overdue_count);
    assert.deepEqual(afterRows,beforeRows);
  });

  it('surfaces a fuel-efficiency anomaly as an observation and never as a diagnosis',()=>{
    fuelExpenseRepository.saveSnapshot({
      id:'fes_personalized_01',
      vehicle_id:vehicleId,
      rolling_economy_km_l:7.5,
      baseline_economy_km_l:10.2,
      delta_percent:-26.47,
      anomaly_detected:true,
      observation_text:'Fuel economy is below the recorded baseline across qualifying intervals.',
      data_quality:'SUFFICIENT',
      qualifying_intervals_count:4,
      total_distance_km:1100,
      observed_at:'2026-10-30T08:00:00.000Z',
      created_at:'2026-10-30T08:00:00.000Z',
    });

    const plan=carCareService.getPersonalizedPlan(owner,vehicleId,false);
    const rec=plan.recommendations.find(r=>r.rule_id==='RECORDED_FUEL_EFFICIENCY_ANOMALY');
    assert.ok(rec);
    assert.equal(rec!.is_diagnosis,false);
    assert.match(rec!.explanation,/observation|not a diagnosis/i);
  });

  it('keeps critical issue authority separate from personalization and flags the precedence in data notes',()=>{
    issueService.reportIssue(vehicleId,{
      title:'Critical braking issue',
      summary:'Vehicle braking is severely reduced.',
      category:IssueCategory.BRAKES,
      severity:IssueSeverity.CRITICAL,
      symptom_category:SymptomCategory.BRAKING_BEHAVIOR,
      symptom_description:'Vehicle has severely reduced braking response.'
    },owner.user_id);

    const dashboard=carCareService.getDashboard(owner,vehicleId);
    assert.ok(dashboard.guidance.some(g=>g.priority==='CRITICAL'));

    const plan=carCareService.getPersonalizedPlan(owner,vehicleId,false);
    assert.ok(plan.data_quality_notes.some(x=>/Critical issue records remain authoritative/i.test(x)));
    assert.equal(plan.recommendations.some(r=>r.is_diagnosis!==false),false);
  });

  it('records explicit deterministic evaluations with a fingerprint and no AI/location inference',()=>{
    carCareService.updateCareProfile(owner,vehicleId,{
      usage_pattern:'MIXED',
      road_exposure:'MIXED',
      climate_exposures:['HOT'],
      long_trip_frequency:'OCCASIONAL'
    });

    const plan=carCareService.getPersonalizedPlan(owner,vehicleId,true);
    const evaluations=carCareService.listPersonalizationEvaluations(owner,vehicleId,5);
    assert.equal(evaluations.length,1);
    assert.equal(evaluations[0].recommendation_count,plan.recommendations.length);
    assert.equal(evaluations[0].input_fingerprint.length,64);
    assert.match(evaluations[0].rule_version,/GAR020-S20/);

    const serialized=JSON.stringify(evaluations[0]);
    assert.equal(serialized.includes('"latitude"'),false);
    assert.equal(serialized.includes('"longitude"'),false);
    assert.equal(serialized.includes('AI_MODEL_INFERRED'),false);

    const outbox=db.prepare("SELECT payload FROM outbox_events WHERE type='car_care.personalization.evaluated' ORDER BY created_at DESC LIMIT 1").get() as any;
    const payload=JSON.parse(outbox.payload);
    assert.equal(payload.location_inference_used,false);
    assert.equal(payload.ai_inference_used,false);
  });

  it('enforces vehicle authorization for profile, plan and evaluation history',()=>{
    for(const fn of [
      ()=>carCareService.getCareProfile(other,vehicleId),
      ()=>carCareService.updateCareProfile(other,vehicleId,{usage_pattern:'MIXED'}),
      ()=>carCareService.getPersonalizedPlan(other,vehicleId,false),
      ()=>carCareService.listPersonalizationEvaluations(other,vehicleId,5),
    ]){
      assert.throws(
        fn,
        (err:any)=>err instanceof CanonicalAppError&&(
          err.code===ErrorCode.NOT_AUTHORIZED||err.code===ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
        )
      );
    }
  });
});
