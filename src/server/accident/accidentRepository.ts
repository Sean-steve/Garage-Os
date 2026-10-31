import { getDatabase } from '../database/connection';
import {
  AccidentAddendum,
  AccidentAggregate,
  AccidentDamageObservation,
  AccidentEvidence,
  AccidentExternalReference,
  AccidentHandoff,
  AccidentIncident,
  AccidentParticipant,
  AccidentParticipantType,
  AccidentReferenceType,
  AccidentReferenceVerificationStatus,
  AccidentSeverity,
  AccidentStatus,
  AccidentWitness,
  TriState,
} from './types';

const b=(v: unknown) => Boolean(v);

function mapIncident(row: any): AccidentIncident {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    vehicle_id: String(row.vehicle_id),
    status: row.status as AccidentStatus,
    incident_type: String(row.incident_type),
    severity: row.severity as AccidentSeverity,
    occurred_at: String(row.occurred_at),
    recorded_at: String(row.recorded_at),
    summary: String(row.summary),
    location_label: row.location_label ? String(row.location_label) : null,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    location_accuracy_meters: row.location_accuracy_meters == null ? null : Number(row.location_accuracy_meters),
    location_sharing_authorized: b(row.location_sharing_authorized),
    police_attended: row.police_attended as TriState,
    injuries_reported: row.injuries_reported as TriState,
    vehicle_drivable: row.vehicle_drivable as TriState,
    timeline_entry_id: row.timeline_entry_id ? String(row.timeline_entry_id) : null,
    version: Number(row.version),
    finalized_at: row.finalized_at ? String(row.finalized_at) : null,
    closed_at: row.closed_at ? String(row.closed_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export class AccidentRepository {
  createIncident(incident: AccidentIncident): void {
    getDatabase().prepare(`
      INSERT INTO accident_incidents (
        id,user_id,vehicle_id,status,incident_type,severity,occurred_at,recorded_at,summary,
        location_label,latitude,longitude,location_accuracy_meters,location_sharing_authorized,
        police_attended,injuries_reported,vehicle_drivable,timeline_entry_id,version,
        finalized_at,closed_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      incident.id, incident.user_id, incident.vehicle_id, incident.status, incident.incident_type,
      incident.severity, incident.occurred_at, incident.recorded_at, incident.summary,
      incident.location_label || null, incident.latitude ?? null, incident.longitude ?? null,
      incident.location_accuracy_meters ?? null, incident.location_sharing_authorized ? 1 : 0,
      incident.police_attended, incident.injuries_reported, incident.vehicle_drivable,
      incident.timeline_entry_id || null, incident.version, incident.finalized_at || null,
      incident.closed_at || null, incident.created_at, incident.updated_at
    );
  }

  getIncident(userId: string, id: string): AccidentIncident | null {
    const row=getDatabase().prepare('SELECT * FROM accident_incidents WHERE id=? AND user_id=? LIMIT 1').get(id,userId) as any;
    return row ? mapIncident(row) : null;
  }

  getIncidentById(id: string): AccidentIncident | null {
    const row=getDatabase().prepare('SELECT * FROM accident_incidents WHERE id=? LIMIT 1').get(id) as any;
    return row ? mapIncident(row) : null;
  }

  listIncidents(userId: string, vehicleId?: string): AccidentIncident[] {
    const rows=(vehicleId
      ? getDatabase().prepare('SELECT * FROM accident_incidents WHERE user_id=? AND vehicle_id=? ORDER BY occurred_at DESC, created_at DESC').all(userId,vehicleId)
      : getDatabase().prepare('SELECT * FROM accident_incidents WHERE user_id=? ORDER BY occurred_at DESC, created_at DESC').all(userId)) as any[];
    return rows.map(mapIncident);
  }

  updateDraft(id:string,userId:string,values:AccidentIncident): boolean {
    const r=getDatabase().prepare(`
      UPDATE accident_incidents SET incident_type=?,severity=?,occurred_at=?,summary=?,
      location_label=?,latitude=?,longitude=?,location_accuracy_meters=?,location_sharing_authorized=?,
      police_attended=?,injuries_reported=?,vehicle_drivable=?,version=version+1,updated_at=?
      WHERE id=? AND user_id=? AND status='DRAFT'
    `).run(
      values.incident_type,values.severity,values.occurred_at,values.summary,values.location_label||null,
      values.latitude??null,values.longitude??null,values.location_accuracy_meters??null,
      values.location_sharing_authorized?1:0,values.police_attended,values.injuries_reported,
      values.vehicle_drivable,values.updated_at,id,userId
    );
    return Number(r.changes||0)===1;
  }

  transition(id:string,userId:string,from:AccidentStatus,to:AccidentStatus,now:string,extra?:{timelineEntryId?:string;finalizedAt?:string;closedAt?:string}): boolean {
    const r=getDatabase().prepare(`
      UPDATE accident_incidents
      SET status=?, timeline_entry_id=COALESCE(?,timeline_entry_id),
          finalized_at=COALESCE(?,finalized_at), closed_at=COALESCE(?,closed_at),
          version=version+1, updated_at=?
      WHERE id=? AND user_id=? AND status=?
    `).run(to,extra?.timelineEntryId||null,extra?.finalizedAt||null,extra?.closedAt||null,now,id,userId,from);
    return Number(r.changes||0)===1;
  }

  addParticipant(p:AccidentParticipant): void {
    getDatabase().prepare(`
      INSERT INTO accident_participants (
        id,accident_id,participant_type,display_label,name,phone,email,vehicle_registration,
        vehicle_make,vehicle_model,insurer_name,policy_reference,notes,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(p.id,p.accident_id,p.participant_type,p.display_label,p.name||null,p.phone||null,p.email||null,
      p.vehicle_registration||null,p.vehicle_make||null,p.vehicle_model||null,p.insurer_name||null,
      p.policy_reference||null,p.notes||null,p.created_at);
  }

  addWitness(w:AccidentWitness): void {
    getDatabase().prepare(`
      INSERT INTO accident_witnesses (id,accident_id,name,phone,email,notes,consent_to_contact,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(w.id,w.accident_id,w.name,w.phone||null,w.email||null,w.notes||null,w.consent_to_contact,w.created_at);
  }

  addDamage(d:AccidentDamageObservation): void {
    getDatabase().prepare(`
      INSERT INTO accident_damage_observations (id,accident_id,vehicle_area,severity,description,source_type,created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(d.id,d.accident_id,d.vehicle_area,d.severity,d.description,d.source_type,d.created_at);
  }

  addEvidence(e:AccidentEvidence): void {
    getDatabase().prepare(`
      INSERT INTO accident_evidence (id,accident_id,file_id,evidence_type,description,captured_at,source_type,privacy_class,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(e.id,e.accident_id,e.file_id,e.evidence_type,e.description||null,e.captured_at||null,e.source_type,e.privacy_class,e.created_at);
  }

  addExternalReference(r:AccidentExternalReference): void {
    getDatabase().prepare(`
      INSERT INTO accident_external_references (id,accident_id,reference_type,provider_name,reference_number,verification_status,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(r.id,r.accident_id,r.reference_type,r.provider_name||null,r.reference_number,r.verification_status,r.notes||null,r.created_at);
  }

  addHandoff(h:AccidentHandoff): void {
    getDatabase().prepare(`
      INSERT INTO accident_handoffs (id,accident_id,handoff_type,target_reference_id,status,notes,created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(h.id,h.accident_id,h.handoff_type,h.target_reference_id,h.status,h.notes||null,h.created_at);
  }

  addAddendum(a:AccidentAddendum): void {
    getDatabase().prepare(`
      INSERT INTO accident_addenda (id,accident_id,author_user_id,addendum_type,text,created_at)
      VALUES (?,?,?,?,?,?)
    `).run(a.id,a.accident_id,a.author_user_id,a.addendum_type,a.text,a.created_at);
  }

  recordStatus(id:string,accidentId:string,from:string|null,to:string,actorId:string,reason:string|null,occurredAt:string): void {
    getDatabase().prepare(`
      INSERT INTO accident_status_history (id,accident_id,from_status,to_status,actor_id,reason,occurred_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(id,accidentId,from,to,actorId,reason,occurredAt);
  }

  getAggregate(userId:string,id:string): AccidentAggregate | null {
    const incident=this.getIncident(userId,id);
    if(!incident) return null;
    const db=getDatabase();
    return {
      incident,
      participants:(db.prepare('SELECT * FROM accident_participants WHERE accident_id=? ORDER BY created_at').all(id) as any[]).map(r=>({...r,participant_type:r.participant_type as AccidentParticipantType})),
      witnesses:db.prepare('SELECT * FROM accident_witnesses WHERE accident_id=? ORDER BY created_at').all(id) as any[],
      damage_observations:db.prepare('SELECT * FROM accident_damage_observations WHERE accident_id=? ORDER BY created_at').all(id) as any[],
      evidence:db.prepare('SELECT * FROM accident_evidence WHERE accident_id=? ORDER BY created_at').all(id) as any[],
      external_references:(db.prepare('SELECT * FROM accident_external_references WHERE accident_id=? ORDER BY created_at').all(id) as any[]).map(r=>({...r,reference_type:r.reference_type as AccidentReferenceType,verification_status:r.verification_status as AccidentReferenceVerificationStatus})),
      handoffs:db.prepare('SELECT * FROM accident_handoffs WHERE accident_id=? ORDER BY created_at').all(id) as any[],
      addenda:db.prepare('SELECT * FROM accident_addenda WHERE accident_id=? ORDER BY created_at').all(id) as any[],
    };
  }
}

export const accidentRepository=new AccidentRepository();
