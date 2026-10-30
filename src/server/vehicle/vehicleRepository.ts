/**
 * Canonical Vehicle Domain Repository (GAR-004, GAR-033 §12A)
 */

import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { getCurrentUtcIsoString } from '../domain/time';
import {
  VehicleEntity,
  VehicleIdentifierEntity,
  VehicleRelationshipEntity,
  OdometerObservationEntity,
  VehicleDocumentEntity,
  CatalogMakeEntity,
  CatalogModelEntity,
  VehicleStatus,
  VehicleType,
  FuelType,
  TransmissionType,
  DriveType,
  VehicleIdentifierType,
  IdentifierVerificationStatus,
  VehicleRelationshipType,
  RelationshipStatus,
  OdometerUnit,
  OdometerObservationStatus,
  VehicleDocumentType,
} from './types';
import { DataProvenanceClass } from '../../shared/provenance';

export class VehicleRepository {
  /**
   * Atomically persists a newly created vehicle aggregate with initial identifiers,
   * ownership relationship, and optional initial odometer observation.
   */
  createVehicleAggregate(params: {
    vehicle: VehicleEntity;
    identifiers: VehicleIdentifierEntity[];
    relationship: VehicleRelationshipEntity;
    initialOdometer?: OdometerObservationEntity;
  }): void {
    withTransaction(({ db }) => {
      // 1. Insert vehicle aggregate root
      db.prepare(`
        INSERT INTO vehicles (
          id, display_name, nickname, make, model, model_year, trim, variant,
          vehicle_type, body_type, color, fuel_type, transmission, drive_type,
          engine_number, engine_type, engine_displacement_cc, manufacture_date,
          first_registration_date, country_of_registration, status, verification_status,
          primary_image_id, current_odometer_cache, current_odometer_unit, timezone,
          version, created_by, owner_scope_type, owner_id, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?
        );
      `).run(
        params.vehicle.id,
        params.vehicle.display_name,
        params.vehicle.nickname,
        params.vehicle.make,
        params.vehicle.model,
        params.vehicle.model_year,
        params.vehicle.trim,
        params.vehicle.variant,
        params.vehicle.vehicle_type,
        params.vehicle.body_type,
        params.vehicle.color,
        params.vehicle.fuel_type,
        params.vehicle.transmission,
        params.vehicle.drive_type,
        params.vehicle.engine_number,
        params.vehicle.engine_type,
        params.vehicle.engine_displacement_cc,
        params.vehicle.manufacture_date,
        params.vehicle.first_registration_date,
        params.vehicle.country_of_registration,
        params.vehicle.status,
        params.vehicle.verification_status,
        params.vehicle.primary_image_id,
        params.vehicle.current_odometer_cache,
        params.vehicle.current_odometer_unit,
        params.vehicle.timezone,
        params.vehicle.version,
        params.vehicle.created_by,
        params.relationship.organization_id ? 'ORGANIZATION' : 'USER',
        params.relationship.organization_id || params.relationship.user_id,
        params.vehicle.created_at,
        params.vehicle.updated_at
      );

      // 2. Insert identifiers
      const insertIdentStmt = db.prepare(`
        INSERT INTO vehicle_identifiers (
          id, vehicle_id, type, value, normalized_value, issuing_country,
          source, verification_status, is_primary, valid_from, valid_until,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);

      for (const ident of params.identifiers) {
        insertIdentStmt.run(
          ident.id,
          ident.vehicle_id,
          ident.type,
          ident.value,
          ident.normalized_value,
          ident.issuing_country,
          ident.source,
          ident.verification_status,
          ident.is_primary ? 1 : 0,
          ident.valid_from,
          ident.valid_until,
          ident.created_at,
          ident.updated_at
        );
      }

      // 3. Insert ownership relationship
      db.prepare(`
        INSERT INTO vehicle_relationships (
          id, vehicle_id, user_id, organization_id, relationship_type,
          is_primary_owner, status, provenance_class, valid_from, valid_until,
          notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `).run(
        params.relationship.id,
        params.relationship.vehicle_id,
        params.relationship.user_id,
        params.relationship.organization_id,
        params.relationship.relationship_type,
        params.relationship.is_primary_owner ? 1 : 0,
        params.relationship.status,
        params.relationship.provenance_class,
        params.relationship.valid_from,
        params.relationship.valid_until,
        params.relationship.notes,
        params.relationship.created_at,
        params.relationship.updated_at
      );

      // 4. Insert initial odometer reading if present
      if (params.initialOdometer) {
        db.prepare(`
          INSERT INTO odometer_observations (
            id, vehicle_id, reading_value, unit, reading_km, observed_at,
            recorded_at, source_class, source_ref, actor_id, provider_id,
            status, flag_reason, superseded_by_id, correction_reason, notes,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `).run(
          params.initialOdometer.id,
          params.initialOdometer.vehicle_id,
          params.initialOdometer.reading_value,
          params.initialOdometer.unit,
          params.initialOdometer.reading_km,
          params.initialOdometer.observed_at,
          params.initialOdometer.recorded_at,
          params.initialOdometer.source_class,
          params.initialOdometer.source_ref,
          params.initialOdometer.actor_id,
          params.initialOdometer.provider_id,
          params.initialOdometer.status,
          params.initialOdometer.flag_reason,
          params.initialOdometer.superseded_by_id,
          params.initialOdometer.correction_reason,
          params.initialOdometer.notes,
          params.initialOdometer.created_at,
          params.initialOdometer.updated_at
        );
      }
    });
  }

  getVehicleById(id: string): VehicleEntity | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM vehicles WHERE id = ?;`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapVehicleRow(row);
  }

  listVehiclesForUser(
    userId: string,
    status?: VehicleStatus,
    limit = 50,
    offset = 0
  ): Array<{ vehicle: VehicleEntity; relationship: VehicleRelationshipEntity }> {
    const db = getDatabase();
    let query = `
      SELECT v.*, 
             vr.id as rel_id, vr.relationship_type, vr.is_primary_owner, 
             vr.status as rel_status, vr.provenance_class as rel_prov,
             vr.valid_from as rel_valid_from, vr.valid_until as rel_valid_until,
             vr.notes as rel_notes, vr.created_at as rel_created_at, vr.updated_at as rel_updated_at,
             vr.organization_id as rel_org_id
      FROM vehicle_relationships vr
      JOIN vehicles v ON vr.vehicle_id = v.id
      WHERE vr.user_id = ? AND vr.status = 'ACTIVE'
    `;
    const params: (string | number | null)[] = [userId];

    if (status) {
      query += ` AND v.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY v.created_at DESC LIMIT ? OFFSET ?;`;
    params.push(limit, offset);

    const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      vehicle: this.mapVehicleRow(r),
      relationship: {
        id: String(r.rel_id),
        vehicle_id: String(r.id),
        user_id: userId,
        organization_id: r.rel_org_id ? String(r.rel_org_id) : null,
        relationship_type: r.relationship_type as VehicleRelationshipType,
        is_primary_owner: Number(r.is_primary_owner) === 1,
        status: r.rel_status as RelationshipStatus,
        provenance_class: r.rel_prov as DataProvenanceClass,
        valid_from: String(r.rel_valid_from),
        valid_until: r.rel_valid_until ? String(r.rel_valid_until) : null,
        notes: r.rel_notes ? String(r.rel_notes) : null,
        created_at: String(r.rel_created_at),
        updated_at: String(r.rel_updated_at),
      },
    }));
  }

  listVehiclesForOrganization(
    orgId: string,
    status?: VehicleStatus,
    limit = 50,
    offset = 0
  ): Array<{ vehicle: VehicleEntity; relationship: VehicleRelationshipEntity }> {
    const db = getDatabase();
    let query = `
      SELECT v.*, 
             vr.id as rel_id, vr.user_id as rel_user_id, vr.relationship_type, vr.is_primary_owner, 
             vr.status as rel_status, vr.provenance_class as rel_prov,
             vr.valid_from as rel_valid_from, vr.valid_until as rel_valid_until,
             vr.notes as rel_notes, vr.created_at as rel_created_at, vr.updated_at as rel_updated_at,
             vr.organization_id as rel_org_id
      FROM vehicle_relationships vr
      JOIN vehicles v ON vr.vehicle_id = v.id
      WHERE vr.organization_id = ? AND vr.status = 'ACTIVE'
    `;
    const params: (string | number | null)[] = [orgId];

    if (status) {
      query += ` AND v.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY v.created_at DESC LIMIT ? OFFSET ?;`;
    params.push(limit, offset);

    const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      vehicle: this.mapVehicleRow(r),
      relationship: {
        id: String(r.rel_id),
        vehicle_id: String(r.id),
        user_id: String(r.rel_user_id),
        organization_id: orgId,
        relationship_type: r.relationship_type as VehicleRelationshipType,
        is_primary_owner: Number(r.is_primary_owner) === 1,
        status: r.rel_status as RelationshipStatus,
        provenance_class: r.rel_prov as DataProvenanceClass,
        valid_from: String(r.rel_valid_from),
        valid_until: r.rel_valid_until ? String(r.rel_valid_until) : null,
        notes: r.rel_notes ? String(r.rel_notes) : null,
        created_at: String(r.rel_created_at),
        updated_at: String(r.rel_updated_at),
      },
    }));
  }

  updateVehicle(id: string, updates: Partial<VehicleEntity>): VehicleEntity {
    const db = getDatabase();
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.nickname !== undefined) {
      sets.push('nickname = ?');
      values.push(updates.nickname);
    }
    if (updates.color !== undefined) {
      sets.push('color = ?');
      values.push(updates.color);
    }
    if (updates.trim !== undefined) {
      sets.push('trim = ?');
      values.push(updates.trim);
    }
    if (updates.variant !== undefined) {
      sets.push('variant = ?');
      values.push(updates.variant);
    }
    if (updates.body_type !== undefined) {
      sets.push('body_type = ?');
      values.push(updates.body_type);
    }
    if (updates.primary_image_id !== undefined) {
      sets.push('primary_image_id = ?');
      values.push(updates.primary_image_id);
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.archived_at !== undefined) {
      sets.push('archived_at = ?');
      values.push(updates.archived_at);
    }
    if (updates.current_odometer_cache !== undefined) {
      sets.push('current_odometer_cache = ?');
      values.push(updates.current_odometer_cache);
    }
    if (updates.current_odometer_unit !== undefined) {
      sets.push('current_odometer_unit = ?');
      values.push(updates.current_odometer_unit);
    }

    sets.push('version = version + 1');
    sets.push('updated_at = ?');
    values.push(getCurrentUtcIsoString());
    values.push(id);

    db.prepare(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = ?;`).run(...values);
    return this.getVehicleById(id)!;
  }

  archiveVehicle(id: string, archivedAt: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE vehicles
      SET status = 'ARCHIVED',
          archived_at = ?,
          version = version + 1,
          updated_at = ?
      WHERE id = ?;
    `).run(archivedAt, getCurrentUtcIsoString(), id);
  }

