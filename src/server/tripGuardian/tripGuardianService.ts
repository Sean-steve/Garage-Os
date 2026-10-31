import { AuthenticatedActorContext } from '../identity/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { withTransaction } from '../database/transaction';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { recordAuditEvent } from '../security/audit';
import { vehicleService } from '../vehicle/vehicleService';
import { maintenanceService } from '../maintenance/maintenanceService';
import { issueRepository } from '../issues/issueRepository';
import { IssueSeverity } from '../issues/types';
import { carCareService } from '../carCare/carCareService';
import { safetyRepository } from '../safety/safetyRepository';
import { safetyService } from '../safety/safetyService';
import { sosService } from '../safety/sosService';
import { SafetyIncidentLevel } from '../safety/types';
import { jobEngine } from '../jobs/jobEngine';
import { tripGuardianRepository } from './tripGuardianRepository';
import {
  CreateTripGuardianJourneyInput,
  EscalateTripToSosInput,
  RecordTripLocationInput,
  StartTripInput,
  TripGuardianAggregate,
  TripGuardianCheckIn,
  TripGuardianCheckInResponse,
  TripGuardianContactShare,
  TripGuardianJourney,
  TripGuardianLocationSnapshot,
  TripGuardianReadiness,
  UpdateTripGuardianJourneyInput,
} from './types';

export const TRIP_GUARDIAN_CHECKIN_PROMPT_JOB = 'trip_guardian.checkin.prompt';
export const TRIP_GUARDIAN_CHECKIN_TIMEOUT_JOB = 'trip_guardian.checkin.timeout';
export const TRIP_GUARDIAN_LOCATION_RETENTION_JOB = 'trip_guardian.location.retention';

const LOCATION_RETENTION_HOURS = 24;
const CHECKIN_GRACE_MINUTES = 10;

function actorType(actor:AuthenticatedActorContext):CanonicalActorType{
  return actor.type||CanonicalActorType.VEHICLE_OWNER;
}

function cleanLabel(value:unknown,field:string,max=180):string{
  const v=String(value||'').trim();
  if(!v) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,`${field} is required`,400);
  if(v.length>max) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,`${field} is too long`,400);
  return v;
}

function cleanOptional(value:unknown,max=500):string|null{
  if(value===undefined||value===null) return null;
  const v=String(value).trim();
  return v?v.slice(0,max):null;
}

function optionalIso(value:unknown,field:string):string|null{
  if(value===undefined||value===null||value==='') return null;
  const d=new Date(String(value));
  if(Number.isNaN(d.getTime())) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,`${field} must be a valid date/time`,400);
  return d.toISOString();
}

export class TripGuardianService {
  create(actor:AuthenticatedActorContext,input:CreateTripGuardianJourneyInput):TripGuardianAggregate{
    vehicleService.getVehicleDetails(actor,input.vehicle_id);
    const open=tripGuardianRepository.listJourneys(actor.user_id,input.vehicle_id)
      .find(j=>j.status==='PREPARED'||j.status==='IN_PROGRESS');
    if(open){
      throw new CanonicalAppError(ErrorCode.CONFLICT,'This vehicle already has an open Trip Guardian journey',409);
    }

    const origin=cleanLabel(input.origin_label,'origin_label');
    const destination=cleanLabel(input.destination_label,'destination_label');
    const planned=optionalIso(input.planned_departure_at,'planned_departure_at');
    const expected=optionalIso(input.expected_arrival_at,'expected_arrival_at');
    if(planned&&expected&&new Date(expected).getTime()<=new Date(planned).getTime()){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'expected_arrival_at must be after planned_departure_at',400);
    }

    const checkinsEnabled=Boolean(input.checkins_enabled);
    const interval=checkinsEnabled?this.validateCheckInInterval(input.checkin_interval_minutes??60):null;
    const locationSharing=Boolean(input.location_sharing_enabled);
    this.assertLocationSharingAllowed(actor,locationSharing);

