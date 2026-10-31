import { AuthenticatedActorContext } from '../identity/types';
import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { vehicleService } from '../vehicle/vehicleService';
import { timelineService } from '../timeline/timelineService';
import {
  TimelineCategory,
  TimelineEntryType,
  TimelineSensitivity,
  TimelineSourceType,
  TimelineVerificationStatus,
  TimelineVisibility,
} from '../timeline/types';
import { recordAuditEvent } from '../security/audit';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { accidentRepository } from './accidentRepository';
import {
  AccidentAddendum,
  AccidentAggregate,
  AccidentDamageObservation,
  AccidentEvidence,
  AccidentEvidenceType,
  AccidentExternalReference,
  AccidentHandoff,
  AccidentHandoffType,
  AccidentIncident,
  AccidentParticipant,
  AccidentParticipantType,
  AccidentReferenceType,
  AccidentReferenceVerificationStatus,
  AccidentSeverity,
  AccidentStatus,
  AccidentWitness,
  CreateAccidentInput,
  TriState,
  UpdateAccidentDraftInput,
} from './types';

function actorType(actor: AuthenticatedActorContext): CanonicalActorType {
  return actor.type || CanonicalActorType.VEHICLE_OWNER;
}
function text(value: unknown, field: string, max: number, required = true): string | null {
  if (value == null || String(value).trim() === '') {
    if (required) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, `${field} is required`, 400);
    return null;
  }
  const v=String(value).trim();
  if(v.length>max) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, `${field} is too long`, 400);
  return v;
}
function iso(value: string, field: string): string {
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, `${field} must be a valid date/time`,400);
  return d.toISOString();
}
function tri(value?: TriState): TriState {
  return value && Object.values(TriState).includes(value) ? value : TriState.UNKNOWN;
}
function severity(value?: AccidentSeverity): AccidentSeverity {
  return value && Object.values(AccidentSeverity).includes(value) ? value : AccidentSeverity.UNKNOWN;
}

