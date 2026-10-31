import { jobEngine } from './jobEngine';
import { logger } from '../observability/logger';
import {
  TRIP_GUARDIAN_CHECKIN_PROMPT_JOB,
  TRIP_GUARDIAN_CHECKIN_TIMEOUT_JOB,
  TRIP_GUARDIAN_LOCATION_RETENTION_JOB,
  tripGuardianService,
} from '../tripGuardian/tripGuardianService';

export function registerTripGuardianJobWorkers():void{
  jobEngine.registerWorker(TRIP_GUARDIAN_CHECKIN_PROMPT_JOB,async(payload:any,correlationId:string)=>{
    const checkinId=String(payload?.checkin_id||'');
    const changed=checkinId?tripGuardianService.promptCheckIn(checkinId):false;
    logger.info('Trip Guardian check-in prompt processed',{
      correlation_id:correlationId,resource_id:checkinId||undefined,
      details:{prompted:changed,external_notification_delivery_claimed:false}
    });
  });

  jobEngine.registerWorker(TRIP_GUARDIAN_CHECKIN_TIMEOUT_JOB,async(payload:any,correlationId:string)=>{
    const checkinId=String(payload?.checkin_id||'');
    const changed=checkinId?tripGuardianService.timeoutCheckIn(checkinId):false;
    logger.info('Trip Guardian check-in timeout processed',{
      correlation_id:correlationId,resource_id:checkinId||undefined,
      details:{missed:changed,injury_inferred:false,automatic_sos_activated:false}
    });
  });

  jobEngine.registerWorker(TRIP_GUARDIAN_LOCATION_RETENTION_JOB,async(_payload:any,correlationId:string)=>{
    const pruned=tripGuardianService.pruneExpiredLocations();
    logger.info('Trip Guardian location retention cleanup processed',{
      correlation_id:correlationId,details:{pruned}
    });
  });

  logger.info('Registered Sprint 21 Trip Guardian workers');
}
