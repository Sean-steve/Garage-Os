/**
 * Canonical Component & Tyre Repository (GAR-010 §6-§56)
 *
 * Implements persistent SQLite storage for physical vehicle components, parts catalog,
 * warranties, evidence, tyres, position assignments, rotations, inspections, and modifications.
 */

import { getDatabase } from '../database/connection';
import { getCurrentUtcIsoString } from '../domain/time';
import {
  ComponentCategory,
  ComponentClassification,
  ComponentDefinitionEntity,
  ComponentEvidenceLinkEntity,
  ComponentStatus,
  ComponentWarrantyEntity,
  ModificationStatus,
  PartsCatalogItemEntity,
  PartClassification,
  PartCondition,
  PartProvenance,
  PartVerificationStatus,
  RemovalReason,
  TyreConditionRating,
  TyreInspectionEntity,
  TyrePosition,
  TyrePositionAssignmentEntity,
  TyreRotationEntity,
  TyreRotationMoveEntity,
  VehicleComponentEntity,
  VehicleComponentEventEntity,
  VehicleComponentReplacementEntity,
  VehicleConfigurationOverrideEntity,
  VehicleModificationEntity,
  VehicleTyreEntity,
  VehicleTyreSetEntity,
  WarrantyStatus,
  WarrantyType,
} from './types';

export class ComponentRepository {
  // ==================== COMPONENT DEFINITIONS & CATALOG ====================

  listComponentDefinitions(): ComponentDefinitionEntity[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM component_definitions ORDER BY category, name;').all() as any[];
    return rows.map((r) => ({
      ...r,
      position_sensitive: Boolean(r.position_sensitive),
      replaceable: Boolean(r.replaceable),
      serviceable: Boolean(r.serviceable),
      serializable: Boolean(r.serializable),
    }));
  }

