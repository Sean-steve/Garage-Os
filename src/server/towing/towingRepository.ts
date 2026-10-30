/**
 * Canonical Towing & Recovery Data Access Repository (GAR-015)
 * Sprint 13 — Mobility Safety / Recovery Operations
 */

import { getDatabase } from '../database/connection';
import {
  TowRequestEntity,
  TowPickupLocationEntity,
  TowDestinationEntity,
  TowDestinationRevisionEntity,
  RecoveryUnitEntity,
  RecoveryUnitEquipmentEntity,
  RecoveryUnitVehicleClassSupportEntity,
  TowCapabilityProfileEntity,
  TowProviderOfferEntity,
  TowAssignmentEntity,
  TowPickupInspectionEntity,
  TowPickupEvidenceEntity,
  TowCustodyEventEntity,
  TowDeliveryConfirmationEntity,
  TowDeliveryEvidenceEntity,
  TowCancellationEntity,
  TowAssignmentFailureEntity,
  TowActivityEntity,
  FullTowAggregate,
  TowRequestStatus,
  TowOfferStatus,
  TowAssignmentStatus,
  RecoveryUnitStatus,
  TowVehicleClass,
} from './types';

export class TowingRepository {
  // -------------------------------------------------------------------------
  // 1. Tow Requests
  // -------------------------------------------------------------------------

  getNextTowSequenceNumber(): string {
    const db = getDatabase();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countRow = db.prepare('SELECT COUNT(*) as count FROM tow_requests').get() as { count: number };
    const seq = ((countRow?.count || 0) + 1).toString().padStart(4, '0');
    return `TOW-${dateStr}-${seq}`;
  }

