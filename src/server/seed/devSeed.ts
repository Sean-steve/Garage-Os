/**
 * Controlled Deterministic Development & Test Seed (Sprint 1 §33)
 *
 * Rules:
 * 1. Clearly labeled non-production test data.
 * 2. Deterministic IDs and timestamps.
 * 3. Resettable and isolated from production.
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { logger } from '../observability/logger';
import { DataProvenanceClass } from '../../shared/provenance';
import { hashPassword } from '../identity/password';
import { rebuildAllProviderSearchProjections } from '../providers/searchProjection';

export function seedDatabase(customDb?: DatabaseSync): void {
  const db = customDb || getDatabase();

  logger.info('Running deterministic development seed for Sprint 1 & Sprint 2...');

  const defaultPasswordHash = hashPassword('Password123!');

  // 1. Seed Consumer User: Jane Wambui
  db.prepare(`
    INSERT OR IGNORE INTO users (
      id, email, phone, full_name, role, status, account_status, email_verified_at, failed_login_attempts, created_at, updated_at
    ) VALUES (
      'usr_seed_owner_01', 'owner.demo@garageos.test', '+254700111222', 'Jane Wambui', 'VEHICLE_OWNER', 'ACTIVE', 'ACTIVE', '2026-01-01T00:00:00.000Z', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO accounts (id, user_id, account_type, name, status, created_at, updated_at)
    VALUES ('acc_seed_owner_01', 'usr_seed_owner_01', 'PERSONAL', 'Jane''s Garage Account', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO user_profiles (user_id, display_name, first_name, last_name, preferred_language, timezone, country, created_at, updated_at)
    VALUES ('usr_seed_owner_01', 'Jane Wambui', 'Jane', 'Wambui', 'en', 'Africa/Nairobi', 'KE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO credentials (id, user_id, credential_type, secret_hash, salt, created_at, updated_at)
    VALUES ('crd_seed_owner_01', 'usr_seed_owner_01', 'PASSWORD', ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run(defaultPasswordHash.hashString, defaultPasswordHash.saltHex);

  // 2. Seed Garage Owner: Mark Otieno
  db.prepare(`
    INSERT OR IGNORE INTO users (
      id, email, phone, full_name, role, status, account_status, email_verified_at, failed_login_attempts, created_at, updated_at
    ) VALUES (
      'usr_seed_garage_owner', 'garage.owner@garageos.test', '+254700333444', 'Mark Otieno', 'SERVICE_PROVIDER', 'ACTIVE', 'ACTIVE', '2026-01-01T00:00:00.000Z', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO user_profiles (user_id, display_name, first_name, last_name, preferred_language, timezone, country, created_at, updated_at)
    VALUES ('usr_seed_garage_owner', 'Mark Otieno', 'Mark', 'Otieno', 'en', 'Africa/Nairobi', 'KE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO credentials (id, user_id, credential_type, secret_hash, salt, created_at, updated_at)
    VALUES ('crd_seed_garage_owner', 'usr_seed_garage_owner', 'PASSWORD', ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run(defaultPasswordHash.hashString, defaultPasswordHash.saltHex);

  // 3. Seed Garage Mechanic: Peter Kamau
  db.prepare(`
    INSERT OR IGNORE INTO users (
      id, email, phone, full_name, role, status, account_status, email_verified_at, failed_login_attempts, created_at, updated_at
    ) VALUES (
      'usr_seed_mechanic', 'garage.mechanic@garageos.test', '+254700555666', 'Peter Kamau', 'SERVICE_PROVIDER', 'ACTIVE', 'ACTIVE', '2026-01-01T00:00:00.000Z', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO user_profiles (user_id, display_name, first_name, last_name, preferred_language, timezone, country, created_at, updated_at)
    VALUES ('usr_seed_mechanic', 'Peter Kamau', 'Peter', 'Kamau', 'en', 'Africa/Nairobi', 'KE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO credentials (id, user_id, credential_type, secret_hash, salt, created_at, updated_at)
    VALUES ('crd_seed_mechanic', 'usr_seed_mechanic', 'PASSWORD', ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run(defaultPasswordHash.hashString, defaultPasswordHash.saltHex);

  // 4. Seed Platform Admin: Sarah Njeri
  db.prepare(`
    INSERT OR IGNORE INTO users (
      id, email, phone, full_name, role, status, account_status, email_verified_at, failed_login_attempts, created_at, updated_at
    ) VALUES (
      'usr_seed_admin', 'admin@garageos.test', '+254700777888', 'Sarah Njeri', 'PLATFORM_ADMIN', 'ACTIVE', 'ACTIVE', '2026-01-01T00:00:00.000Z', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO user_profiles (user_id, display_name, first_name, last_name, preferred_language, timezone, country, created_at, updated_at)
    VALUES ('usr_seed_admin', 'Sarah Njeri (Platform Admin)', 'Sarah', 'Njeri', 'en', 'Africa/Nairobi', 'KE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO credentials (id, user_id, credential_type, secret_hash, salt, created_at, updated_at)
    VALUES ('crd_seed_admin', 'usr_seed_admin', 'PASSWORD', ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run(defaultPasswordHash.hashString, defaultPasswordHash.saltHex);

  db.prepare(`
    INSERT OR IGNORE INTO user_platform_roles (user_id, role, assigned_by, assigned_at)
    VALUES ('usr_seed_admin', 'PLATFORM_ADMIN', 'SYSTEM_BOOTSTRAP', '2026-01-01T00:00:00.000Z');
  `).run();

  // 5. Seed Suspended User: Kevin Kiprono
  db.prepare(`
    INSERT OR IGNORE INTO users (
      id, email, phone, full_name, role, status, account_status, email_verified_at, failed_login_attempts, created_at, updated_at
    ) VALUES (
      'usr_seed_suspended', 'suspended@garageos.test', '+254700999000', 'Kevin Kiprono', 'VEHICLE_OWNER', 'ACTIVE', 'SUSPENDED', '2026-01-01T00:00:00.000Z', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO user_profiles (user_id, display_name, first_name, last_name, preferred_language, timezone, country, created_at, updated_at)
    VALUES ('usr_seed_suspended', 'Kevin Kiprono (Suspended)', 'Kevin', 'Kiprono', 'en', 'Africa/Nairobi', 'KE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO credentials (id, user_id, credential_type, secret_hash, salt, created_at, updated_at)
    VALUES ('crd_seed_suspended', 'usr_seed_suspended', 'PASSWORD', ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run(defaultPasswordHash.hashString, defaultPasswordHash.saltHex);

  // 6. Seed Organizations & Memberships (Tenant Isolation demo)
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, organization_type, name, status, created_at, updated_at)
    VALUES ('org_seed_garage_01', 'GARAGE', 'Nairobi Premier Auto Clinic', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, organization_type, name, status, created_at, updated_at)
    VALUES ('org_seed_towing_01', 'TOWING_PROVIDER', 'Nairobi Central Towing Ltd', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, organization_type, name, status, created_at, updated_at)
    VALUES ('org_seed_towing_02', 'TOWING_PROVIDER', 'Mombasa Port Recovery & Towing', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, organization_type, name, status, created_at, updated_at)
    VALUES ('org_seed_mobile_03', 'MOBILE_MECHANIC', 'Safari Mobile Mechanic Express', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO organization_memberships (id, user_id, organization_id, role, status, accepted_at, created_at, updated_at)
    VALUES ('mem_seed_01', 'usr_seed_garage_owner', 'org_seed_garage_01', 'OWNER', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO organization_memberships (id, user_id, organization_id, role, status, accepted_at, created_at, updated_at)
    VALUES ('mem_seed_02', 'usr_seed_mechanic', 'org_seed_garage_01', 'MECHANIC', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  // 7. Seed Canonical Vehicles (GAR-004)
  db.prepare(`
    INSERT OR IGNORE INTO vehicles (
      id, owner_scope_type, owner_id, display_name, nickname, make, model, model_year, trim, vin,
      registration_number, vehicle_type, fuel_type, transmission, color, status, current_odometer_cache, current_odometer_unit, timezone, version,
      created_by, created_at, updated_at
    ) VALUES (
      'veh_seed_car_01', 'USER', 'usr_seed_owner_01', '2021 Toyota Land Cruiser Prado TX-L', 'Daily Safari Cruiser', 'Toyota', 'Land Cruiser Prado', 2021,
      'TX-L 2.8L Diesel', 'JTEBH51J005123456', 'KDA 789X', 'SUV', 'DIESEL', 'AUTOMATIC', 'Pearl White', 'ACTIVE', 54200, 'KM', 'Africa/Nairobi', 1,
      'usr_seed_owner_01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO vehicle_identifiers (
      id, vehicle_id, type, value, normalized_value, issuing_country, source, verification_status, is_primary, valid_from, created_at, updated_at
    ) VALUES
      ('vid_seed_vin_01', 'veh_seed_car_01', 'VIN', 'JTEBH51J005123456', 'JTEBH51J005123456', 'KE', 'OWNER_ENTERED', 'OWNER_ASSERTED', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('vid_seed_reg_01', 'veh_seed_car_01', 'REGISTRATION_NUMBER', 'KDA 789X', 'KDA 789X', 'KE', 'OWNER_ENTERED', 'OWNER_ASSERTED', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO vehicle_relationships (
      id, vehicle_id, user_id, organization_id, relationship_type, is_primary_owner, status, provenance_class, valid_from, created_at, updated_at
    ) VALUES
      ('vrel_seed_01', 'veh_seed_car_01', 'usr_seed_owner_01', NULL, 'OWNER', 1, 'ACTIVE', 'OWNER_ASSERTED', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  // Second Vehicle for Owner (Subaru Outback)
  db.prepare(`
    INSERT OR IGNORE INTO vehicles (
      id, owner_scope_type, owner_id, display_name, nickname, make, model, model_year, trim, vin,
      registration_number, vehicle_type, fuel_type, transmission, color, status, current_odometer_cache, current_odometer_unit, timezone, version,
      created_by, created_at, updated_at
    ) VALUES (
      'veh_seed_car_02', 'USER', 'usr_seed_owner_01', '2019 Subaru Outback 2.5i Limited', 'Family Wagon', 'Subaru', 'Outback', 2019,
      '2.5i Limited Eyesight', '4S4BSANC1K3123456', 'KCA 456Y', 'WAGON', 'PETROL', 'CVT', 'Tungsten Metallic', 'ACTIVE', 88450, 'KM', 'Africa/Nairobi', 1,
      'usr_seed_owner_01', '2026-01-10T00:00:00.000Z', '2026-01-10T00:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO vehicle_identifiers (
      id, vehicle_id, type, value, normalized_value, issuing_country, source, verification_status, is_primary, valid_from, created_at, updated_at
    ) VALUES
      ('vid_seed_vin_02', 'veh_seed_car_02', 'VIN', '4S4BSANC1K3123456', '4S4BSANC1K3123456', 'KE', 'OWNER_ENTERED', 'OWNER_ASSERTED', 1, '2026-01-10T00:00:00.000Z', '2026-01-10T00:00:00.000Z', '2026-01-10T00:00:00.000Z'),
      ('vid_seed_reg_02', 'veh_seed_car_02', 'REGISTRATION_NUMBER', 'KCA 456Y', 'KCA 456Y', 'KE', 'OWNER_ENTERED', 'OWNER_ASSERTED', 0, '2026-01-10T00:00:00.000Z', '2026-01-10T00:00:00.000Z', '2026-01-10T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO vehicle_relationships (
      id, vehicle_id, user_id, organization_id, relationship_type, is_primary_owner, status, provenance_class, valid_from, created_at, updated_at
    ) VALUES
      ('vrel_seed_02', 'veh_seed_car_02', 'usr_seed_owner_01', NULL, 'OWNER', 1, 'ACTIVE', 'OWNER_ASSERTED', '2026-01-10T00:00:00.000Z', '2026-01-10T00:00:00.000Z', '2026-01-10T00:00:00.000Z');
  `).run();

  // 8. Seed Odometer Observations (GAR-004)
  db.prepare(`
    INSERT OR IGNORE INTO odometer_observations (
      id, vehicle_id, reading_value, unit, reading_km, source_class, source_ref, actor_id, status, observed_at, recorded_at, created_at, updated_at
    ) VALUES
      ('odo_seed_01', 'veh_seed_car_01', 54200, 'KM', 54200, 'PROVIDER_RECORDED', 'srv_seed_garage_01', 'usr_seed_mechanic', 'VALID', '2026-02-15T09:30:00.000Z', '2026-02-15T09:30:00.000Z', '2026-02-15T09:30:00.000Z', '2026-02-15T09:30:00.000Z'),
      ('odo_seed_02', 'veh_seed_car_02', 88450, 'KM', 88450, 'OWNER_ENTERED', NULL, 'usr_seed_owner_01', 'VALID', '2026-02-10T14:00:00.000Z', '2026-02-10T14:00:00.000Z', '2026-02-10T14:00:00.000Z', '2026-02-10T14:00:00.000Z');
  `).run();

  // Seed Initial Vehicle Documents
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_documents (
      id, vehicle_id, document_type, file_id, title, document_number, issuer, issued_at, expires_at, verification_status, created_by, created_at, updated_at
    ) VALUES
      ('vdoc_seed_01', 'veh_seed_car_01', 'REGISTRATION', 'file_prado_logbook_pdf', 'Logbook / Certificate of Vehicle Registration', 'LOG-2021-KE-8910', 'National Transport and Safety Authority', '2021-04-10T00:00:00.000Z', NULL, 'DOCUMENT_VERIFIED', 'usr_seed_owner_01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('vdoc_seed_02', 'veh_seed_car_01', 'INSURANCE', 'file_prado_insurance_pdf', 'Comprehensive Motor Insurance Certificate', 'INS-772910-AA', 'APA Insurance Kenya', '2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 'DOCUMENT_VERIFIED', 'usr_seed_owner_01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  // 9. Seed Canonical Timeline Event (GAR-005)
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_timeline_events (
      id, vehicle_id, entry_type, occurred_at, recorded_at, source_class, source_ref,
      verification_state, subject_refs, summary_payload, privacy_class, created_at, updated_at
    ) VALUES (
      'tl_seed_01', 'veh_seed_car_01', 'SERVICE', '2026-02-15T09:30:00.000Z', '2026-02-15T09:30:00.000Z',
      'PROVIDER_RECORDED', 'srv_seed_garage_01', 'EXTERNALLY_VERIFIED',
      '{"service_id":"srv_seed_garage_01","odometer_km":54200}',
      '{"title":"50,000 km Major Service & Synthetic Oil Change","provider_name":"Nairobi Premier Auto Clinic"}',
      'INTERNAL', '2026-02-15T09:30:00.000Z', '2026-02-15T09:30:00.000Z'
    );
  `).run();

  // 10. Seed Verified Service Provider (GAR-011)
  db.prepare(`
    INSERT INTO service_providers (
      id, organization_id, name, legal_business_name, provider_type,
      description, website, email, phone,
      status, verification_status, accepts_bookings, accepts_mobile_jobs, accepts_roadside_jobs, accepts_towing_jobs,
      service_radius_km, currency, created_at, updated_at
    ) VALUES (
      'srv_seed_garage_01', 'org_seed_garage_01', 'Nairobi Premier Auto Clinic', 'Nairobi Premier Automotive Services Ltd',
      'GARAGE',
      'Full-service automotive workshop offering dealer-grade computerized diagnostics, scheduled servicing, brake systems and mechanical overhauls.',
      'https://nairobiautoclinic.garageos.ke', 'service@nairobiauto.test', '+254700123456',
      'ACTIVE', 'VERIFIED', 1, 1, 1, 0,
      35.0, 'KES', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    )
    ON CONFLICT(id) DO UPDATE SET
      organization_id = excluded.organization_id,
      legal_business_name = excluded.legal_business_name,
      provider_type = excluded.provider_type,
      verification_status = excluded.verification_status,
      accepts_bookings = excluded.accepts_bookings,
      accepts_mobile_jobs = excluded.accepts_mobile_jobs,
      accepts_roadside_jobs = excluded.accepts_roadside_jobs,
      service_radius_km = excluded.service_radius_km;
  `).run();

  // 11. Seed Canonical Sprint 4 Timeline Entries (GAR-005)
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_timeline_entries (
      id, vehicle_id, entry_type, category, occurred_at, recorded_at,
      title, summary, source_type, source_reference_type, source_reference_id,
      source_event_id, actor_type, actor_id, organization_id,
      verification_status, confidence, odometer_value, odometer_unit,
      location_reference, visibility, sensitivity, supersedes_timeline_entry_id,
      corrected_by_timeline_entry_id, is_active, metadata, created_at, updated_at
    ) VALUES
    (
      'vte_seed_srv_01', 'veh_seed_car_01', 'SERVICE_COMPLETED', 'SERVICE',
      '2026-02-15T09:30:00.000Z', '2026-02-15T09:30:00.000Z',
      '50,000 km Major Service & Synthetic Oil Change',
      'Full factory-spec scheduled maintenance, engine oil replacement (Castrol Edge 5W-30), oil filter, fuel filter, and multi-point safety inspection.',
      'PROVIDER_RECORDED', 'SERVICE_RECORD', 'srv_seed_garage_01', 'seed:vte_srv_01',
      'SERVICE_PROVIDER', 'usr_seed_mechanic', 'srv_seed_garage_01',
      'VERIFIED', 1.0, 54200, 'KM',
      'Nairobi Premier Auto Clinic, Industrial Area', 'PASSPORT_SHARED', 'NORMAL',
      NULL, NULL, 1,
      '{"provider_name":"Nairobi Premier Auto Clinic","technician":"Peter Kamau","parts_replaced":["Engine Oil 5W-30","Oil Filter OEM","Fuel Filter"]}',
      '2026-02-15T09:30:00.000Z', '2026-02-15T09:30:00.000Z'
    ),
    (
      'vte_seed_rep_01', 'veh_seed_car_01', 'REPAIR_COMPLETED', 'REPAIR',
      '2025-11-20T11:00:00.000Z', '2025-11-20T11:00:00.000Z',
      'Ceramic Brake Pads & Rotor Resurfacing',
      'Replaced front ceramic brake pads and resurfaced brake discs following routine wear detection.',
      'PROVIDER_RECORDED', 'REPAIR_RECORD', 'srv_seed_garage_01', 'seed:vte_rep_01',
      'SERVICE_PROVIDER', 'usr_seed_mechanic', 'srv_seed_garage_01',
      'VERIFIED', 1.0, 48500, 'KM',
      'Nairobi Premier Auto Clinic', 'PASSPORT_SHARED', 'NORMAL',
      NULL, NULL, 1,
      '{"part_category":"BRAKES","brand":"Akebono ProACT Ceramic"}',
      '2025-11-20T11:00:00.000Z', '2025-11-20T11:00:00.000Z'
    ),
    (
      'vte_seed_tyr_01', 'veh_seed_car_01', 'TYRE_INSTALLED', 'TYRES',
      '2025-08-14T14:30:00.000Z', '2025-08-14T14:30:00.000Z',
      'Set of 4 All-Terrain Tyres Installed',
      'Installed four BFGoodrich All-Terrain T/A KO2 tyres with dynamic laser wheel balancing and alignment.',
      'PROVIDER_RECORDED', 'INVOICE', 'inv_tyre_891', 'seed:vte_tyr_01',
      'SERVICE_PROVIDER', 'usr_seed_mechanic', 'srv_seed_garage_01',
      'VERIFIED', 1.0, 42100, 'KM',
      'Nairobi Premier Auto Clinic', 'PASSPORT_SHARED', 'NORMAL',
      NULL, NULL, 1,
      '{"brand":"BFGoodrich","size":"265/65 R17","position":"ALL","pattern":"All-Terrain T/A KO2"}',
      '2025-08-14T14:30:00.000Z', '2025-08-14T14:30:00.000Z'
    ),
    (
      'vte_seed_iss_01', 'veh_seed_car_01', 'ISSUE_RESOLVED', 'ISSUE',
      '2025-05-02T16:00:00.000Z', '2025-05-02T16:00:00.000Z',
      'Check Engine Light (P0455 EVAP) Diagnosed & Cleared',
      'Evaporative purge valve seal reseated and gas cap O-ring replaced; emissions circuit retested nominal.',
      'GARAGE_VERIFIED', 'DIAGNOSTIC_JOB', 'diag_evap_102', 'seed:vte_iss_01',
      'SERVICE_PROVIDER', 'usr_seed_mechanic', 'srv_seed_garage_01',
      'VERIFIED', 1.0, 36800, 'KM',
      'Nairobi Premier Auto Clinic', 'PASSPORT_SHARED', 'NORMAL',
      NULL, NULL, 1,
      '{"dtc_code":"P0455","status":"RESOLVED","resolved_at":"2025-05-02T16:00:00.000Z"}',
      '2025-05-02T16:00:00.000Z', '2025-05-02T16:00:00.000Z'
    ),
    (
      'vte_seed_mod_01', 'veh_seed_car_01', 'MODIFICATION_INSTALLED', 'MODIFICATION',
      '2024-03-10T10:00:00.000Z', '2024-03-10T10:00:00.000Z',
      'Heavy-Duty Aluminum Safari Skid Plate Underbody Protection',
      'Mounted 4mm aircraft-grade aluminum underbody sump and transfer case skid plates for off-road durability.',
      'OWNER_ENTERED', 'OWNER_RECORD', 'rec_mod_01', 'seed:vte_mod_01',
      'VEHICLE_OWNER', 'usr_seed_owner_01', NULL,
      'OWNER_ASSERTED', 0.9, 18500, 'KM',
      'Nairobi', 'PASSPORT_SHARED', 'NORMAL',
      NULL, NULL, 1,
      '{"manufacturer":"Safari Armor","material":"Aluminum 5083 4mm"}',
      '2024-03-10T10:00:00.000Z', '2024-03-10T10:00:00.000Z'
    );
  `).run();

  // 12. Seed Canonical Issues (GAR-008 Sprint 6)
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_issues (
      id, vehicle_id, issue_code, title, summary, category, severity, status, persistence_state,
      primary_component_category, first_observed_at, first_observed_odometer_km,
      last_observed_at, last_observed_odometer_km, occurrence_count, diagnosis_count,
      intervention_count, last_intervention_id, created_by, created_at, updated_at
    ) VALUES
    (
      'iss_seed_prado_01', 'veh_seed_car_01', 'ISS-2026-001',
      'Front-end steering vibration at highway speeds (80-100 km/h)',
      'Subtle high-frequency steering wheel wobble developing between 80 km/h and 100 km/h on smooth tarmac.',
      'STEERING', 'MODERATE', 'MONITORING', 'REPEATED',
      'FRONT_SUSPENSION_STEERING', '2026-01-15T08:00:00.000Z', 51200,
      '2026-02-18T14:30:00.000Z', 54350, 3, 1,
      1, 'intv_seed_01', 'usr_seed_owner_01',
      '2026-01-15T08:00:00.000Z', '2026-02-19T10:00:00.000Z'
    ),
    (
      'iss_seed_outback_01', 'veh_seed_car_02', 'ISS-2026-002',
      'Cold morning engine hesitation and rough idle for 30 seconds',
      'Engine stumbles briefly on cold start when ambient temperature is below 16°C, clears once warmed up.',
      'ENGINE', 'LOW', 'UNDER_OBSERVATION', 'INTERMITTENT',
      'FUEL_AIR_INTAKE', '2026-02-05T06:45:00.000Z', 88100,
      '2026-02-12T06:30:00.000Z', 88450, 2, 0,
      0, NULL, 'usr_seed_owner_01',
      '2026-02-05T06:45:00.000Z', '2026-02-12T06:30:00.000Z'
    );
  `).run();

  // Seed occurrences for iss_seed_prado_01
  db.prepare(`
    INSERT OR IGNORE INTO issue_occurrences (
      id, vehicle_issue_id, vehicle_id, occurred_at, recorded_at,
      odometer_value, odometer_unit, odometer_km, description, symptom_category,
      driving_condition, speed_range, engine_temperature_state, weather_context,
      road_condition, source_type, actor_id, location_reference, evidence_count,
      created_at
    ) VALUES
    (
      'occ_seed_01', 'iss_seed_prado_01', 'veh_seed_car_01',
      '2026-01-15T08:00:00.000Z', '2026-01-15T08:30:00.000Z',
      51200, 'KM', 51200,
      'First noticed steering wheel oscillating rapidly when cruising at 85 km/h on highway toward Naivasha.',
      'VIBRATION', 'AT_HIGH_SPEED', '80-100 km/h', 'NORMAL', 'DRY_CLEAR',
      'SMOOTH_TARMAC', 'OWNER_ASSERTED', 'usr_seed_owner_01', 'Naivasha Highway', 0,
      '2026-01-15T08:30:00.000Z'
    ),
    (
      'occ_seed_02', 'iss_seed_prado_01', 'veh_seed_car_01',
      '2026-01-28T16:20:00.000Z', '2026-01-28T17:00:00.000Z',
      52400, 'KM', 52400,
      'Vibration repeated at exactly 92 km/h on Southern Bypass. Vanished below 75 km/h.',
      'VIBRATION', 'AT_HIGH_SPEED', '80-100 km/h', 'NORMAL', 'DRY_CLEAR',
      'SMOOTH_TARMAC', 'OWNER_ASSERTED', 'usr_seed_owner_01', 'Southern Bypass', 0,
      '2026-01-28T17:00:00.000Z'
    ),
    (
      'occ_seed_03', 'iss_seed_prado_01', 'veh_seed_car_01',
      '2026-02-10T11:15:00.000Z', '2026-02-10T12:00:00.000Z',
      53900, 'KM', 53900,
      'Vibration became slightly more pronounced under gentle braking from 100 km/h down to 80 km/h.',
      'VIBRATION', 'WHILE_BRAKING', '80-100 km/h', 'NORMAL', 'DRY_CLEAR',
      'SMOOTH_TARMAC', 'OWNER_ASSERTED', 'usr_seed_owner_01', 'Mombasa Road', 0,
      '2026-02-10T12:00:00.000Z'
    );
  `).run();

  // Seed Diagnosis for iss_seed_prado_01
  db.prepare(`
    INSERT OR IGNORE INTO issue_diagnoses (
      id, vehicle_issue_id, vehicle_id, provider_id, provider_name, technician_id,
      technician_name, diagnosed_at, diagnosis_code, diagnosis_summary, diagnosis_details,
      confirmed_component, outcome, verification_status, evidence_reference_ids,
      source_work_order_id, created_at
    ) VALUES (
      'diag_seed_01', 'iss_seed_prado_01', 'veh_seed_car_01',
      'srv_seed_garage_01', 'Nairobi Premier Auto Clinic', 'usr_seed_mechanic',
      'Kamau Kariuki (Senior Master Tech)', '2026-02-16T10:30:00.000Z',
      'CHAS-SUSP-77B', 'Front lower control arm hydro-bushings degraded with slight radial tear.',
      'Put vehicle on four-post lift and dial indicator test. Left lower control arm bushing has 3.2mm excessive deflection under lateral load test. Wheel rim runouts measured true <0.3mm.',
      'Front Left/Right Lower Control Arm Bushings', 'CONFIRMED',
      'PROVIDER_RECORDED', '[]',
      'wo_diag_001', '2026-02-16T10:30:00.000Z'
    );
  `).run();

  // Seed Intervention for iss_seed_prado_01
  db.prepare(`
    INSERT OR IGNORE INTO issue_interventions (
      id, vehicle_issue_id, vehicle_id, intervention_type, description,
      performed_at, odometer_value, odometer_unit, odometer_km, provider_id, provider_name,
      work_order_id, replaced_part_names, cost_total, currency, result, verification_status,
      notes, created_at
    ) VALUES (
      'intv_seed_01', 'iss_seed_prado_01', 'veh_seed_car_01',
      'REPLACEMENT',
      'Pressed out worn bushings, pressed in OEM heavy-duty control arm bushing pair, performed 4-wheel Hunter laser alignment and road force re-balance.',
      '2026-02-18T14:00:00.000Z', 54300, 'KM', 54300,
      'srv_seed_garage_01', 'Nairobi Premier Auto Clinic',
      'wo_rep_001',
      '["Toyota OEM Front Lower Control Arm Bushing LH 48654-60030", "Toyota OEM Front Lower Control Arm Bushing RH 48655-60030"]',
      18500, 'KES', 'AWAITING_OBSERVATION', 'PROVIDER_RECORDED',
      'Alignment specs set to OEM camber -0.2°, caster +3.8°, total toe +0.10°. Recommend highway road check.',
      '2026-02-18T14:00:00.000Z'
    );
  `).run();

  // Seed Followup for iss_seed_prado_01
  db.prepare(`
    INSERT OR IGNORE INTO issue_followups (
      id, vehicle_issue_id, intervention_id, scheduled_at, due_date,
      due_odometer_km, status, prompt_message, response, response_notes,
      responded_at, responded_by, created_at, updated_at
    ) VALUES (
      'fol_seed_01', 'iss_seed_prado_01', 'intv_seed_01',
      '2026-02-18T14:00:00.000Z', '2026-02-25T14:00:00.000Z',
      54800, 'DUE',
      'Have you driven on the highway at 80-100 km/h? Is the front-end vibration completely resolved?',
      NULL, NULL, NULL, NULL,
      '2026-02-18T14:00:00.000Z', '2026-02-18T14:00:00.000Z'
    );
  `).run();

  // 12. Seed Sprint 7 Fuel Purchases, Economy & Expenses (GAR-009)
  // Fuel Entries for Prado (veh_seed_car_01 - Diesel)
  db.prepare(`
    INSERT OR IGNORE INTO fuel_entries (
      id, vehicle_id, fueled_at, recorded_at, odometer_value, odometer_unit, odometer_km,
      fuel_type, quantity, quantity_unit, quantity_litres, total_cost, currency,
      price_per_unit, fill_type, tank_level_before, tank_level_after, station_name,
      location_reference, source_type, actor_id, is_corrected, created_at, updated_at
    ) VALUES
      ('fuel_seed_01', 'veh_seed_car_01', '2026-01-10T08:00:00.000Z', '2026-01-10T08:00:00.000Z', 52000, 'KM', 52000, 'DIESEL', 70.0, 'LITRE', 70.0, 12600.0, 'KES', 180.0, 'FULL', 0.15, 1.0, 'TotalEnergies Hurlingham', 'Nairobi', 'OWNER_ENTERED', 'usr_seed_owner_01', 0, '2026-01-10T08:00:00.000Z', '2026-01-10T08:00:00.000Z'),
      ('fuel_seed_02', 'veh_seed_car_01', '2026-01-22T09:30:00.000Z', '2026-01-22T09:30:00.000Z', 52750, 'KM', 52750, 'DIESEL', 68.0, 'LITRE', 68.0, 12240.0, 'KES', 180.0, 'FULL', 0.10, 1.0, 'Rubis Westlands', 'Nairobi', 'OWNER_ENTERED', 'usr_seed_owner_01', 0, '2026-01-22T09:30:00.000Z', '2026-01-22T09:30:00.000Z'),
      ('fuel_seed_03', 'veh_seed_car_01', '2026-02-02T10:15:00.000Z', '2026-02-02T10:15:00.000Z', 53480, 'KM', 53480, 'DIESEL', 66.0, 'LITRE', 66.0, 11880.0, 'KES', 180.0, 'FULL', 0.12, 1.0, 'Shell Ngong Road', 'Nairobi', 'OWNER_ENTERED', 'usr_seed_owner_01', 0, '2026-02-02T10:15:00.000Z', '2026-02-02T10:15:00.000Z'),
      ('fuel_seed_04', 'veh_seed_car_01', '2026-02-14T17:00:00.000Z', '2026-02-14T17:00:00.000Z', 54200, 'KM', 54200, 'DIESEL', 65.0, 'LITRE', 65.0, 11700.0, 'KES', 180.0, 'FULL', 0.14, 1.0, 'Ola Energy Gigiri', 'Nairobi', 'OWNER_ENTERED', 'usr_seed_owner_01', 0, '2026-02-14T17:00:00.000Z', '2026-02-14T17:00:00.000Z');
  `).run();

  // Calculated Intervals for Prado
  db.prepare(`
    INSERT OR IGNORE INTO fuel_economy_intervals (
      id, vehicle_id, start_fuel_entry_id, end_fuel_entry_id, distance_km,
      fuel_consumed_litres, km_per_litre, litres_per_100_km, mpg_us, mpg_uk,
      confidence, partial_fills_included_count, calculated_at
    ) VALUES
      ('fei_seed_01', 'veh_seed_car_01', 'fuel_seed_01', 'fuel_seed_02', 750.0, 68.0, 11.03, 9.07, 25.94, 31.16, 'HIGH', 0, '2026-01-22T09:30:00.000Z'),
      ('fei_seed_02', 'veh_seed_car_01', 'fuel_seed_02', 'fuel_seed_03', 730.0, 66.0, 11.06, 9.04, 26.01, 31.24, 'HIGH', 0, '2026-02-02T10:15:00.000Z'),
      ('fei_seed_03', 'veh_seed_car_01', 'fuel_seed_03', 'fuel_seed_04', 720.0, 65.0, 11.08, 9.03, 26.06, 31.30, 'HIGH', 0, '2026-02-14T17:00:00.000Z');
  `).run();

  // Fuel Efficiency Snapshot for Prado
  db.prepare(`
    INSERT OR IGNORE INTO fuel_efficiency_snapshots (
      id, vehicle_id, rolling_economy_km_l, baseline_economy_km_l, delta_percent,
      anomaly_detected, observation_text, data_quality, qualifying_intervals_count,
      total_distance_km, observed_at, created_at
    ) VALUES (
      'fes_seed_01', 'veh_seed_car_01', 11.07, 11.06, 0.09,
      0, 'Fuel consumption is consistent with historical baseline.', 'HIGH', 3,
      2200.0, '2026-02-14T17:00:00.000Z', '2026-02-14T17:00:00.000Z'
    );
  `).run();

  // Expenses for Prado
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_expenses (
      id, vehicle_id, expense_category, expense_subcategory, occurred_at, recorded_at,
      amount, currency, cost_type, status, description, source_type,
      source_reference_type, source_reference_id, merchant_provider_id,
      recurring_expense_id, odometer_km, notes, is_corrected, created_by, created_at, updated_at
    ) VALUES
      ('vexp_seed_01', 'veh_seed_car_01', 'FUEL', 'FUEL_FILL', '2026-01-10T08:00:00.000Z', '2026-01-10T08:00:00.000Z', 12600.0, 'KES', 'ACTUAL', 'CONFIRMED', 'Fuel purchase - 70L Diesel', 'SYSTEM_DERIVED', 'FUEL_ENTRY', 'fuel_seed_01', NULL, NULL, 52000, 'TotalEnergies Hurlingham', 0, 'usr_seed_owner_01', '2026-01-10T08:00:00.000Z', '2026-01-10T08:00:00.000Z'),
      ('vexp_seed_02', 'veh_seed_car_01', 'FUEL', 'FUEL_FILL', '2026-01-22T09:30:00.000Z', '2026-01-22T09:30:00.000Z', 12240.0, 'KES', 'ACTUAL', 'CONFIRMED', 'Fuel purchase - 68L Diesel', 'SYSTEM_DERIVED', 'FUEL_ENTRY', 'fuel_seed_02', NULL, NULL, 52750, 'Rubis Westlands', 0, 'usr_seed_owner_01', '2026-01-22T09:30:00.000Z', '2026-01-22T09:30:00.000Z'),
      ('vexp_seed_03', 'veh_seed_car_01', 'FUEL', 'FUEL_FILL', '2026-02-02T10:15:00.000Z', '2026-02-02T10:15:00.000Z', 11880.0, 'KES', 'ACTUAL', 'CONFIRMED', 'Fuel purchase - 66L Diesel', 'SYSTEM_DERIVED', 'FUEL_ENTRY', 'fuel_seed_03', NULL, NULL, 53480, 'Shell Ngong Road', 0, 'usr_seed_owner_01', '2026-02-02T10:15:00.000Z', '2026-02-02T10:15:00.000Z'),
      ('vexp_seed_04', 'veh_seed_car_01', 'FUEL', 'FUEL_FILL', '2026-02-14T17:00:00.000Z', '2026-02-14T17:00:00.000Z', 11700.0, 'KES', 'ACTUAL', 'CONFIRMED', 'Fuel purchase - 65L Diesel', 'SYSTEM_DERIVED', 'FUEL_ENTRY', 'fuel_seed_04', NULL, NULL, 54200, 'Ola Energy Gigiri', 0, 'usr_seed_owner_01', '2026-02-14T17:00:00.000Z', '2026-02-14T17:00:00.000Z'),
      ('vexp_seed_05', 'veh_seed_car_01', 'INSURANCE', 'ANNUAL_COMPREHENSIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 85000.0, 'KES', 'ACTUAL', 'CONFIRMED', 'Annual Comprehensive Motor Insurance Premium', 'OWNER_ENTERED', NULL, NULL, 'APA Insurance Kenya', NULL, 51500, 'Policy INS-772910-AA', 0, 'usr_seed_owner_01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('vexp_seed_06', 'veh_seed_car_01', 'MAINTENANCE', 'SCHEDULED_SERVICE', '2026-02-15T12:00:00.000Z', '2026-02-15T12:00:00.000Z', 28500.0, 'KES', 'ACTUAL', 'CONFIRMED', '50,000 KM Major Service & Synthetic Fluids', 'SERVICE_TRANSACTION', 'MAINTENANCE_COMPLETION', 'mc_seed_01', 'srv_seed_garage_01', NULL, 54200, 'Invoice INV-2026-089', 0, 'usr_seed_owner_01', '2026-02-15T12:00:00.000Z', '2026-02-15T12:00:00.000Z'),
      ('vexp_seed_07', 'veh_seed_car_01', 'REPAIR', 'SUSPENSION', '2026-02-18T14:00:00.000Z', '2026-02-18T14:00:00.000Z', 18500.0, 'KES', 'ACTUAL', 'CONFIRMED', 'Control arm bushing pair & Hunter 4-wheel laser alignment', 'SERVICE_TRANSACTION', 'ISSUE_INTERVENTION', 'intv_seed_01', 'srv_seed_garage_01', NULL, 54300, 'Work Order wo_rep_001', 0, 'usr_seed_owner_01', '2026-02-18T14:00:00.000Z', '2026-02-18T14:00:00.000Z'),
      ('vexp_seed_08', 'veh_seed_car_01', 'PARKING', 'CBD_MONTHLY', '2026-02-01T08:00:00.000Z', '2026-02-01T08:00:00.000Z', 4500.0, 'KES', 'ACTUAL', 'CONFIRMED', 'Nairobi County CBD Monthly Parking Pass', 'OWNER_ENTERED', NULL, NULL, 'Nairobi County Government', NULL, NULL, 'Receipt NRB-PRK-2026-02', 0, 'usr_seed_owner_01', '2026-02-01T08:00:00.000Z', '2026-02-01T08:00:00.000Z'),
      ('vexp_seed_09', 'veh_seed_car_01', 'WASH_DETAILING', 'FULL_VALET', '2026-02-08T15:00:00.000Z', '2026-02-08T15:00:00.000Z', 2500.0, 'KES', 'ACTUAL', 'CONFIRMED', 'Executive Underbody Wash & Interior Steam Clean', 'OWNER_ENTERED', NULL, NULL, 'Sparkle Auto Spa Karen', NULL, NULL, NULL, 0, 'usr_seed_owner_01', '2026-02-08T15:00:00.000Z', '2026-02-08T15:00:00.000Z');
  `).run();

  // Recurring Expenses for Prado
  db.prepare(`
    INSERT OR IGNORE INTO recurring_vehicle_expenses (
      id, vehicle_id, category, description, amount, currency, frequency,
      start_date, end_date, next_due_date, status, auto_create_expense,
      created_at, updated_at
    ) VALUES
      ('vrec_seed_01', 'veh_seed_car_01', 'INSURANCE', 'Annual Comprehensive Motor Insurance Premium', 85000.0, 'KES', 'ANNUAL', '2026-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 'ACTIVE', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('vrec_seed_02', 'veh_seed_car_01', 'PARKING', 'Nairobi CBD Monthly Parking Permit', 4500.0, 'KES', 'MONTHLY', '2026-01-01T00:00:00.000Z', NULL, '2026-03-01T00:00:00.000Z', 'ACTIVE', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  // 15. Seed Sprint 8 Canonical Component Taxonomy & Parts Catalog (GAR-010)
  db.prepare(`
    INSERT OR IGNORE INTO component_definitions (
      id, code, name, category, classification, position_sensitive, replaceable, serviceable, serializable, created_at, updated_at
    ) VALUES
      ('cdef_battery', 'BATTERY_12V', '12V Lead-Acid / AGM Starter Battery', 'BATTERY', 'DURABLE_COMPONENT', 0, 1, 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('cdef_brake_pads_front', 'BRAKE_PADS_FRONT', 'Front Axle Disc Brake Pads Set', 'BRAKES', 'WEAR_ITEM', 1, 1, 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('cdef_tyre', 'TYRE_PNEUMATIC', 'Pneumatic Road Tyre', 'TYRES', 'WEAR_ITEM', 1, 1, 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO parts_catalog_items (
      id, component_definition_id, manufacturer, brand, part_number, oem_number, name, description, classification, condition, created_at, updated_at
    ) VALUES
      ('cat_bosch_s5_agm', 'cdef_battery', 'Bosch', 'Bosch', '0 092 S5A 130', '28800-YZZA1', 'Bosch S5 A13 AGM Heavy Duty Battery 12V 95Ah 850A', 'High performance AGM battery for heavy electrical loads', 'AFTERMARKET_PREMIUM', 'NEW', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('cat_brembo_p83024', 'cdef_brake_pads_front', 'Brembo', 'Brembo', 'P83024', '04465-35290', 'Brembo Ceramic Front Brake Pads Set', 'Low-dust high coefficient ceramic composite brake pads', 'AFTERMARKET_PREMIUM', 'NEW', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('cat_bfg_ko2_265_65r17', 'cdef_tyre', 'Michelin / BFGoodrich', 'BFGoodrich', 'KO2-265-65R17', NULL, 'BFGoodrich All-Terrain T/A KO2 265/65 R17', 'Severe snow and mud rated all-terrain tyre with CoreGard', 'AFTERMARKET_UPGRADE', 'NEW', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  // Replaced Old Factory Battery (Chain of custody)
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_components (
      id, vehicle_id, component_definition_id, part_id, custom_name, category,
      classification, brand, part_number, oem_number, position, serial_number,
      status, is_current, installed_at, installed_odometer_km, installed_odometer_unit,
      removed_at, removed_odometer_km, removal_reason,
      installation_source, installation_provider_id, installation_provider_name, installation_work_order_id, verification_status,
      maintenance_completion_id, issue_intervention_id, vehicle_expense_id, notes, created_at, updated_at
    ) VALUES (
      'comp_seed_bat_old', 'veh_seed_car_01', 'cdef_battery', NULL, 'Original Factory AGM Battery 12V 80Ah', 'BATTERY',
      'DURABLE_COMPONENT', 'Panasonic', '28800-YZZA1', '28800-YZZA1', 'ENGINE_BAY', 'PANA-2021-08-991',
      'REPLACED', 0, '2021-06-15T00:00:00.000Z', 0, 'KM',
      '2025-09-10T10:00:00.000Z', 43000, 'WORN',
      'FACTORY_ORIGINAL', NULL, 'Toyota Factory Assembly Tahara', NULL, 'VERIFIED',
      NULL, NULL, NULL, 'Replaced after cell degradation at 43,000 km', '2025-09-10T10:00:00.000Z', '2025-09-10T10:00:00.000Z'
    );
  `).run();

  // Current Active Bosch Battery
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_components (
      id, vehicle_id, component_definition_id, part_id, custom_name, category,
      classification, brand, part_number, oem_number, position, serial_number,
      status, is_current, installed_at, installed_odometer_km, installed_odometer_unit,
      removed_at, removed_odometer_km, removal_reason,
      installation_source, installation_provider_id, installation_provider_name, installation_work_order_id, verification_status,
      maintenance_completion_id, issue_intervention_id, vehicle_expense_id, notes, created_at, updated_at
    ) VALUES (
      'comp_seed_bat_current', 'veh_seed_car_01', 'cdef_battery', 'cat_bosch_s5_agm', 'Bosch S5 A13 AGM Heavy Duty Battery 12V 95Ah 850A', 'BATTERY',
      'DURABLE_COMPONENT', 'Bosch', '0 092 S5A 130', '28800-YZZA1', 'ENGINE_BAY', 'BSH-AGM-2025-901',
      'INSTALLED', 1, '2025-09-10T10:00:00.000Z', 43000, 'KM',
      NULL, NULL, NULL,
      'GARAGE_RECORDED', 'srv_seed_garage_01', 'Nairobi Premier Auto Clinic', 'wo_bat_2025_09', 'PROVIDER_RECORDED',
      NULL, NULL, NULL, 'High cold-cranking performance AGM upgrade', '2025-09-10T10:00:00.000Z', '2025-09-10T10:00:00.000Z'
    );
  `).run();

  // Battery Replacement Chain Link (GAR-010 §13)
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_component_replacements (
      id, vehicle_id, old_component_id, new_component_id, replaced_at, odometer_km, reason, notes, created_at
    ) VALUES (
      'rep_seed_bat_01', 'veh_seed_car_01', 'comp_seed_bat_old', 'comp_seed_bat_current',
      '2025-09-10T10:00:00.000Z', 43000, 'WORN',
      'Replaced degraded factory Panasonic battery with premium Bosch S5 AGM battery', '2025-09-10T10:00:00.000Z'
    );
  `).run();

  // Active Battery Warranty (GAR-010 §22-§25)
  db.prepare(`
    INSERT OR IGNORE INTO component_warranties (
      id, vehicle_component_id, vehicle_id, provider_id, seller_id, warranty_type,
      starts_at, expires_at, distance_limit_km, terms_summary, document_reference,
      status, created_at, updated_at
    ) VALUES (
      'warr_seed_bat_01', 'comp_seed_bat_current', 'veh_seed_car_01', 'srv_seed_garage_01', 'srv_seed_garage_01',
      'MANUFACTURER', '2025-09-10T10:00:00.000Z', '2027-09-10T10:00:00.000Z', 50000,
      '24 Months or 50,000 km full free replacement warranty against internal cell failure', 'DOC-WARR-BOSCH-8821',
      'ACTIVE', '2025-09-10T10:00:00.000Z', '2025-09-10T10:00:00.000Z'
    );
  `).run();

  // Current Active Front Brake Pads
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_components (
      id, vehicle_id, component_definition_id, part_id, custom_name, category,
      classification, brand, part_number, oem_number, position, serial_number,
      status, is_current, installed_at, installed_odometer_km, installed_odometer_unit,
      removed_at, removed_odometer_km, removal_reason,
      installation_source, installation_provider_id, installation_provider_name, installation_work_order_id, verification_status,
      maintenance_completion_id, issue_intervention_id, vehicle_expense_id, notes, created_at, updated_at
    ) VALUES (
      'comp_seed_brake_front', 'veh_seed_car_01', 'cdef_brake_pads_front', 'cat_brembo_p83024', 'Brembo Ceramic Front Brake Pads Set', 'BRAKES',
      'WEAR_ITEM', 'Brembo', 'P83024', '04465-35290', 'FRONT_AXLE', NULL,
      'INSTALLED', 1, '2025-11-20T11:00:00.000Z', 48500, 'KM',
      NULL, NULL, NULL,
      'GARAGE_RECORDED', 'srv_seed_garage_01', 'Nairobi Premier Auto Clinic', 'wo_brk_2025_11', 'PROVIDER_RECORDED',
      NULL, NULL, NULL, 'Low-dust high coefficient ceramic composite', '2025-11-20T11:00:00.000Z', '2025-11-20T11:00:00.000Z'
    );
  `).run();

  // 16. Seed Sprint 8 Canonical Tyres, Positions & Rotations (GAR-010 §28-§47)
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_tyre_sets (
      id, vehicle_id, name, season_type, installed_at, status, created_at
    ) VALUES (
      'set_bfg_ko2_01', 'veh_seed_car_01', 'BFGoodrich All-Terrain T/A KO2 Set', 'ALL_SEASON',
      '2025-08-14T14:30:00.000Z', 'ACTIVE', '2025-08-14T14:30:00.000Z'
    );
  `).run();

  const tyrePositions = [
    { id: 'tyre_seed_fl', pos: 'FRONT_LEFT', serial: 'DOT-BFG-4024-FL' },
    { id: 'tyre_seed_fr', pos: 'FRONT_RIGHT', serial: 'DOT-BFG-4024-FR' },
    { id: 'tyre_seed_rl', pos: 'REAR_LEFT', serial: 'DOT-BFG-4024-RL' },
    { id: 'tyre_seed_rr', pos: 'REAR_RIGHT', serial: 'DOT-BFG-4024-RR' },
    { id: 'tyre_seed_spare', pos: 'SPARE', serial: 'DOT-BFG-4024-SP' },
  ];

  for (const t of tyrePositions) {
    // 1. Dual-create vehicle component
    db.prepare(`
      INSERT OR IGNORE INTO vehicle_components (
        id, vehicle_id, component_definition_id, part_id, custom_name, category,
        classification, brand, part_number, oem_number, position, serial_number,
        status, is_current, installed_at, installed_odometer_km, installed_odometer_unit,
        removed_at, removed_odometer_km, removal_reason,
        installation_source, installation_provider_id, installation_provider_name, installation_work_order_id, verification_status,
        maintenance_completion_id, issue_intervention_id, vehicle_expense_id, notes, created_at, updated_at
      ) VALUES (
        ?, 'veh_seed_car_01', 'cdef_tyre', 'cat_bfg_ko2_265_65r17', 'BFGoodrich All-Terrain T/A KO2 265/65 R17', 'TYRES',
        'WEAR_ITEM', 'BFGoodrich', 'KO2-265-65R17', NULL, ?, ?,
        'INSTALLED', 1, '2025-08-14T14:30:00.000Z', 42100, 'KM',
        NULL, NULL, NULL,
        'GARAGE_RECORDED', 'srv_seed_garage_01', 'Nairobi Premier Auto Clinic', 'wo_tyr_2025_08', 'PROVIDER_RECORDED',
        NULL, NULL, NULL, 'Severe snow & mud rated all-terrain tyre', '2025-08-14T14:30:00.000Z', '2025-08-14T14:30:00.000Z'
      );
    `).run(`comp_${t.id}`, t.pos, t.serial);

    // 2. Insert vehicle tyre entity
    db.prepare(`
      INSERT OR IGNORE INTO vehicle_tyres (
        id, vehicle_id, vehicle_component_id, part_id, tyre_set_id, brand, model,
        size_raw, width, aspect_ratio, rim_diameter, construction, load_index, speed_rating,
        manufacture_dot_code, serial_number, status, installed_at, installed_odometer_km,
        removed_at, removed_odometer_km, removal_reason, provenance, verification_status,
        created_at, updated_at
      ) VALUES (
        ?, 'veh_seed_car_01', ?, 'cat_bfg_ko2_265_65r17', 'set_bfg_ko2_01', 'BFGoodrich', 'All-Terrain T/A KO2',
        '265/65 R17 116S', 265, 65, 17, 'RADIAL', 116, 'S',
        'DOT BFG 4024', ?, 'INSTALLED', '2025-08-14T14:30:00.000Z', 42100,
        NULL, NULL, NULL, 'GARAGE_RECORDED', 'PROVIDER_RECORDED',
        '2025-08-14T14:30:00.000Z', '2025-08-14T14:30:00.000Z'
      );
    `).run(t.id, `comp_${t.id}`, t.serial);

    // 3. Insert active position assignment
    db.prepare(`
      INSERT OR IGNORE INTO tyre_position_assignments (
        id, vehicle_tyre_id, vehicle_id, position, assigned_at, assigned_odometer_km,
        ended_at, ended_odometer_km, source, is_current, created_at
      ) VALUES (
        ?, ?, 'veh_seed_car_01', ?, '2026-01-20T10:00:00.000Z', 52500,
        NULL, NULL, 'ROTATION', 1, '2026-01-20T10:00:00.000Z'
      );
    `).run(`pos_${t.id}_cur`, t.id, t.pos);
  }

  // Tyre Rotation History (GAR-010 §33)
  db.prepare(`
    INSERT OR IGNORE INTO tyre_rotations (
      id, vehicle_id, performed_at, odometer_km, pattern, provider_id, provider_name,
      work_order_id, notes, maintenance_completion_id, created_at
    ) VALUES (
      'rot_seed_01', 'veh_seed_car_01', '2026-01-20T10:00:00.000Z', 52500,
      'FORWARD_CROSS', 'srv_seed_garage_01', 'Nairobi Premier Auto Clinic',
      'wo_rot_2026_01', '10,000 km routine tyre rotation and dynamic balance check', NULL, '2026-01-20T10:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO tyre_rotation_moves (
      id, tyre_rotation_id, vehicle_tyre_id, from_position, to_position, created_at
    ) VALUES
      ('trm_seed_01', 'rot_seed_01', 'tyre_seed_fl', 'FRONT_LEFT', 'REAR_RIGHT', '2026-01-20T10:00:00.000Z'),
      ('trm_seed_02', 'rot_seed_01', 'tyre_seed_fr', 'FRONT_RIGHT', 'REAR_LEFT', '2026-01-20T10:00:00.000Z');
  `).run();

  // Tyre Inspection for Front Left (GAR-010 §42-§43)
  db.prepare(`
    INSERT OR IGNORE INTO tyre_inspections (
      id, vehicle_tyre_id, vehicle_id, tread_depth_outer_mm, tread_depth_center_mm,
      tread_depth_inner_mm, pressure_psi, condition_rating, observed_at, source_type,
      provider_id, notes, created_at
    ) VALUES (
      'insp_seed_fl_01', 'tyre_seed_fl', 'veh_seed_car_01', 7.8, 8.1,
      7.7, 34.0, 'EXCELLENT', '2026-02-15T09:30:00.000Z', 'GARAGE_INSPECTION',
      'srv_seed_garage_01', 'Even wear pattern detected across outer, center and inner grooves. Pressure adjusted to 34 PSI cold.', '2026-02-15T09:30:00.000Z'
    );
  `).run();

  // 17. Seed Sprint 8 Vehicle Modifications & Configuration Overrides (GAR-010 §51-§56)
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_modifications (
      id, vehicle_id, category, name, description, installed_at, odometer_km,
      provider_id, provider_name, work_order_id, status, verification_status,
      vehicle_component_id, vehicle_expense_id, created_at, updated_at
    ) VALUES (
      'mod_seed_01', 'veh_seed_car_01', 'INFOTAINMENT', '10.25-inch Wireless Apple CarPlay & Android Auto Head Unit',
      'Upgraded factory audio console with high-definition capacitive IPS touchscreen, DSP amplifier module, and AHD wide-angle reverse camera',
      '2025-07-10T14:00:00.000Z', 40500, 'srv_seed_garage_01', 'Nairobi Premier Auto Clinic',
      'wo_mod_2025_07', 'INSTALLED', 'PROVIDER_RECORDED', NULL, NULL, '2025-07-10T14:00:00.000Z', '2025-07-10T14:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO vehicle_configuration_overrides (
      id, vehicle_id, attribute_key, original_value, current_value, source_reference,
      effective_from, effective_to, created_at
    ) VALUES (
      'ovr_seed_01', 'veh_seed_car_01', 'infotainment_system', 'Factory 7-inch Monochrome Display',
      '10.25-inch Wireless Apple CarPlay & Android Auto Touchscreen', 'Modification mod_seed_01',
      '2025-07-10T14:00:00.000Z', NULL, '2025-07-10T14:00:00.000Z'
    );
  `).run();

  // 18. Seed Sprint 9 Service Provider Domain Network (GAR-011)
  // Additional Service Providers
  db.prepare(`
    INSERT OR IGNORE INTO service_providers (
      id, organization_id, name, legal_business_name, provider_type,
      description, website, email, phone,
      status, verification_status, accepts_bookings, accepts_mobile_jobs, accepts_roadside_jobs, accepts_towing_jobs,
      service_radius_km, currency, created_at, updated_at
    ) VALUES
    (
      'srv_seed_towing_02', 'org_seed_towing_02', 'Mombasa Port Recovery & Heavy Towing', 'Mombasa Heavy Towing Services Ltd',
      'TOWING_RECOVERY',
      '24/7 Heavy vehicle towing, recovery, hydraulic flatbeds, winch recovery and coastal highway emergency roadside response.',
      'https://mombasarecovery.garageos.ke', 'dispatch@mombasarecovery.test', '+254711999888',
      'ACTIVE', 'VERIFIED', 1, 1, 1, 1,
      60.0, 'KES', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'srv_seed_mobile_03', 'org_seed_mobile_03', 'Safari Mobile Mechanic Express', 'Safari Mobile Mechanical Services',
      'MOBILE_MECHANIC',
      'On-demand mobile mechanics arriving at your home, office, or roadside with fully equipped mobile workshop vans.',
      'https://safarimobile.garageos.ke', 'mobile@safarimechanic.test', '+254722334455',
      'ACTIVE', 'VERIFIED', 1, 1, 1, 0,
      40.0, 'KES', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  // Seed Provider Locations
  db.prepare(`
    INSERT OR IGNORE INTO provider_locations (
      id, provider_id, name, location_type, address_line1, address_line2, city, county_state,
      postal_code, country, latitude, longitude, is_primary, created_at, updated_at
    ) VALUES
    (
      'prvloc_seed_ind_01', 'srv_seed_garage_01', 'Industrial Area Central Workshop', 'WORKSHOP', 'Enterprise Road, Plot 42', 'Opposite Crown Paints',
      'Nairobi', 'Nairobi County', '00100', 'KE', -1.3032, 36.8263, 1,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvloc_seed_wst_02', 'srv_seed_garage_01', 'Westlands Quick Service Center', 'BRANCH', 'Muthithi Road', 'Westlands Commercial Center',
      'Nairobi', 'Nairobi County', '00800', 'KE', -1.2683, 36.8111, 0,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvloc_seed_msa_03', 'srv_seed_towing_02', 'Mombasa Port Recovery Yard', 'TOW_YARD', 'Moi Avenue, Port Reitz Road', 'Near Gate 5',
      'Mombasa', 'Mombasa County', '80100', 'KE', -4.0435, 39.6682, 1,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvloc_seed_mob_04', 'srv_seed_mobile_03', 'Mobile Fleet Dispatch Center', 'MOBILE_BASE', 'Langata Road, Nairobi West', 'Unit 12',
      'Nairobi', 'Nairobi County', '00100', 'KE', -1.3120, 36.8180, 1,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  // Seed Provider Branches
  db.prepare(`
    INSERT OR IGNORE INTO provider_branches (
      id, provider_id, location_id, name, phone, email, status, created_at, updated_at
    ) VALUES
    (
      'prvbr_seed_01', 'srv_seed_garage_01', 'prvloc_seed_ind_01', 'Industrial Area Headquarters',
      '+254700123456', 'industrial@nairobiauto.test', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvbr_seed_02', 'srv_seed_garage_01', 'prvloc_seed_wst_02', 'Westlands Express Lane',
      '+254700123457', 'westlands@nairobiauto.test', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvbr_seed_03', 'srv_seed_towing_02', 'prvloc_seed_msa_03', 'Mombasa Port Command Center',
      '+254711999888', 'dispatch@mombasarecovery.test', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  // Seed Weekly Operating Hours
  // Garage: Mon-Sat 08:00 - 18:00, Sun Closed
  for (let day = 0; day <= 6; day++) {
    const isClosed = day === 0 ? 1 : 0;
    db.prepare(`
      INSERT OR IGNORE INTO provider_operating_hours (
        id, provider_id, branch_id, day_of_week, opens_at, closes_at, is_closed, created_at, updated_at
      ) VALUES (?, 'srv_seed_garage_01', NULL, ?, '08:00', '18:00', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `).run(`poh_seed_gar_${day}`, day, isClosed);
  }

  // Towing: 24/7 (Mon-Sun 00:00 - 23:59)
  for (let day = 0; day <= 6; day++) {
    db.prepare(`
      INSERT OR IGNORE INTO provider_operating_hours (
        id, provider_id, branch_id, day_of_week, opens_at, closes_at, is_closed, created_at, updated_at
      ) VALUES (?, 'srv_seed_towing_02', NULL, ?, '00:00', '23:59', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `).run(`poh_seed_tow_${day}`, day);
  }

  // Mobile: Mon-Sun 07:00 - 20:00
  for (let day = 0; day <= 6; day++) {
    db.prepare(`
      INSERT OR IGNORE INTO provider_operating_hours (
        id, provider_id, branch_id, day_of_week, opens_at, closes_at, is_closed, created_at, updated_at
      ) VALUES (?, 'srv_seed_mobile_03', NULL, ?, '07:00', '20:00', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `).run(`poh_seed_mob_${day}`, day);
  }

  // Seed Schedule Exception (Christmas Holiday)
  db.prepare(`
    INSERT OR IGNORE INTO provider_schedule_exceptions (
      id, provider_id, branch_id, exception_date, opens_at, closes_at, is_closed, reason, created_at
    ) VALUES
    ('pexc_seed_01', 'srv_seed_garage_01', NULL, '2026-12-25', NULL, NULL, 1, 'Christmas Day National Holiday', '2026-01-01T00:00:00.000Z');
  `).run();

  // Seed Service Areas
  db.prepare(`
    INSERT OR IGNORE INTO provider_service_areas (
      id, provider_id, region, area_type, center_lat, center_lng, radius_km, polygon_json, status, created_at, updated_at
    ) VALUES
    (
      'prvsar_seed_01', 'srv_seed_garage_01', 'Nairobi Greater Metropolitan Area', 'RADIUS',
      -1.286389, 36.817223, 35.0, NULL, 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvsar_seed_02', 'srv_seed_towing_02', 'Mombasa Coastline & Highway Corridor', 'RADIUS',
      -4.0435, 39.6682, 60.0, NULL, 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvsar_seed_03', 'srv_seed_mobile_03', 'Nairobi Expressway & Ring Roads Rapid Response', 'RADIUS',
      -1.3032, 36.8263, 40.0, NULL, 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  // Seed Service Categories (Canonical Taxonomy)
  db.prepare(`
    INSERT OR IGNORE INTO service_categories (
      id, code, name, description, icon, sort_order, is_active, created_at, updated_at
    ) VALUES
    ('cat_oil_change', 'OIL_CHANGE', 'Engine Oil & Filter Service', 'Periodic engine oil and filter renewal', 'droplet', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('cat_brake_pad_disc', 'BRAKE_SERVICE', 'Brake Systems & Rotors', 'Brake inspection, pad replacement and hydraulic bleeding', 'disc', 2, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('cat_obd_diag', 'DIAGNOSTICS', 'Computer Diagnostics & Scan', 'OBD-II vehicle electronics and sensor diagnostics', 'cpu', 3, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('cat_tyre_mount_balance', 'TYRES_WHEELS', 'Tyres, Alignment & Balance', 'Tyre mounting, 3D laser alignment and balancing', 'circle', 4, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('cat_ac_recharge', 'HVAC_AC', 'Air Conditioning & Climate', 'A/C refrigerant vacuum, leak test and recharge', 'wind', 5, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('cat_flatbed_towing', 'TOWING', 'Flatbed Towing & Recovery', 'Emergency flatbed transport and winching', 'truck', 6, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('cat_jumpstart', 'BATTERY_ELECTRICAL', 'Battery Jumpstart & Electrics', 'Emergency boost starting and alternator testing', 'zap', 7, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ('cat_mobile_minor_service', 'MOBILE_SERVICE', 'Mobile On-Site Maintenance', 'Routine periodic servicing at home or office', 'wrench', 8, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `).run();

  // Seed Provider Service Capabilities
  db.prepare(`
    INSERT OR IGNORE INTO provider_service_capabilities (
      id, provider_id, branch_id, service_category_id, service_code, service_name,
      description, delivery_mode, pricing_type, indicative_price, currency, status,
      booking_enabled, roadside_eligible, created_at, updated_at
    ) VALUES
    (
      'prvcap_seed_01', 'srv_seed_garage_01', NULL, 'cat_oil_change', 'SVC_OIL_CHANGE', 'Full Synthetic Oil Service',
      'Full synthetic 5W-30 / 0W-20 engine oil change with OEM-grade oil filter replacement and 24-point fluid check',
      'WORKSHOP', 'FIXED', 6500.0, 'KES', 'ACTIVE', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvcap_seed_02', 'srv_seed_garage_01', NULL, 'cat_brake_pad_disc', 'SVC_BRAKE_PAD', 'Brake Pad & Rotor Renewal',
      'Front and rear brake pad replacement, rotor runout inspection, caliper slide lubrication and hydraulic pressure test',
      'WORKSHOP', 'FIXED', 9500.0, 'KES', 'ACTIVE', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvcap_seed_03', 'srv_seed_garage_01', NULL, 'cat_obd_diag', 'SVC_OBD_DIAG', 'Computerized Diagnostic Scan',
      'OEM computerized diagnostic scan with bidirectional live data readout, clear fault codes, and emissions health report',
      'WORKSHOP', 'FIXED', 3500.0, 'KES', 'ACTIVE', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvcap_seed_04', 'srv_seed_garage_01', NULL, 'cat_tyre_mount_balance', 'SVC_TYRE_ALIGN', '3D Laser Alignment & Balance',
      'Computerized 3D four-wheel laser alignment, wheel balancing, and tyre rotation according to manufacturer pattern',
      'WORKSHOP', 'FIXED', 2500.0, 'KES', 'ACTIVE', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvcap_seed_05', 'srv_seed_garage_01', NULL, 'cat_ac_recharge', 'SVC_AC_RECHARGE', 'A/C Refrigerant Service',
      'Air conditioning refrigerant evacuation, UV dye leak check, vacuum test and R134a/R1234yf precision gas recharge',
      'WORKSHOP', 'FIXED', 5500.0, 'KES', 'ACTIVE', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvcap_seed_06', 'srv_seed_towing_02', NULL, 'cat_flatbed_towing', 'SVC_TOW_FLATBED', 'Emergency Flatbed Towing',
      'Emergency hydraulic flatbed towing service across Mombasa County and coastal highways up to 60 km',
      'TOWING', 'STARTING_AT', 7500.0, 'KES', 'ACTIVE', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvcap_seed_07', 'srv_seed_mobile_03', NULL, 'cat_jumpstart', 'SVC_JUMPSTART', 'Rapid Emergency Jumpstart',
      'Rapid emergency 12V/24V heavy-duty booster jumpstart, alternator charging output test and battery health diagnosis',
      'ROADSIDE', 'FIXED', 2500.0, 'KES', 'ACTIVE', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvcap_seed_08', 'srv_seed_mobile_03', NULL, 'cat_mobile_minor_service', 'SVC_MOBILE_LUBE', 'Mobile On-Site Minor Service',
      'On-site home or office minor maintenance including synthetic oil, oil filter, air filter and 20-point digital inspection',
      'MOBILE', 'FIXED', 7500.0, 'KES', 'ACTIVE', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  // Seed Supported Vehicle Makes
  const supportedMakes = [
    'TOYOTA', 'MITSUBISHI', 'NISSAN', 'SUBARU', 'ISUZU',
    'MERCEDES-BENZ', 'BMW', 'LAND ROVER', 'MAZDA', 'FORD'
  ];
  for (const make of supportedMakes) {
    db.prepare(`
      INSERT OR IGNORE INTO provider_vehicle_make_support (id, provider_id, make_name, support_level, created_at)
      VALUES (?, 'srv_seed_garage_01', ?, 'SPECIALIST', '2026-01-01T00:00:00.000Z');
    `).run(`pvms_gar_${make.toLowerCase().replace(/[^a-z0-9]/g, '_')}`, make);
  }

  // Seed Supported Vehicle Classes
  const supportedClasses = ['PASSENGER', 'SUV', 'COMMERCIAL', 'MOTORCYCLE'];
  for (const cls of supportedClasses) {
    db.prepare(`
      INSERT OR IGNORE INTO provider_vehicle_class_support (id, provider_id, vehicle_class, support_level, created_at)
      VALUES (?, 'srv_seed_garage_01', ?, 'SUPPORTED', '2026-01-01T00:00:00.000Z');
    `).run(`pvcs_gar_${cls.toLowerCase()}`, cls);
  }

  // Seed Provider Staff Profiles (Integrated with Sprint 2 Organization Memberships)
  db.prepare(`
    INSERT OR IGNORE INTO provider_staff_profiles (
      id, provider_id, membership_id, job_title, professional_role, status, created_at, updated_at
    ) VALUES
    (
      'prvstf_seed_01', 'srv_seed_garage_01', 'mem_seed_01', 'Workshop Director & Master Technician',
      'OWNER', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'prvstf_seed_02', 'srv_seed_garage_01', 'mem_seed_02', 'Lead Diagnostic & Powertrain Specialist',
      'MECHANIC', 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  // Seed Staff Branch Assignments
  db.prepare(`
    INSERT OR IGNORE INTO provider_staff_branch_assignments (
      id, staff_profile_id, branch_id, is_primary, created_at
    ) VALUES
    ('sba_seed_01', 'prvstf_seed_01', 'prvbr_seed_01', 1, '2026-01-01T00:00:00.000Z'),
    ('sba_seed_02', 'prvstf_seed_02', 'prvbr_seed_01', 1, '2026-01-01T00:00:00.000Z');
  `).run();

  // Seed Technician Skills
  db.prepare(`
    INSERT OR IGNORE INTO technician_skills (
      id, staff_profile_id, skill_name, proficiency_level, created_at
    ) VALUES
    ('tskill_seed_01', 'prvstf_seed_01', 'Master Automobile Technician (A1-A8)', 'EXPERT', '2026-01-01T00:00:00.000Z'),
    ('tskill_seed_02', 'prvstf_seed_01', 'Toyota Master Diagnostic Technician (MDT)', 'EXPERT', '2026-01-01T00:00:00.000Z'),
    ('tskill_seed_03', 'prvstf_seed_02', 'Common Rail Diesel Diagnostics', 'ADVANCED', '2026-01-01T00:00:00.000Z');
  `).run();

  // Seed Verification Documents (GAR-011 §15)
  db.prepare(`
    INSERT OR IGNORE INTO provider_verification_documents (
      id, provider_id, document_type, document_number, file_key, file_name,
      status, rejection_reason, reviewed_by, reviewed_at, created_at, updated_at
    ) VALUES
    (
      'prvdoc_seed_01', 'srv_seed_garage_01', 'BUSINESS_REGISTRATION', 'SBP-NBI-2026-09921', 'docs/nairobi_clinic_permit.pdf', 'Nairobi County Single Business Permit 2026.pdf',
      'VERIFIED', NULL, 'usr_seed_admin', '2026-01-05T10:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-05T10:00:00.000Z'
    ),
    (
      'prvdoc_seed_02', 'srv_seed_garage_01', 'TAX_PIN_COMPLIANCE', 'P051234567Z', 'docs/kra_pin_certificate.pdf', 'KRA PIN Certificate & Tax Compliance.pdf',
      'VERIFIED', NULL, 'usr_seed_admin', '2026-01-05T10:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-05T10:00:00.000Z'
    ),
    (
      'prvdoc_seed_03', 'srv_seed_garage_01', 'INSURANCE_POLICY', 'POL-INS-GAR-2026-091', 'docs/garage_liability_insurance.pdf', 'APA Garage Combined Public Liability Insurance.pdf',
      'VERIFIED', NULL, 'usr_seed_admin', '2026-01-05T10:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-05T10:00:00.000Z'
    );
  `).run();

  // Seed Verification History
  db.prepare(`
    INSERT OR IGNORE INTO provider_verification_history (
      id, provider_id, document_id, action, reviewed_by, notes, created_at
    ) VALUES
    (
      'pvh_seed_01', 'srv_seed_garage_01', 'prvdoc_seed_01', 'VERIFIED', 'usr_seed_admin',
      'Valid business permit verified against Nairobi County government portal records.', '2026-01-05T10:00:00.000Z'
    ),
    (
      'pvh_seed_02', 'srv_seed_garage_01', 'prvdoc_seed_02', 'VERIFIED', 'usr_seed_admin',
      'KRA TCC verified active and compliant.', '2026-01-05T10:00:00.000Z'
    );
  `).run();

  // Rebuild Search Projections for all seeded providers
  rebuildAllProviderSearchProjections(db);

  // -------------------------------------------------------------
  // 19. Seed Sprint 10 Garage Operations Management (GAR-012)
  // -------------------------------------------------------------
  logger.info('Seeding Garage Operations Management data (Sprint 10)...');

  // 1. Active Service Case: Toyota Land Cruiser Prado (veh_seed_car_01)
  db.prepare(`
    INSERT OR IGNORE INTO service_cases (
      id, service_case_number, provider_id, branch_id, vehicle_id,
      customer_user_id, customer_contact_name, customer_contact_phone, customer_contact_email,
      source_type, source_reference_id, service_advisor_id, status,
      intake_odometer_km, final_odometer_km, opened_at, checked_in_at,
      completed_at, released_at, cancelled_at, cancellation_reason,
      prior_service_case_id, created_by, created_at, updated_at
    ) VALUES (
      'sc_seed_01', 'SC-202603-1001', 'srv_seed_garage_01', 'prvbr_seed_01', 'veh_seed_car_01',
      'usr_seed_owner_01', 'Jane Wambui', '+254700111222', 'owner.demo@garageos.test',
      'WALK_IN', NULL, 'usr_seed_garage_owner', 'IN_PROGRESS',
      134250, NULL, '2026-03-01T08:00:00.000Z', '2026-03-01T08:15:00.000Z',
      NULL, NULL, NULL, NULL,
      NULL, 'usr_seed_owner_01', '2026-03-01T08:00:00.000Z', '2026-03-01T10:30:00.000Z'
    );
  `).run();

  // Customer Concerns
  db.prepare(`
    INSERT OR IGNORE INTO customer_concerns (
      id, service_case_id, vehicle_id, concern_type, description,
      related_issue_id, related_maintenance_requirement_id,
      reported_by, reported_at, priority, created_at
    ) VALUES
    ('cc_seed_01', 'sc_seed_01', 'veh_seed_car_01', 'NOISE', 'Persistent squealing noise from front left brake when coming to moderate stop', 'iss_seed_prado_01', NULL, 'Jane Wambui', '2026-03-01T08:05:00.000Z', 'HIGH', '2026-03-01T08:05:00.000Z'),
    ('cc_seed_02', 'sc_seed_01', 'veh_seed_car_01', 'VIBRATION', 'Steering wheel wobble/shimmy at highway speeds between 80-100 km/h', NULL, NULL, 'Jane Wambui', '2026-03-01T08:05:00.000Z', 'MEDIUM', '2026-03-01T08:05:00.000Z');
  `).run();

  // Vehicle Check-In
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_check_ins (
      id, service_case_id, vehicle_id, checked_in_at,
      odometer_value, odometer_unit, odometer_observation_id,
      fuel_level, vehicle_condition_summary,
      keys_received_count, documents_received,
      created_by, created_at
    ) VALUES (
      'chk_seed_01', 'sc_seed_01', 'veh_seed_car_01', '2026-03-01T08:15:00.000Z',
      134250, 'KM', 'odo_seed_01',
      60, 'Vehicle clean on intake. Minor rim scuff on front left alloy, minor bonnet stone chipping.',
      1, 'Vehicle Logbook Copy, Insurance Certificate',
      'usr_seed_mechanic', '2026-03-01T08:15:00.000Z'
    );
  `).run();

  // Intake Observations
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_intake_observations (
      id, vehicle_check_in_id, service_case_id, category, position,
      description, severity, media_reference_ids, created_by, created_at
    ) VALUES
    ('vio_seed_01', 'chk_seed_01', 'sc_seed_01', 'WHEEL_TYRE', 'FRONT_LEFT', 'Curb rash on outer rim lip approx 4cm long', 'MINOR', NULL, 'usr_seed_mechanic', '2026-03-01T08:18:00.000Z'),
    ('vio_seed_02', 'chk_seed_01', 'sc_seed_01', 'BODY_PANEL', 'FRONT_BUMPER', 'Highway stone chips on center front bumper clear coat', 'MINOR', NULL, 'usr_seed_mechanic', '2026-03-01T08:18:00.000Z');
  `).run();

  // Intake Inventory Items
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_intake_items (
      id, vehicle_check_in_id, service_case_id, item_name,
      item_type, quantity, condition_notes, created_at
    ) VALUES
    ('vii_seed_01', 'chk_seed_01', 'sc_seed_01', 'Spare Wheel (Full Size)', 'SPARE_TYRE', 1, 'Dunlop Grandtrek AT20, good pressure', '2026-03-01T08:20:00.000Z'),
    ('vii_seed_02', 'chk_seed_01', 'sc_seed_01', 'OEM Scissor Jack & Lug Wrench', 'TOOL_KIT', 1, 'Present in trunk side compartment', '2026-03-01T08:20:00.000Z'),
    ('vii_seed_03', 'chk_seed_01', 'sc_seed_01', 'Wheel Lock Key Nut', 'ACCESSORY', 1, 'In glove compartment box', '2026-03-01T08:20:00.000Z');
  `).run();

  // Vehicle Inspection
  db.prepare(`
    INSERT OR IGNORE INTO vehicle_inspections (
      id, service_case_id, vehicle_id, inspection_type, template_id,
      status, performed_by_technician_id, started_at, completed_at,
      notes, created_at, updated_at
    ) VALUES (
      'insp_seed_01', 'sc_seed_01', 'veh_seed_car_01', 'DIAGNOSTIC', 'tmpl_diagnostic_std',
      'COMPLETED', 'usr_seed_mechanic', '2026-03-01T08:30:00.000Z', '2026-03-01T09:15:00.000Z',
      'Full brake and front suspension diagnostic completed. Front left pad worn down to backing shim.', '2026-03-01T08:30:00.000Z', '2026-03-01T09:15:00.000Z'
    );
  `).run();

  // Inspection Results
  db.prepare(`
    INSERT OR IGNORE INTO inspection_item_results (
      id, inspection_id, item_name, category, result,
      measured_value, measurement_unit, notes, media_reference_ids, created_at
    ) VALUES
    ('iir_seed_01', 'insp_seed_01', 'Front Brake Pads Thickness', 'BRAKES', 'FAIL', 1.8, 'mm', 'Front left inner pad critically worn (1.8mm). Backing metal contacting rotor.', NULL, '2026-03-01T08:45:00.000Z'),
    ('iir_seed_02', 'insp_seed_01', 'Front Brake Rotors Thickness & Runout', 'BRAKES', 'WARNING', 26.2, 'mm', 'Rotors scored on left side with 0.08mm lateral runout.', NULL, '2026-03-01T08:50:00.000Z'),
    ('iir_seed_03', 'insp_seed_01', 'Rear Brake Lining', 'BRAKES', 'PASS', 6.5, 'mm', 'Rear pads in good condition at 6.5mm.', NULL, '2026-03-01T08:55:00.000Z'),
    ('iir_seed_04', 'insp_seed_01', 'Front Wheel Balancing & Runout', 'SUSPENSION', 'FAIL', 25.0, 'grams', 'Front wheels out of balance by 25g left and 15g right causing speed wobble.', NULL, '2026-03-01T09:00:00.000Z');
  `).run();

  // Inspection Findings
  db.prepare(`
    INSERT OR IGNORE INTO inspection_findings (
      id, inspection_id, service_case_id, vehicle_id, category,
      component_definition_id, vehicle_component_id, finding_type,
      severity, description, recommended_action, evidence_references,
      related_issue_id, created_by, created_at
    ) VALUES
    (
      'find_seed_01', 'insp_seed_01', 'sc_seed_01', 'veh_seed_car_01', 'BRAKES',
      'cdef_brake_pads_front', NULL, 'CRITICAL_WEAR',
      'SAFETY_CRITICAL', 'Front brake pads worn below safety minimum (1.8mm remaining). High metallic friction screech and scoring.',
      'Replace front brake pads with OEM ceramic set and skim or replace front brake rotors.', NULL,
      'iss_seed_prado_01', 'usr_seed_mechanic', '2026-03-01T09:10:00.000Z'
    ),
    (
      'find_seed_02', 'insp_seed_01', 'sc_seed_01', 'veh_seed_car_01', 'SUSPENSION',
      NULL, NULL, 'IMBALANCE',
      'MEDIUM', 'Dynamic wheel imbalance detected on both front wheels causing steering oscillation at 80-100 km/h.',
      'Perform precision computer dynamic wheel balancing and check wheel alignment.', NULL,
      NULL, 'usr_seed_mechanic', '2026-03-01T09:12:00.000Z'
    );
  `).run();

  // Recommended Work Items
  db.prepare(`
    INSERT OR IGNORE INTO recommended_work_items (
      id, service_case_id, related_finding_id, related_issue_id,
      maintenance_task_id, service_category, description, priority,
      estimated_labor_hours, estimated_labor_cost, estimated_parts_cost,
      currency, status, declined_reason, declined_at, declined_by,
      created_at, updated_at
    ) VALUES
    (
      'rec_seed_01', 'sc_seed_01', 'find_seed_01', 'iss_seed_prado_01',
      NULL, 'BRAKES', 'Replace front brake pad set and resurface ventilated front brake discs', 'CRITICAL_SAFETY',
      1.5, 4500, 18500,
      'KES', 'AUTHORIZED', NULL, NULL, NULL,
      '2026-03-01T09:20:00.000Z', '2026-03-01T09:45:00.000Z'
    ),
    (
      'rec_seed_02', 'sc_seed_01', 'find_seed_02', NULL,
      NULL, 'SUSPENSION', 'Dynamic 4-wheel precision balancing and computerized suspension alignment check', 'RECOMMENDED_NOW',
      1.0, 3500, 500,
      'KES', 'AUTHORIZED', NULL, NULL, NULL,
      '2026-03-01T09:20:00.000Z', '2026-03-01T09:45:00.000Z'
    );
  `).run();

  // Service Authorization
  db.prepare(`
    INSERT OR IGNORE INTO service_authorizations (
      id, service_case_id, authorization_type, scope_version,
      amount_authorized, currency, authorized_by, authorized_at,
      authorization_channel, status, notes, created_at
    ) VALUES (
      'auth_seed_01', 'sc_seed_01', 'INITIAL', 1,
      27000, 'KES', 'Jane Wambui', '2026-03-01T09:45:00.000Z',
      'PHONE_VERBAL', 'AUTHORIZED', 'Authorized verbally via phone call with Advisor David Kibet. Full scope approved.', '2026-03-01T09:45:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO service_authorization_items (id, authorization_id, recommended_work_item_id, created_at)
    VALUES
    ('sai_seed_01', 'auth_seed_01', 'rec_seed_01', '2026-03-01T09:45:00.000Z'),
    ('sai_seed_02', 'auth_seed_01', 'rec_seed_02', '2026-03-01T09:45:00.000Z');
  `).run();

  // Work Order
  db.prepare(`
    INSERT OR IGNORE INTO work_orders (
      id, service_case_id, provider_id, branch_id, vehicle_id,
      work_order_number, status, opened_at, started_at, completed_at,
      assigned_service_advisor_id, created_by, created_at, updated_at
    ) VALUES (
      'wo_seed_01', 'sc_seed_01', 'srv_seed_garage_01', 'prvbr_seed_01', 'veh_seed_car_01',
      'WO-202603-1001', 'IN_PROGRESS', '2026-03-01T09:50:00.000Z', '2026-03-01T10:00:00.000Z', NULL,
      'usr_seed_garage_owner', 'usr_seed_owner_01', '2026-03-01T09:50:00.000Z', '2026-03-01T10:15:00.000Z'
    );
  `).run();

  // Work Order Items
  db.prepare(`
    INSERT OR IGNORE INTO work_order_items (
      id, work_order_id, work_type, service_category, description,
      related_recommended_work_item_id, related_issue_id,
      related_maintenance_task_id, related_finding_id,
      status, authorization_status, assigned_technician_id,
      estimated_hours, actual_hours, billable_hours, hourly_rate,
      started_at, completed_at, block_reason, created_at, updated_at
    ) VALUES
    (
      'woi_seed_01', 'wo_seed_01', 'REPAIR', 'BRAKES', 'Replace front brake pad set and resurface ventilated front brake discs',
      'rec_seed_01', 'iss_seed_prado_01', NULL, 'find_seed_01',
      'IN_PROGRESS', 'AUTHORIZED', 'usr_seed_mechanic',
      1.5, 0.75, 1.5, 3000,
      '2026-03-01T10:00:00.000Z', NULL, NULL, '2026-03-01T09:50:00.000Z', '2026-03-01T10:00:00.000Z'
    ),
    (
      'woi_seed_02', 'wo_seed_01', 'MAINTENANCE', 'SUSPENSION', 'Dynamic 4-wheel precision balancing and computerized suspension alignment check',
      'rec_seed_02', NULL, NULL, 'find_seed_02',
      'ASSIGNED', 'AUTHORIZED', 'usr_seed_mechanic',
      1.0, 0.0, 1.0, 3500,
      NULL, NULL, NULL, '2026-03-01T09:50:00.000Z', '2026-03-01T09:50:00.000Z'
    );
  `).run();

  // Technician Assignment
  db.prepare(`
    INSERT OR IGNORE INTO technician_assignments (
      id, work_order_id, work_order_item_id, technician_id,
      provider_membership_id, role, assigned_at, assigned_by, status
    ) VALUES (
      'ta_seed_01', 'wo_seed_01', 'woi_seed_01', 'usr_seed_mechanic',
      'mem_seed_01', 'PRIMARY', '2026-03-01T09:55:00.000Z', 'usr_seed_garage_owner', 'ACTIVE'
    );
  `).run();

  // Technician Work Session
  db.prepare(`
    INSERT OR IGNORE INTO technician_work_sessions (
      id, work_order_item_id, technician_id, started_at,
      ended_at, duration_minutes, labor_type, notes, status
    ) VALUES (
      'tws_seed_01', 'woi_seed_01', 'usr_seed_mechanic', '2026-03-01T10:00:00.000Z',
      NULL, 45, 'ACTUAL', 'Front calipers dismantled, slide pins cleaned and greased, new ceramic pads fitted.', 'ACTIVE'
    );
  `).run();

  // Work Order Parts
  db.prepare(`
    INSERT OR IGNORE INTO work_order_parts (
      id, work_order_item_id, work_order_id, part_number, description,
      quantity, source, unit_cost, unit_price, currency,
      status, vehicle_component_id, replaced_component_id,
      installed_at, installed_by, created_at, updated_at
    ) VALUES (
      'wop_seed_01', 'woi_seed_01', 'wo_seed_01', '04465-60280', 'Toyota Genuine Front Brake Pad Kit (Ceramic formulation)',
      1, 'WORKSHOP_INVENTORY', 13500, 18500, 'KES',
      'ALLOCATED', NULL, NULL,
      NULL, NULL, '2026-03-01T09:55:00.000Z', '2026-03-01T09:55:00.000Z'
    );
  `).run();

  // Service Case Notes & Activity
  db.prepare(`
    INSERT OR IGNORE INTO service_case_notes (
      id, service_case_id, author_id, author_name, visibility, content, created_at
    ) VALUES
    ('scn_seed_01', 'sc_seed_01', 'usr_seed_garage_owner', 'David Kibet (Service Advisor)', 'CUSTOMER_FACING', 'Vehicle checked in on time. Technician Peter Maina assigned for diagnosis.', '2026-03-01T08:25:00.000Z'),
    ('scn_seed_02', 'sc_seed_01', 'usr_seed_mechanic', 'Peter Maina (Master Tech)', 'INTERNAL_PROVIDER_NOTE', 'Caliper guide pins require silicone lube. Rotors have enough meat above discard limit for precision skimming.', '2026-03-01T09:18:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO service_case_activity (
      id, service_case_id, work_order_id, action, actor_id, actor_name, details, occurred_at
    ) VALUES
    ('act_seed_01', 'sc_seed_01', NULL, 'SERVICE_CASE_OPENED', 'usr_seed_garage_owner', 'David Kibet', 'Service Case SC-202603-1001 created', '2026-03-01T08:00:00.000Z'),
    ('act_seed_02', 'sc_seed_01', NULL, 'VEHICLE_CHECKED_IN', 'usr_seed_garage_owner', 'David Kibet', 'Vehicle checked in at 134,250 KM', '2026-03-01T08:15:00.000Z'),
    ('act_seed_03', 'sc_seed_01', NULL, 'INSPECTION_COMPLETED', 'usr_seed_mechanic', 'Peter Maina', '30-point safety inspection completed with 2 findings', '2026-03-01T09:15:00.000Z'),
    ('act_seed_04', 'sc_seed_01', NULL, 'SERVICE_AUTHORIZED', 'usr_seed_garage_owner', 'David Kibet', 'Customer authorized KES 27,000 via phone', '2026-03-01T09:45:00.000Z'),
    ('act_seed_05', 'sc_seed_01', 'wo_seed_01', 'WORK_ORDER_CREATED', 'usr_seed_garage_owner', 'David Kibet', 'Work order WO-202603-1001 generated and assigned', '2026-03-01T09:50:00.000Z');
  `).run();

  // 2. Completed & Released Service Case: Subaru Forester (veh_seed_car_02)
  db.prepare(`
    INSERT OR IGNORE INTO service_cases (
      id, service_case_number, provider_id, branch_id, vehicle_id,
      customer_user_id, customer_contact_name, customer_contact_phone, customer_contact_email,
      source_type, source_reference_id, service_advisor_id, status,
      intake_odometer_km, final_odometer_km, opened_at, checked_in_at,
      completed_at, released_at, cancelled_at, cancellation_reason,
      prior_service_case_id, created_by, created_at, updated_at
    ) VALUES (
      'sc_seed_02', 'SC-202602-0982', 'srv_seed_garage_01', 'prvbr_seed_01', 'veh_seed_car_02',
      'usr_seed_owner_01', 'Jane Wambui', '+254700111222', 'owner.demo@garageos.test',
      'BOOKING', NULL, 'usr_seed_garage_owner', 'RELEASED',
      87400, 87412, '2026-02-15T08:00:00.000Z', '2026-02-15T08:10:00.000Z',
      '2026-02-15T15:30:00.000Z', '2026-02-15T16:00:00.000Z', NULL, NULL,
      NULL, 'usr_seed_owner_01', '2026-02-15T08:00:00.000Z', '2026-02-15T16:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO work_orders (
      id, service_case_id, provider_id, branch_id, vehicle_id,
      work_order_number, status, opened_at, started_at, completed_at,
      assigned_service_advisor_id, created_by, created_at, updated_at
    ) VALUES (
      'wo_seed_02', 'sc_seed_02', 'srv_seed_garage_01', 'prvbr_seed_01', 'veh_seed_car_02',
      'WO-202602-0982', 'CLOSED', '2026-02-15T08:30:00.000Z', '2026-02-15T09:00:00.000Z', '2026-02-15T15:00:00.000Z',
      'usr_seed_garage_owner', 'usr_seed_owner_01', '2026-02-15T08:30:00.000Z', '2026-02-15T16:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO quality_control_checks (
      id, work_order_id, inspection_id, performed_by,
      performed_at, result, checklist_results, notes,
      rework_instructions, created_at
    ) VALUES (
      'qc_seed_01', 'wo_seed_02', NULL, 'usr_seed_mechanic',
      '2026-02-15T15:15:00.000Z', 'PASSED',
      '{"fluid_levels_verified":true,"torqued_to_spec":true,"no_dashboard_dtc":true,"clean_interior":true,"wheel_nuts_torqued":true}',
      'All routine service items inspected and torqued to OEM specifications. Engine idling smoothly, zero error codes on scan tool.',
      NULL, '2026-02-15T15:15:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO road_tests (
      id, work_order_id, performed_by, started_at, ended_at,
      start_odometer_km, end_odometer_km, result, notes, created_at
    ) VALUES (
      'rt_seed_01', 'wo_seed_02', 'usr_seed_mechanic', '2026-02-15T15:20:00.000Z', '2026-02-15T15:35:00.000Z',
      87400, 87412, 'PASSED', '12 km road test on bypass. Acceleration smooth, CVT transmission responsive, braking firm and straight.', '2026-02-15T15:35:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO vehicle_releases (
      id, service_case_id, work_order_id, released_at, released_by,
      recipient_user_id, recipient_name, recipient_phone,
      final_odometer_km, final_odometer_observation_id,
      handover_notes, acknowledgement_status, created_at
    ) VALUES (
      'rel_seed_01', 'sc_seed_02', 'wo_seed_02', '2026-02-15T16:00:00.000Z', 'usr_seed_garage_owner',
      'usr_seed_owner_01', 'Jane Wambui', '+254700111222',
      87412, 'odo_seed_02',
      'Vehicle keys, spare tyre, and invoice receipt handed over to owner. Maintenance service recorded in digital passport.',
      'ACKNOWLEDGED', '2026-02-15T16:00:00.000Z'
    );
  `).run();

  // -------------------------------------------------------------
  // 20. Seed Sprint 11 Booking, Scheduling & Quotes (GAR-013)
  // -------------------------------------------------------------
  logger.info('Seeding Booking, Scheduling & Quotes data (Sprint 11)...');

  // Service Offerings
  db.prepare(`
    INSERT OR IGNORE INTO service_offerings (
      id, provider_id, branch_id, service_category_id, capability_id,
      name, description, delivery_mode, booking_mode,
      estimated_duration_minutes, pricing_model, base_price_minor, currency,
      requires_inspection, requires_quote, requires_vehicle, status,
      created_at, updated_at
    ) VALUES
    (
      'off_seed_01', 'srv_seed_garage_01', 'prvbr_seed_01', 'cat_oil_change', 'prvcap_seed_01',
      'Full Synthetic Major Oil & Filter Service',
      'Comprehensive 5W-30 / 5W-40 full synthetic oil renewal, OEM oil filter replacement, 25-point safety inspection & fluid top-up.',
      'WORKSHOP', 'INSTANT_CONFIRMATION', 60, 'FIXED', 850000, 'KES',
      0, 0, 1, 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'off_seed_02', 'srv_seed_garage_01', 'prvbr_seed_01', 'cat_brake_pad_disc', 'prvcap_seed_02',
      'Front Axle Brake Renewal & Disc Resurfacing',
      'Installation of OEM / Premium Brembo ceramic brake pads, rotor precision runout skimming, caliper pin lubrication and brake fluid test.',
      'WORKSHOP', 'PROVIDER_CONFIRMATION', 120, 'STARTING_FROM', 1850000, 'KES',
      1, 1, 1, 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'off_seed_03', 'srv_seed_garage_01', 'prvbr_seed_01', 'cat_obd_diag', 'prvcap_seed_03',
      'OBD-II Multi-System Diagnostic Scan & Report',
      'High-end Launch/Autel diagnostic health scan across ECM, TCM, ABS, and BCM modules with freeze-frame analysis and clearing.',
      'WORKSHOP', 'INSTANT_CONFIRMATION', 45, 'FIXED', 450000, 'KES',
      0, 0, 1, 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ),
    (
      'off_seed_04', 'srv_seed_garage_01', 'prvbr_seed_01', 'cat_tyre_mount_balance', 'prvcap_seed_04',
      '3D Computerized 4-Wheel Alignment & Road Force Balance',
      'Precision Hunter Hawkeye alignment calibration to OEM geometry specs and precision dynamic road force balancing.',
      'WORKSHOP', 'INSTANT_CONFIRMATION', 60, 'FIXED', 400000, 'KES',
      0, 0, 1, 'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  // Provider Capacity Rules (Mon - Sat)
  const days = [1, 2, 3, 4, 5, 6];
  for (const day of days) {
    db.prepare(`
      INSERT OR IGNORE INTO provider_capacity_rules (
        id, provider_id, branch_id, service_category_id, day_of_week,
        start_time, end_time, max_concurrent_bookings, slot_duration_minutes,
        buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes,
        max_advance_days, timezone, is_active, created_at, updated_at
      ) VALUES (
        'pcr_seed_d${day}', 'srv_seed_garage_01', 'prvbr_seed_01', NULL, ${day},
        '08:00', '17:00', 3, 60,
        0, 15, 60, 30, 'Africa/Nairobi', 1,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `).run();
  }

  // Active Confirmed Booking: Toyota Land Cruiser Prado (veh_seed_car_01)
  db.prepare(`
    INSERT OR IGNORE INTO bookings (
      id, customer_user_id, vehicle_id, provider_id, branch_id,
      service_offering_id, booking_type, booking_mode, status,
      requested_start_at, requested_end_at, confirmed_start_at, confirmed_end_at,
      delivery_mode, customer_notes, source_type, created_at, updated_at
    ) VALUES (
      'bkg_seed_01', 'usr_seed_owner_01', 'veh_seed_car_01', 'srv_seed_garage_01', 'prvbr_seed_01',
      'off_seed_01', 'SERVICE_OFFERING', 'PROVIDER_CONFIRMATION', 'CONFIRMED',
      '2026-03-20T09:00:00.000Z', '2026-03-20T10:30:00.000Z', '2026-03-20T09:00:00.000Z', '2026-03-20T10:30:00.000Z',
      'WORKSHOP', 'Please also inspect the slight squeak from the front left wheel when braking.', 'DIRECT_CUSTOMER',
      '2026-03-12T10:00:00.000Z', '2026-03-12T10:15:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO booking_items (
      id, booking_id, service_offering_id, service_category_id,
      description, quantity, estimated_duration_minutes, status, created_at
    ) VALUES
    ('bki_seed_01', 'bkg_seed_01', 'off_seed_01', 'cat_oil_change', 'Full Synthetic Major Oil & Filter Service (Toyota 2.8L D-4D)', 1, 60, 'CONFIRMED', '2026-03-12T10:00:00.000Z'),
    ('bki_seed_02', 'bkg_seed_01', 'off_seed_02', 'cat_brake_pad_disc', 'Front Brake Noise Inspection & Lining Check', 1, 30, 'CONFIRMED', '2026-03-12T10:00:00.000Z');
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO service_appointments (
      id, booking_id, provider_id, branch_id, scheduled_start_at, scheduled_end_at, timezone, status, created_at, updated_at
    ) VALUES (
      'apt_seed_01', 'bkg_seed_01', 'srv_seed_garage_01', 'prvbr_seed_01',
      '2026-03-20T09:00:00.000Z', '2026-03-20T10:30:00.000Z', 'Africa/Nairobi', 'SCHEDULED',
      '2026-03-12T10:15:00.000Z', '2026-03-12T10:15:00.000Z'
    );
  `).run();

  // Canonical Service Quote: Issued for Jane Wambui (bkg_seed_01)
  db.prepare(`
    INSERT OR IGNORE INTO service_quotes (
      id, booking_id, service_case_id, provider_id, branch_id, vehicle_id, customer_user_id,
      quote_number, version, status, quote_type, currency,
      subtotal_minor, tax_minor, tax_rate, fees_minor, discounts_minor, total_minor,
      valid_until, terms_and_conditions, created_by, created_at, issued_at
    ) VALUES (
      'qte_seed_01', 'bkg_seed_01', 'sc_seed_01', 'srv_seed_garage_01', 'prvbr_seed_01', 'veh_seed_car_01', 'usr_seed_owner_01',
      'QTE-2026-0042', 1, 'ISSUED', 'INITIAL', 'KES',
      2300000, 368000, 0.16, 0, 0, 2668000,
      '2026-04-01T23:59:59.000Z',
      'Standard Nairobi Premier Auto Clinic Warranty: 6 months or 10,000 km on parts and workmanship. Prices valid for 14 days from issuance.',
      'usr_seed_garage_owner', '2026-03-12T11:00:00.000Z', '2026-03-12T11:15:00.000Z'
    );
  `).run();

  // Quote Line Items (Mandatory Service + Optional Recommended Repairs)
  db.prepare(`
    INSERT OR IGNORE INTO quote_line_items (
      id, quote_id, line_type, service_category, description,
      quantity, unit_price_minor, line_total_minor,
      related_recommended_work_item_id, related_service_offering_id,
      authorization_required, is_optional, status, created_at
    ) VALUES
    (
      'qli_seed_01', 'qte_seed_01', 'SERVICE', 'cat_oil_change',
      'Full Synthetic 5W-30 Engine Oil (7.5 Liters) & OEM Toyota Oil Filter',
      1, 850000, 850000, NULL, 'off_seed_01',
      1, 0, 'PROPOSED', '2026-03-12T11:00:00.000Z'
    ),
    (
      'qli_seed_02', 'qte_seed_01', 'PART', 'cat_brake_pad_disc',
      'Toyota Genuine Front Brake Pad Kit (Ceramic Composite)',
      1, 1450000, 1450000, 'rec_seed_01', 'off_seed_02',
      1, 0, 'PROPOSED', '2026-03-12T11:00:00.000Z'
    ),
    (
      'qli_seed_03', 'qte_seed_01', 'LABOR', 'cat_tyre_mount_balance',
      'High-Speed Dynamic Front Wheel Balancing & Diagnostic Runout Check',
      1, 350000, 350000, 'rec_seed_02', 'off_seed_04',
      0, 1, 'PROPOSED', '2026-03-12T11:00:00.000Z'
    );
  `).run();

  // 25. Seed Sprint 13 Towing & Recovery Domain (GAR-015)
  // Nairobi Central Towing & Recovery Provider
  db.prepare(`
    INSERT OR IGNORE INTO service_providers (
      id, organization_id, name, legal_business_name, provider_type,
      description, website, email, phone,
      status, verification_status, accepts_bookings, accepts_mobile_jobs, accepts_roadside_jobs, accepts_towing_jobs,
      service_radius_km, currency, created_at, updated_at
    ) VALUES (
      'srv_seed_towing_01', 'org_seed_towing_01', 'Nairobi Central 24/7 Towing & Recovery', 'Nairobi Central Towing Ltd',
      'TOWING_RECOVERY',
      'Rapid response flatbed recovery, wheel-lift towing with dollies, off-road winching, and secure vehicle transport across the Nairobi metropolitan area.',
      'https://nairoitowing.garageos.ke', 'dispatch@nairoitowing.test', '+254700888999',
      'ACTIVE', 'VERIFIED', 1, 1, 1, 1,
      50.0, 'KES', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO provider_locations (
      id, provider_id, name, location_type, address_line1, address_line2, city, county_state,
      postal_code, country, latitude, longitude, is_primary, created_at, updated_at
    ) VALUES (
      'prvloc_seed_tow_01', 'srv_seed_towing_01', 'Nairobi Towing Dispatch Depot', 'TOW_YARD', 'Bunyala Road, Lower Industrial Area', 'Near Nyayo Stadium',
      'Nairobi', 'Nairobi County', '00100', 'KE', -1.3050, 36.8300, 1,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  db.prepare(`
    UPDATE service_providers SET primary_location_id = 'prvloc_seed_tow_01' WHERE id = 'srv_seed_towing_01';
  `).run();

  // Seed Tow Capability Profiles (GAR-015)
  db.prepare(`
    INSERT OR IGNORE INTO tow_capability_profiles (
      id, name, supported_classes_json, supported_mobility_states_json, supported_recovery_types_json,
      required_equipment_json, max_weight_kg, created_at
    ) VALUES
    (
      'ep_flatbed_nbo_01', 'Flatbed Standard Recovery Profile',
      '["PASSENGER_CAR","SUV_CROSSOVER","LIGHT_COMMERCIAL","MOTORCYCLE"]',
      '["ROLLING_FREELY","STEERING_LOCKED","BRAKES_SEIZED","IMMOBILE"]',
      '["FLATBED","WINCHING"]',
      '["HYDRAULIC_TILT_TRAY","WINCH","SOFT_STRAPS","WHEEL_SKATES"]',
      5500, '2026-01-01T00:00:00.000Z'
    ),
    (
      'ep_lift_nbo_02', 'Wheel-Lift Underlift Profile with Dollies',
      '["PASSENGER_CAR","SUV_CROSSOVER"]',
      '["ROLLING_FREELY","WHEELS_LOCKED"]',
      '["WHEEL_LIFT","DOLLIES"]',
      '["WHEEL_LIFT","TOW_DOLLIES","WINCH"]',
      3500, '2026-01-01T00:00:00.000Z'
    ),
    (
      'ep_rotator_msa_01', 'Heavy Duty Rotator Crane Profile',
      '["HEAVY_TRUCK","BUS","LIGHT_COMMERCIAL","SUV_CROSSOVER"]',
      '["IMMOBILE","ROLLOVER","DITCH_EXTRICATION"]',
      '["HEAVY_ROTATOR","CRANE_BOOM","HEAVY_RIGGING"]',
      '["CRANE_BOOM","HEAVY_RIGGING","EXTENDED_CABLES","SNATCH_BLOCKS"]',
      28000, '2026-01-01T00:00:00.000Z'
    );
  `).run();

  // Seed Recovery Units (GAR-015 §6-§10)
  // Unit 1: Modern Hydraulic Tilt Flatbed
  db.prepare(`
    INSERT OR IGNORE INTO recovery_units (
      id, provider_id, unit_type, registration_identifier, fleet_identifier,
      status, max_vehicle_weight_kg, max_vehicle_length_mm, max_vehicle_width_mm,
      equipment_profile_id, base_location_id, created_at, updated_at
    ) VALUES (
      'rec_unit_flatbed_01', 'srv_seed_towing_01', 'FLATBED', 'KDA 101T', 'TOW-01-FLATBED',
      'AVAILABLE', 5500, 6500, 2400,
      'ep_flatbed_nbo_01', 'prvloc_seed_tow_01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  // Unit 2: Underlift / Wheel Lift with Tow Dollies for tight parking / garage access
  db.prepare(`
    INSERT OR IGNORE INTO recovery_units (
      id, provider_id, unit_type, registration_identifier, fleet_identifier,
      status, max_vehicle_weight_kg, max_vehicle_length_mm, max_vehicle_width_mm,
      equipment_profile_id, base_location_id, created_at, updated_at
    ) VALUES (
      'rec_unit_wheel_lift_02', 'srv_seed_towing_01', 'WHEEL_LIFT', 'KDC 202U', 'TOW-02-LIFT',
      'AVAILABLE', 3500, 5200, 2100,
      'ep_lift_nbo_02', 'prvloc_seed_tow_01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  // Unit 3: Mombasa Heavy Rotator / Crane Winch Recovery Truck
  db.prepare(`
    INSERT OR IGNORE INTO recovery_units (
      id, provider_id, unit_type, registration_identifier, fleet_identifier,
      status, max_vehicle_weight_kg, max_vehicle_length_mm, max_vehicle_width_mm,
      equipment_profile_id, base_location_id, created_at, updated_at
    ) VALUES (
      'rec_unit_rotator_03', 'srv_seed_towing_02', 'HEAVY_ROTATOR', 'KDE 303V', 'MSA-ROTATOR-01',
      'AVAILABLE', 28000, 11000, 2600,
      'ep_rotator_msa_01', 'prvloc_seed_msa_03', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `).run();

  // Seed Recovery Unit Equipment
  db.prepare(`
    INSERT OR IGNORE INTO recovery_unit_equipment (
      id, recovery_unit_id, equipment_type, rating_capacity_kg, is_operational, created_at
    ) VALUES
    ('rue_fb_01', 'rec_unit_flatbed_01', 'HYDRAULIC_TILT_TRAY', 6000, 1, '2026-01-01T00:00:00.000Z'),
    ('rue_fb_02', 'rec_unit_flatbed_01', 'WINCH', 8000, 1, '2026-01-01T00:00:00.000Z'),
    ('rue_fb_03', 'rec_unit_flatbed_01', 'SOFT_STRAPS', 5000, 1, '2026-01-01T00:00:00.000Z'),
    ('rue_fb_04', 'rec_unit_flatbed_01', 'WHEEL_SKATES', 3000, 1, '2026-01-01T00:00:00.000Z'),
    ('rue_wl_01', 'rec_unit_wheel_lift_02', 'WHEEL_LIFT', 3500, 1, '2026-01-01T00:00:00.000Z'),
    ('rue_wl_02', 'rec_unit_wheel_lift_02', 'TOW_DOLLIES', 2500, 1, '2026-01-01T00:00:00.000Z'),
    ('rue_wl_03', 'rec_unit_wheel_lift_02', 'WINCH', 4000, 1, '2026-01-01T00:00:00.000Z'),
    ('rue_rt_01', 'rec_unit_rotator_03', 'CRANE_BOOM', 30000, 1, '2026-01-01T00:00:00.000Z'),
    ('rue_rt_02', 'rec_unit_rotator_03', 'HEAVY_RIGGING', 35000, 1, '2026-01-01T00:00:00.000Z'),
    ('rue_rt_03', 'rec_unit_rotator_03', 'EXTENDED_CABLES', 25000, 1, '2026-01-01T00:00:00.000Z'),
    ('rue_rt_04', 'rec_unit_rotator_03', 'SNATCH_BLOCKS', 30000, 1, '2026-01-01T00:00:00.000Z');
  `).run();

  // Seed Supported Vehicle Classes
  db.prepare(`
    INSERT OR IGNORE INTO recovery_unit_vehicle_class_support (id, recovery_unit_id, vehicle_class)
    VALUES
    ('rucs_fb_01', 'rec_unit_flatbed_01', 'PASSENGER_CAR'),
    ('rucs_fb_02', 'rec_unit_flatbed_01', 'SUV_CROSSOVER'),
    ('rucs_fb_03', 'rec_unit_flatbed_01', 'LIGHT_COMMERCIAL'),
    ('rucs_fb_04', 'rec_unit_flatbed_01', 'MOTORCYCLE'),
    ('rucs_wl_01', 'rec_unit_wheel_lift_02', 'PASSENGER_CAR'),
    ('rucs_wl_02', 'rec_unit_wheel_lift_02', 'SUV_CROSSOVER'),
    ('rucs_rt_01', 'rec_unit_rotator_03', 'HEAVY_TRUCK'),
    ('rucs_rt_02', 'rec_unit_rotator_03', 'BUS'),
    ('rucs_rt_03', 'rec_unit_rotator_03', 'LIGHT_COMMERCIAL'),
    ('rucs_rt_04', 'rec_unit_rotator_03', 'SUV_CROSSOVER');
  `).run();

  // --- SPRINT 14: REAL-TIME DISPATCH, PRESENCE & LOCATION SEED DATA (GAR-016) ---
  const nowIso = new Date().toISOString();
  const freshTime = new Date(Date.now() - 30 * 1000).toISOString(); // 30s ago (FRESH)
  const agingTime = new Date(Date.now() - 150 * 1000).toISOString(); // 2.5m ago (AGING)
  const staleTime = new Date(Date.now() - 400 * 1000).toISOString(); // 6.6m ago (STALE)

  // 1. Responder Presence
  db.prepare(`
    INSERT OR IGNORE INTO responder_presence (
      id, provider_id, responder_type, responder_reference_id, status,
      last_heartbeat_at, available_since, current_job_reference, created_at, updated_at
    ) VALUES
    ('pres_seed_01', 'srv_seed_garage_01', 'PROVIDER_STAFF', 'usr_seed_tech_01', 'AVAILABLE', ?, ?, NULL, ?, ?),
    ('pres_seed_02', 'srv_seed_mobile_03', 'PROVIDER_STAFF', 'usr_seed_mobile_tech_01', 'AVAILABLE', ?, ?, NULL, ?, ?),
    ('pres_seed_03', 'srv_seed_towing_01', 'RECOVERY_UNIT', 'rec_unit_flatbed_01', 'AVAILABLE', ?, ?, NULL, ?, ?),
    ('pres_seed_04', 'srv_seed_towing_01', 'RECOVERY_UNIT', 'rec_unit_wheel_lift_02', 'AVAILABLE_LIMITED', ?, ?, NULL, ?, ?),
    ('pres_seed_05', 'srv_seed_towing_01', 'RECOVERY_UNIT', 'rec_unit_rotator_03', 'ON_JOB', ?, ?, 'ta_heavy_01', ?, ?);
  `).run(
    freshTime, freshTime, freshTime, freshTime,
    freshTime, freshTime, freshTime, freshTime,
    freshTime, freshTime, freshTime, freshTime,
    agingTime, agingTime, agingTime, agingTime,
    freshTime, freshTime, freshTime, freshTime
  );

  // 2. Responder Current Locations (Nairobi geographic coordinates)
  db.prepare(`
    INSERT OR IGNORE INTO responder_current_locations (
      responder_reference_id, responder_type, latitude, longitude,
      accuracy_meters, heading_degrees, speed_meters_per_second,
      captured_at, received_at, freshness_state, quality,
      movement_state, source_type, updated_at
    ) VALUES
    ('usr_seed_tech_01', 'PROVIDER_STAFF', -1.2683, 36.8111, 12.0, 90.0, 0.0, ?, ?, 'FRESH', 'GOOD', 'STATIONARY', 'DEVICE_GPS', ?),
    ('usr_seed_mobile_tech_01', 'PROVIDER_STAFF', -1.2921, 36.8219, 15.0, 180.0, 8.5, ?, ?, 'FRESH', 'GOOD', 'MOVING', 'DEVICE_GPS', ?),
    ('rec_unit_flatbed_01', 'RECOVERY_UNIT', -1.3032, 36.8263, 10.0, 45.0, 0.0, ?, ?, 'FRESH', 'GOOD', 'STATIONARY', 'DEVICE_GPS', ?),
    ('rec_unit_wheel_lift_02', 'RECOVERY_UNIT', -1.3120, 36.8180, 28.0, 270.0, 4.0, ?, ?, 'AGING', 'DEGRADED', 'MOVING', 'DEVICE_GPS', ?),
    ('rec_unit_rotator_03', 'RECOVERY_UNIT', -1.3350, 36.8900, 14.0, 120.0, 11.2, ?, ?, 'FRESH', 'GOOD', 'MOVING', 'DEVICE_GPS', ?);
  `).run(
    freshTime, freshTime, freshTime,
    freshTime, freshTime, freshTime,
    freshTime, freshTime, freshTime,
    agingTime, agingTime, agingTime,
    freshTime, freshTime, freshTime
  );

  // 3. Demo Dispatch Request (Roadside Assistance on Uhuru Highway / CBD)
  db.prepare(`
    INSERT OR IGNORE INTO dispatch_requests (
      id, dispatch_domain, source_reference_type, source_reference_id,
      required_capability, pickup_latitude, pickup_longitude,
      destination_latitude, destination_longitude, vehicle_id,
      priority, status, strategy, strategy_version, active_attempt_id,
      assigned_responder_type, assigned_responder_id, created_at, updated_at, completed_at
    ) VALUES (
      'dr_demo_s14', 'ROADSIDE', 'ROADSIDE_ASSISTANCE_REQUEST', 'rsa_req_demo_01',
      'TIRE_CHANGE', -1.286389, 36.817223,
      NULL, NULL, 'veh_seed_car_01',
      'NORMAL', 'OFFERING', 'BATCH', 'v1.0', 'da_demo_s14_01',
      NULL, NULL, ?, ?, NULL
    );
  `).run(freshTime, freshTime);

  // 4. Demo Dispatch Attempt
  db.prepare(`
    INSERT OR IGNORE INTO dispatch_attempts (
      id, dispatch_request_id, attempt_number, strategy,
      search_radius_km, candidate_ids_json, status,
      started_at, expires_at, completed_at, created_at
    ) VALUES (
      'da_demo_s14_01', 'dr_demo_s14', 1, 'BATCH',
      5.0, '["dc_demo_01", "dc_demo_02"]', 'OFFERS_SENT',
      ?, ?, NULL, ?
    );
  `).run(
    freshTime,
    new Date(Date.now() + 240 * 1000).toISOString(),
    freshTime
  );

  // 5. Demo Ranked Candidates
  db.prepare(`
    INSERT OR IGNORE INTO dispatch_candidates (
      id, dispatch_request_id, dispatch_attempt_id, provider_id,
      responder_type, responder_reference_id, eligibility_status,
      distance_meters, distance_type, eta_seconds, eta_source,
      location_freshness, availability_state, capability_score,
      distance_score, eta_score, workload_score, overall_score,
      rank, exclusion_reason, strategy_version, created_at
    ) VALUES
    (
      'dc_demo_01', 'dr_demo_s14', 'da_demo_s14_01', 'srv_seed_mobile_03',
      'PROVIDER_STAFF', 'usr_seed_mobile_tech_01', 'ELIGIBLE',
      1200, 'ROAD_DISTANCE', 420, 'STATIC_ROUTING',
      'FRESH', 'AVAILABLE', 1.0, 0.88, 0.88, 1.0, 0.91,
      1, NULL, 'v1.0', ?
    ),
    (
      'dc_demo_02', 'dr_demo_s14', 'da_demo_s14_01', 'srv_seed_garage_01',
      'PROVIDER_STAFF', 'usr_seed_tech_01', 'ELIGIBLE',
      2400, 'ROAD_DISTANCE', 780, 'STATIC_ROUTING',
      'FRESH', 'AVAILABLE', 1.0, 0.76, 0.78, 1.0, 0.82,
      2, NULL, 'v1.0', ?
    );
  `).run(freshTime, freshTime);

  logger.info('Deterministic development seed completed successfully.');
}

