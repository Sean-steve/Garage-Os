import { createHash } from 'node:crypto';
import { AuthenticatedActorContext } from '../identity/types';
import { CanonicalActorType } from '../../shared/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { withTransaction } from '../database/transaction';
import { vehicleService } from '../vehicle/vehicleService';
import { maintenanceService } from '../maintenance/maintenanceService';
import { MaintenanceCycleStatus } from '../maintenance/types';
import { issueRepository } from '../issues/issueRepository';
import { issueService } from '../issues/issueService';
import { IssuePersistenceState, IssueSeverity } from '../issues/types';
import { componentRepository } from '../components/componentRepository';
import { ComponentStatus } from '../components/types';
import { fuelExpenseRepository } from '../finance/fuelExpenseRepository';
import { evaluatePersonalizedCare, CAR_CARE_PERSONALIZATION_RULE_VERSION } from './personalizationEngine';
import { carCareRepository } from './carCareRepository';
import {
  CarCareArticle, CarCareDashboard, CareGuidanceCard, CareMissionItemProgress,
  CareMissionItemStatus, EnrichedVehicleCareMission, VehicleCareMission,
  VehicleCareProfile, UpdateVehicleCareProfileInput, PersonalizedCarePlan,
  CarCarePersonalizationEvaluation, CareClimateExposure
} from './types';
import { recordAuditEvent } from '../security/audit';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { DataProvenanceClass } from '../../shared/provenance';

const COMPLETION_STATEMENT =
  'Owner checklist completed. This does not certify the vehicle as safe, roadworthy, defect-free, or professionally inspected.';

export class CarCareService {
  listArticles(filters:{kind?:string;category?:string;query?:string}={}):CarCareArticle[]{
    return carCareRepository.listArticles(filters);
  }

  getArticle(slug:string):CarCareArticle{
    const article=carCareRepository.getArticleBySlug(slug);
    if(!article) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Car Care article not found',404);
    return article;
  }

  getDashboard(actor:AuthenticatedActorContext,vehicleId:string):CarCareDashboard{
    vehicleService.getVehicleDetails(actor,vehicleId);
    const maintenance=maintenanceService.getVehicleMaintenanceStatus(vehicleId);
    const activeIssues=issueRepository.listActiveIssuesForVehicle(vehicleId);
    const persistentIssues=issueRepository.listPersistentIssuesForVehicle(vehicleId);
    const guidance:CareGuidanceCard[]=[];

    for(const issue of activeIssues){
      let nextAction:any=null;
      try{nextAction=issueService.getEnrichedIssue(issue.id).next_recommended_action;}catch{nextAction=null;}
      const stop=nextAction?.action_type==='STOP_DRIVING_SAFETY_WARNING';
      const priority=stop||issue.severity===IssueSeverity.CRITICAL?'CRITICAL':issue.severity===IssueSeverity.HIGH?'HIGH':'MEDIUM';
      guidance.push({
        id:'issue:'+issue.id,priority,title:stop?'Safety-critical issue requires attention':issue.title,
        explanation:stop
          ? 'Garage OS has an existing issue whose canonical next action is to stop driving for safety. Car Care is surfacing that existing state; it is not making a new diagnosis.'
          : 'This is an existing vehicle issue already recorded in Garage OS. Review its history and next recommended action before relying on owner-level care checks.',
        source_type:'VEHICLE_ISSUE',source_reference_id:issue.id,is_diagnosis:false,
        actions:stop
          ? [{label:'Review issue',target_tab:'issues',target_id:issue.id},{label:'Open roadside',target_tab:'roadside'}]
          : [{label:'Review issue',target_tab:'issues',target_id:issue.id},{label:'Find service',target_tab:'providers'}]
      });
    }

    for(const item of maintenance.active_cycles){
      if(![MaintenanceCycleStatus.OVERDUE,MaintenanceCycleStatus.DUE,MaintenanceCycleStatus.APPROACHING_DUE].includes(item.cycle.status)) continue;
      const priority=item.cycle.status===MaintenanceCycleStatus.OVERDUE?'HIGH':item.cycle.status===MaintenanceCycleStatus.DUE?'MEDIUM':'INFO';
      guidance.push({
        id:'maintenance:'+item.cycle.id,priority,
        title:item.cycle.status===MaintenanceCycleStatus.OVERDUE
          ? 'Maintenance overdue: '+item.requirement.name
          : item.cycle.status===MaintenanceCycleStatus.DUE
            ? 'Maintenance due: '+item.requirement.name
            : 'Maintenance approaching: '+item.requirement.name,
        explanation:'This guidance comes from the canonical maintenance due-state engine, not from a Car Care estimate.',
        source_type:'MAINTENANCE_STATE',source_reference_id:item.cycle.id,is_diagnosis:false,
        actions:[{label:'Review maintenance',target_tab:'maintenance'},{label:'Book service',target_tab:'bookings'}]
      });
    }

    if(guidance.length===0){
      guidance.push({
        id:'baseline:care',priority:'INFO',title:'No urgent care action surfaced',
        explanation:'No urgent action is being inferred. Continue routine maintenance, review active missions, and record new symptoms when they occur.',
        source_type:'CARE_BASELINE',is_diagnosis:false,
        actions:[{label:'Start a care mission',target_tab:'care'}]
      });
    }

    const rank={CRITICAL:0,HIGH:1,MEDIUM:2,INFO:3};
    guidance.sort((a,b)=>rank[a.priority]-rank[b.priority]);

    return {
      vehicle_id:vehicleId,generated_at:getCurrentUtcIsoString(),
      maintenance:{
        overall_status:maintenance.overall_status,overdue_count:maintenance.overdue_count,
        due_count:maintenance.due_count,approaching_count:maintenance.approaching_count,
        next_due_item:maintenance.next_due_item
      },
      active_issue_count:activeIssues.length,persistent_issue_count:persistentIssues.length,
      guidance:guidance.slice(0,10),
      recommended_missions:carCareRepository.listTemplates(),
      active_missions:carCareRepository.listMissions(actor.user_id,vehicleId)
        .filter(m=>m.status==='ACTIVE').map(m=>this.enrichMission(m)),
      safety_statement:'Car Care guidance explains observations and routes the owner to authoritative Garage OS workflows. It does not diagnose faults or replace a professional inspection.'
    };
  }

