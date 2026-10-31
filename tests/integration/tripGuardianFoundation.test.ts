/**
 * Sprint 21 — Pre-Trip & Trip Guardian Foundation (GAR-019)
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { tripGuardianService } from '../../src/server/tripGuardian/tripGuardianService';
import { carCareService } from '../../src/server/carCare/carCareService';
import { safetyService } from '../../src/server/safety/safetyService';
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

describe('Trip Guardian Foundation (GAR-019 / Sprint 21)',()=>{
  let db:any;
  const owner=actor('usr_trip_owner','owner@trip.test');
  const other=actor('usr_trip_other','other@trip.test');
  let vehicleId:string;

  beforeEach(()=>{
    resetDatabaseInstance();
    db=getDatabase({memory:true});
    runMigrations(db);
    const insert=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    insert.run(owner.user_id,owner.email,'Trip Owner','+254700200001','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    insert.run(other.user_id,other.email,'Other Trip Owner','+254700200002','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    vehicleId=vehicleService.createVehicle(owner,{
      make:'Toyota',model:'Harrier',model_year:2018,registration_number:'KDF 221T',initial_odometer_value:92000
    }).vehicle.id;
  });

  function createJourney(overrides:any={}){
    return tripGuardianService.create(owner,{
      vehicle_id:vehicleId,
      origin_label:'Home area',
      destination_label:'Destination area',
      planned_departure_at:'2026-11-01T05:00:00.000Z',
      expected_arrival_at:'2026-11-01T08:00:00.000Z',
      checkins_enabled:true,
      checkin_interval_minutes:60,
      ...overrides,
    });
  }

  it('adds normalized journey/check-in/share/location/history persistence',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
    for(const table of [
      'trip_guardian_journeys','trip_guardian_contact_shares','trip_guardian_checkins',
      'trip_guardian_location_snapshots','trip_guardian_escalation_links','trip_guardian_status_history'
    ]) assert.ok(tables.includes(table),table+' must exist');
  });

  it('prepares a journey by linking a real Car Care PRE_TRIP_CHECK mission',()=>{
    const aggregate=createJourney({checkins_enabled:false});
    assert.equal(aggregate.journey.status,'PREPARED');
    const mission=carCareService.getMission(owner,vehicleId,aggregate.journey.pretrip_mission_id);
    assert.equal(mission.template.code,'PRE_TRIP_CHECK');
    assert.equal(mission.mission.status,'ACTIVE');
    assert.equal(aggregate.readiness.level,'CHECKLIST_INCOMPLETE');
    assert.equal(aggregate.readiness.requires_start_acknowledgement,true);
    assert.equal(aggregate.truth.journey_status_is_safety_certification,false);
    assert.match(aggregate.readiness.statement,/does not certify/i);
  });

  it('allows only one open journey per owner/vehicle',()=>{
    createJourney({checkins_enabled:false});
    assert.throws(
      ()=>createJourney({destination_label:'Second destination',checkins_enabled:false}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.CONFLICT
    );
  });

  it('requires explicit acknowledgement when checklist/readiness warnings remain',()=>{
    const aggregate=createJourney({checkins_enabled:false});
    assert.throws(
      ()=>tripGuardianService.start(owner,aggregate.journey.id,{}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );
    const started=tripGuardianService.start(owner,aggregate.journey.id,{
      acknowledge_readiness_warnings:true,
      acknowledgement_note:'Owner reviewed the incomplete pre-trip state.'
    });
    assert.equal(started.journey.status,'IN_PROGRESS');
    assert.ok(started.journey.start_warning_acknowledged_at);
  });

  it('does not allow start when the canonical Issue domain requires immediate grounding',()=>{
    const aggregate=createJourney({checkins_enabled:false});
    const issue=issueService.reportIssue(vehicleId,{
      title:'Brake failure symptom',
      summary:'Brake pedal goes to the floor and there is no brake response.',
      category:IssueCategory.BRAKES,
      severity:IssueSeverity.CRITICAL,
      symptom_category:SymptomCategory.BRAKING_BEHAVIOR,
      symptom_description:'Brake pedal to floor with no brake response.'
    },owner.user_id);
    const enriched=issueService.getEnrichedIssue(issue.id);
    assert.equal(enriched.requires_immediate_grounding,true);

    const readiness=tripGuardianService.getReadiness(owner,aggregate.journey.id);
    assert.equal(readiness.level,'CANONICAL_STOP_DRIVING');
    assert.equal(readiness.start_allowed,false);

    assert.throws(
      ()=>tripGuardianService.start(owner,aggregate.journey.id,{acknowledge_readiness_warnings:true}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );
  });

  it('can reach REVIEWED only as checklist state and never as a safety certification',()=>{
    const aggregate=createJourney({checkins_enabled:false});
    let mission=carCareService.getMission(owner,vehicleId,aggregate.journey.pretrip_mission_id);
    for(const row of mission.items){
      mission=carCareService.updateMissionItem(owner,vehicleId,mission.mission.id,row.item.id,'COMPLETED');
    }
    const readiness=tripGuardianService.getReadiness(owner,aggregate.journey.id);
    assert.equal(readiness.level,'REVIEWED');
    assert.equal(readiness.start_allowed,true);
    assert.equal(readiness.requires_start_acknowledgement,false);
    assert.match(readiness.statement,/does not certify/i);
  });

  it('schedules check-ins, prompts idempotently, and records a missed check-in without inferring injury/crash or activating SOS',()=>{
    const aggregate=createJourney();
    const started=tripGuardianService.start(owner,aggregate.journey.id,{acknowledge_readiness_warnings:true});
    assert.equal(started.checkins.length,1);
    const checkin=started.checkins[0];

    assert.equal(tripGuardianService.promptCheckIn(checkin.id,checkin.due_at),true);
    assert.equal(tripGuardianService.promptCheckIn(checkin.id,checkin.due_at),false);

    const missedAt=new Date(new Date(checkin.due_at).getTime()+11*60*1000).toISOString();
    assert.equal(tripGuardianService.timeoutCheckIn(checkin.id,missedAt),true);

    const refreshed=tripGuardianService.get(owner,aggregate.journey.id);
    assert.equal(refreshed.checkins[0].status,'MISSED');
    assert.equal(refreshed.truth.missed_checkin_means_injury,false);

    const event=db.prepare("SELECT payload FROM outbox_events WHERE type='trip_guardian.checkin.missed' ORDER BY created_at DESC LIMIT 1").get() as any;
    const payload=JSON.parse(event.payload);
    assert.equal(payload.no_response_received,true);
    assert.equal(payload.injury_inferred,false);
    assert.equal(payload.crash_inferred,false);
    assert.equal(payload.automatic_sos_activated,false);
  });

  it('records NEED_HELP without automatic emergency escalation',()=>{
    const aggregate=createJourney();
    const started=tripGuardianService.start(owner,aggregate.journey.id,{acknowledge_readiness_warnings:true});
    const checkin=started.checkins[0];
    const updated=tripGuardianService.respondCheckIn(owner,aggregate.journey.id,checkin.id,'NEED_HELP','Need assistance');
    assert.equal(updated.checkins[0].status,'RESPONDED');
    assert.equal(updated.checkins[0].response,'NEED_HELP');
    assert.equal(updated.escalation_links.length,0);
    const activeSos=db.prepare("SELECT COUNT(*) AS count FROM sos_incidents WHERE user_id=? AND status IN ('COUNTDOWN','ACTIVATED')").get(owner.user_id) as any;
    assert.equal(Number(activeSos.count),0);
  });

  it('requires explicit global and journey consent for precise trip-location snapshots and never emits coordinates to outbox/audit',()=>{
    assert.throws(
      ()=>createJourney({location_sharing_enabled:true,checkins_enabled:false}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );

    safetyService.updatePreferences(owner,{allow_location_sharing:true});
    const aggregate=createJourney({location_sharing_enabled:true,checkins_enabled:false});
    tripGuardianService.start(owner,aggregate.journey.id,{acknowledge_readiness_warnings:true});

    const snapshot=tripGuardianService.recordLocation(owner,aggregate.journey.id,{
      latitude:-1.286389,longitude:36.817223,accuracy_meters:8,captured_at:'2026-11-01T05:10:00.000Z'
    });
    assert.equal(snapshot.sharing_authorized,true);

    const event=db.prepare("SELECT payload FROM outbox_events WHERE type='trip_guardian.location.snapshot_recorded' ORDER BY created_at DESC LIMIT 1").get() as any;
    assert.equal(event.payload.includes('-1.286389'),false);
    assert.equal(event.payload.includes('36.817223'),false);
    const audit=db.prepare("SELECT metadata FROM audit_events WHERE action='TRIP_GUARDIAN_LOCATION_RECORDED' ORDER BY created_at DESC LIMIT 1").get() as any;
    assert.equal(String(audit.metadata).includes('-1.286389'),false);
    assert.equal(String(audit.metadata).includes('36.817223'),false);
  });

  it('configures Emergency Circle journey context without claiming a notification was sent or delivered',()=>{
    const contact=safetyService.addContact(owner,{
      display_name:'Trusted Person',relationship_label:'Family',phone_e164:'+254700200010',priority:1
    });
    const aggregate=createJourney({checkins_enabled:false,contact_ids:[contact.id]});
    assert.equal(aggregate.contact_shares.length,1);
    assert.equal(aggregate.contact_shares[0].contact_id,contact.id);

    const event=db.prepare("SELECT payload FROM outbox_events WHERE type='trip_guardian.journey.prepared' ORDER BY created_at DESC LIMIT 1").get() as any;
    const payload=JSON.parse(event.payload);
    assert.equal(payload.trusted_contact_notification_attempted,false);
    assert.equal(payload.contact_share_count,1);
  });

  it('creates an SOS link only after explicit owner escalation and preserves SOS truth-state separation',()=>{
    safetyService.updatePreferences(owner,{allow_location_sharing:true});
    const aggregate=createJourney({location_sharing_enabled:true,checkins_enabled:false});
    tripGuardianService.start(owner,aggregate.journey.id,{acknowledge_readiness_warnings:true});
    tripGuardianService.recordLocation(owner,aggregate.journey.id,{
      latitude:-1.28,longitude:36.82,accuracy_meters:10
    });

    const escalated=tripGuardianService.escalateToSos(owner,aggregate.journey.id,{});
    assert.equal(escalated.escalation_links.length,1);
    const sosId=escalated.escalation_links[0].target_reference_id;
    const sos=db.prepare('SELECT status,assistance_state FROM sos_incidents WHERE id=?').get(sosId) as any;
    assert.equal(sos.status,'COUNTDOWN');
    assert.equal(sos.assistance_state,'NOT_REQUESTED');

    const event=db.prepare("SELECT payload FROM outbox_events WHERE type='trip_guardian.sos_handoff.created' ORDER BY created_at DESC LIMIT 1").get() as any;
    const payload=JSON.parse(event.payload);
    assert.equal(payload.sos_backend_acknowledged,true);
    assert.equal(payload.trusted_contact_delivery_confirmed,false);
    assert.equal(payload.assistance_requested,false);
    assert.equal(payload.assistance_accepted,false);
  });

  it('arrival closes pending check-ins, revokes trip-location access and does not create Passport history',()=>{
    safetyService.updatePreferences(owner,{allow_location_sharing:true});
    const aggregate=createJourney({location_sharing_enabled:true});
    const started=tripGuardianService.start(owner,aggregate.journey.id,{acknowledge_readiness_warnings:true});
    tripGuardianService.recordLocation(owner,aggregate.journey.id,{latitude:-1.28,longitude:36.82});
    const arrived=tripGuardianService.arrive(owner,aggregate.journey.id);
    assert.equal(arrived.journey.status,'ARRIVED');
    assert.equal(arrived.latest_location,null);
    assert.ok(arrived.checkins.every(c=>c.status!=='PENDING'));

    const activeLocations=db.prepare("SELECT COUNT(*) AS count FROM trip_guardian_location_snapshots WHERE journey_id=? AND access_revoked_at IS NULL").get(aggregate.journey.id) as any;
    assert.equal(Number(activeLocations.count),0);

    const timeline=db.prepare("SELECT COUNT(*) AS count FROM vehicle_timeline_entries WHERE source_reference_type='TRIP_GUARDIAN_JOURNEY'").get() as any;
    assert.equal(Number(timeline.count),0);

    const mission=carCareService.getMission(owner,vehicleId,started.journey.pretrip_mission_id);
    assert.ok(['COMPLETED','CANCELLED'].includes(mission.mission.status));
  });

  it('enforces cross-user isolation for journey reads and actions',()=>{
    const aggregate=createJourney({checkins_enabled:false});
    for(const fn of [
      ()=>tripGuardianService.get(other,aggregate.journey.id),
      ()=>tripGuardianService.getReadiness(other,aggregate.journey.id),
      ()=>tripGuardianService.start(other,aggregate.journey.id,{acknowledge_readiness_warnings:true}),
    ]){
      assert.throws(
        fn,
        (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
      );
    }
  });
});