  getVehicleIdentifiers(vehicleId: string): VehicleIdentifierEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM vehicle_identifiers
      WHERE vehicle_id = ?
      ORDER BY is_primary DESC, created_at ASC;
    `).all(vehicleId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapIdentifierRow(r));
  }

  addVehicleIdentifier(identifier: VehicleIdentifierEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_identifiers (
        id, vehicle_id, type, value, normalized_value, issuing_country,
        source, verification_status, is_primary, valid_from, valid_until,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      identifier.id,
      identifier.vehicle_id,
      identifier.type,
      identifier.value,
      identifier.normalized_value,
      identifier.issuing_country,
      identifier.source,
      identifier.verification_status,
      identifier.is_primary ? 1 : 0,
      identifier.valid_from,
      identifier.valid_until,
      identifier.created_at,
      identifier.updated_at
    );
  }

  findIdentifierConflict(
    type: VehicleIdentifierType,
    normalizedValue: string,
    excludeVehicleId?: string
  ): { vehicle_id: string; identifier_id: string } | null {
    const db = getDatabase();
    let query = `
      SELECT vi.vehicle_id, vi.id as identifier_id
      FROM vehicle_identifiers vi
      JOIN vehicles v ON vi.vehicle_id = v.id
      WHERE vi.type = ? AND vi.normalized_value = ? AND v.status != 'ARCHIVED'
    `;
    const params: (string | number | null)[] = [type, normalizedValue];
    if (excludeVehicleId) {
      query += ` AND vi.vehicle_id != ?`;
      params.push(excludeVehicleId);
    }
    query += ` LIMIT 1;`;
    const row = db.prepare(query).get(...params) as { vehicle_id: string; identifier_id: string } | undefined;
    return row || null;
  }

  getVehicleRelationships(vehicleId: string): VehicleRelationshipEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM vehicle_relationships
      WHERE vehicle_id = ? AND status = 'ACTIVE'
      ORDER BY is_primary_owner DESC, created_at ASC;
    `).all(vehicleId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRelationshipRow(r));
  }

  getUserRelationshipForVehicle(vehicleId: string, userId: string): VehicleRelationshipEntity | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM vehicle_relationships
      WHERE vehicle_id = ? AND user_id = ? AND status = 'ACTIVE'
      LIMIT 1;
    `).get(vehicleId, userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRelationshipRow(row);
  }

  getPrimaryOwner(vehicleId: string): { user_id: string; organization_id: string | null } | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT user_id, organization_id
      FROM vehicle_relationships
      WHERE vehicle_id = ? AND is_primary_owner = 1 AND status = 'ACTIVE'
      LIMIT 1;
    `).get(vehicleId) as { user_id: string; organization_id: string | null } | undefined;
    return row || null;
  }

  addVehicleRelationship(relationship: VehicleRelationshipEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_relationships (
        id, vehicle_id, user_id, organization_id, relationship_type,
        is_primary_owner, status, provenance_class, valid_from, valid_until,
        notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      relationship.id,
      relationship.vehicle_id,
      relationship.user_id,
      relationship.organization_id,
      relationship.relationship_type,
      relationship.is_primary_owner ? 1 : 0,
      relationship.status,
      relationship.provenance_class,
      relationship.valid_from,
      relationship.valid_until,
      relationship.notes,
      relationship.created_at,
      relationship.updated_at
    );
  }

  revokeVehicleRelationship(relationshipId: string, endedAt: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE vehicle_relationships
      SET status = 'REVOKED',
          valid_until = ?,
          updated_at = ?
      WHERE id = ?;
    `).run(endedAt, getCurrentUtcIsoString(), relationshipId);
  }

  getLatestOdometerObservation(vehicleId: string): OdometerObservationEntity | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM odometer_observations
      WHERE vehicle_id = ? AND status = 'VALID'
      ORDER BY reading_km DESC, observed_at DESC
      LIMIT 1;
    `).get(vehicleId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapOdometerRow(row);
  }

  listOdometerObservations(vehicleId: string, limit = 50, offset = 0): OdometerObservationEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM odometer_observations
      WHERE vehicle_id = ?
      ORDER BY observed_at DESC, created_at DESC
      LIMIT ? OFFSET ?;
    `).all(vehicleId, limit, offset) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapOdometerRow(r));
  }

  getOdometerObservationById(id: string): OdometerObservationEntity | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM odometer_observations WHERE id = ?;`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapOdometerRow(row);
  }

  createOdometerObservation(observation: OdometerObservationEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO odometer_observations (
        id, vehicle_id, reading_value, unit, reading_km, observed_at,
        recorded_at, source_class, source_ref, actor_id, provider_id,
        status, flag_reason, superseded_by_id, correction_reason, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      observation.id,
      observation.vehicle_id,
      observation.reading_value,
      observation.unit,
      observation.reading_km,
      observation.observed_at,
      observation.recorded_at,
      observation.source_class,
      observation.source_ref,
      observation.actor_id,
      observation.provider_id,
      observation.status,
      observation.flag_reason,
      observation.superseded_by_id,
      observation.correction_reason,
      observation.notes,
      observation.created_at,
      observation.updated_at
    );
  }

  supersedeOdometerObservation(observationId: string, supersededById: string, reason: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE odometer_observations
      SET status = 'SUPERSEDED',
          superseded_by_id = ?,
          correction_reason = ?,
          updated_at = ?
      WHERE id = ?;
    `).run(supersededById, reason, getCurrentUtcIsoString(), observationId);
  }

  updateVehicleOdometerCache(vehicleId: string, readingKm: number, unit: OdometerUnit): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE vehicles
      SET current_odometer_cache = ?,
          current_odometer_unit = ?,
          updated_at = ?
      WHERE id = ?;
    `).run(readingKm, unit, getCurrentUtcIsoString(), vehicleId);
  }

  addVehicleDocument(doc: VehicleDocumentEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_documents (
        id, vehicle_id, document_type, file_id, title, document_number,
        issuer, issued_at, expires_at, verification_status, created_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      doc.id,
      doc.vehicle_id,
      doc.document_type,
      doc.file_id,
      doc.title,
      doc.document_number,
      doc.issuer,
      doc.issued_at,
      doc.expires_at,
      doc.verification_status,
      doc.created_by,
      doc.created_at,
      doc.updated_at
    );
  }

  listVehicleDocuments(vehicleId: string): VehicleDocumentEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM vehicle_documents
      WHERE vehicle_id = ?
      ORDER BY created_at DESC;
    `).all(vehicleId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      vehicle_id: String(r.vehicle_id),
      document_type: r.document_type as VehicleDocumentType,
      file_id: String(r.file_id),
      title: String(r.title),
      document_number: r.document_number ? String(r.document_number) : null,
      issuer: r.issuer ? String(r.issuer) : null,
      issued_at: r.issued_at ? String(r.issued_at) : null,
      expires_at: r.expires_at ? String(r.expires_at) : null,
      verification_status: r.verification_status as IdentifierVerificationStatus,
      created_by: String(r.created_by),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    }));
  }

  getCatalogMakes(): CatalogMakeEntity[] {
    const db = getDatabase();
    this.seedCatalogIfEmpty();
    const rows = db.prepare(`
      SELECT * FROM vehicle_catalog_makes
      ORDER BY is_popular DESC, name ASC;
    `).all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      country_of_origin: r.country_of_origin ? String(r.country_of_origin) : null,
      is_popular: Number(r.is_popular) === 1,
    }));
  }

  getCatalogModels(makeId: string): CatalogModelEntity[] {
    const db = getDatabase();
    this.seedCatalogIfEmpty();
    const rows = db.prepare(`
      SELECT * FROM vehicle_catalog_models
      WHERE make_id = ?
      ORDER BY name ASC;
    `).all(makeId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      make_id: String(r.make_id),
      name: String(r.name),
      body_type: String(r.body_type),
      fuel_types: JSON.parse(String(r.fuel_types || '["PETROL"]')),
      transmissions: JSON.parse(String(r.transmissions || '["AUTOMATIC"]')),
      popular_model_years: JSON.parse(String(r.popular_model_years || '[]')),
    }));
  }

  seedCatalogIfEmpty(): void {
    const db = getDatabase();
    const countRow = db.prepare('SELECT COUNT(*) as count FROM vehicle_catalog_makes;').get() as { count: number };
    if (countRow && countRow.count > 0) {
      return;
    }

    const defaultMakes = [
      { id: 'make_toyota', name: 'Toyota', origin: 'Japan', isPopular: 1 },
      { id: 'make_subaru', name: 'Subaru', origin: 'Japan', isPopular: 1 },
      { id: 'make_mazda', name: 'Mazda', origin: 'Japan', isPopular: 1 },
      { id: 'make_nissan', name: 'Nissan', origin: 'Japan', isPopular: 1 },
      { id: 'make_honda', name: 'Honda', origin: 'Japan', isPopular: 1 },
      { id: 'make_isuzu', name: 'Isuzu', origin: 'Japan', isPopular: 1 },
      { id: 'make_mitsubishi', name: 'Mitsubishi', origin: 'Japan', isPopular: 1 },
      { id: 'make_mercedes', name: 'Mercedes-Benz', origin: 'Germany', isPopular: 1 },
      { id: 'make_bmw', name: 'BMW', origin: 'Germany', isPopular: 1 },
      { id: 'make_volkswagen', name: 'Volkswagen', origin: 'Germany', isPopular: 1 },
      { id: 'make_landrover', name: 'Land Rover', origin: 'United Kingdom', isPopular: 1 },
      { id: 'make_ford', name: 'Ford', origin: 'United States', isPopular: 0 },
      { id: 'make_hyundai', name: 'Hyundai', origin: 'South Korea', isPopular: 0 },
      { id: 'make_kia', name: 'Kia', origin: 'South Korea', isPopular: 0 },
    ];

    const insertMake = db.prepare(`
      INSERT OR IGNORE INTO vehicle_catalog_makes (id, name, country_of_origin, is_popular)
      VALUES (?, ?, ?, ?);
    `);

    for (const m of defaultMakes) {
      insertMake.run(m.id, m.name, m.origin, m.isPopular);
    }

    const defaultModels = [
      // Toyota
      { id: 'mod_harrier', make_id: 'make_toyota', name: 'Harrier', body_type: 'SUV', fuel_types: '["PETROL","HYBRID_PETROL"]' },
      { id: 'mod_prado', make_id: 'make_toyota', name: 'Land Cruiser Prado', body_type: 'SUV', fuel_types: '["DIESEL","PETROL"]' },
      { id: 'mod_hilux', make_id: 'make_toyota', name: 'Hilux', body_type: 'PICKUP', fuel_types: '["DIESEL"]' },
      { id: 'mod_rav4', make_id: 'make_toyota', name: 'RAV4', body_type: 'SUV', fuel_types: '["PETROL","HYBRID_PETROL"]' },
      { id: 'mod_premio', make_id: 'make_toyota', name: 'Premio', body_type: 'SEDAN', fuel_types: '["PETROL"]' },
      { id: 'mod_vitz', make_id: 'make_toyota', name: 'Vitz', body_type: 'HATCHBACK', fuel_types: '["PETROL"]' },
      { id: 'mod_axio', make_id: 'make_toyota', name: 'Corolla Axio', body_type: 'SEDAN', fuel_types: '["PETROL","HYBRID_PETROL"]' },
      { id: 'mod_fielder', make_id: 'make_toyota', name: 'Corolla Fielder', body_type: 'WAGON', fuel_types: '["PETROL","HYBRID_PETROL"]' },
      { id: 'mod_hiace', make_id: 'make_toyota', name: 'HiAce', body_type: 'VAN', fuel_types: '["DIESEL","PETROL"]' },
      // Subaru
      { id: 'mod_forester', make_id: 'make_subaru', name: 'Forester', body_type: 'SUV', fuel_types: '["PETROL"]' },
      { id: 'mod_outback', make_id: 'make_subaru', name: 'Outback', body_type: 'WAGON', fuel_types: '["PETROL","DIESEL"]' },
      { id: 'mod_impreza', make_id: 'make_subaru', name: 'Impreza', body_type: 'HATCHBACK', fuel_types: '["PETROL"]' },
      { id: 'mod_xv', make_id: 'make_subaru', name: 'XV / Crosstrek', body_type: 'CROSSOVER', fuel_types: '["PETROL","HYBRID_PETROL"]' },
      // Mazda
      { id: 'mod_cx5', make_id: 'make_mazda', name: 'CX-5', body_type: 'SUV', fuel_types: '["DIESEL","PETROL"]' },
      { id: 'mod_demio', make_id: 'make_mazda', name: 'Demio / Mazda2', body_type: 'HATCHBACK', fuel_types: '["PETROL"]' },
      { id: 'mod_axela', make_id: 'make_mazda', name: 'Axela / Mazda3', body_type: 'SEDAN', fuel_types: '["PETROL"]' },
      // Nissan
      { id: 'mod_xtrail', make_id: 'make_nissan', name: 'X-Trail', body_type: 'SUV', fuel_types: '["PETROL","HYBRID_PETROL"]' },
      { id: 'mod_note', make_id: 'make_nissan', name: 'Note', body_type: 'HATCHBACK', fuel_types: '["PETROL","HYBRID_PETROL"]' },
      { id: 'mod_juke', make_id: 'make_nissan', name: 'Juke', body_type: 'CROSSOVER', fuel_types: '["PETROL"]' },
      // Honda
      { id: 'mod_crv', make_id: 'make_honda', name: 'CR-V', body_type: 'SUV', fuel_types: '["PETROL","HYBRID_PETROL"]' },
      { id: 'mod_fit', make_id: 'make_honda', name: 'Fit', body_type: 'HATCHBACK', fuel_types: '["PETROL","HYBRID_PETROL"]' },
      { id: 'mod_vezel', make_id: 'make_honda', name: 'Vezel / HR-V', body_type: 'CROSSOVER', fuel_types: '["PETROL","HYBRID_PETROL"]' },
      // Isuzu
      { id: 'mod_dmax', make_id: 'make_isuzu', name: 'D-Max', body_type: 'PICKUP', fuel_types: '["DIESEL"]' },
      { id: 'mod_mux', make_id: 'make_isuzu', name: 'MU-X', body_type: 'SUV', fuel_types: '["DIESEL"]' },
      // Mercedes-Benz
      { id: 'mod_cclass', make_id: 'make_mercedes', name: 'C-Class', body_type: 'SEDAN', fuel_types: '["PETROL","DIESEL"]' },
      { id: 'mod_eclass', make_id: 'make_mercedes', name: 'E-Class', body_type: 'SEDAN', fuel_types: '["PETROL","DIESEL"]' },
      { id: 'mod_glc', make_id: 'make_mercedes', name: 'GLC', body_type: 'SUV', fuel_types: '["PETROL","DIESEL"]' },
      // BMW
      { id: 'mod_3series', make_id: 'make_bmw', name: '3 Series', body_type: 'SEDAN', fuel_types: '["PETROL","DIESEL"]' },
      { id: 'mod_5series', make_id: 'make_bmw', name: '5 Series', body_type: 'SEDAN', fuel_types: '["PETROL","DIESEL"]' },
      { id: 'mod_x3', make_id: 'make_bmw', name: 'X3', body_type: 'SUV', fuel_types: '["PETROL","DIESEL"]' },
      { id: 'mod_x5', make_id: 'make_bmw', name: 'X5', body_type: 'SUV', fuel_types: '["PETROL","DIESEL"]' },
      // Volkswagen
      { id: 'mod_golf', make_id: 'make_volkswagen', name: 'Golf', body_type: 'HATCHBACK', fuel_types: '["PETROL","DIESEL"]' },
      { id: 'mod_tiguan', make_id: 'make_volkswagen', name: 'Tiguan', body_type: 'SUV', fuel_types: '["PETROL","DIESEL"]' },
      { id: 'mod_passat', make_id: 'make_volkswagen', name: 'Passat', body_type: 'SEDAN', fuel_types: '["PETROL","DIESEL"]' },
    ];

    const insertModel = db.prepare(`
      INSERT OR IGNORE INTO vehicle_catalog_models (id, make_id, name, body_type, fuel_types, transmissions, popular_model_years)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `);

    for (const mod of defaultModels) {
      insertModel.run(
        mod.id,
        mod.make_id,
        mod.name,
        mod.body_type,
        mod.fuel_types,
        '["AUTOMATIC","MANUAL"]',
        '[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]'
      );
    }
  }

  private mapVehicleRow(r: Record<string, unknown>): VehicleEntity {
    return {
      id: String(r.id),
      display_name: String(r.display_name),
      nickname: r.nickname ? String(r.nickname) : null,
      make: String(r.make),
      model: String(r.model),
      model_year: Number(r.model_year),
      trim: r.trim ? String(r.trim) : null,
      variant: r.variant ? String(r.variant) : null,
      vehicle_type: (r.vehicle_type as VehicleType) || VehicleType.SEDAN,
      body_type: r.body_type ? String(r.body_type) : null,
      color: r.color ? String(r.color) : null,
      fuel_type: (r.fuel_type as FuelType) || FuelType.PETROL,
      transmission: (r.transmission as TransmissionType) || TransmissionType.AUTOMATIC,
      drive_type: (r.drive_type as DriveType) || null,
      engine_number: r.engine_number ? String(r.engine_number) : null,
      engine_type: r.engine_type ? String(r.engine_type) : null,
      engine_displacement_cc: r.engine_displacement_cc ? Number(r.engine_displacement_cc) : null,
      manufacture_date: r.manufacture_date ? String(r.manufacture_date) : null,
      first_registration_date: r.first_registration_date ? String(r.first_registration_date) : null,
      country_of_registration: String(r.country_of_registration || 'KE'),
      status: (r.status as VehicleStatus) || VehicleStatus.ACTIVE,
      verification_status: (r.verification_status as IdentifierVerificationStatus) || IdentifierVerificationStatus.OWNER_ASSERTED,
      primary_image_id: r.primary_image_id ? String(r.primary_image_id) : null,
      current_odometer_cache: Number(r.current_odometer_cache || 0),
      current_odometer_unit: (r.current_odometer_unit as OdometerUnit) || OdometerUnit.KM,
      timezone: String(r.timezone || 'Africa/Nairobi'),
      version: Number(r.version || 1),
      created_by: String(r.created_by || r.owner_id || ''),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      archived_at: r.archived_at ? String(r.archived_at) : null,
    };
  }

  private mapIdentifierRow(r: Record<string, unknown>): VehicleIdentifierEntity {
    return {
      id: String(r.id),
      vehicle_id: String(r.vehicle_id),
      type: r.type as VehicleIdentifierType,
      value: String(r.value),
      normalized_value: String(r.normalized_value),
      issuing_country: String(r.issuing_country || 'KE'),
      source: String(r.source || 'OWNER_ENTERED'),
      verification_status: (r.verification_status as IdentifierVerificationStatus) || IdentifierVerificationStatus.OWNER_ASSERTED,
      is_primary: Number(r.is_primary) === 1,
      valid_from: String(r.valid_from),
      valid_until: r.valid_until ? String(r.valid_until) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  private mapRelationshipRow(r: Record<string, unknown>): VehicleRelationshipEntity {
    return {
      id: String(r.id),
      vehicle_id: String(r.vehicle_id),
      user_id: String(r.user_id),
      organization_id: r.organization_id ? String(r.organization_id) : null,
      relationship_type: r.relationship_type as VehicleRelationshipType,
      is_primary_owner: Number(r.is_primary_owner) === 1,
      status: r.status as RelationshipStatus,
      provenance_class: (r.provenance_class as DataProvenanceClass) || DataProvenanceClass.OWNER_ASSERTED,
      valid_from: String(r.valid_from),
      valid_until: r.valid_until ? String(r.valid_until) : null,
      notes: r.notes ? String(r.notes) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  private mapOdometerRow(r: Record<string, unknown>): OdometerObservationEntity {
    return {
      id: String(r.id),
      vehicle_id: String(r.vehicle_id),
      reading_value: Number(r.reading_value || r.reading_km || 0),
      unit: (r.unit as OdometerUnit) || OdometerUnit.KM,
      reading_km: Number(r.reading_km || 0),
      observed_at: String(r.observed_at || r.recorded_at),
      recorded_at: String(r.recorded_at),
      source_class: String(r.source_class || 'OWNER_ENTERED'),
      source_ref: r.source_ref ? String(r.source_ref) : null,
      actor_id: String(r.actor_id || 'usr_unknown'),
      provider_id: r.provider_id ? String(r.provider_id) : null,
      status: (r.status as OdometerObservationStatus) || OdometerObservationStatus.VALID,
      flag_reason: r.flag_reason ? String(r.flag_reason) : null,
      superseded_by_id: r.superseded_by_id ? String(r.superseded_by_id) : null,
      correction_reason: r.correction_reason ? String(r.correction_reason) : null,
      notes: r.notes ? String(r.notes) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }
}

export const vehicleRepository = new VehicleRepository();
