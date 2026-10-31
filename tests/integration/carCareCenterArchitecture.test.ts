/**
 * Sprint 19 — Car Care Center (GAR-020)
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { issueService } from '../../src/server/issues/issueService';
import { IssueCategory, IssueSeverity, SymptomCategory } from '../../src/server/issues/types';
import { carCareService } from '../../src/server/carCare/carCareService';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';

function actor(userId:string,email:string){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:[],memberships:[],
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-10-31T00:00:00.000Z',updated_at:'2026-10-31T00:00:00.000Z'},
    session_id:'ses_'+userId,
  } as any;
}

describe('Car Care Center (GAR-020)',()=>{
  let db:any;
  const owner=actor('usr_care_owner','owner@care.test');
  const other=actor('usr_care_other','other@care.test');
  let vehicleId:string;

  beforeEach(()=>{
    resetDatabaseInstance();
    db=getDatabase({memory:true});
    runMigrations(db);
    const insert=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    insert.run(owner.user_id,owner.email,'Care Owner','+254700000001','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    insert.run(other.user_id,other.email,'Other Owner','+254700000002','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    vehicleId=vehicleService.createVehicle(owner,{
      make:'Toyota',model:'Harrier',model_year:2018,registration_number:'KDC 919C',
      initial_odometer_value:86000
    }).vehicle.id;
  });

  it('adds curated guidance and normalized owner mission persistence',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
    for(const table of [
      'car_care_articles','car_care_mission_templates','car_care_mission_items',
      'vehicle_care_missions','vehicle_care_mission_item_progress'
    ]) assert.ok(tables.includes(table),table+' must exist');

    const articles=carCareService.listArticles();
    assert.ok(articles.length>=8);
    assert.ok(articles.some(a=>a.slug==='engine-temperature-overheating'&&a.risk_level==='URGENT'));
    assert.ok(articles.every(a=>a.source_label.length>0));
  });

  it('explains warning lights without converting the content into a diagnosis',()=>{
    const article=carCareService.getArticle('check-engine-light');
    assert.match(article.explanation,/not a diagnosis/i);
    assert.equal(article.professional_inspection_required,true);
    assert.equal(article.booking_recommended,true);
    assert.ok(article.owner_actions.length>0);
    assert.ok(article.seek_help_when.length>0);
  });

  it('surfaces canonical critical issue state and explicitly marks guidance as non-diagnostic',()=>{
    const issue=issueService.reportIssue(vehicleId,{
      title:'Severe brake problem',
      summary:'Brake pedal has almost no pressure and stopping distance increased.',
      category:IssueCategory.BRAKES,
      severity:IssueSeverity.CRITICAL,
      symptom_category:SymptomCategory.BRAKING_BEHAVIOR,
      symptom_description:'Vehicle does not slow normally under braking.'
    },owner.user_id);

    const dash=carCareService.getDashboard(owner,vehicleId);
    const card=dash.guidance.find(x=>x.source_reference_id===issue.id);
    assert.ok(card);
    assert.equal(card!.priority,'CRITICAL');
    assert.equal(card!.is_diagnosis,false);
    assert.ok(card!.actions.some(a=>a.target_tab==='roadside'));
    assert.match(card!.explanation,/existing issue|canonical next action/i);
  });

  it('does not fabricate maintenance urgency when the canonical maintenance engine has no due state',()=>{
    const dash=carCareService.getDashboard(owner,vehicleId);
    assert.equal(typeof dash.maintenance.overall_status,'string');
    const maintenanceCards=dash.guidance.filter(x=>x.source_type==='MAINTENANCE_STATE');
    if(dash.maintenance.overdue_count===0&&dash.maintenance.due_count===0&&dash.maintenance.approaching_count===0){
      assert.equal(maintenanceCards.length,0);
    }
  });

  it('starts one active mission per template and creates structured progress rows',()=>{
    const first=carCareService.startMission(owner,vehicleId,'WEEKLY_OWNER_CHECK');
    const second=carCareService.startMission(owner,vehicleId,'WEEKLY_OWNER_CHECK');

    assert.equal(first.mission.id,second.mission.id);
    assert.equal(first.mission.status,'ACTIVE');
    assert.ok(first.items.length>=4);
    assert.equal(first.progress.pending,first.items.length);
    assert.ok(first.items.every(x=>x.progress.status==='PENDING'));

    const count=db.prepare("SELECT COUNT(*) AS count FROM vehicle_care_missions WHERE vehicle_id=? AND template_id=? AND status='ACTIVE'").get(vehicleId,first.template.id) as any;
    assert.equal(Number(count.count),1);
  });

  it('prevents an owner from self-certifying a professional-inspection-only checklist item',()=>{
    const mission=carCareService.startMission(owner,vehicleId,'LONG_TRIP_PREPARATION');
    const professional=mission.items.find(x=>x.item.check_level==='PROFESSIONAL_INSPECTION_ONLY');
    assert.ok(professional);

    assert.throws(
      ()=>carCareService.updateMissionItem(owner,vehicleId,mission.mission.id,professional!.item.id,'COMPLETED'),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );

    const updated=carCareService.updateMissionItem(owner,vehicleId,mission.mission.id,professional!.item.id,'PROFESSIONAL_HELP_REQUIRED');
    assert.equal(updated.items.find(x=>x.item.id===professional!.item.id)!.progress.status,'PROFESSIONAL_HELP_REQUIRED');
  });

  it('completes an owner checklist without claiming professional inspection or roadworthiness certification',()=>{
    let mission=carCareService.startMission(owner,vehicleId,'WEEKLY_OWNER_CHECK');
    for(const row of mission.items){
      mission=carCareService.updateMissionItem(owner,vehicleId,mission.mission.id,row.item.id,'COMPLETED');
    }

    assert.equal(mission.mission.status,'COMPLETED');
    assert.match(mission.completion_statement,/does not certify/i);

    const event=db.prepare("SELECT payload FROM outbox_events WHERE type='car_care.mission.completed' AND correlation_id=? ORDER BY created_at DESC LIMIT 1").get(mission.mission.id) as any;
    assert.ok(event);
    assert.equal(JSON.parse(event.payload).professional_inspection_certified,false);
  });

  it('keeps completed missions immutable',()=>{
    let mission=carCareService.startMission(owner,vehicleId,'PRE_TRIP_CHECK');
    for(const row of mission.items){
      mission=carCareService.updateMissionItem(owner,vehicleId,mission.mission.id,row.item.id,'SKIPPED');
    }
    assert.equal(mission.mission.status,'COMPLETED');

    assert.throws(
      ()=>carCareService.updateMissionItem(owner,vehicleId,mission.mission.id,mission.items[0].item.id,'COMPLETED'),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.INVALID_STATE_TRANSITION
    );
  });

  it('enforces vehicle ownership/resource authorization for Car Care dashboard and missions',()=>{
    assert.throws(
      ()=>carCareService.getDashboard(other,vehicleId),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
    );
    assert.throws(
      ()=>carCareService.startMission(other,vehicleId,'WEEKLY_OWNER_CHECK'),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
    );
  });

  it('does not create Passport/timeline records merely because an owner completed a care checklist',()=>{
    let mission=carCareService.startMission(owner,vehicleId,'WEEKLY_OWNER_CHECK');
    for(const row of mission.items){
      mission=carCareService.updateMissionItem(owner,vehicleId,mission.mission.id,row.item.id,'COMPLETED');
    }
    const careTimeline=db.prepare("SELECT COUNT(*) AS count FROM vehicle_timeline_entries WHERE source_reference_type='CAR_CARE_MISSION'").get() as any;
    assert.equal(Number(careTimeline.count),0);
  });
});
