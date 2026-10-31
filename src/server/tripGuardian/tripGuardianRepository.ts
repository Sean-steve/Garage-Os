import { getDatabase } from '../database/connection';
import {
  TripGuardianJourney,
  TripGuardianContactShare,
  TripGuardianCheckIn,
  TripGuardianLocationSnapshot,
  TripGuardianEscalationLink,
} from './types';

export class TripGuardianRepository {
  createJourney(journey:TripGuardianJourney):TripGuardianJourney{
    getDatabase().prepare(`
      INSERT INTO trip_guardian_journeys (
        id,user_id,vehicle_id,status,origin_label,destination_label,planned_departure_at,
        expected_arrival_at,purpose,pretrip_mission_id,location_sharing_enabled,
        checkins_enabled,checkin_interval_minutes,started_at,arrived_at,cancelled_at,
        cancellation_reason,start_warning_acknowledged_at,start_warning_acknowledgement,
        created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      journey.id,journey.user_id,journey.vehicle_id,journey.status,journey.origin_label,
      journey.destination_label,journey.planned_departure_at,journey.expected_arrival_at,
      journey.purpose,journey.pretrip_mission_id,journey.location_sharing_enabled?1:0,
      journey.checkins_enabled?1:0,journey.checkin_interval_minutes,journey.started_at,
      journey.arrived_at,journey.cancelled_at,journey.cancellation_reason,
      journey.start_warning_acknowledged_at,journey.start_warning_acknowledgement,
      journey.created_at,journey.updated_at
    );
    return journey;
  }

  getJourney(userId:string,id:string):TripGuardianJourney|null{
    const row=getDatabase().prepare(
      'SELECT * FROM trip_guardian_journeys WHERE id=? AND user_id=? LIMIT 1'
    ).get(id,userId) as any;
    return row?this.mapJourney(row):null;
  }

  listJourneys(userId:string,vehicleId?:string):TripGuardianJourney[]{
    let sql='SELECT * FROM trip_guardian_journeys WHERE user_id=?';
    const params:any[]=[userId];
    if(vehicleId){sql+=' AND vehicle_id=?';params.push(vehicleId);}
    sql+=' ORDER BY created_at DESC';
    return (getDatabase().prepare(sql).all(...params) as any[]).map(this.mapJourney);
  }

  updatePreparedJourney(journey:TripGuardianJourney):boolean{
    const r=getDatabase().prepare(`
      UPDATE trip_guardian_journeys SET
        origin_label=?,destination_label=?,planned_departure_at=?,expected_arrival_at=?,
        purpose=?,location_sharing_enabled=?,checkins_enabled=?,checkin_interval_minutes=?,
        updated_at=?
      WHERE id=? AND user_id=? AND status='PREPARED'
    `).run(
      journey.origin_label,journey.destination_label,journey.planned_departure_at,
      journey.expected_arrival_at,journey.purpose,journey.location_sharing_enabled?1:0,
      journey.checkins_enabled?1:0,journey.checkin_interval_minutes,journey.updated_at,
      journey.id,journey.user_id
    );
    return Number(r.changes||0)===1;
  }

  transitionJourney(args:{
    journeyId:string;userId:string;expectedStatus:string;nextStatus:string;now:string;
    startedAt?:string|null;arrivedAt?:string|null;cancelledAt?:string|null;
    cancellationReason?:string|null;warningAcknowledgedAt?:string|null;warningAcknowledgement?:string|null;
  }):boolean{
    const r=getDatabase().prepare(`
      UPDATE trip_guardian_journeys SET
        status=?,
        started_at=COALESCE(?,started_at),
        arrived_at=COALESCE(?,arrived_at),
        cancelled_at=COALESCE(?,cancelled_at),
        cancellation_reason=COALESCE(?,cancellation_reason),
        start_warning_acknowledged_at=COALESCE(?,start_warning_acknowledged_at),
        start_warning_acknowledgement=COALESCE(?,start_warning_acknowledgement),
        updated_at=?
      WHERE id=? AND user_id=? AND status=?
    `).run(
      args.nextStatus,args.startedAt??null,args.arrivedAt??null,args.cancelledAt??null,
      args.cancellationReason??null,args.warningAcknowledgedAt??null,args.warningAcknowledgement??null,
      args.now,args.journeyId,args.userId,args.expectedStatus
    );
    return Number(r.changes||0)===1;
  }

  replaceContactShares(journeyId:string,shares:TripGuardianContactShare[]):void{
    const db=getDatabase();
    db.prepare("UPDATE trip_guardian_contact_shares SET status='REVOKED',updated_at=? WHERE journey_id=? AND status='CONFIGURED'")
      .run(shares[0]?.updated_at||new Date().toISOString(),journeyId);
    const stmt=db.prepare(`
      INSERT INTO trip_guardian_contact_shares (
        id,journey_id,contact_id,share_journey_status,share_vehicle_summary,
        share_location_when_available,status,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(journey_id,contact_id) DO UPDATE SET
        share_journey_status=excluded.share_journey_status,
        share_vehicle_summary=excluded.share_vehicle_summary,
        share_location_when_available=excluded.share_location_when_available,
        status='CONFIGURED',updated_at=excluded.updated_at
    `);
    for(const s of shares){
      stmt.run(s.id,s.journey_id,s.contact_id,s.share_journey_status?1:0,s.share_vehicle_summary?1:0,
        s.share_location_when_available?1:0,s.status,s.created_at,s.updated_at);
    }
  }

  listContactShares(journeyId:string):TripGuardianContactShare[]{
    return (getDatabase().prepare(
      "SELECT * FROM trip_guardian_contact_shares WHERE journey_id=? AND status='CONFIGURED' ORDER BY created_at"
    ).all(journeyId) as any[]).map(r=>({
      id:String(r.id),journey_id:String(r.journey_id),contact_id:String(r.contact_id),
      share_journey_status:Boolean(r.share_journey_status),
      share_vehicle_summary:Boolean(r.share_vehicle_summary),
      share_location_when_available:Boolean(r.share_location_when_available),
      status:r.status,created_at:String(r.created_at),updated_at:String(r.updated_at)
    }));
  }

  createCheckIn(checkin:TripGuardianCheckIn):TripGuardianCheckIn{
    getDatabase().prepare(`
      INSERT INTO trip_guardian_checkins (
        id,journey_id,user_id,status,due_at,prompted_at,responded_at,response,response_notes,
        missed_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      checkin.id,checkin.journey_id,checkin.user_id,checkin.status,checkin.due_at,
      checkin.prompted_at,checkin.responded_at,checkin.response,checkin.response_notes,
      checkin.missed_at,checkin.created_at,checkin.updated_at
    );
    return checkin;
  }

  getCheckIn(id:string):TripGuardianCheckIn|null{
    const r=getDatabase().prepare('SELECT * FROM trip_guardian_checkins WHERE id=? LIMIT 1').get(id) as any;
    return r?this.mapCheckIn(r):null;
  }

  listCheckIns(journeyId:string):TripGuardianCheckIn[]{
    return (getDatabase().prepare(
      'SELECT * FROM trip_guardian_checkins WHERE journey_id=? ORDER BY due_at'
    ).all(journeyId) as any[]).map(this.mapCheckIn);
  }

  markCheckInPrompted(id:string,asOf:string):boolean{
    const r=getDatabase().prepare(`
      UPDATE trip_guardian_checkins
      SET prompted_at=COALESCE(prompted_at,?),updated_at=?
      WHERE id=? AND status='PENDING' AND due_at<=?
    `).run(asOf,asOf,id,asOf);
    return Number(r.changes||0)===1;
  }

  respondCheckIn(id:string,userId:string,response:string,notes:string|null,now:string):boolean{
    const r=getDatabase().prepare(`
      UPDATE trip_guardian_checkins
      SET status='RESPONDED',responded_at=?,response=?,response_notes=?,updated_at=?
      WHERE id=? AND user_id=? AND status='PENDING'
    `).run(now,response,notes,now,id,userId);
    return Number(r.changes||0)===1;
  }

  markCheckInMissed(id:string,asOf:string):boolean{
    const r=getDatabase().prepare(`
      UPDATE trip_guardian_checkins
      SET status='MISSED',missed_at=?,updated_at=?
      WHERE id=? AND status='PENDING' AND due_at<=?
    `).run(asOf,asOf,id,asOf);
    return Number(r.changes||0)===1;
  }

  cancelPendingCheckIns(journeyId:string,now:string):number{
    const r=getDatabase().prepare(`
      UPDATE trip_guardian_checkins SET status='CANCELLED',updated_at=?
      WHERE journey_id=? AND status='PENDING'
    `).run(now,journeyId);
    return Number(r.changes||0);
  }

  insertLocation(snapshot:TripGuardianLocationSnapshot):TripGuardianLocationSnapshot{
    getDatabase().prepare(`
      INSERT INTO trip_guardian_location_snapshots (
        id,journey_id,user_id,latitude,longitude,accuracy_meters,captured_at,source_type,
        purpose,sharing_authorized,expires_at,access_revoked_at,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      snapshot.id,snapshot.journey_id,snapshot.user_id,snapshot.latitude,snapshot.longitude,
      snapshot.accuracy_meters,snapshot.captured_at,snapshot.source_type,snapshot.purpose,
      snapshot.sharing_authorized?1:0,snapshot.expires_at,snapshot.access_revoked_at,snapshot.created_at
    );
    return snapshot;
  }

  getLatestLocation(journeyId:string):TripGuardianLocationSnapshot|null{
    const r=getDatabase().prepare(`
      SELECT * FROM trip_guardian_location_snapshots
      WHERE journey_id=? AND access_revoked_at IS NULL
      ORDER BY captured_at DESC LIMIT 1
    `).get(journeyId) as any;
    return r?this.mapLocation(r):null;
  }

  revokeJourneyLocations(journeyId:string,now:string):number{
    const r=getDatabase().prepare(`
      UPDATE trip_guardian_location_snapshots SET access_revoked_at=?
      WHERE journey_id=? AND access_revoked_at IS NULL
    `).run(now,journeyId);
    return Number(r.changes||0);
  }

  pruneExpiredLocations(asOf:string):number{
    const r=getDatabase().prepare(`
      UPDATE trip_guardian_location_snapshots SET access_revoked_at=?
      WHERE access_revoked_at IS NULL AND expires_at<=?
    `).run(asOf,asOf);
    return Number(r.changes||0);
  }

  createEscalationLink(link:TripGuardianEscalationLink):void{
    getDatabase().prepare(`
      INSERT OR IGNORE INTO trip_guardian_escalation_links
      (id,journey_id,escalation_type,target_reference_id,created_by,created_at)
      VALUES (?,?,?,?,?,?)
    `).run(link.id,link.journey_id,link.escalation_type,link.target_reference_id,link.created_by,link.created_at);
  }

  listEscalationLinks(journeyId:string):TripGuardianEscalationLink[]{
    return getDatabase().prepare(
      'SELECT * FROM trip_guardian_escalation_links WHERE journey_id=? ORDER BY created_at DESC'
    ).all(journeyId) as unknown as TripGuardianEscalationLink[];
  }

  recordStatusHistory(args:{
    id:string;journeyId:string;fromStatus?:string|null;toStatus:string;actorId?:string|null;
    actorType:string;reason?:string|null;metadata?:Record<string,unknown>;occurredAt:string;
  }):void{
    getDatabase().prepare(`
      INSERT INTO trip_guardian_status_history
      (id,journey_id,from_status,to_status,actor_id,actor_type,reason,metadata_json,occurred_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      args.id,args.journeyId,args.fromStatus??null,args.toStatus,args.actorId??null,args.actorType,
      args.reason??null,args.metadata?JSON.stringify(args.metadata):null,args.occurredAt
    );
  }

  private mapJourney=(r:any):TripGuardianJourney=>({
    id:String(r.id),user_id:String(r.user_id),vehicle_id:String(r.vehicle_id),status:r.status,
    origin_label:String(r.origin_label),destination_label:String(r.destination_label),
    planned_departure_at:r.planned_departure_at?String(r.planned_departure_at):null,
    expected_arrival_at:r.expected_arrival_at?String(r.expected_arrival_at):null,
    purpose:r.purpose?String(r.purpose):null,pretrip_mission_id:String(r.pretrip_mission_id),
    location_sharing_enabled:Boolean(r.location_sharing_enabled),
    checkins_enabled:Boolean(r.checkins_enabled),
    checkin_interval_minutes:r.checkin_interval_minutes===null?null:Number(r.checkin_interval_minutes),
    started_at:r.started_at?String(r.started_at):null,arrived_at:r.arrived_at?String(r.arrived_at):null,
    cancelled_at:r.cancelled_at?String(r.cancelled_at):null,
    cancellation_reason:r.cancellation_reason?String(r.cancellation_reason):null,
    start_warning_acknowledged_at:r.start_warning_acknowledged_at?String(r.start_warning_acknowledged_at):null,
    start_warning_acknowledgement:r.start_warning_acknowledgement?String(r.start_warning_acknowledgement):null,
    created_at:String(r.created_at),updated_at:String(r.updated_at)
  });

  private mapCheckIn=(r:any):TripGuardianCheckIn=>({
    id:String(r.id),journey_id:String(r.journey_id),user_id:String(r.user_id),status:r.status,
    due_at:String(r.due_at),prompted_at:r.prompted_at?String(r.prompted_at):null,
    responded_at:r.responded_at?String(r.responded_at):null,response:r.response||null,
    response_notes:r.response_notes?String(r.response_notes):null,
    missed_at:r.missed_at?String(r.missed_at):null,created_at:String(r.created_at),updated_at:String(r.updated_at)
  });

  private mapLocation=(r:any):TripGuardianLocationSnapshot=>({
    id:String(r.id),journey_id:String(r.journey_id),user_id:String(r.user_id),
    latitude:Number(r.latitude),longitude:Number(r.longitude),
    accuracy_meters:r.accuracy_meters===null?null:Number(r.accuracy_meters),
    captured_at:String(r.captured_at),source_type:'USER_DEVICE',purpose:'TRIP_GUARDIAN',
    sharing_authorized:Boolean(r.sharing_authorized),expires_at:String(r.expires_at),
    access_revoked_at:r.access_revoked_at?String(r.access_revoked_at):null,created_at:String(r.created_at)
  });
}

export const tripGuardianRepository=new TripGuardianRepository();