  getCareProfile(actor:AuthenticatedActorContext,vehicleId:string):VehicleCareProfile|null{
    vehicleService.getVehicleDetails(actor,vehicleId);
    return carCareRepository.getCareProfile(actor.user_id,vehicleId);
  }

  updateCareProfile(
    actor:AuthenticatedActorContext,
    vehicleId:string,
    input:UpdateVehicleCareProfileInput
  ):VehicleCareProfile{
    vehicleService.getVehicleDetails(actor,vehicleId);
    const existing=carCareRepository.getCareProfile(actor.user_id,vehicleId);
    const now=getCurrentUtcIsoString();

    const usageAllowed=['UNKNOWN','OCCASIONAL','DAILY_COMMUTE','MIXED','LONG_DISTANCE','LIGHT_COMMERCIAL'];
    const distanceAllowed=['UNKNOWN','UNDER_5000_KM','KM_5000_10000','KM_10000_20000','KM_20000_30000','OVER_30000_KM'];
    const roadAllowed=['UNKNOWN','PAVED_MOSTLY','MIXED','ROUGH_ROADS_FREQUENT'];
    const parkingAllowed=['UNKNOWN','GARAGED','COVERED_OUTDOOR','OUTDOOR_EXPOSED','MIXED'];
    const longTripAllowed=['UNKNOWN','RARE','OCCASIONAL','MONTHLY','FREQUENT'];
    const loadAllowed=['UNKNOWN','NEVER','OCCASIONAL','FREQUENT'];
    const climateAllowed:CareClimateExposure[]=['DUSTY','HOT','HUMID','HEAVY_RAIN','COASTAL_SALT','COLD','NONE_REPORTED'];

    const validate=(value:string|undefined,allowed:string[],field:string,current:string):string=>{
      const next=value===undefined?current:value;
      if(!allowed.includes(next)) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,`Invalid ${field}`,400);
      return next;
    };

