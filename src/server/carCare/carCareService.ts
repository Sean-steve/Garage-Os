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
import { carCareRepository } from './carCareRepository';
import {
  CarCareArticle, CarCareDashboard, CareGuidanceCard, CareMissionItemProgress,
  CareMissionItemStatus, EnrichedVehicleCareMission, VehicleCareMission
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
