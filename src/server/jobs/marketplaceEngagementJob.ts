import { jobEngine } from './jobEngine';
import { logger } from '../observability/logger';
import { authService } from '../identity/authService';
import { marketplaceEngagementService } from '../marketplaceEngagement/marketplaceEngagementService';

export const MARKETPLACE_ALERT_EVALUATION_JOB='marketplace.engagement.alert.evaluate';

export async function runMarketplaceAlertEvaluationJob(payload:{listing_id?:string;user_id?:string},correlationId:string):Promise<void>{
  if(payload.listing_id){
    const result=marketplaceEngagementService.evaluateListingChangeInternal(String(payload.listing_id));
    logger.info('Marketplace listing alert evaluation completed',{correlation_id:correlationId,resource_id:String(payload.listing_id),details:result});
    return;
  }
  if(payload.user_id){
    const actor=authService.getActorContextById(String(payload.user_id));
    if(!actor||actor.account_status!=='ACTIVE')return;
    const result=marketplaceEngagementService.evaluateForUser(actor);
    logger.info('Marketplace user alert evaluation completed',{correlation_id:correlationId,resource_id:String(payload.user_id),details:result});
  }
}
export function registerMarketplaceEngagementJobWorkers():void{
  jobEngine.registerWorker(MARKETPLACE_ALERT_EVALUATION_JOB,runMarketplaceAlertEvaluationJob);
  logger.info('Registered Sprint 29 marketplace engagement alert worker');
}