    const climateRaw=input.climate_exposures===undefined
      ? existing?.climate_exposures||[]
      : Array.from(new Set(input.climate_exposures));
    if(climateRaw.some(x=>!climateAllowed.includes(x))){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid climate_exposures value',400);
    }
    if(climateRaw.includes('NONE_REPORTED')&&climateRaw.length>1){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'NONE_REPORTED cannot be combined with other climate exposures',400);
    }

    const profile:VehicleCareProfile={
      id:existing?.id||generateCanonicalId('ccprof'),
      user_id:actor.user_id,
      vehicle_id:vehicleId,
      usage_pattern:validate(input.usage_pattern,usageAllowed,'usage_pattern',existing?.usage_pattern||'UNKNOWN') as VehicleCareProfile['usage_pattern'],
      annual_distance_band:validate(input.annual_distance_band,distanceAllowed,'annual_distance_band',existing?.annual_distance_band||'UNKNOWN') as VehicleCareProfile['annual_distance_band'],
      road_exposure:validate(input.road_exposure,roadAllowed,'road_exposure',existing?.road_exposure||'UNKNOWN') as VehicleCareProfile['road_exposure'],
      parking_context:validate(input.parking_context,parkingAllowed,'parking_context',existing?.parking_context||'UNKNOWN') as VehicleCareProfile['parking_context'],
      climate_exposures:climateRaw,
      long_trip_frequency:validate(input.long_trip_frequency,longTripAllowed,'long_trip_frequency',existing?.long_trip_frequency||'UNKNOWN') as VehicleCareProfile['long_trip_frequency'],
      heavy_load_frequency:validate(input.heavy_load_frequency,loadAllowed,'heavy_load_frequency',existing?.heavy_load_frequency||'UNKNOWN') as VehicleCareProfile['heavy_load_frequency'],
      profile_version:(existing?.profile_version||0)+1,
      source_type:'OWNER_CONFIGURED',
      created_at:existing?.created_at||now,
      updated_at:now,
    };

    return withTransaction(({db})=>{
      const saved=carCareRepository.saveCareProfile(profile);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'car_care.profile.updated',
        producer:'garage-os-car-care',
        correlation_id:`care-profile:${saved.id}:v${saved.profile_version}`,
        subject_ids:{vehicle:vehicleId,care_profile:saved.id},
        actor_id:actor.user_id,
        actor_type:actor.type||CanonicalActorType.VEHICLE_OWNER,
        provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{
          vehicle_id:vehicleId,
          profile_id:saved.id,
          profile_version:saved.profile_version,
          source_type:saved.source_type,
          location_inference_used:false,
        }
      }),db);
      recordAuditEvent({
        actor_id:actor.user_id,
        actor_type:actor.type||CanonicalActorType.VEHICLE_OWNER,
        action:'CAR_CARE_PROFILE_UPDATED',
        resource_type:'vehicle_care_profile',
        resource_id:saved.id,
        correlation_id:`care-profile:${saved.id}:v${saved.profile_version}`,
        source:'CAR_CARE_API',
        before_state:existing||undefined,
        after_state:saved,
        metadata:{vehicle_id:vehicleId,location_inference_used:false}
      },db);
      return saved;
    });
  }

  getPersonalizedPlan(
    actor:AuthenticatedActorContext,
    vehicleId:string,
    recordEvaluation=false
  ):PersonalizedCarePlan{
    const detail=vehicleService.getVehicleDetails(actor,vehicleId);
    const profile=carCareRepository.getCareProfile(actor.user_id,vehicleId);
    const maintenance=maintenanceService.getVehicleMaintenanceStatus(vehicleId);
    const activeIssues=issueRepository.listActiveIssuesForVehicle(vehicleId);
    const persistentIssues=issueRepository.listPersistentIssuesForVehicle(vehicleId);
    const currentTyres=componentRepository.findTyresByVehicleId(vehicleId,ComponentStatus.INSTALLED);
    const tyreInspections=componentRepository.findLatestInspectionsByVehicleId(vehicleId);
    const fuelSnapshot=fuelExpenseRepository.getLatestSnapshotForVehicle(vehicleId);
    const generatedAt=getCurrentUtcIsoString();

    const plan=evaluatePersonalizedCare({
      generated_at:generatedAt,
      vehicle:{
        vehicle_id:vehicleId,
        model_year:detail.vehicle.model_year,
        fuel_type:detail.vehicle.fuel_type,
        current_odometer_km:detail.vehicle.current_odometer_cache,
      },
      profile,
      maintenance:{
        overall_status:maintenance.overall_status,
        overdue_count:maintenance.overdue_count,
        due_count:maintenance.due_count,
        approaching_count:maintenance.approaching_count,
      },
      issues:{
        active_count:activeIssues.length,
        persistent_count:persistentIssues.length,
        critical_count:activeIssues.filter(x=>x.severity===IssueSeverity.CRITICAL).length,
      },
      tyres:{
        installed_count:currentTyres.length,
        latest_inspections:tyreInspections.map(x=>({
          id:x.id,condition_rating:x.condition_rating,observed_at:x.observed_at
        })),
      },
      fuel:{
        anomaly_detected:Boolean(fuelSnapshot?.anomaly_detected),
        observation_text:fuelSnapshot?.observation_text||null,
        data_quality:fuelSnapshot?.data_quality||null,
        snapshot_id:fuelSnapshot?.id||null,
      }
    });

    if(recordEvaluation){
      const fingerprintPayload={
        vehicle:{
          model_year:detail.vehicle.model_year,
          fuel_type:detail.vehicle.fuel_type,
          odometer_km:detail.vehicle.current_odometer_cache,
        },
        profile_version:profile?.profile_version||0,
        profile:profile?{
          usage_pattern:profile.usage_pattern,
          annual_distance_band:profile.annual_distance_band,
          road_exposure:profile.road_exposure,
          parking_context:profile.parking_context,
          climate_exposures:profile.climate_exposures,
          long_trip_frequency:profile.long_trip_frequency,
          heavy_load_frequency:profile.heavy_load_frequency,
        }:null,
        maintenance:{
          overall_status:maintenance.overall_status,
          overdue_count:maintenance.overdue_count,
          due_count:maintenance.due_count,
          approaching_count:maintenance.approaching_count,
        },
        issues:{
          active_count:activeIssues.length,
          persistent_count:persistentIssues.length,
          critical_ids:activeIssues.filter(x=>x.severity===IssueSeverity.CRITICAL).map(x=>x.id).sort(),
        },
        tyre_inspections:tyreInspections.map(x=>({id:x.id,condition:x.condition_rating,observed_at:x.observed_at})),
        fuel_snapshot:fuelSnapshot?{id:fuelSnapshot.id,anomaly:fuelSnapshot.anomaly_detected,data_quality:fuelSnapshot.data_quality}:null,
      };
      const inputFingerprint=createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex');
      const evaluation:CarCarePersonalizationEvaluation={
        id:generateCanonicalId('cceval'),
        user_id:actor.user_id,
        vehicle_id:vehicleId,
        profile_id:profile?.id||null,
        rule_version:CAR_CARE_PERSONALIZATION_RULE_VERSION,
        input_fingerprint:inputFingerprint,
        recommendation_count:plan.recommendations.length,
        recommendations:plan.recommendations,
        evidence_summary:{
          maintenance_overall_status:maintenance.overall_status,
          active_issue_count:activeIssues.length,
          persistent_issue_count:persistentIssues.length,
          current_tyre_count:currentTyres.length,
          tyre_inspection_count:tyreInspections.length,
          fuel_snapshot_available:Boolean(fuelSnapshot),
          location_inference_used:false,
          ai_inference_used:false,
        },
        generated_at:generatedAt,
        created_at:generatedAt,
      };

      withTransaction(({db})=>{
        carCareRepository.savePersonalizationEvaluation(evaluation);
        enqueueOutboxEvent(createCanonicalEventEnvelope({
          type:'car_care.personalization.evaluated',
          producer:'garage-os-car-care',
          correlation_id:evaluation.id,
          subject_ids:{vehicle:vehicleId,personalization_evaluation:evaluation.id},
          actor_id:actor.user_id,
          actor_type:actor.type||CanonicalActorType.VEHICLE_OWNER,
          provenance_class:DataProvenanceClass.DERIVED_DETERMINISTIC,
          payload:{
            vehicle_id:vehicleId,
            evaluation_id:evaluation.id,
            rule_version:evaluation.rule_version,
            recommendation_count:evaluation.recommendation_count,
            input_fingerprint:evaluation.input_fingerprint,
            location_inference_used:false,
            ai_inference_used:false,
          }
        }),db);
        recordAuditEvent({
          actor_id:actor.user_id,
          actor_type:actor.type||CanonicalActorType.VEHICLE_OWNER,
          action:'CAR_CARE_PERSONALIZATION_EVALUATED',
          resource_type:'car_care_personalization_evaluation',
          resource_id:evaluation.id,
          correlation_id:evaluation.id,
          source:'CAR_CARE_API',
          metadata:{
            vehicle_id:vehicleId,
            rule_version:evaluation.rule_version,
            recommendation_count:evaluation.recommendation_count,
            location_inference_used:false,
            ai_inference_used:false,
          }
        },db);
      });
    }

    return plan;
  }

  listPersonalizationEvaluations(
    actor:AuthenticatedActorContext,
    vehicleId:string,
    limit=10
  ):CarCarePersonalizationEvaluation[]{
    vehicleService.getVehicleDetails(actor,vehicleId);
    return carCareRepository.listPersonalizationEvaluations(actor.user_id,vehicleId,limit);
  }

  listMissions(actor:AuthenticatedActorContext,vehicleId:string):EnrichedVehicleCareMission[]{
    vehicleService.getVehicleDetails(actor,vehicleId);
    return carCareRepository.listMissions(actor.user_id,vehicleId).map(m=>this.enrichMission(m));
  }

  startMission(actor:AuthenticatedActorContext,vehicleId:string,templateCode:string):EnrichedVehicleCareMission{
    vehicleService.getVehicleDetails(actor,vehicleId);
    const template=carCareRepository.getTemplateByCode(templateCode);
    if(!template) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Care mission template not found',404);
    const existing=carCareRepository.getActiveMissionForTemplate(actor.user_id,vehicleId,template.id);
    if(existing) return this.enrichMission(existing);
    const now=getCurrentUtcIsoString();
    const mission:VehicleCareMission={
      id:generateCanonicalId('ccm'),user_id:actor.user_id,vehicle_id:vehicleId,template_id:template.id,
      status:'ACTIVE',started_at:now,completed_at:null,cancelled_at:null,created_at:now,updated_at:now
    };
    const items=carCareRepository.listTemplateItems(template.id);
    withTransaction(({db})=>{
      carCareRepository.createMission(mission);
      for(const item of items){
        carCareRepository.createProgress({
          id:generateCanonicalId('ccp'),mission_id:mission.id,item_id:item.id,status:'PENDING',
          note:null,updated_by:actor.user_id,completed_at:null,created_at:now,updated_at:now
        });
      }
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'car_care.mission.started',producer:'garage-os-car-care',correlation_id:mission.id,
        subject_ids:{vehicle:vehicleId,mission:mission.id,template:template.id},
        actor_id:actor.user_id,actor_type:actor.type||CanonicalActorType.VEHICLE_OWNER,
        provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{vehicle_id:vehicleId,mission_id:mission.id,template_code:template.code}
      }),db);
      recordAuditEvent({
        actor_id:actor.user_id,actor_type:actor.type||CanonicalActorType.VEHICLE_OWNER,
        action:'CAR_CARE_MISSION_STARTED',resource_type:'vehicle_care_mission',resource_id:mission.id,
        correlation_id:mission.id,source:'CAR_CARE_API',metadata:{vehicle_id:vehicleId,template_code:template.code}
      },db);
    });
    return this.enrichMission(mission);
  }

  updateMissionItem(
    actor:AuthenticatedActorContext,vehicleId:string,missionId:string,itemId:string,
    status:CareMissionItemStatus,note?:string
  ):EnrichedVehicleCareMission{
    vehicleService.getVehicleDetails(actor,vehicleId);
    const mission=carCareRepository.getMission(actor.user_id,vehicleId,missionId);
    if(!mission) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Care mission not found',404);
    if(mission.status!=='ACTIVE') throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Completed or cancelled missions are immutable',409);
    const template=carCareRepository.getTemplateById(mission.template_id);
    if(!template) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Care mission template not found',404);
    const item=carCareRepository.listTemplateItems(template.id).find(x=>x.id===itemId);
    if(!item) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Care mission item not found',404);
    const allowed:CareMissionItemStatus[]=['PENDING','COMPLETED','CONCERN_REPORTED','SKIPPED','PROFESSIONAL_HELP_REQUIRED'];
    if(!allowed.includes(status)) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid mission item status',400);
    if(item.check_level==='PROFESSIONAL_INSPECTION_ONLY' && !['PENDING','SKIPPED','PROFESSIONAL_HELP_REQUIRED'].includes(status)){
      throw new CanonicalAppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Owner cannot mark a professional-inspection-only item as professionally completed',
        409
      );
    }
    const safeNote=note?.trim()?note.trim().slice(0,1000):null;
    const now=getCurrentUtcIsoString();
    if(!carCareRepository.updateProgress(missionId,itemId,status,safeNote,actor.user_id,now)){
      throw new CanonicalAppError(ErrorCode.CONFLICT,'Mission progress could not be updated',409);
    }

    withTransaction(({db})=>{
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'car_care.mission.item.updated',producer:'garage-os-car-care',correlation_id:missionId,
        subject_ids:{vehicle:vehicleId,mission:missionId,item:itemId},
        actor_id:actor.user_id,actor_type:actor.type||CanonicalActorType.VEHICLE_OWNER,
        provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{vehicle_id:vehicleId,mission_id:missionId,item_id:itemId,status}
      }),db);
    });

    let enriched=this.enrichMission(mission);
    if(enriched.progress.pending===0){
      carCareRepository.completeMission(missionId,actor.user_id,vehicleId,now);
      withTransaction(({db})=>{
        enqueueOutboxEvent(createCanonicalEventEnvelope({
          type:'car_care.mission.completed',producer:'garage-os-car-care',correlation_id:missionId,
          subject_ids:{vehicle:vehicleId,mission:missionId},
          actor_id:actor.user_id,actor_type:actor.type||CanonicalActorType.VEHICLE_OWNER,
          provenance_class:DataProvenanceClass.OWNER_ASSERTED,
          payload:{
            vehicle_id:vehicleId,mission_id:missionId,
            professional_help_required:enriched.progress.professional_help_required,
            concerns_reported:enriched.progress.concerns_reported,
            professional_inspection_certified:false
          }
        }),db);
        recordAuditEvent({
          actor_id:actor.user_id,actor_type:actor.type||CanonicalActorType.VEHICLE_OWNER,
          action:'CAR_CARE_MISSION_COMPLETED',resource_type:'vehicle_care_mission',resource_id:missionId,
          correlation_id:missionId,source:'CAR_CARE_API',
          metadata:{vehicle_id:vehicleId,professional_inspection_certified:false}
        },db);
      });
      const completed=carCareRepository.getMission(actor.user_id,vehicleId,missionId)!;
      enriched=this.enrichMission(completed);
    }
    return enriched;
  }

  getMission(actor:AuthenticatedActorContext,vehicleId:string,missionId:string):EnrichedVehicleCareMission{
    vehicleService.getVehicleDetails(actor,vehicleId);
    const mission=carCareRepository.getMission(actor.user_id,vehicleId,missionId);
    if(!mission) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Care mission not found',404);
    return this.enrichMission(mission);
  }

  private enrichMission(mission:VehicleCareMission):EnrichedVehicleCareMission{
    const template=carCareRepository.getTemplateById(mission.template_id);
    if(!template) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Care mission template unavailable',404);
    const progress=carCareRepository.listProgress(mission.id);
    const byItem=new Map(progress.map(p=>[p.item_id,p]));
    const items=carCareRepository.listTemplateItems(template.id).map(item=>({
      item,progress:byItem.get(item.id) as CareMissionItemProgress
    }));
    const total=items.length;
    const pending=items.filter(x=>x.progress?.status==='PENDING').length;
    const professional=items.filter(x=>x.progress?.status==='PROFESSIONAL_HELP_REQUIRED').length;
    const concerns=items.filter(x=>x.progress?.status==='CONCERN_REPORTED').length;
    return {
      mission,template,items,
      progress:{total,resolved:total-pending,pending,percent:total?Math.round(((total-pending)/total)*100):100,professional_help_required:professional,concerns_reported:concerns},
      completion_statement:COMPLETION_STATEMENT
    };
  }
}

export const carCareService=new CarCareService();