  findComponentDefinitionByCode(code: string): ComponentDefinitionEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM component_definitions WHERE code = ?;').get(code) as any;
    if (!row) return null;
    return {
      ...row,
      position_sensitive: Boolean(row.position_sensitive),
      replaceable: Boolean(row.replaceable),
      serviceable: Boolean(row.serviceable),
      serializable: Boolean(row.serializable),
    };
  }

  listPartsCatalog(query?: string): PartsCatalogItemEntity[] {
    const db = getDatabase();
    if (query && query.trim()) {
      const q = `%${query.trim()}%`;
      const rows = db.prepare(`
        SELECT * FROM parts_catalog_items
        WHERE name LIKE ? OR brand LIKE ? OR part_number LIKE ? OR oem_number LIKE ?
        ORDER BY brand, name LIMIT 50;
      `).all(q, q, q, q) as unknown as PartsCatalogItemEntity[];
      return rows;
    }
    const rows = db.prepare('SELECT * FROM parts_catalog_items ORDER BY brand, name LIMIT 100;').all() as unknown as PartsCatalogItemEntity[];
    return rows;
  }

  findPartCatalogItemById(id: string): PartsCatalogItemEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM parts_catalog_items WHERE id = ?;').get(id) as unknown as PartsCatalogItemEntity | undefined;
    return row || null;
  }

  // ==================== VEHICLE COMPONENTS ====================

  createComponent(component: VehicleComponentEntity): VehicleComponentEntity {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO vehicle_components (
        id, vehicle_id, component_definition_id, part_id, custom_name, category,
        subcategory, classification, brand, model, part_number, oem_number, serial_number,
        position, status, installed_at, installed_odometer_km, installed_odometer_unit,
        installation_source, installation_provider_id, installation_provider_name,
        installation_work_order_id, verification_status, removed_at, removed_odometer_km,
        removal_reason, maintenance_completion_id, issue_intervention_id, vehicle_expense_id,
        notes, is_current, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      );
    `);

    stmt.run(
      component.id,
      component.vehicle_id,
      component.component_definition_id || null,
      component.part_id || null,
      component.custom_name,
      component.category,
      component.subcategory || null,
      component.classification,
      component.brand || null,
      component.model || null,
      component.part_number || null,
      component.oem_number || null,
      component.serial_number || null,
      component.position || null,
      component.status,
      component.installed_at,
      component.installed_odometer_km !== undefined ? component.installed_odometer_km : null,
      component.installed_odometer_unit || null,
      component.installation_source,
      component.installation_provider_id || null,
      component.installation_provider_name || null,
      component.installation_work_order_id || null,
      component.verification_status,
      component.removed_at || null,
      component.removed_odometer_km !== undefined ? component.removed_odometer_km : null,
      component.removal_reason || null,
      component.maintenance_completion_id || null,
      component.issue_intervention_id || null,
      component.vehicle_expense_id || null,
      component.notes || null,
      component.is_current ? 1 : 0,
      component.created_at,
      component.updated_at
    );

    return component;
  }

  findComponentById(id: string): VehicleComponentEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM vehicle_components WHERE id = ?;').get(id) as any;
    if (!row) return null;
    return {
      ...row,
      is_current: Boolean(row.is_current),
    };
  }

  findComponentsByVehicleId(
    vehicleId: string,
    filters?: {
      isCurrentOnly?: boolean;
      category?: ComponentCategory;
      status?: ComponentStatus;
    }
  ): VehicleComponentEntity[] {
    const db = getDatabase();
    const conditions: string[] = ['vehicle_id = ?'];
    const params: any[] = [vehicleId];

    if (filters?.isCurrentOnly === true) {
      conditions.push('is_current = 1');
    }
    if (filters?.category) {
      conditions.push('category = ?');
      params.push(filters.category);
    }
    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    const sql = `
      SELECT * FROM vehicle_components
      WHERE ${conditions.join(' AND ')}
      ORDER BY is_current DESC, installed_at DESC;
    `;
    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      ...r,
      is_current: Boolean(r.is_current),
    }));
  }

  markComponentRemoved(
    componentId: string,
    removedAt: string,
    removedOdometerKm: number | null,
    reason: RemovalReason,
    status: ComponentStatus = ComponentStatus.REMOVED,
    notes?: string
  ): void {
    const db = getDatabase();
    const now = getCurrentUtcIsoString();
    db.prepare(`
      UPDATE vehicle_components
      SET status = ?,
          is_current = 0,
          removed_at = ?,
          removed_odometer_km = ?,
          removal_reason = ?,
          notes = COALESCE(?, notes),
          updated_at = ?
      WHERE id = ?;
    `).run(status, removedAt, removedOdometerKm, reason, notes || null, now, componentId);
  }

  // ==================== REPLACEMENTS & EVENTS ====================

  createComponentReplacement(replacement: VehicleComponentReplacementEntity): VehicleComponentReplacementEntity {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_component_replacements (
        id, vehicle_id, old_component_id, new_component_id, replaced_at, odometer_km, reason, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      replacement.id,
      replacement.vehicle_id,
      replacement.old_component_id,
      replacement.new_component_id,
      replacement.replaced_at,
      replacement.odometer_km !== undefined ? replacement.odometer_km : null,
      replacement.reason,
      replacement.notes || null,
      replacement.created_at
    );
    return replacement;
  }

  findReplacementsByVehicleId(vehicleId: string): VehicleComponentReplacementEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM vehicle_component_replacements
      WHERE vehicle_id = ?
      ORDER BY replaced_at DESC;
    `).all(vehicleId) as unknown as VehicleComponentReplacementEntity[];
    return rows;
  }

  createComponentEvent(event: VehicleComponentEventEntity): VehicleComponentEventEntity {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_component_events (
        id, vehicle_component_id, vehicle_id, event_type, occurred_at, odometer_km,
        actor_id, actor_type, notes, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      event.id,
      event.vehicle_component_id,
      event.vehicle_id,
      event.event_type,
      event.occurred_at,
      event.odometer_km !== undefined ? event.odometer_km : null,
      event.actor_id,
      event.actor_type,
      event.notes || null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.created_at
    );
    return event;
  }

  findEventsByComponentId(componentId: string): VehicleComponentEventEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM vehicle_component_events
      WHERE vehicle_component_id = ?
      ORDER BY occurred_at DESC;
    `).all(componentId) as any[];

    return rows.map((r) => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
    }));
  }

  // ==================== WARRANTIES & EVIDENCE ====================

  createComponentWarranty(warranty: ComponentWarrantyEntity): ComponentWarrantyEntity {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO component_warranties (
        id, vehicle_component_id, vehicle_id, provider_id, provider_name, seller_id,
        warranty_type, starts_at, expires_at, distance_limit_km, distance_limit_value,
        distance_unit, terms_summary, document_reference, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      warranty.id,
      warranty.vehicle_component_id,
      warranty.vehicle_id,
      warranty.provider_id || null,
      warranty.provider_name || null,
      warranty.seller_id || null,
      warranty.warranty_type,
      warranty.starts_at,
      warranty.expires_at || null,
      warranty.distance_limit_km !== undefined ? warranty.distance_limit_km : null,
      warranty.distance_limit_value !== undefined ? warranty.distance_limit_value : null,
      warranty.distance_unit || null,
      warranty.terms_summary,
      warranty.document_reference || null,
      warranty.status,
      warranty.created_at,
      warranty.updated_at
    );
    return warranty;
  }

  findWarrantiesByVehicleId(vehicleId: string): ComponentWarrantyEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM component_warranties
      WHERE vehicle_id = ?
      ORDER BY starts_at DESC;
    `).all(vehicleId) as unknown as ComponentWarrantyEntity[];
    return rows;
  }

  findWarrantiesByComponentId(componentId: string): ComponentWarrantyEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM component_warranties
      WHERE vehicle_component_id = ?
      ORDER BY starts_at DESC;
    `).all(componentId) as unknown as ComponentWarrantyEntity[];
    return rows;
  }

  createComponentEvidenceLink(link: ComponentEvidenceLinkEntity): ComponentEvidenceLinkEntity {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO component_evidence_links (
        id, vehicle_component_id, vehicle_id, document_id, evidence_type, file_url, caption, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      link.id,
      link.vehicle_component_id,
      link.vehicle_id,
      link.document_id || null,
      link.evidence_type,
      link.file_url,
      link.caption || null,
      link.created_at
    );
    return link;
  }

  // ==================== TYRES & TYRE SETS ====================

  createTyreSet(set: VehicleTyreSetEntity): VehicleTyreSetEntity {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_tyre_sets (id, vehicle_id, name, season_type, installed_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `).run(set.id, set.vehicle_id, set.name, set.season_type, set.installed_at, set.status, set.created_at);
    return set;
  }

  findTyreSetsByVehicleId(vehicleId: string): VehicleTyreSetEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM vehicle_tyre_sets WHERE vehicle_id = ? ORDER BY installed_at DESC;
    `).all(vehicleId) as unknown as VehicleTyreSetEntity[];
    return rows;
  }

  createTyre(tyre: VehicleTyreEntity): VehicleTyreEntity {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_tyres (
        id, vehicle_id, vehicle_component_id, part_id, tyre_set_id, brand, model,
        size_raw, width, aspect_ratio, rim_diameter, construction, load_index,
        speed_rating, manufacture_dot_code, serial_number, status, installed_at,
        installed_odometer_km, removed_at, removed_odometer_km, removal_reason,
        provenance, verification_status, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      );
    `).run(
      tyre.id,
      tyre.vehicle_id,
      tyre.vehicle_component_id || null,
      tyre.part_id || null,
      tyre.tyre_set_id || null,
      tyre.brand,
      tyre.model,
      tyre.size_raw,
      tyre.width,
      tyre.aspect_ratio,
      tyre.rim_diameter,
      tyre.construction,
      tyre.load_index !== undefined ? tyre.load_index : null,
      tyre.speed_rating || null,
      tyre.manufacture_dot_code || null,
      tyre.serial_number || null,
      tyre.status,
      tyre.installed_at,
      tyre.installed_odometer_km !== undefined ? tyre.installed_odometer_km : null,
      tyre.removed_at || null,
      tyre.removed_odometer_km !== undefined ? tyre.removed_odometer_km : null,
      tyre.removal_reason || null,
      tyre.provenance,
      tyre.verification_status,
      tyre.created_at,
      tyre.updated_at
    );
    return tyre;
  }

  findTyreById(id: string): VehicleTyreEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM vehicle_tyres WHERE id = ?;').get(id) as unknown as VehicleTyreEntity | undefined;
    return row || null;
  }

  findTyresByVehicleId(vehicleId: string, status?: ComponentStatus): VehicleTyreEntity[] {
    const db = getDatabase();
    if (status) {
      return db.prepare('SELECT * FROM vehicle_tyres WHERE vehicle_id = ? AND status = ? ORDER BY installed_at DESC;')
        .all(vehicleId, status) as unknown as VehicleTyreEntity[];
    }
    return db.prepare('SELECT * FROM vehicle_tyres WHERE vehicle_id = ? ORDER BY installed_at DESC;')
      .all(vehicleId) as unknown as VehicleTyreEntity[];
  }

  markTyreRemoved(
    tyreId: string,
    removedAt: string,
    removedOdometerKm: number | null,
    reason: RemovalReason,
    status: ComponentStatus = ComponentStatus.REMOVED
  ): void {
    const db = getDatabase();
    const now = getCurrentUtcIsoString();
    db.prepare(`
      UPDATE vehicle_tyres
      SET status = ?,
          removed_at = ?,
          removed_odometer_km = ?,
          removal_reason = ?,
          updated_at = ?
      WHERE id = ?;
    `).run(status, removedAt, removedOdometerKm, reason, now, tyreId);
  }

  // ==================== TYRE POSITIONS & ROTATIONS ====================

  assignTyrePosition(assignment: TyrePositionAssignmentEntity): TyrePositionAssignmentEntity {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO tyre_position_assignments (
        id, vehicle_tyre_id, vehicle_id, position, assigned_at, assigned_odometer_km,
        ended_at, ended_odometer_km, source, is_current, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      assignment.id,
      assignment.vehicle_tyre_id,
      assignment.vehicle_id,
      assignment.position,
      assignment.assigned_at,
      assignment.assigned_odometer_km !== undefined ? assignment.assigned_odometer_km : null,
      assignment.ended_at || null,
      assignment.ended_odometer_km !== undefined ? assignment.ended_odometer_km : null,
      assignment.source,
      assignment.is_current ? 1 : 0,
      assignment.created_at
    );
    return assignment;
  }

  endCurrentTyrePosition(
    vehicleTyreId: string,
    endedAt: string,
    endedOdometerKm: number | null
  ): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE tyre_position_assignments
      SET is_current = 0,
          ended_at = ?,
          ended_odometer_km = ?
      WHERE vehicle_tyre_id = ? AND is_current = 1;
    `).run(endedAt, endedOdometerKm, vehicleTyreId);
  }

  findCurrentTyrePositions(vehicleId: string): TyrePositionAssignmentEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM tyre_position_assignments
      WHERE vehicle_id = ? AND is_current = 1;
    `).all(vehicleId) as any[];
    return rows.map((r) => ({ ...r, is_current: Boolean(r.is_current) }));
  }

  findCurrentPositionByTyreId(vehicleTyreId: string): TyrePositionAssignmentEntity | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM tyre_position_assignments
      WHERE vehicle_tyre_id = ? AND is_current = 1;
    `).get(vehicleTyreId) as any;
    if (!row) return null;
    return { ...row, is_current: Boolean(row.is_current) };
  }

  findCurrentTyreAtPosition(vehicleId: string, position: TyrePosition): TyrePositionAssignmentEntity | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM tyre_position_assignments
      WHERE vehicle_id = ? AND position = ? AND is_current = 1;
    `).get(vehicleId, position) as any;
    if (!row) return null;
    return { ...row, is_current: Boolean(row.is_current) };
  }

  findPositionHistoryByTyreId(vehicleTyreId: string): TyrePositionAssignmentEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM tyre_position_assignments
      WHERE vehicle_tyre_id = ?
      ORDER BY assigned_at DESC;
    `).all(vehicleTyreId) as any[];
    return rows.map((r) => ({ ...r, is_current: Boolean(r.is_current) }));
  }

  createTyreRotation(rotation: TyreRotationEntity, moves: TyreRotationMoveEntity[]): TyreRotationEntity {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO tyre_rotations (
        id, vehicle_id, performed_at, odometer_km, pattern, provider_id, provider_name,
        work_order_id, notes, maintenance_completion_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      rotation.id,
      rotation.vehicle_id,
      rotation.performed_at,
      rotation.odometer_km !== undefined ? rotation.odometer_km : null,
      rotation.pattern,
      rotation.provider_id || null,
      rotation.provider_name || null,
      rotation.work_order_id || null,
      rotation.notes || null,
      rotation.maintenance_completion_id || null,
      rotation.created_at
    );

    const moveStmt = db.prepare(`
      INSERT INTO tyre_rotation_moves (id, tyre_rotation_id, vehicle_tyre_id, from_position, to_position, created_at)
      VALUES (?, ?, ?, ?, ?, ?);
    `);

    for (const move of moves) {
      moveStmt.run(move.id, move.tyre_rotation_id, move.vehicle_tyre_id, move.from_position, move.to_position, move.created_at);
    }

    return { ...rotation, moves };
  }

  findTyreRotationsByVehicleId(vehicleId: string): TyreRotationEntity[] {
    const db = getDatabase();
    const rotations = db.prepare(`
      SELECT * FROM tyre_rotations WHERE vehicle_id = ? ORDER BY performed_at DESC;
    `).all(vehicleId) as unknown as TyreRotationEntity[];

    const movesStmt = db.prepare('SELECT * FROM tyre_rotation_moves WHERE tyre_rotation_id = ?;');
    for (const rot of rotations) {
      rot.moves = movesStmt.all(rot.id) as unknown as TyreRotationMoveEntity[];
    }
    return rotations;
  }

  // ==================== TYRE INSPECTIONS ====================

  createTyreInspection(inspection: TyreInspectionEntity): TyreInspectionEntity {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO tyre_inspections (
        id, vehicle_tyre_id, vehicle_id, tread_depth_outer_mm, tread_depth_center_mm,
        tread_depth_inner_mm, pressure_psi, condition_rating, observed_at, source_type,
        provider_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      inspection.id,
      inspection.vehicle_tyre_id,
      inspection.vehicle_id,
      inspection.tread_depth_outer_mm !== undefined ? inspection.tread_depth_outer_mm : null,
      inspection.tread_depth_center_mm !== undefined ? inspection.tread_depth_center_mm : null,
      inspection.tread_depth_inner_mm !== undefined ? inspection.tread_depth_inner_mm : null,
      inspection.pressure_psi !== undefined ? inspection.pressure_psi : null,
      inspection.condition_rating,
      inspection.observed_at,
      inspection.source_type,
      inspection.provider_id || null,
      inspection.notes || null,
      inspection.created_at
    );
    return inspection;
  }

  findInspectionsByTyreId(vehicleTyreId: string): TyreInspectionEntity[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM tyre_inspections WHERE vehicle_tyre_id = ? ORDER BY observed_at DESC;
    `).all(vehicleTyreId) as unknown as TyreInspectionEntity[];
  }

  findLatestInspectionsByVehicleId(vehicleId: string): TyreInspectionEntity[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM tyre_inspections
      WHERE vehicle_id = ?
      ORDER BY observed_at DESC LIMIT 20;
    `).all(vehicleId) as unknown as TyreInspectionEntity[];
  }

  // ==================== VEHICLE MODIFICATIONS & OVERRIDES ====================

  createModification(mod: VehicleModificationEntity): VehicleModificationEntity {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_modifications (
        id, vehicle_id, category, name, description, installed_at, odometer_km,
        provider_id, provider_name, work_order_id, status, verification_status,
        vehicle_component_id, vehicle_expense_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      mod.id,
      mod.vehicle_id,
      mod.category,
      mod.name,
      mod.description,
      mod.installed_at,
      mod.odometer_km !== undefined ? mod.odometer_km : null,
      mod.provider_id || null,
      mod.provider_name || null,
      mod.work_order_id || null,
      mod.status,
      mod.verification_status,
      mod.vehicle_component_id || null,
      mod.vehicle_expense_id || null,
      mod.created_at,
      mod.updated_at
    );
    return mod;
  }

  findModificationsByVehicleId(vehicleId: string): VehicleModificationEntity[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM vehicle_modifications WHERE vehicle_id = ? ORDER BY installed_at DESC;
    `).all(vehicleId) as unknown as VehicleModificationEntity[];
  }

  createConfigurationOverride(override: VehicleConfigurationOverrideEntity): VehicleConfigurationOverrideEntity {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_configuration_overrides (
        id, vehicle_id, attribute_key, original_value, current_value, source_reference,
        effective_from, effective_to, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      override.id,
      override.vehicle_id,
      override.attribute_key,
      override.original_value,
      override.current_value,
      override.source_reference || null,
      override.effective_from,
      override.effective_to || null,
      override.created_at
    );
    return override;
  }

  findActiveConfigurationOverrides(vehicleId: string): VehicleConfigurationOverrideEntity[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM vehicle_configuration_overrides
      WHERE vehicle_id = ? AND effective_to IS NULL
      ORDER BY effective_from DESC;
    `).all(vehicleId) as unknown as VehicleConfigurationOverrideEntity[];
  }

  findOverridesByVehicleId(vehicleId: string): VehicleConfigurationOverrideEntity[] {
    return this.findActiveConfigurationOverrides(vehicleId);
  }
}

export const componentRepository = new ComponentRepository();