  createTowRequest(req: TowRequestEntity): TowRequestEntity {
    req.sequence_number = req.sequence_number || req.request_number;
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_requests (
        id, request_number, vehicle_id, requesting_user_id, organization_id,
        source_type, source_reference_id, status, tow_reason, recovery_type,
        vehicle_mobility_state, vehicle_condition_state, required_capability_profile_id,
        preferred_provider_id, assigned_provider_id, active_assignment_id,
        related_issue_id, special_instructions, requested_at, assigned_at,
        completed_at, cancelled_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      );
    `);
    stmt.run(
      req.id,
      req.request_number,
      req.vehicle_id,
      req.requesting_user_id,
      req.organization_id || null,
      req.source_type,
      req.source_reference_id || null,
      req.status,
      req.tow_reason,
      req.recovery_type,
      req.vehicle_mobility_state,
      req.vehicle_condition_state,
      req.required_capability_profile_id || null,
      req.preferred_provider_id || null,
      req.assigned_provider_id || null,
      req.active_assignment_id || null,
      req.related_issue_id || null,
      req.special_instructions || null,
      req.requested_at,
      req.assigned_at || null,
      req.completed_at || null,
      req.cancelled_at || null,
      req.created_at,
      req.updated_at
    );
    return req;
  }

  getTowRequestById(id: string): TowRequestEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM tow_requests WHERE id = ?').get(id) as unknown as TowRequestEntity | undefined;
    if (!row) return null;
    row.sequence_number = (row as any).sequence_number || row.request_number;
    row.created_from_roadside_incident_id =
      (row as any).created_from_roadside_incident_id ||
      (row.source_type === 'ROADSIDE_INCIDENT' ? row.source_reference_id : null) ||
      null;
    return row;
  }

  getTowRequestByRequestNumber(reqNo: string): TowRequestEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM tow_requests WHERE request_number = ?').get(reqNo) as unknown as TowRequestEntity | undefined;
    if (!row) return null;
    row.sequence_number = (row as any).sequence_number || row.request_number;
    row.created_from_roadside_incident_id =
      (row as any).created_from_roadside_incident_id ||
      (row.source_type === 'ROADSIDE_INCIDENT' ? row.source_reference_id : null) ||
      null;
    return row;
  }

  getTowRequestBySource(sourceType: string, sourceReferenceId: string): TowRequestEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM tow_requests WHERE source_type = ? AND source_reference_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(sourceType, sourceReferenceId) as unknown as TowRequestEntity | undefined;
    if (!row) return null;
    row.sequence_number = (row as any).sequence_number || row.request_number;
    row.created_from_roadside_incident_id =
      (row as any).created_from_roadside_incident_id ||
      (row.source_type === 'ROADSIDE_INCIDENT' ? row.source_reference_id : null) ||
      null;
    return row;
  }

  updateTowRequest(id: string, updates: Partial<TowRequestEntity>): void {
    const db = getDatabase();
    const keys = Object.keys(updates).filter((k) => k !== 'id');
    if (keys.length === 0) return;

    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (updates as Record<string, unknown>)[k]);
    values.push(id);

    db.prepare(`UPDATE tow_requests SET ${setClauses} WHERE id = ?`).run(...(values as any[]));
  }

  listTowRequests(filters?: {
    vehicle_id?: string;
    requesting_user_id?: string;
    organization_id?: string;
    status?: TowRequestStatus;
    assigned_provider_id?: string;
  }): TowRequestEntity[] {
    const db = getDatabase();
    let query = 'SELECT * FROM tow_requests WHERE 1=1';
    const params: any[] = [];

    if (filters?.vehicle_id) {
      query += ' AND vehicle_id = ?';
      params.push(filters.vehicle_id);
    }
    if (filters?.requesting_user_id) {
      query += ' AND requesting_user_id = ?';
      params.push(filters.requesting_user_id);
    }
    if (filters?.organization_id) {
      query += ' AND organization_id = ?';
      params.push(filters.organization_id);
    }
    if (filters?.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.assigned_provider_id) {
      query += ' AND assigned_provider_id = ?';
      params.push(filters.assigned_provider_id);
    }

    query += ' ORDER BY created_at DESC';
    return db.prepare(query).all(...params) as unknown as TowRequestEntity[];
  }

  // -------------------------------------------------------------------------
  // 2. Pickup Location
  // -------------------------------------------------------------------------

  createPickupLocation(loc: TowPickupLocationEntity): TowPickupLocationEntity {
    loc.access_instructions = loc.access_instructions || loc.access_notes || null;
    loc.access_notes = loc.access_notes || loc.access_instructions || null;
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_pickup_locations (
        id, tow_request_id, latitude, longitude, accuracy_meters,
        address_summary, road_name, landmark, access_notes,
        source_type, captured_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      loc.id,
      loc.tow_request_id,
      loc.latitude,
      loc.longitude,
      loc.accuracy_meters || null,
      loc.address_summary,
      loc.road_name || null,
      loc.landmark || null,
      loc.access_notes || null,
      loc.source_type,
      loc.captured_at,
      loc.created_at
    );
    return loc;
  }

  getPickupLocationByRequestId(requestId: string): TowPickupLocationEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM tow_pickup_locations WHERE tow_request_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(requestId) as unknown as TowPickupLocationEntity | undefined;
    if (!row) return null;
    row.access_instructions = row.access_instructions || row.access_notes || null;
    return row;
  }

  // -------------------------------------------------------------------------
  // 3. Destination & Revisions
  // -------------------------------------------------------------------------

  createDestination(dest: TowDestinationEntity): TowDestinationEntity {
    dest.revision_number = dest.revision_number ?? 1;
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_destinations (
        id, tow_request_id, destination_type, provider_id, branch_id,
        location_reference_id, address_summary, latitude, longitude,
        contact_name, contact_phone, instructions, revision_number, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      dest.id,
      dest.tow_request_id,
      dest.destination_type,
      dest.provider_id || null,
      dest.branch_id || null,
      dest.location_reference_id || null,
      dest.address_summary,
      dest.latitude || null,
      dest.longitude || null,
      dest.contact_name || null,
      dest.contact_phone || null,
      dest.instructions || null,
      dest.revision_number,
      dest.created_at,
      dest.updated_at
    );
    return dest;
  }

  getDestinationByRequestId(requestId: string): TowDestinationEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM tow_destinations WHERE tow_request_id = ? ORDER BY revision_number DESC, created_at DESC LIMIT 1')
      .get(requestId) as unknown as TowDestinationEntity | undefined;
    if (!row) return null;
    row.revision_number = (row as any).revision_number || 1;
    return row;
  }

  updateDestination(id: string, updates: Partial<TowDestinationEntity>): void {
    const db = getDatabase();
    const keys = Object.keys(updates).filter((k) => k !== 'id');
    if (keys.length === 0) return;

    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (updates as Record<string, unknown>)[k]);
    values.push(id);

    db.prepare(`UPDATE tow_destinations SET ${setClauses} WHERE id = ?`).run(...(values as any[]));
  }

  createDestinationRevision(rev: TowDestinationRevisionEntity): TowDestinationRevisionEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_destination_revisions (
        id, tow_request_id, previous_destination_id, new_destination_id,
        changed_by_user_id, changed_by_role, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      rev.id,
      rev.tow_request_id,
      rev.previous_destination_id,
      rev.new_destination_id,
      rev.changed_by_user_id,
      rev.changed_by_role,
      rev.reason,
      rev.created_at
    );
    return rev;
  }

  listDestinationRevisions(destIdOrRequestId: string): TowDestinationRevisionEntity[] {
    const db = getDatabase();
    return db
      .prepare(`
        SELECT 
          r.*,
          prev.address_summary as prior_address_summary,
          r.reason as change_reason
        FROM tow_destination_revisions r
        LEFT JOIN tow_destinations prev ON r.previous_destination_id = prev.id
        WHERE r.tow_request_id = ? OR r.previous_destination_id = ? OR r.new_destination_id = ?
        ORDER BY r.created_at ASC
      `)
      .all(destIdOrRequestId, destIdOrRequestId, destIdOrRequestId) as unknown as TowDestinationRevisionEntity[];
  }

  // -------------------------------------------------------------------------
  // 4. Recovery Units & Equipment & Classes
  // -------------------------------------------------------------------------

  createRecoveryUnit(unit: RecoveryUnitEntity): RecoveryUnitEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO recovery_units (
        id, provider_id, unit_type, registration_identifier, fleet_identifier,
        status, max_vehicle_weight_kg, max_vehicle_length_mm, max_vehicle_width_mm,
        equipment_profile_id, base_location_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      unit.id,
      unit.provider_id,
      unit.unit_type,
      unit.registration_identifier,
      unit.fleet_identifier || null,
      unit.status,
      unit.max_vehicle_weight_kg || null,
      unit.max_vehicle_length_mm || null,
      unit.max_vehicle_width_mm || null,
      unit.equipment_profile_id || null,
      unit.base_location_id || null,
      unit.created_at,
      unit.updated_at
    );
    return unit;
  }

  getRecoveryUnitById(id: string): RecoveryUnitEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM recovery_units WHERE id = ?').get(id) as unknown as RecoveryUnitEntity | undefined;
    return row || null;
  }

  listRecoveryUnitsByProvider(providerId: string): RecoveryUnitEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM recovery_units WHERE provider_id = ? ORDER BY created_at ASC')
      .all(providerId) as unknown as RecoveryUnitEntity[];
  }

  listAllRecoveryUnits(): RecoveryUnitEntity[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM recovery_units ORDER BY created_at ASC').all() as unknown as RecoveryUnitEntity[];
  }

  updateRecoveryUnit(id: string, updates: Partial<RecoveryUnitEntity>): void {
    const db = getDatabase();
    const keys = Object.keys(updates).filter((k) => k !== 'id');
    if (keys.length === 0) return;

    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (updates as Record<string, unknown>)[k]);
    values.push(id);

    db.prepare(`UPDATE recovery_units SET ${setClauses} WHERE id = ?`).run(...(values as any[]));
  }

  createUnitEquipment(eq: RecoveryUnitEquipmentEntity): RecoveryUnitEquipmentEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO recovery_unit_equipment (
        id, recovery_unit_id, equipment_type, rating_capacity_kg, is_operational, created_at
      ) VALUES (?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      eq.id,
      eq.recovery_unit_id,
      eq.equipment_type,
      eq.rating_capacity_kg || null,
      eq.is_operational ? 1 : 0,
      eq.created_at
    );
    return eq;
  }

  createRecoveryUnitEquipment(eq: RecoveryUnitEquipmentEntity): RecoveryUnitEquipmentEntity {
    return this.createUnitEquipment(eq);
  }

  listUnitEquipment(unitId: string): RecoveryUnitEquipmentEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM recovery_unit_equipment WHERE recovery_unit_id = ?')
      .all(unitId) as unknown as RecoveryUnitEquipmentEntity[];
  }

  createUnitClassSupport(cs: RecoveryUnitVehicleClassSupportEntity): RecoveryUnitVehicleClassSupportEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO recovery_unit_vehicle_class_support (
        id, recovery_unit_id, vehicle_class
      ) VALUES (?, ?, ?);
    `);
    stmt.run(cs.id, cs.recovery_unit_id, cs.vehicle_class);
    return cs;
  }

  listUnitSupportedClasses(unitId: string): TowVehicleClass[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT vehicle_class FROM recovery_unit_vehicle_class_support WHERE recovery_unit_id = ?')
      .all(unitId) as Array<{ vehicle_class: TowVehicleClass }>;
    return rows.map((r) => r.vehicle_class);
  }

  // -------------------------------------------------------------------------
  // 5. Capability Profiles
  // -------------------------------------------------------------------------

  createCapabilityProfile(profile: TowCapabilityProfileEntity): TowCapabilityProfileEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_capability_profiles (
        id, name, supported_classes_json, supported_mobility_states_json,
        supported_recovery_types_json, required_equipment_json, max_weight_kg, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      profile.id,
      profile.name,
      profile.supported_classes_json,
      profile.supported_mobility_states_json,
      profile.supported_recovery_types_json,
      profile.required_equipment_json || null,
      profile.max_weight_kg || null,
      profile.created_at
    );
    return profile;
  }

  getCapabilityProfileById(id: string): TowCapabilityProfileEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM tow_capability_profiles WHERE id = ?').get(id) as unknown as TowCapabilityProfileEntity | undefined;
    return row || null;
  }

  // -------------------------------------------------------------------------
  // 6. Tow Provider Offers
  // -------------------------------------------------------------------------

  createOffer(offer: TowProviderOfferEntity): TowProviderOfferEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_provider_offers (
        id, tow_request_id, provider_id, recovery_unit_id, status,
        offered_at, expires_at, distance_km, compatibility_status,
        estimated_price_minor, currency, responded_at, decline_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      offer.id,
      offer.tow_request_id,
      offer.provider_id,
      offer.recovery_unit_id || null,
      offer.status,
      offer.offered_at,
      offer.expires_at,
      offer.distance_km || null,
      offer.compatibility_status,
      offer.estimated_price_minor || null,
      offer.currency,
      offer.responded_at || null,
      offer.decline_reason || null,
      offer.created_at
    );
    return offer;
  }

  getOfferById(id: string): TowProviderOfferEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM tow_provider_offers WHERE id = ?').get(id) as unknown as TowProviderOfferEntity | undefined;
    return row || null;
  }

  listOffersByRequestId(requestId: string): TowProviderOfferEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM tow_provider_offers WHERE tow_request_id = ? ORDER BY created_at ASC')
      .all(requestId) as unknown as TowProviderOfferEntity[];
  }

  listOffersForRequest(requestId: string): TowProviderOfferEntity[] {
    return this.listOffersByRequestId(requestId);
  }

  listOffersByProviderId(providerId: string, status?: TowOfferStatus): TowProviderOfferEntity[] {
    const db = getDatabase();
    if (status) {
      return db
        .prepare('SELECT * FROM tow_provider_offers WHERE provider_id = ? AND status = ? ORDER BY created_at DESC')
        .all(providerId, status) as unknown as TowProviderOfferEntity[];
    }
    return db
      .prepare('SELECT * FROM tow_provider_offers WHERE provider_id = ? ORDER BY created_at DESC')
      .all(providerId) as unknown as TowProviderOfferEntity[];
  }

  updateOffer(id: string, updates: Partial<TowProviderOfferEntity>): void {
    const db = getDatabase();
    const keys = Object.keys(updates).filter((k) => k !== 'id');
    if (keys.length === 0) return;

    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (updates as Record<string, unknown>)[k]);
    values.push(id);

    db.prepare(`UPDATE tow_provider_offers SET ${setClauses} WHERE id = ?`).run(...(values as any[]));
  }

  cancelOtherPendingOffers(requestId: string, acceptedOfferId: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE tow_provider_offers
      SET status = 'CANCELLED'
      WHERE tow_request_id = ? AND id != ? AND status IN ('OFFERED', 'VIEWED')
    `).run(requestId, acceptedOfferId);
  }

  // -------------------------------------------------------------------------
  // 7. Tow Assignments
  // -------------------------------------------------------------------------

  createAssignment(assignment: TowAssignmentEntity): TowAssignmentEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_assignments (
        id, tow_request_id, provider_id, recovery_unit_id, operator_staff_id,
        operator_name, operator_phone, status, assigned_at, accepted_at,
        en_route_at, arrived_pickup_at, loading_started_at, loaded_at,
        transit_started_at, arrived_destination_at, unloading_started_at,
        unloaded_at, delivery_confirmed_at, completed_at, waiting_started_at,
        waiting_ended_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      );
    `);
    stmt.run(
      assignment.id,
      assignment.tow_request_id,
      assignment.provider_id,
      assignment.recovery_unit_id,
      assignment.operator_staff_id || null,
      assignment.operator_name || null,
      assignment.operator_phone || null,
      assignment.status,
      assignment.assigned_at,
      assignment.accepted_at,
      assignment.en_route_at || null,
      assignment.arrived_pickup_at || null,
      assignment.loading_started_at || null,
      assignment.loaded_at || null,
      assignment.transit_started_at || null,
      assignment.arrived_destination_at || null,
      assignment.unloading_started_at || null,
      assignment.unloaded_at || null,
      assignment.delivery_confirmed_at || null,
      assignment.completed_at || null,
      assignment.waiting_started_at || null,
      assignment.waiting_ended_at || null,
      assignment.created_at,
      assignment.updated_at
    );
    return assignment;
  }

  getAssignmentById(id: string): TowAssignmentEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM tow_assignments WHERE id = ?').get(id) as unknown as TowAssignmentEntity | undefined;
    return row || null;
  }

  getActiveAssignmentForRequest(requestId: string): TowAssignmentEntity | null {
    const db = getDatabase();
    const row = db
      .prepare(`
        SELECT * FROM tow_assignments
        WHERE tow_request_id = ?
          AND status IN ('ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'LOADING', 'VEHICLE_LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING')
        LIMIT 1
      `)
      .get(requestId) as unknown as TowAssignmentEntity | undefined;
    return row || null;
  }

  getActiveAssignmentForUnit(unitId: string): TowAssignmentEntity | null {
    const db = getDatabase();
    const row = db
      .prepare(`
        SELECT * FROM tow_assignments
        WHERE recovery_unit_id = ?
          AND status IN ('ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'LOADING', 'VEHICLE_LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING')
        LIMIT 1
      `)
      .get(unitId) as unknown as TowAssignmentEntity | undefined;
    return row || null;
  }

  updateAssignment(id: string, updates: Partial<TowAssignmentEntity>): void {
    const db = getDatabase();
    const keys = Object.keys(updates).filter((k) => k !== 'id');
    if (keys.length === 0) return;

    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (updates as Record<string, unknown>)[k]);
    values.push(id);

    db.prepare(`UPDATE tow_assignments SET ${setClauses} WHERE id = ?`).run(...(values as any[]));
  }

  // -------------------------------------------------------------------------
  // 8. Pickup Inspections & Evidence
  // -------------------------------------------------------------------------

  createInspection(insp: TowPickupInspectionEntity): TowPickupInspectionEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_pickup_inspections (
        id, tow_assignment_id, performed_at, performed_by_user_id,
        vehicle_condition_summary, visible_damage_json, mobility_state_confirmed,
        odometer_reading_km, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      insp.id,
      insp.tow_assignment_id,
      insp.performed_at,
      insp.performed_by_user_id,
      insp.vehicle_condition_summary,
      insp.visible_damage_json || null,
      insp.mobility_state_confirmed,
      insp.odometer_reading_km || null,
      insp.notes || null,
      insp.created_at
    );
    return insp;
  }

  getInspectionByAssignmentId(assignmentId: string): TowPickupInspectionEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM tow_pickup_inspections WHERE tow_assignment_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(assignmentId) as unknown as TowPickupInspectionEntity | undefined;
    return row || null;
  }

  createPickupEvidence(ev: TowPickupEvidenceEntity): TowPickupEvidenceEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_pickup_evidence (
        id, inspection_id, storage_object_id, evidence_type, file_url, caption, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      ev.id,
      ev.inspection_id,
      ev.storage_object_id || null,
      ev.evidence_type,
      ev.file_url,
      ev.caption || null,
      ev.created_at
    );
    return ev;
  }

  listPickupEvidence(inspectionId: string): TowPickupEvidenceEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM tow_pickup_evidence WHERE inspection_id = ? ORDER BY created_at ASC')
      .all(inspectionId) as unknown as TowPickupEvidenceEntity[];
  }

  // -------------------------------------------------------------------------
  // 9. Custody Events
  // -------------------------------------------------------------------------

  createCustodyEvent(ev: TowCustodyEventEntity): TowCustodyEventEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_custody_events (
        id, tow_assignment_id, event_type, from_party_type, from_party_id,
        from_party_name, to_party_type, to_party_id, to_party_name,
        occurred_at, location_summary, evidence_reference_ids_json,
        acknowledgement_status, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      ev.id,
      ev.tow_assignment_id,
      ev.event_type,
      ev.from_party_type,
      ev.from_party_id || null,
      ev.from_party_name || null,
      ev.to_party_type,
      ev.to_party_id || null,
      ev.to_party_name || null,
      ev.occurred_at,
      ev.location_summary || null,
      ev.evidence_reference_ids_json || null,
      ev.acknowledgement_status,
      ev.notes || null,
      ev.created_at
    );
    return ev;
  }

  listCustodyEventsByAssignmentId(assignmentId: string): TowCustodyEventEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM tow_custody_events WHERE tow_assignment_id = ? ORDER BY occurred_at ASC')
      .all(assignmentId) as unknown as TowCustodyEventEntity[];
  }

  listCustodyEvents(assignmentId: string): TowCustodyEventEntity[] {
    return this.listCustodyEventsByAssignmentId(assignmentId);
  }

  // -------------------------------------------------------------------------
  // 10. Delivery Confirmations & Evidence
  // -------------------------------------------------------------------------

  createDeliveryConfirmation(conf: TowDeliveryConfirmationEntity): TowDeliveryConfirmationEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_delivery_confirmations (
        id, tow_assignment_id, delivered_at, recipient_type, recipient_id,
        recipient_name, recipient_signature_reference, destination_provider_id,
        destination_branch_id, condition_summary, acknowledgement_method,
        service_case_handoff_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      conf.id,
      conf.tow_assignment_id,
      conf.delivered_at,
      conf.recipient_type,
      conf.recipient_id || null,
      conf.recipient_name,
      conf.recipient_signature_reference || null,
      conf.destination_provider_id || null,
      conf.destination_branch_id || null,
      conf.condition_summary,
      conf.acknowledgement_method,
      conf.service_case_handoff_id || null,
      conf.created_at
    );
    return conf;
  }

  getDeliveryConfirmationByAssignmentId(assignmentId: string): TowDeliveryConfirmationEntity | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM tow_delivery_confirmations WHERE tow_assignment_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(assignmentId) as unknown as TowDeliveryConfirmationEntity | undefined;
    return row || null;
  }

  createDeliveryEvidence(ev: TowDeliveryEvidenceEntity): TowDeliveryEvidenceEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_delivery_evidence (
        id, delivery_confirmation_id, storage_object_id, evidence_type, file_url, caption, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      ev.id,
      ev.delivery_confirmation_id,
      ev.storage_object_id || null,
      ev.evidence_type,
      ev.file_url,
      ev.caption || null,
      ev.created_at
    );
    return ev;
  }

  listDeliveryEvidence(confirmationId: string): TowDeliveryEvidenceEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM tow_delivery_evidence WHERE delivery_confirmation_id = ? ORDER BY created_at ASC')
      .all(confirmationId) as unknown as TowDeliveryEvidenceEntity[];
  }

  // -------------------------------------------------------------------------
  // 11. Cancellations & Failures
  // -------------------------------------------------------------------------

  createCancellation(canc: TowCancellationEntity): TowCancellationEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_cancellations (
        id, tow_request_id, cancelled_by_user_id, cancelled_by_role, reason,
        assignment_state_at_cancellation, callout_fee_incurred_minor, currency, notes, cancelled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      canc.id,
      canc.tow_request_id,
      canc.cancelled_by_user_id,
      canc.cancelled_by_role,
      canc.reason,
      canc.assignment_state_at_cancellation || null,
      canc.callout_fee_incurred_minor,
      canc.currency,
      canc.notes || null,
      canc.cancelled_at
    );
    return canc;
  }

  listCancellationsByRequestId(requestId: string): TowCancellationEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM tow_cancellations WHERE tow_request_id = ? ORDER BY cancelled_at ASC')
      .all(requestId) as unknown as TowCancellationEntity[];
  }

  createAssignmentFailure(fail: TowAssignmentFailureEntity): TowAssignmentFailureEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_assignment_failures (
        id, assignment_id, failure_type, description, occurred_at, reported_by_user_id, recoverable, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      fail.id,
      fail.assignment_id,
      fail.failure_type,
      fail.description,
      fail.occurred_at,
      fail.reported_by_user_id,
      fail.recoverable ? 1 : 0,
      fail.created_at
    );
    return fail;
  }

  listAssignmentFailures(assignmentId: string): TowAssignmentFailureEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM tow_assignment_failures WHERE assignment_id = ? ORDER BY occurred_at ASC')
      .all(assignmentId) as unknown as TowAssignmentFailureEntity[];
  }

  // -------------------------------------------------------------------------
  // 12. Activity Log
  // -------------------------------------------------------------------------

  logActivity(act: TowActivityEntity): TowActivityEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO tow_activity (
        id, tow_request_id, tow_assignment_id, activity_type,
        actor_id, actor_type, actor_name, title, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      act.id,
      act.tow_request_id,
      act.tow_assignment_id || null,
      act.activity_type,
      act.actor_id || null,
      act.actor_type || null,
      act.actor_name || null,
      act.title,
      act.details || null,
      act.created_at
    );
    return act;
  }

  listActivities(requestId: string): TowActivityEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM tow_activity WHERE tow_request_id = ? ORDER BY created_at ASC')
      .all(requestId) as unknown as TowActivityEntity[];
  }

  // -------------------------------------------------------------------------
  // 13. Full Aggregate Assembler
  // -------------------------------------------------------------------------

  getFullTowAggregate(requestId: string): FullTowAggregate | null {
    const request = this.getTowRequestById(requestId);
    if (!request) return null;

    const pickup_location = this.getPickupLocationByRequestId(requestId);
    const destination = this.getDestinationByRequestId(requestId);
    const destination_revisions = this.listDestinationRevisions(requestId);

    // Active assignment
    let active_assignment: (TowAssignmentEntity & { recovery_unit?: RecoveryUnitEntity; provider_name?: string }) | null = null;
    if (request.active_assignment_id) {
      const a = this.getAssignmentById(request.active_assignment_id);
      if (a) {
        const unit = this.getRecoveryUnitById(a.recovery_unit_id);
        const db = getDatabase();
        const pRow = db.prepare('SELECT name FROM service_providers WHERE id = ?').get(a.provider_id) as { name: string } | undefined;
        active_assignment = {
          ...a,
          recovery_unit: unit || undefined,
          provider_name: pRow?.name,
        };
      }
    }
    if (!active_assignment) {
      const db = getDatabase();
      const row = db.prepare('SELECT id FROM tow_assignments WHERE tow_request_id = ? ORDER BY created_at DESC LIMIT 1').get(requestId) as any;
      if (row) {
        const a = this.getAssignmentById(row.id);
        if (a) {
          const unit = this.getRecoveryUnitById(a.recovery_unit_id);
          const pRow = db.prepare('SELECT name FROM service_providers WHERE id = ?').get(a.provider_id) as { name: string } | undefined;
          active_assignment = {
            ...a,
            recovery_unit: unit || undefined,
            provider_name: pRow?.name,
          };
        }
      }
    }

    // Offers
    const rawOffers = this.listOffersByRequestId(requestId);
    const db = getDatabase();
    const offers = rawOffers.map((o) => {
      const pRow = db.prepare('SELECT name FROM service_providers WHERE id = ?').get(o.provider_id) as { name: string } | undefined;
      return {
        ...o,
        provider_name: pRow?.name,
      };
    });

    // Pickup Inspection
    let pickup_inspection: (TowPickupInspectionEntity & { evidence: TowPickupEvidenceEntity[] }) | null = null;
    let custody_events: TowCustodyEventEntity[] = [];
    let delivery_confirmation: (TowDeliveryConfirmationEntity & { evidence: TowDeliveryEvidenceEntity[] }) | null = null;
    let assignment_failures: TowAssignmentFailureEntity[] = [];

    if (active_assignment) {
      const insp = this.getInspectionByAssignmentId(active_assignment.id);
      if (insp) {
        const ev = this.listPickupEvidence(insp.id);
        pickup_inspection = { ...insp, evidence: ev };
      }
      custody_events = this.listCustodyEventsByAssignmentId(active_assignment.id);
      const delConf = this.getDeliveryConfirmationByAssignmentId(active_assignment.id);
      if (delConf) {
        const ev = this.listDeliveryEvidence(delConf.id);
        delivery_confirmation = { ...delConf, evidence: ev };
      }
      assignment_failures = this.listAssignmentFailures(active_assignment.id);
    }

    const cancellations = this.listCancellationsByRequestId(requestId);
    const activity_log = this.listActivities(requestId);

    return {
      request,
      pickup_location,
      destination,
      destination_revisions,
      active_assignment,
      assignment: active_assignment,
      offers,
      pickup_inspection,
      custody_events,
      delivery_confirmation,
      cancellations,
      assignment_failures,
      activity_log,
    };
  }
}

export const towingRepository = new TowingRepository();
