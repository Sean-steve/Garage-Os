/**
 * Sprint 18 — Accident Management (GAR-018)
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { accidentService } from '../../src/server/accident/accidentService';
import { timelineService } from '../../src/server/timeline/timelineService';
import { storageEngine } from '../../src/server/storage/storageEngine';
import { DataClassificationLevel } from '../../src/shared/classification';
import {
  AccidentEvidenceType,
  AccidentParticipantType,
  AccidentReferenceType,
  AccidentReferenceVerificationStatus,
  AccidentSeverity,
  AccidentStatus,
  TriState,
} from '../../src/server/accident/types';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';

function actor(userId:string,email:string){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:[],memberships:[],
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-10-31T00:00:00.000Z',updated_at:'2026-10-31T00:00:00.000Z'},
    session_id:'ses_'+userId,
  } as any;
}

describe('Accident Management (GAR-018)',()=>{
  let db:any;
  const owner=actor('usr_acc_owner','owner@accident.test');
  const other=actor('usr_acc_other','other@accident.test');
  let vehicleId:string;

  beforeEach(()=>{
    resetDatabaseInstance();
    db=getDatabase({memory:true});
    runMigrations(db);
    const insert=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    insert.run(owner.user_id,owner.email,'Accident Owner','+254700000001','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    insert.run(other.user_id,other.email,'Other Owner','+254700000002','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    vehicleId=vehicleService.createVehicle(owner,{
      make:'Toyota',model:'Harrier',model_year:2018,registration_number:'KDA 555A'
    }).vehicle.id;
  });

  function createDraft(){
    return accidentService.create(owner,{
      vehicle_id:vehicleId,
      incident_type:'COLLISION',
      severity:AccidentSeverity.MODERATE,
      occurred_at:'2026-10-30T14:30:00+03:00',
      summary:'Rear-end collision at a junction. Private narrative includes details not intended for the passport.',
      location_label:'Private junction description',
      location:{latitude:-1.286389,longitude:36.817223,accuracy_meters:9},
      location_sharing_authorized:false,
      police_attended:TriState.YES,
      injuries_reported:TriState.UNKNOWN,
      vehicle_drivable:TriState.NO,
    });
  }

  it('adds the canonical accident schema',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
    for(const name of ['accident_incidents','accident_participants','accident_witnesses','accident_damage_observations','accident_evidence','accident_external_references','accident_handoffs','accident_addenda','accident_status_history']){
      assert.ok(tables.includes(name),name+' must exist');
    }
  });

  it('creates an owner-scoped private draft without prematurely changing the Vehicle Passport',()=>{
    const draft=createDraft();
    assert.equal(draft.incident.status,AccidentStatus.DRAFT);
    assert.equal(draft.incident.latitude,-1.286389);
    assert.equal(draft.incident.timeline_entry_id,null);

    const passport=timelineService.getPassport(owner,vehicleId);
    assert.equal(passport.accident_history.known_records_count,0);
    assert.match(passport.accident_history.statement,/No accident records are currently recorded/i);
  });

  it('keeps participants and witnesses private and preserves their contact metadata outside the Passport',()=>{
    const draft=createDraft();
    accidentService.addParticipant(owner,draft.incident.id,{
      participant_type:AccidentParticipantType.OTHER_DRIVER,
      display_label:'Other driver',
      name:'Private Other Driver',
      phone:'+254711999999',
      vehicle_registration:'KXX 001X',
      insurer_name:'Private Insurer',
      policy_reference:'POLICY-SECRET-001',
    });
    accidentService.addWitness(owner,draft.incident.id,{
      name:'Private Witness',
      phone:'+254722999999',
      notes:'Saw the collision from the roadside',
      consent_to_contact:TriState.YES,
    });
    accidentService.addDamage(owner,draft.incident.id,{
      vehicle_area:'Rear bumper',severity:'MODERATE',description:'Visible deformation'
    });

    const recorded=accidentService.finalize(owner,draft.incident.id);
    assert.equal(recorded.incident.status,AccidentStatus.RECORDED);
    assert.ok(recorded.incident.timeline_entry_id);

    const passport=timelineService.getPassport(owner,vehicleId);
    assert.equal(passport.accident_history.known_records_count,1);
    const projected=JSON.stringify(passport.accident_history);
    assert.equal(projected.includes('Private Other Driver'),false);
    assert.equal(projected.includes('+254711999999'),false);
    assert.equal(projected.includes('Private Witness'),false);
    assert.equal(projected.includes('+254722999999'),false);
    assert.equal(projected.includes('POLICY-SECRET-001'),false);
    assert.equal(projected.includes('-1.286389'),false);
    assert.match(passport.accident_history.records[0].summary,/Severity: MODERATE/);
    assert.match(passport.accident_history.records[0].summary,/Structured damage observations: 1/);
  });

  it('links only evidence files owned by the authenticated user and does not convert evidence into external verification',async()=>{
    const draft=createDraft();
    const file=await storageEngine.storeFile({
      filename:'scene.jpg',contentType:'image/jpeg',buffer:Buffer.from('test-image'),
      ownerId:owner.user_id,classification:DataClassificationLevel.CONFIDENTIAL
    });
    const withEvidence=accidentService.addEvidence(owner,draft.incident.id,{
      file_id:file.id,evidence_type:AccidentEvidenceType.SCENE_PHOTO,privacy_class:'PRIVATE'
    });
    assert.equal(withEvidence.evidence.length,1);

    const finalized=accidentService.finalize(owner,draft.incident.id);
    const timeline=db.prepare('SELECT verification_status,metadata FROM vehicle_timeline_entries WHERE id=?').get(finalized.incident.timeline_entry_id) as any;
    assert.equal(timeline.verification_status,'EVIDENCE_SUPPORTED');
    assert.equal(JSON.parse(timeline.metadata).evidence_count,1);

    const otherFile=await storageEngine.storeFile({
      filename:'other.jpg',contentType:'image/jpeg',buffer:Buffer.from('other'),
      ownerId:other.user_id,classification:DataClassificationLevel.CONFIDENTIAL
    });
    assert.throws(
      ()=>accidentService.addEvidence(owner,finalized.incident.id,{file_id:otherFile.id,evidence_type:'SCENE_PHOTO'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
    );
  });

  it('blocks owner self-assertion of EXTERNAL_VERIFIED police or insurance records',()=>{
    const draft=createDraft();
    assert.throws(
      ()=>accidentService.addExternalReference(owner,draft.incident.id,{
        reference_type:AccidentReferenceType.POLICE_REFERENCE,
        provider_name:'Police',
        reference_number:'OB-123',
        verification_status:AccidentReferenceVerificationStatus.EXTERNAL_VERIFIED,
      }),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );

    const aggregate=accidentService.addExternalReference(owner,draft.incident.id,{
      reference_type:AccidentReferenceType.INSURANCE_CLAIM,
      provider_name:'Example Insurance',
      reference_number:'CLAIM-123',
      verification_status:AccidentReferenceVerificationStatus.DOCUMENT_SUPPORTED,
    });
    assert.equal(aggregate.external_references[0].verification_status,'DOCUMENT_SUPPORTED');
  });

  it('makes finalized core facts immutable while allowing non-destructive addenda',()=>{
    const draft=createDraft();
    const recorded=accidentService.finalize(owner,draft.incident.id);

    assert.throws(
      ()=>accidentService.updateDraft(owner,recorded.incident.id,{summary:'rewrite history'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.INVALID_STATE_TRANSITION
    );

    const withAddendum=accidentService.addAddendum(owner,recorded.incident.id,{
      addendum_type:'CORRECTION_NOTE',text:'Owner later clarified the lane direction.'
    });
    assert.equal(withAddendum.addenda.length,1);
    assert.equal(withAddendum.incident.summary,draft.incident.summary);
  });

  it('keeps accident records and operational handoffs strictly vehicle/user scoped',()=>{
    const draft=createDraft();

    assert.throws(
      ()=>accidentService.get(other,draft.incident.id),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
    );

    assert.throws(
      ()=>accidentService.linkHandoff(owner,draft.incident.id,{
        handoff_type:'TOW_REQUEST',target_reference_id:'tow_nonexistent'
      }),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
    );
  });

  it('closes only finalized records, preserves history and leaves the Passport accident record intact',()=>{
    const draft=createDraft();
    assert.throws(
      ()=>accidentService.close(owner,draft.incident.id,'too early'),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.INVALID_STATE_TRANSITION
    );

    accidentService.finalize(owner,draft.incident.id);
    const closed=accidentService.close(owner,draft.incident.id,'Vehicle repaired and incident administration complete');
    assert.equal(closed.incident.status,AccidentStatus.CLOSED);
    assert.ok(closed.incident.closed_at);

    const history=db.prepare('SELECT from_status,to_status FROM accident_status_history WHERE accident_id=? ORDER BY occurred_at').all(draft.incident.id) as any[];
    assert.ok(history.some(r=>r.to_status==='DRAFT'));
    assert.ok(history.some(r=>r.to_status==='RECORDED'));
    assert.ok(history.some(r=>r.to_status==='CLOSED'));

    const passport=timelineService.getPassport(owner,vehicleId);
    assert.equal(passport.accident_history.known_records_count,1);
  });
});