    const contactIds=this.normalizeContactIds(actor,input.contact_ids||[]);
    const existingPretrip=carCareService.listMissions(actor,input.vehicle_id)
      .find(m=>m.mission.status==='ACTIVE'&&m.template.code==='PRE_TRIP_CHECK');
    const pretrip=carCareService.startMission(actor,input.vehicle_id,'PRE_TRIP_CHECK');
    const pretripCreatedForJourney=!existingPretrip;
    const now=getCurrentUtcIsoString();
    const journey:TripGuardianJourney={
      id:generateCanonicalId('tgj'),
      user_id:actor.user_id,
      vehicle_id:input.vehicle_id,
      status:'PREPARED',
      origin_label:origin,
      destination_label:destination,
      planned_departure_at:planned,
      expected_arrival_at:expected,
      purpose:cleanOptional(input.purpose,300),
      pretrip_mission_id:pretrip.mission.id,
      location_sharing_enabled:locationSharing,
      checkins_enabled:checkinsEnabled,
      checkin_interval_minutes:interval,
      started_at:null,arrived_at:null,cancelled_at:null,cancellation_reason:null,
      start_warning_acknowledged_at:null,start_warning_acknowledgement:null,
      created_at:now,updated_at:now,
    };

    try{
      withTransaction(({db})=>{
        tripGuardianRepository.createJourney(journey);
        tripGuardianRepository.replaceContactShares(journey.id,this.buildContactShares(journey,contactIds,now));
        tripGuardianRepository.recordStatusHistory({
          id:generateCanonicalId('tgh'),journeyId:journey.id,toStatus:'PREPARED',
          actorId:actor.user_id,actorType:actorType(actor),
          reason:'Journey prepared and linked to owner pre-trip checklist.',
          metadata:{
            pretrip_mission_id:pretrip.mission.id,
            contact_share_count:contactIds.length,
            location_sharing_enabled:locationSharing,
            checkins_enabled:checkinsEnabled,
            trusted_contact_notification_attempted:false,
          },
          occurredAt:now
        });
        enqueueOutboxEvent(createCanonicalEventEnvelope({
          type:'trip_guardian.journey.prepared',producer:'garage-os-trip-guardian',
          correlation_id:journey.id,
          subject_ids:{user:actor.user_id,vehicle:journey.vehicle_id,journey:journey.id},
          actor_id:actor.user_id,actor_type:actorType(actor),
          provenance_class:DataProvenanceClass.OWNER_ASSERTED,
          payload:{
            journey_id:journey.id,vehicle_id:journey.vehicle_id,status:'PREPARED',
            pretrip_mission_id:pretrip.mission.id,contact_share_count:contactIds.length,
            location_sharing_enabled:locationSharing,checkins_enabled:checkinsEnabled,
            trusted_contact_notification_attempted:false,
          }
        }),db);
        recordAuditEvent({
          actor_id:actor.user_id,actor_type:actorType(actor),action:'TRIP_GUARDIAN_JOURNEY_PREPARED',
          resource_type:'trip_guardian_journey',resource_id:journey.id,correlation_id:journey.id,
          source:'TRIP_GUARDIAN_API',
          metadata:{
            vehicle_id:journey.vehicle_id,pretrip_mission_id:pretrip.mission.id,
            contact_share_count:contactIds.length,location_sharing_enabled:locationSharing,
            precise_location_stored:false,
          }
        },db);
      });
    }catch(err){
      if(pretripCreatedForJourney){
        carCareService.cancelMission(actor,input.vehicle_id,pretrip.mission.id,'TRIP_GUARDIAN_CREATE_FAILED');
      }
      throw err;
    }