export class AccidentService {
  create(actor:AuthenticatedActorContext,input:CreateAccidentInput): AccidentAggregate {
    vehicleService.getVehicleDetails(actor,input.vehicle_id);
    const now=getCurrentUtcIsoString();
    const occurred=iso(input.occurred_at,'occurred_at');
    if(new Date(occurred).getTime()>Date.now()+5*60_000){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'occurred_at cannot be in the future',400);
    }
    const location=this.normalizeLocation(input.location);
    const incident:AccidentIncident={
      id:generateCanonicalId('acc'),
      user_id:actor.user_id,
      vehicle_id:input.vehicle_id,
      status:AccidentStatus.DRAFT,
      incident_type:text(input.incident_type,'incident_type',80)!,
      severity:severity(input.severity),
      occurred_at:occurred,
      recorded_at:now,
      summary:text(input.summary,'summary',2000)!,
      location_label:text(input.location_label,'location_label',240,false),
      latitude:location?.latitude??null,
      longitude:location?.longitude??null,
      location_accuracy_meters:location?.accuracy_meters??null,
      location_sharing_authorized:Boolean(input.location_sharing_authorized),
      police_attended:tri(input.police_attended),
      injuries_reported:tri(input.injuries_reported),
      vehicle_drivable:tri(input.vehicle_drivable),
      timeline_entry_id:null,version:1,finalized_at:null,closed_at:null,
      created_at:now,updated_at:now,
    };
    withTransaction(({db})=>{
      accidentRepository.createIncident(incident);
      accidentRepository.recordStatus(generateCanonicalId('ash'),incident.id,null,AccidentStatus.DRAFT,actor.user_id,'ACCIDENT_DRAFT_CREATED',now);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'accident.draft.created',producer:'garage-os-accident',correlation_id:incident.id,
        subject_ids:{accident:incident.id,vehicle:incident.vehicle_id,user:actor.user_id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{accident_id:incident.id,vehicle_id:incident.vehicle_id,status:incident.status,severity:incident.severity,occurred_at:incident.occurred_at}
      }),db);
      recordAuditEvent({
        actor_id:actor.user_id,actor_type:actorType(actor),action:'ACCIDENT_DRAFT_CREATED',
        resource_type:'accident',resource_id:incident.id,correlation_id:incident.id,source:'ACCIDENT_API',
        metadata:{vehicle_id:incident.vehicle_id,severity:incident.severity,location_recorded:Boolean(location)}
      },db);
    });
    return accidentRepository.getAggregate(actor.user_id,incident.id)!;
  }

  updateDraft(actor:AuthenticatedActorContext,id:string,input:UpdateAccidentDraftInput): AccidentAggregate {
    const current=this.require(actor,id);
    if(current.status!==AccidentStatus.DRAFT) throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Finalized accident core fields are immutable; add an addendum instead',409);
    const location=input.location===undefined?{latitude:current.latitude,longitude:current.longitude,accuracy_meters:current.location_accuracy_meters}:this.normalizeLocation(input.location);
    const updated:AccidentIncident={...current,
      incident_type:input.incident_type===undefined?current.incident_type:text(input.incident_type,'incident_type',80)!,
      severity:input.severity===undefined?current.severity:severity(input.severity),
      occurred_at:input.occurred_at===undefined?current.occurred_at:iso(input.occurred_at,'occurred_at'),
      summary:input.summary===undefined?current.summary:text(input.summary,'summary',2000)!,
      location_label:input.location_label===undefined?current.location_label:text(input.location_label,'location_label',240,false),
      latitude:location?.latitude??null,longitude:location?.longitude??null,location_accuracy_meters:location?.accuracy_meters??null,
      location_sharing_authorized:input.location_sharing_authorized===undefined?current.location_sharing_authorized:Boolean(input.location_sharing_authorized),
      police_attended:input.police_attended===undefined?current.police_attended:tri(input.police_attended),
      injuries_reported:input.injuries_reported===undefined?current.injuries_reported:tri(input.injuries_reported),
      vehicle_drivable:input.vehicle_drivable===undefined?current.vehicle_drivable:tri(input.vehicle_drivable),
      updated_at:getCurrentUtcIsoString()
    };
    if(!accidentRepository.updateDraft(id,actor.user_id,updated)) throw new CanonicalAppError(ErrorCode.CONFLICT,'Accident draft changed concurrently',409);
    this.audit(actor,id,'ACCIDENT_DRAFT_UPDATED');
    return accidentRepository.getAggregate(actor.user_id,id)!;
  }

  finalize(actor:AuthenticatedActorContext,id:string): AccidentAggregate {
    const current=this.require(actor,id);
    if(current.status===AccidentStatus.RECORDED || current.status===AccidentStatus.REPAIR_IN_PROGRESS || current.status===AccidentStatus.CLOSED) return accidentRepository.getAggregate(actor.user_id,id)!;
    if(current.status!==AccidentStatus.DRAFT) throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Accident cannot be finalized from current state',409);
    const aggregate=accidentRepository.getAggregate(actor.user_id,id)!;
    const now=getCurrentUtcIsoString();
    const eventId=`accident.recorded:${id}`;
    const controlledSummary=`Accident record reported in Garage OS. Severity: ${current.severity}. Structured damage observations: ${aggregate.damage_observations.length}. Evidence items: ${aggregate.evidence.length}.`;
    const timeline=timelineService.projectDomainRecord(actor,current.vehicle_id,{
      entry_type:TimelineEntryType.ACCIDENT_RECORDED,category:TimelineCategory.ACCIDENT,
      occurred_at:current.occurred_at,title:'Accident recorded',summary:controlledSummary,
      source_type:TimelineSourceType.OWNER_ENTERED,source_reference_type:'ACCIDENT',
      source_reference_id:id,source_event_id:eventId,actor_type:actorType(actor),actor_id:actor.user_id,
      verification_status:aggregate.evidence.length>0?TimelineVerificationStatus.EVIDENCE_SUPPORTED:TimelineVerificationStatus.OWNER_ASSERTED,
      visibility:TimelineVisibility.PASSPORT_SHARED,sensitivity:TimelineSensitivity.SENSITIVE,
      metadata:{accident_id:id,severity:current.severity,damage_observation_count:aggregate.damage_observations.length,evidence_count:aggregate.evidence.length}
    });
    withTransaction(({db})=>{
      if(!accidentRepository.transition(id,actor.user_id,AccidentStatus.DRAFT,AccidentStatus.RECORDED,now,{timelineEntryId:timeline.id,finalizedAt:now})){
        throw new CanonicalAppError(ErrorCode.CONFLICT,'Accident changed concurrently',409);
      }
      accidentRepository.recordStatus(generateCanonicalId('ash'),id,AccidentStatus.DRAFT,AccidentStatus.RECORDED,actor.user_id,'OWNER_FINALIZED_RECORD',now);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'accident.recorded',producer:'garage-os-accident',correlation_id:id,
        subject_ids:{accident:id,vehicle:current.vehicle_id,timeline_entry:timeline.id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{accident_id:id,vehicle_id:current.vehicle_id,severity:current.severity,timeline_entry_id:timeline.id,evidence_count:aggregate.evidence.length}
      }),db);
      recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'ACCIDENT_RECORDED',resource_type:'accident',resource_id:id,correlation_id:id,source:'ACCIDENT_API',metadata:{vehicle_id:current.vehicle_id,timeline_entry_id:timeline.id}},db);
    });
    return accidentRepository.getAggregate(actor.user_id,id)!;
  }

  addParticipant(actor:AuthenticatedActorContext,id:string,input:any): AccidentAggregate {
    this.requireMutable(actor,id);
    const now=getCurrentUtcIsoString();
    const type=Object.values(AccidentParticipantType).includes(input.participant_type)?input.participant_type:AccidentParticipantType.OTHER;
    const p:AccidentParticipant={id:generateCanonicalId('acp'),accident_id:id,participant_type:type,
      display_label:text(input.display_label,'display_label',120)!,
      name:text(input.name,'name',120,false),phone:text(input.phone,'phone',40,false),email:text(input.email,'email',254,false),
      vehicle_registration:text(input.vehicle_registration,'vehicle_registration',40,false),vehicle_make:text(input.vehicle_make,'vehicle_make',80,false),
      vehicle_model:text(input.vehicle_model,'vehicle_model',80,false),insurer_name:text(input.insurer_name,'insurer_name',120,false),
      policy_reference:text(input.policy_reference,'policy_reference',120,false),notes:text(input.notes,'notes',1000,false),created_at:now};
    accidentRepository.addParticipant(p); this.audit(actor,id,'ACCIDENT_PARTICIPANT_ADDED',{participant_type:type});
    return accidentRepository.getAggregate(actor.user_id,id)!;
  }

  addWitness(actor:AuthenticatedActorContext,id:string,input:any): AccidentAggregate {
    this.requireMutable(actor,id); const now=getCurrentUtcIsoString();
    const w:AccidentWitness={id:generateCanonicalId('acw'),accident_id:id,name:text(input.name,'name',120)!,
      phone:text(input.phone,'phone',40,false),email:text(input.email,'email',254,false),notes:text(input.notes,'notes',1000,false),
      consent_to_contact:tri(input.consent_to_contact),created_at:now};
    accidentRepository.addWitness(w); this.audit(actor,id,'ACCIDENT_WITNESS_ADDED',{consent_to_contact:w.consent_to_contact});
    return accidentRepository.getAggregate(actor.user_id,id)!;
  }

  addDamage(actor:AuthenticatedActorContext,id:string,input:any): AccidentAggregate {
    this.requireMutable(actor,id); const now=getCurrentUtcIsoString();
    const allowed=['UNKNOWN','COSMETIC','MINOR','MODERATE','SEVERE'];
    const d:AccidentDamageObservation={id:generateCanonicalId('acd'),accident_id:id,vehicle_area:text(input.vehicle_area,'vehicle_area',120)!,
      severity:allowed.includes(input.severity)?input.severity:'UNKNOWN',description:text(input.description,'description',1000)!,
      source_type:'OWNER_OBSERVATION',created_at:now};
    accidentRepository.addDamage(d); this.audit(actor,id,'ACCIDENT_DAMAGE_OBSERVATION_ADDED',{vehicle_area:d.vehicle_area,severity:d.severity});
    return accidentRepository.getAggregate(actor.user_id,id)!;
  }

  addEvidence(actor:AuthenticatedActorContext,id:string,input:any): AccidentAggregate {
    this.requireMutable(actor,id);
    const fileId=text(input.file_id,'file_id',160)!;
    const file=getDatabase().prepare('SELECT id,owner_id FROM file_objects WHERE id=? LIMIT 1').get(fileId) as {id:string;owner_id?:string|null}|undefined;
    if(!file || file.owner_id!==actor.user_id) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Evidence file not found or not accessible',404);
    const type=Object.values(AccidentEvidenceType).includes(input.evidence_type)?input.evidence_type:AccidentEvidenceType.OTHER;
    const now=getCurrentUtcIsoString();
    const e:AccidentEvidence={id:generateCanonicalId('ace'),accident_id:id,file_id:fileId,evidence_type:type,
      description:text(input.description,'description',500,false),captured_at:input.captured_at?iso(input.captured_at,'captured_at'):null,
      source_type:'OWNER_PROVIDED',privacy_class:input.privacy_class==='SHAREABLE_INCIDENT_EVIDENCE'?'SHAREABLE_INCIDENT_EVIDENCE':'PRIVATE',created_at:now};
    accidentRepository.addEvidence(e); this.audit(actor,id,'ACCIDENT_EVIDENCE_LINKED',{evidence_type:type,privacy_class:e.privacy_class,file_id:fileId});
    return accidentRepository.getAggregate(actor.user_id,id)!;
  }

  addExternalReference(actor:AuthenticatedActorContext,id:string,input:any): AccidentAggregate {
    this.requireMutable(actor,id);
    const type=Object.values(AccidentReferenceType).includes(input.reference_type)?input.reference_type:AccidentReferenceType.OTHER;
    let verification=input.verification_status as AccidentReferenceVerificationStatus;
    if(verification===AccidentReferenceVerificationStatus.EXTERNAL_VERIFIED){
      throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'External verification cannot be self-asserted by an owner',409);
    }
    if(verification!==AccidentReferenceVerificationStatus.DOCUMENT_SUPPORTED) verification=AccidentReferenceVerificationStatus.OWNER_REPORTED;
    const now=getCurrentUtcIsoString();
    const r:AccidentExternalReference={id:generateCanonicalId('acr'),accident_id:id,reference_type:type,
      provider_name:text(input.provider_name,'provider_name',160,false),reference_number:text(input.reference_number,'reference_number',160)!,
      verification_status:verification,notes:text(input.notes,'notes',1000,false),created_at:now};
    accidentRepository.addExternalReference(r); this.audit(actor,id,'ACCIDENT_EXTERNAL_REFERENCE_ADDED',{reference_type:type,verification_status:verification});
    return accidentRepository.getAggregate(actor.user_id,id)!;
  }

  linkHandoff(actor:AuthenticatedActorContext,id:string,input:any): AccidentAggregate {
    const incident=this.require(actor,id);
    if(incident.status===AccidentStatus.CLOSED) throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Closed accidents cannot receive new operational handoffs',409);
    const type=input.handoff_type as AccidentHandoffType;
    if(!Object.values(AccidentHandoffType).includes(type)) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid handoff_type',400);
    const target=text(input.target_reference_id,'target_reference_id',160)!;
    this.assertHandoffAccess(actor,incident.vehicle_id,type,target);
    const now=getCurrentUtcIsoString();
    const h:AccidentHandoff={id:generateCanonicalId('ach'),accident_id:id,handoff_type:type,target_reference_id:target,status:'LINKED',notes:text(input.notes,'notes',1000,false),created_at:now};
    accidentRepository.addHandoff(h);
    if((type===AccidentHandoffType.SERVICE_CASE || type===AccidentHandoffType.BOOKING) && incident.status===AccidentStatus.RECORDED){
      accidentRepository.transition(id,actor.user_id,AccidentStatus.RECORDED,AccidentStatus.REPAIR_IN_PROGRESS,now);
      accidentRepository.recordStatus(generateCanonicalId('ash'),id,AccidentStatus.RECORDED,AccidentStatus.REPAIR_IN_PROGRESS,actor.user_id,'REPAIR_HANDOFF_LINKED',now);
    }
    this.audit(actor,id,'ACCIDENT_HANDOFF_LINKED',{handoff_type:type,target_reference_id:target});
    return accidentRepository.getAggregate(actor.user_id,id)!;
  }

  addAddendum(actor:AuthenticatedActorContext,id:string,input:any): AccidentAggregate {
    const incident=this.require(actor,id);
    if(incident.status===AccidentStatus.DRAFT) throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Edit the draft directly before finalization',409);
    const allowed=['OWNER_NOTE','CORRECTION_NOTE','REPAIR_UPDATE','EXTERNAL_REFERENCE_UPDATE'];
    const type=allowed.includes(input.addendum_type)?input.addendum_type:'OWNER_NOTE';
    const a:AccidentAddendum={id:generateCanonicalId('aca'),accident_id:id,author_user_id:actor.user_id,addendum_type:type,text:text(input.text,'text',2000)!,created_at:getCurrentUtcIsoString()};
    accidentRepository.addAddendum(a); this.audit(actor,id,'ACCIDENT_ADDENDUM_ADDED',{addendum_type:type});
    return accidentRepository.getAggregate(actor.user_id,id)!;
  }

  close(actor:AuthenticatedActorContext,id:string,reason?:string): AccidentAggregate {
    const incident=this.require(actor,id);
    if(incident.status===AccidentStatus.CLOSED) return accidentRepository.getAggregate(actor.user_id,id)!;
    if(![AccidentStatus.RECORDED,AccidentStatus.REPAIR_IN_PROGRESS].includes(incident.status)) throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only finalized accident records may be closed',409);
    const now=getCurrentUtcIsoString();
    if(!accidentRepository.transition(id,actor.user_id,incident.status,AccidentStatus.CLOSED,now,{closedAt:now})) throw new CanonicalAppError(ErrorCode.CONFLICT,'Accident changed concurrently',409);
    accidentRepository.recordStatus(generateCanonicalId('ash'),id,incident.status,AccidentStatus.CLOSED,actor.user_id,text(reason,'reason',500,false),now);
    this.audit(actor,id,'ACCIDENT_CLOSED');
    return accidentRepository.getAggregate(actor.user_id,id)!;
  }

  get(actor:AuthenticatedActorContext,id:string): AccidentAggregate {
    const a=accidentRepository.getAggregate(actor.user_id,id);
    if(!a) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Accident record not found',404);
    vehicleService.getVehicleDetails(actor,a.incident.vehicle_id);
    return a;
  }

  list(actor:AuthenticatedActorContext,vehicleId?:string): AccidentIncident[] {
    if(vehicleId) vehicleService.getVehicleDetails(actor,vehicleId);
    return accidentRepository.listIncidents(actor.user_id,vehicleId);
  }

  private require(actor:AuthenticatedActorContext,id:string): AccidentIncident {
    const incident=accidentRepository.getIncident(actor.user_id,id);
    if(!incident) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Accident record not found',404);
    vehicleService.getVehicleDetails(actor,incident.vehicle_id);
    return incident;
  }
  private requireMutable(actor:AuthenticatedActorContext,id:string): AccidentIncident {
    const incident=this.require(actor,id);
    if(incident.status===AccidentStatus.CLOSED) throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Closed accident records are immutable',409);
    return incident;
  }
  private normalizeLocation(value:any): {latitude:number;longitude:number;accuracy_meters:number|null}|null {
    if(value==null) return null;
    const latitude=Number(value.latitude),longitude=Number(value.longitude);
    const accuracy=value.accuracy_meters==null?null:Number(value.accuracy_meters);
    if(!Number.isFinite(latitude)||latitude < -90||latitude>90||!Number.isFinite(longitude)||longitude < -180||longitude>180||(accuracy!=null&&(!Number.isFinite(accuracy)||accuracy<0))){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid accident location',400);
    }
    return {latitude,longitude,accuracy_meters:accuracy};
  }
  private assertHandoffAccess(actor:AuthenticatedActorContext,vehicleId:string,type:AccidentHandoffType,target:string):void {
    const db=getDatabase(); let row:any;
    if(type===AccidentHandoffType.TOW_REQUEST) row=db.prepare('SELECT id,vehicle_id,requesting_user_id FROM tow_requests WHERE id=? LIMIT 1').get(target);
    else if(type===AccidentHandoffType.ROADSIDE_INCIDENT) row=db.prepare('SELECT id,vehicle_id,reported_by_user_id FROM roadside_incidents WHERE id=? LIMIT 1').get(target);
    else if(type===AccidentHandoffType.SERVICE_CASE) row=db.prepare('SELECT id,vehicle_id,customer_user_id FROM service_cases WHERE id=? LIMIT 1').get(target);
    else row=db.prepare('SELECT id,vehicle_id,customer_user_id FROM bookings WHERE id=? LIMIT 1').get(target);
    const ownerId=row?.requesting_user_id||row?.reported_by_user_id||row?.customer_user_id;
    if(!row || row.vehicle_id!==vehicleId || ownerId!==actor.user_id) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Handoff target not found or not accessible for this vehicle',404);
  }
  private audit(actor:AuthenticatedActorContext,id:string,action:string,metadata:Record<string,unknown>={}):void {
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action,resource_type:'accident',resource_id:id,correlation_id:id,source:'ACCIDENT_API',metadata});
  }
}

export const accidentService=new AccidentService();