    return this.get(actor,journey.id);
  }

  list(actor:AuthenticatedActorContext,vehicleId?:string):TripGuardianJourney[]{
    if(vehicleId) vehicleService.getVehicleDetails(actor,vehicleId);
    return tripGuardianRepository.listJourneys(actor.user_id,vehicleId);
  }

  get(actor:AuthenticatedActorContext,journeyId:string):TripGuardianAggregate{
    const journey=this.requireJourney(actor,journeyId);
    vehicleService.getVehicleDetails(actor,journey.vehicle_id);
    return {
      journey,
      readiness:this.getReadiness(actor,journeyId),
      contact_shares:tripGuardianRepository.listContactShares(journeyId),
      checkins:tripGuardianRepository.listCheckIns(journeyId),
      latest_location:tripGuardianRepository.getLatestLocation(journeyId),
      escalation_links:tripGuardianRepository.listEscalationLinks(journeyId),
      truth:{
        live_tracking_active:false,
        crash_detection_active:false,
        automatic_emergency_escalation_active:false,
        missed_checkin_means_injury:false,
        journey_status_is_safety_certification:false,
      }
    };
  }

  update(actor:AuthenticatedActorContext,journeyId:string,input:UpdateTripGuardianJourneyInput):TripGuardianAggregate{
    const current=this.requireJourney(actor,journeyId);
    if(current.status!=='PREPARED'){
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only a prepared journey can be edited',409);
    }
    const planned=input.planned_departure_at!==undefined?optionalIso(input.planned_departure_at,'planned_departure_at'):current.planned_departure_at;
    const expected=input.expected_arrival_at!==undefined?optionalIso(input.expected_arrival_at,'expected_arrival_at'):current.expected_arrival_at;
    if(planned&&expected&&new Date(expected).getTime()<=new Date(planned).getTime()){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'expected_arrival_at must be after planned_departure_at',400);
    }
    const locationSharing=input.location_sharing_enabled===undefined?current.location_sharing_enabled:Boolean(input.location_sharing_enabled);
    this.assertLocationSharingAllowed(actor,locationSharing);
    const checkins=input.checkins_enabled===undefined?current.checkins_enabled:Boolean(input.checkins_enabled);
    const interval=checkins
      ? this.validateCheckInInterval(input.checkin_interval_minutes===undefined?(current.checkin_interval_minutes??60):input.checkin_interval_minutes)
      : null;
    const now=getCurrentUtcIsoString();
    const updated:TripGuardianJourney={
      ...current,
      origin_label:input.origin_label===undefined?current.origin_label:cleanLabel(input.origin_label,'origin_label'),
      destination_label:input.destination_label===undefined?current.destination_label:cleanLabel(input.destination_label,'destination_label'),
      planned_departure_at:planned,expected_arrival_at:expected,
      purpose:input.purpose===undefined?current.purpose:cleanOptional(input.purpose,300),
      location_sharing_enabled:locationSharing,checkins_enabled:checkins,checkin_interval_minutes:interval,
      updated_at:now,
    };
    if(!tripGuardianRepository.updatePreparedJourney(updated)){
      throw new CanonicalAppError(ErrorCode.CONFLICT,'Journey could not be updated',409);
    }
    if(input.contact_ids!==undefined){
      const ids=this.normalizeContactIds(actor,input.contact_ids);
      tripGuardianRepository.replaceContactShares(journeyId,this.buildContactShares(updated,ids,now));
    }
    return this.get(actor,journeyId);
  }

  getReadiness(actor:AuthenticatedActorContext,journeyId:string):TripGuardianReadiness{
    const journey=this.requireJourney(actor,journeyId);
    const mission=carCareService.getMission(actor,journey.vehicle_id,journey.pretrip_mission_id);
    const maintenance=maintenanceService.getVehicleMaintenanceStatus(journey.vehicle_id);
    const issues=issueRepository.listActiveIssuesForVehicle(journey.vehicle_id);
    const grounding=issues.filter(i=>Boolean(i.requires_immediate_grounding));
    const critical=issues.filter(i=>i.severity===IssueSeverity.CRITICAL);
    let level:TripGuardianReadiness['level']='REVIEWED';

    if(grounding.length>0) level='CANONICAL_STOP_DRIVING';
    else if(
      mission.progress.concerns_reported>0||
      mission.progress.professional_help_required>0||
      maintenance.overdue_count>0||
      maintenance.due_count>0||
      critical.length>0
    ) level='ATTENTION_RECORDED';
    else if(mission.mission.status!=='COMPLETED'||mission.progress.pending>0) level='CHECKLIST_INCOMPLETE';

    const actions:TripGuardianReadiness['actions']=[];
    if(grounding.length>0){
      actions.push({label:'Review critical issue',target_tab:'issues'});
      actions.push({label:'Open roadside assistance',target_tab:'roadside'});
    }else{
      if(mission.progress.pending>0) actions.push({label:'Continue pre-trip check',target_tab:'care'});
      if(mission.progress.concerns_reported>0||mission.progress.professional_help_required>0) actions.push({label:'Review concerns',target_tab:'issues'});
      if(maintenance.overdue_count>0||maintenance.due_count>0) actions.push({label:'Review maintenance',target_tab:'maintenance'});
      if(critical.length>0) actions.push({label:'Review critical issues',target_tab:'issues'});
    }

    return {
      journey_id:journey.id,vehicle_id:journey.vehicle_id,generated_at:getCurrentUtcIsoString(),
      level,start_allowed:grounding.length===0,
      requires_start_acknowledgement:grounding.length===0&&level!=='REVIEWED',
      pretrip_mission_status:mission.mission.status,
      pretrip_progress_percent:mission.progress.percent,
      pretrip_pending_count:mission.progress.pending,
      pretrip_concerns_reported:mission.progress.concerns_reported,
      pretrip_professional_help_required:mission.progress.professional_help_required,
      maintenance_overdue_count:maintenance.overdue_count,maintenance_due_count:maintenance.due_count,
      active_issue_count:issues.length,critical_issue_count:critical.length,
      grounding_issue_ids:grounding.map(i=>i.id),
      actions,
      statement:'Trip Guardian readiness summarizes recorded checks and existing Garage OS state. REVIEWED does not certify the vehicle, route, driver, weather, or journey as safe.'
    };
  }

  start(actor:AuthenticatedActorContext,journeyId:string,input:StartTripInput={}):TripGuardianAggregate{
    const journey=this.requireJourney(actor,journeyId);
    if(journey.status==='IN_PROGRESS') return this.get(actor,journeyId);
    if(journey.status!=='PREPARED'){
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only a prepared journey can be started',409);
    }
    const readiness=this.getReadiness(actor,journeyId);
    if(!readiness.start_allowed){
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Trip cannot start while a canonical issue requires immediate grounding. Review the Issue/Roadside workflow.',
        409
      );
    }
    if(readiness.requires_start_acknowledgement&&!input.acknowledge_readiness_warnings){
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Recorded readiness warnings must be explicitly acknowledged before starting this journey',
        409
      );
    }
    const now=getCurrentUtcIsoString();
    const ack=readiness.requires_start_acknowledgement
      ? cleanOptional(input.acknowledgement_note,500)||'OWNER_ACKNOWLEDGED_RECORDED_READINESS_WARNINGS'
      : null;
    const changed=tripGuardianRepository.transitionJourney({
      journeyId,userId:actor.user_id,expectedStatus:'PREPARED',nextStatus:'IN_PROGRESS',now,
      startedAt:now,
      warningAcknowledgedAt:ack?now:null,
      warningAcknowledgement:ack,
    });
    if(!changed) throw new CanonicalAppError(ErrorCode.CONFLICT,'Journey start state changed concurrently',409);

    const started=tripGuardianRepository.getJourney(actor.user_id,journeyId)!;
    const checkin=this.scheduleNextCheckIn(started,now);

    withTransaction(({db})=>{
      tripGuardianRepository.recordStatusHistory({
        id:generateCanonicalId('tgh'),journeyId,fromStatus:'PREPARED',toStatus:'IN_PROGRESS',
        actorId:actor.user_id,actorType:actorType(actor),reason:'Owner started journey.',
        metadata:{
          readiness_level:readiness.level,
          readiness_warning_acknowledged:Boolean(ack),
          first_checkin_id:checkin?.id||null,
          contact_share_count:tripGuardianRepository.listContactShares(journeyId).length,
          trusted_contact_notification_attempted:false,
        },occurredAt:now
      });
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'trip_guardian.journey.started',producer:'garage-os-trip-guardian',
        correlation_id:journeyId,
        subject_ids:{user:actor.user_id,vehicle:journey.vehicle_id,journey:journeyId},
        actor_id:actor.user_id,actor_type:actorType(actor),
        provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{
          journey_id:journeyId,started_at:now,readiness_level:readiness.level,
          checkin_scheduled:Boolean(checkin),trusted_contact_notification_attempted:false,
          live_tracking_active:false,crash_detection_active:false,
        }
      }),db);
      recordAuditEvent({
        actor_id:actor.user_id,actor_type:actorType(actor),action:'TRIP_GUARDIAN_JOURNEY_STARTED',
        resource_type:'trip_guardian_journey',resource_id:journeyId,correlation_id:journeyId,
        source:'TRIP_GUARDIAN_API',
        metadata:{readiness_level:readiness.level,warning_acknowledged:Boolean(ack),checkin_scheduled:Boolean(checkin)}
      },db);
    });
    return this.get(actor,journeyId);
  }

  arrive(actor:AuthenticatedActorContext,journeyId:string):TripGuardianAggregate{
    const journey=this.requireJourney(actor,journeyId);
    if(journey.status==='ARRIVED') return this.get(actor,journeyId);
    if(journey.status!=='IN_PROGRESS'){
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only an in-progress journey can be marked arrived',409);
    }
    const now=getCurrentUtcIsoString();
    if(!tripGuardianRepository.transitionJourney({
      journeyId,userId:actor.user_id,expectedStatus:'IN_PROGRESS',nextStatus:'ARRIVED',now,arrivedAt:now
    })) throw new CanonicalAppError(ErrorCode.CONFLICT,'Journey arrival state changed concurrently',409);

    const cancelledChecks=tripGuardianRepository.cancelPendingCheckIns(journeyId,now);
    const revokedLocations=tripGuardianRepository.revokeJourneyLocations(journeyId,now);
    const mission=carCareService.getMission(actor,journey.vehicle_id,journey.pretrip_mission_id);
    if(mission.mission.status==='ACTIVE'){
      carCareService.cancelMission(actor,journey.vehicle_id,journey.pretrip_mission_id,'TRIP_ENDED_WITH_CHECKLIST_INCOMPLETE');
    }

    withTransaction(({db})=>{
      tripGuardianRepository.recordStatusHistory({
        id:generateCanonicalId('tgh'),journeyId,fromStatus:'IN_PROGRESS',toStatus:'ARRIVED',
        actorId:actor.user_id,actorType:actorType(actor),reason:'Owner confirmed journey arrival.',
        metadata:{pending_checkins_cancelled:cancelledChecks,location_snapshots_revoked:revokedLocations},
        occurredAt:now
      });
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'trip_guardian.journey.arrived',producer:'garage-os-trip-guardian',correlation_id:journeyId,
        subject_ids:{user:actor.user_id,vehicle:journey.vehicle_id,journey:journeyId},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{journey_id:journeyId,arrived_at:now,pending_checkins_cancelled:cancelledChecks,location_access_revoked:true}
      }),db);
    });
    return this.get(actor,journeyId);
  }

  cancel(actor:AuthenticatedActorContext,journeyId:string,reason?:string):TripGuardianAggregate{
    const journey=this.requireJourney(actor,journeyId);
    if(journey.status==='CANCELLED') return this.get(actor,journeyId);
    if(!['PREPARED','IN_PROGRESS'].includes(journey.status)){
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Completed journey cannot be cancelled',409);
    }
    const now=getCurrentUtcIsoString();
    const why=cleanOptional(reason,500)||'OWNER_CANCELLED';
    if(!tripGuardianRepository.transitionJourney({
      journeyId,userId:actor.user_id,expectedStatus:journey.status,nextStatus:'CANCELLED',now,
      cancelledAt:now,cancellationReason:why
    })) throw new CanonicalAppError(ErrorCode.CONFLICT,'Journey cancellation state changed concurrently',409);

    tripGuardianRepository.cancelPendingCheckIns(journeyId,now);
    tripGuardianRepository.revokeJourneyLocations(journeyId,now);
    const mission=carCareService.getMission(actor,journey.vehicle_id,journey.pretrip_mission_id);
    if(mission.mission.status==='ACTIVE'){
      carCareService.cancelMission(actor,journey.vehicle_id,journey.pretrip_mission_id,'TRIP_GUARDIAN_JOURNEY_CANCELLED');
    }
    withTransaction(({db})=>{
      tripGuardianRepository.recordStatusHistory({
        id:generateCanonicalId('tgh'),journeyId,fromStatus:journey.status,toStatus:'CANCELLED',
        actorId:actor.user_id,actorType:actorType(actor),reason:why,occurredAt:now
      });
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'trip_guardian.journey.cancelled',producer:'garage-os-trip-guardian',correlation_id:journeyId,
        subject_ids:{user:actor.user_id,vehicle:journey.vehicle_id,journey:journeyId},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{journey_id:journeyId,cancelled_at:now,location_access_revoked:true}
      }),db);
    });
    return this.get(actor,journeyId);
  }

  recordLocation(
    actor:AuthenticatedActorContext,
    journeyId:string,
    input:RecordTripLocationInput
  ):TripGuardianLocationSnapshot{
    const journey=this.requireJourney(actor,journeyId);
    if(journey.status!=='IN_PROGRESS'){
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Location snapshots are accepted only during an in-progress journey',409);
    }
    if(!journey.location_sharing_enabled){
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Journey location sharing is not enabled',403);
    }
    this.assertLocationSharingAllowed(actor,true);
    const lat=Number(input.latitude),lon=Number(input.longitude);
    const accuracy=input.accuracy_meters===undefined||input.accuracy_meters===null?null:Number(input.accuracy_meters);
    if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid location coordinates',400);
    }
    if(accuracy!==null&&(!Number.isFinite(accuracy)||accuracy<0)){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'accuracy_meters must be non-negative',400);
    }
    const now=getCurrentUtcIsoString();
    const captured=input.captured_at?optionalIso(input.captured_at,'captured_at')!:now;
    if(new Date(captured).getTime()>Date.now()+5*60*1000){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'captured_at cannot be materially in the future',400);
    }
    const expires=new Date(new Date(now).getTime()+LOCATION_RETENTION_HOURS*3600*1000).toISOString();
    const snapshot:TripGuardianLocationSnapshot={
      id:generateCanonicalId('tgl'),journey_id:journeyId,user_id:actor.user_id,
      latitude:lat,longitude:lon,accuracy_meters:accuracy,captured_at:captured,
      source_type:'USER_DEVICE',purpose:'TRIP_GUARDIAN',sharing_authorized:true,
      expires_at:expires,access_revoked_at:null,created_at:now
    };
    withTransaction(({db})=>{
      tripGuardianRepository.insertLocation(snapshot);
      jobEngine.enqueue(
        TRIP_GUARDIAN_LOCATION_RETENTION_JOB,
        {journey_id:journeyId},
        {runAt:expires,correlationId:journeyId,maxRetries:3}
      );
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'trip_guardian.location.snapshot_recorded',producer:'garage-os-trip-guardian',
        correlation_id:journeyId,
        subject_ids:{user:actor.user_id,vehicle:journey.vehicle_id,journey:journeyId,location_snapshot:snapshot.id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.DEVICE_OBSERVED,
        payload:{
          journey_id:journeyId,location_snapshot_id:snapshot.id,captured_at:captured,
          sharing_authorized:true,expires_at:expires,coordinates_in_event:false
        }
      }),db);
      recordAuditEvent({
        actor_id:actor.user_id,actor_type:actorType(actor),action:'TRIP_GUARDIAN_LOCATION_RECORDED',
        resource_type:'trip_guardian_location_snapshot',resource_id:snapshot.id,correlation_id:journeyId,
        source:'TRIP_GUARDIAN_API',
        metadata:{journey_id:journeyId,sharing_authorized:true,expires_at:expires,coordinates_logged:false}
      },db);
    });
    return snapshot;
  }

  respondCheckIn(
    actor:AuthenticatedActorContext,
    journeyId:string,
    checkInId:string,
    response:TripGuardianCheckInResponse,
    notes?:string
  ):TripGuardianAggregate{
    const journey=this.requireJourney(actor,journeyId);
    if(journey.status!=='IN_PROGRESS'){
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Check-ins are only active during an in-progress journey',409);
    }
    if(!['OKAY','DELAYED','NEED_HELP'].includes(response)){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid check-in response',400);
    }
    const checkin=tripGuardianRepository.getCheckIn(checkInId);
    if(!checkin||checkin.journey_id!==journeyId||checkin.user_id!==actor.user_id){
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Trip check-in not found',404);
    }
    const now=getCurrentUtcIsoString();
    if(!tripGuardianRepository.respondCheckIn(checkInId,actor.user_id,response,cleanOptional(notes,500),now)){
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Trip check-in is no longer pending',409);
    }
    const next=response==='NEED_HELP'?null:this.scheduleNextCheckIn(journey,now);
    withTransaction(({db})=>{
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'trip_guardian.checkin.responded',producer:'garage-os-trip-guardian',correlation_id:journeyId,
        subject_ids:{user:actor.user_id,vehicle:journey.vehicle_id,journey:journeyId,checkin:checkInId},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{
          journey_id:journeyId,checkin_id:checkInId,response,responded_at:now,
          next_checkin_id:next?.id||null,automatic_sos_activated:false,injury_inferred:false
        }
      }),db);
    });
    return this.get(actor,journeyId);
  }

  promptCheckIn(checkInId:string,asOf=getCurrentUtcIsoString()):boolean{
    const checkin=tripGuardianRepository.getCheckIn(checkInId);
    if(!checkin||checkin.status!=='PENDING') return false;
    const journey=tripGuardianRepository.getJourney(checkin.user_id,checkin.journey_id);
    if(!journey||journey.status!=='IN_PROGRESS') return false;
    if(new Date(asOf).getTime()<new Date(checkin.due_at).getTime()) return false;
    const changed=tripGuardianRepository.markCheckInPrompted(checkInId,asOf);
    if(!changed) return false;
    const timeoutAt=new Date(new Date(asOf).getTime()+CHECKIN_GRACE_MINUTES*60*1000).toISOString();
    jobEngine.enqueue(
      TRIP_GUARDIAN_CHECKIN_TIMEOUT_JOB,
      {checkin_id:checkInId,journey_id:journey.id},
      {runAt:timeoutAt,correlationId:journey.id,maxRetries:3}
    );
    withTransaction(({db})=>{
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'trip_guardian.checkin.prompt_due',producer:'garage-os-trip-guardian',correlation_id:journey.id,
        subject_ids:{user:journey.user_id,vehicle:journey.vehicle_id,journey:journey.id,checkin:checkInId},
        actor_type:CanonicalActorType.SYSTEM_WORKER,provenance_class:DataProvenanceClass.DERIVED_DETERMINISTIC,
        payload:{
          journey_id:journey.id,checkin_id:checkInId,prompted_at:asOf,
          external_notification_delivery_claimed:false,timeout_at:timeoutAt
        }
      }),db);
    });
    return true;
  }

  timeoutCheckIn(checkInId:string,asOf=getCurrentUtcIsoString()):boolean{
    const checkin=tripGuardianRepository.getCheckIn(checkInId);
    if(!checkin||checkin.status!=='PENDING') return false;
    const changed=tripGuardianRepository.markCheckInMissed(checkInId,asOf);
    if(!changed) return false;
    const journey=tripGuardianRepository.getJourney(checkin.user_id,checkin.journey_id);
    if(journey){
      withTransaction(({db})=>{
        enqueueOutboxEvent(createCanonicalEventEnvelope({
          type:'trip_guardian.checkin.missed',producer:'garage-os-trip-guardian',correlation_id:journey.id,
          subject_ids:{user:journey.user_id,vehicle:journey.vehicle_id,journey:journey.id,checkin:checkInId},
          actor_type:CanonicalActorType.SYSTEM_WORKER,provenance_class:DataProvenanceClass.DERIVED_DETERMINISTIC,
          payload:{
            journey_id:journey.id,checkin_id:checkInId,missed_at:asOf,
            no_response_received:true,injury_inferred:false,crash_inferred:false,
            automatic_sos_activated:false,automatic_emergency_escalation:false
          }
        }),db);
        recordAuditEvent({
          actor_type:CanonicalActorType.SYSTEM_WORKER,action:'TRIP_GUARDIAN_CHECKIN_MISSED',
          resource_type:'trip_guardian_checkin',resource_id:checkInId,correlation_id:journey.id,
          source:'TRIP_GUARDIAN_WORKER',
          metadata:{
            no_response_received:true,injury_inferred:false,crash_inferred:false,
            automatic_sos_activated:false
          }
        },db);
      });
    }
    return true;
  }

  escalateToSos(
    actor:AuthenticatedActorContext,
    journeyId:string,
    input:EscalateTripToSosInput={}
  ):TripGuardianAggregate{
    const journey=this.requireJourney(actor,journeyId);
    if(journey.status!=='IN_PROGRESS'){
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'SOS handoff is available only for an in-progress journey',409);
    }
    const latestTripLocation=journey.location_sharing_enabled
      ? tripGuardianRepository.getLatestLocation(journeyId)
      : null;
    const sosLocation=input.location||(
      latestTripLocation&&latestTripLocation.sharing_authorized
        ? {
            latitude:latestTripLocation.latitude,
            longitude:latestTripLocation.longitude,
            accuracy_meters:latestTripLocation.accuracy_meters??undefined,
            captured_at:latestTripLocation.captured_at,
          }
        : undefined
    );
    const sos=sosService.initiate(actor,{
      vehicle_id:journey.vehicle_id,
      incident_type:'TRIP_GUARDIAN_USER_ESCALATION',
      incident_level:SafetyIncidentLevel.SERIOUS_EMERGENCY,
      activation_source:'MANUAL_SAFETY_ACTION',
      location:sosLocation
    });
    const now=getCurrentUtcIsoString();
    tripGuardianRepository.createEscalationLink({
      id:generateCanonicalId('tge'),journey_id:journeyId,escalation_type:'SOS',
      target_reference_id:sos.incident.id,created_by:actor.user_id,created_at:now
    });
    withTransaction(({db})=>{
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'trip_guardian.sos_handoff.created',producer:'garage-os-trip-guardian',correlation_id:journeyId,
        subject_ids:{user:actor.user_id,vehicle:journey.vehicle_id,journey:journeyId,sos_incident:sos.incident.id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{
          journey_id:journeyId,sos_incident_id:sos.incident.id,
          sos_backend_acknowledged:sos.acknowledgement.backend_acknowledged,
          trusted_contact_delivery_confirmed:sos.acknowledgement.trusted_contact_delivery_confirmed,
          assistance_requested:sos.acknowledgement.assistance_requested,
          assistance_accepted:sos.acknowledgement.assistance_accepted,
        }
      }),db);
    });
    return this.get(actor,journeyId);
  }

  pruneExpiredLocations(asOf=getCurrentUtcIsoString()):number{
    return tripGuardianRepository.pruneExpiredLocations(asOf);
  }

  private scheduleNextCheckIn(journey:TripGuardianJourney,fromIso:string):TripGuardianCheckIn|null{
    if(!journey.checkins_enabled||!journey.checkin_interval_minutes||journey.status!=='IN_PROGRESS') return null;
    const fromMs=new Date(fromIso).getTime();
    let dueMs=fromMs+journey.checkin_interval_minutes*60*1000;
    if(journey.expected_arrival_at){
      const arrivalMs=new Date(journey.expected_arrival_at).getTime();
      if(arrivalMs<=fromMs) return null;
      dueMs=Math.min(dueMs,arrivalMs);
    }
    if(dueMs<=fromMs) return null;
    const now=getCurrentUtcIsoString();
    const checkin:TripGuardianCheckIn={
      id:generateCanonicalId('tgci'),journey_id:journey.id,user_id:journey.user_id,
      status:'PENDING',due_at:new Date(dueMs).toISOString(),prompted_at:null,responded_at:null,
      response:null,response_notes:null,missed_at:null,created_at:now,updated_at:now
    };
    tripGuardianRepository.createCheckIn(checkin);
    jobEngine.enqueue(
      TRIP_GUARDIAN_CHECKIN_PROMPT_JOB,
      {checkin_id:checkin.id,journey_id:journey.id},
      {runAt:checkin.due_at,correlationId:journey.id,maxRetries:3}
    );
    return checkin;
  }

  private validateCheckInInterval(value:number|null|undefined):number{
    const n=Number(value);
    if(!Number.isInteger(n)||n<15||n>720){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'checkin_interval_minutes must be an integer between 15 and 720',400);
    }
    return n;
  }

  private normalizeContactIds(actor:AuthenticatedActorContext,values:string[]):string[]{
    const ids=Array.from(new Set((values||[]).map(String).filter(Boolean)));
    if(ids.length>10) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'At most 10 Emergency Circle contacts may be selected',400);
    for(const id of ids){
      const contact=safetyRepository.getContact(actor.user_id,id);
      if(!contact||contact.status!=='ACTIVE'){
        throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Emergency Circle contact not available',404);
      }
    }
    return ids;
  }

  private buildContactShares(journey:TripGuardianJourney,contactIds:string[],now:string):TripGuardianContactShare[]{
    return contactIds.map(contactId=>({
      id:generateCanonicalId('tgcs'),journey_id:journey.id,contact_id:contactId,
      share_journey_status:true,share_vehicle_summary:true,
      share_location_when_available:journey.location_sharing_enabled,
      status:'CONFIGURED',created_at:now,updated_at:now
    }));
  }

  private assertLocationSharingAllowed(actor:AuthenticatedActorContext,requested:boolean):void{
    if(!requested) return;
    const prefs=safetyService.getPreferences(actor);
    if(!prefs.allow_location_sharing){
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Enable location sharing in Safety preferences before enabling Trip Guardian location sharing',
        409
      );
    }
  }

  private requireJourney(actor:AuthenticatedActorContext,journeyId:string):TripGuardianJourney{
    const journey=tripGuardianRepository.getJourney(actor.user_id,journeyId);
    if(!journey) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Trip Guardian journey not found',404);
    return journey;
  }
}

export const tripGuardianService=new TripGuardianService();
