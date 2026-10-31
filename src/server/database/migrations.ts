/**
 * Deterministic Migration Engine with Rollback Support (GAR-033 §1-§12, GAR-046 §3)
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { logger } from '../observability/logger';
import { getCurrentUtcIsoString } from '../domain/time';

export interface Migration {
  id: string;
  name: string;
  up: (db: DatabaseSync) => void;
  down: (db: DatabaseSync) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001_platform_foundation',
    name: 'Initial Platform Primitives & Outbox/Jobs/Security Schemas',
    up: (db: DatabaseSync) => {
      // 1. Audit Events (GAR-039 §11, GAR-033 §12A)
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY,
          actor_id TEXT,
          actor_type TEXT NOT NULL,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT,
          correlation_id TEXT NOT NULL,
          source TEXT NOT NULL,
          before_state TEXT,
          after_state TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_events(resource_type, resource_id);
        CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_events(correlation_id);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
      `);

      // 2. Transactional Outbox (GAR-035 §4.x & §9, GAR-033 §12A)
      db.exec(`
        CREATE TABLE IF NOT EXISTS outbox_events (
          id TEXT PRIMARY KEY,
          event_id TEXT UNIQUE NOT NULL,
          type TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          occurred_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          producer TEXT NOT NULL,
          correlation_id TEXT NOT NULL,
          causation_id TEXT,
          subject_ids TEXT NOT NULL,
          actor_id TEXT,
          actor_type TEXT,
          provenance_class TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          published_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_status_created ON outbox_events(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_outbox_correlation ON outbox_events(correlation_id);
      `);

      // 3. Background Jobs Engine (GAR-036 §4.x & §6)
      db.exec(`
        CREATE TABLE IF NOT EXISTS job_definitions (
          id TEXT PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          description TEXT,
          default_max_retries INTEGER NOT NULL DEFAULT 5,
          timeout_seconds INTEGER NOT NULL DEFAULT 300,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS job_instances (
          id TEXT PRIMARY KEY,
          job_name TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'QUEUED',
          retry_count INTEGER NOT NULL DEFAULT 0,
          max_retries INTEGER NOT NULL DEFAULT 5,
          run_at TEXT NOT NULL,
          lease_id TEXT,
          lease_expires_at TEXT,
          last_error TEXT,
          correlation_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_status_run_at ON job_instances(status, run_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_lease ON job_instances(lease_id, lease_expires_at);

        CREATE TABLE IF NOT EXISTS dead_letter_jobs (
          id TEXT PRIMARY KEY,
          original_job_id TEXT NOT NULL,
          job_name TEXT NOT NULL,
          payload TEXT NOT NULL,
          failure_reason TEXT NOT NULL,
          retry_count INTEGER NOT NULL,
          correlation_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dead_letters_job ON dead_letter_jobs(job_name, created_at DESC);
      `);

      // 4. API Idempotency Records (GAR-034 §7, GAR-000 §12)
      db.exec(`
        CREATE TABLE IF NOT EXISTS idempotency_records (
          idempotency_key TEXT PRIMARY KEY,
          actor_id TEXT,
          endpoint TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          status_code INTEGER NOT NULL,
          response_body TEXT NOT NULL,
          resource_version INTEGER,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_records(expires_at);
      `);

      // 5. Feature Flags (GAR-046 §4.x & §7)
      db.exec(`
        CREATE TABLE IF NOT EXISTS feature_flags (
          key TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          description TEXT NOT NULL,
          percentage INTEGER NOT NULL DEFAULT 100,
          roles TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 6. Secure File & Object Storage Metadata (GAR-038 §4.x)
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_objects (
          id TEXT PRIMARY KEY,
          storage_key TEXT UNIQUE NOT NULL,
          filename TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          scan_status TEXT NOT NULL DEFAULT 'AVAILABLE',
          owner_id TEXT,
          data_classification TEXT NOT NULL DEFAULT 'INTERNAL',
          metadata TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_files_owner ON file_objects(owner_id);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS file_objects;
        DROP TABLE IF EXISTS feature_flags;
        DROP TABLE IF EXISTS idempotency_records;
        DROP TABLE IF EXISTS dead_letter_jobs;
        DROP TABLE IF EXISTS job_instances;
        DROP TABLE IF EXISTS job_definitions;
        DROP TABLE IF EXISTS outbox_events;
        DROP TABLE IF EXISTS audit_events;
      `);
    },
  },
  {
    id: '002_canonical_core_entities_schema',
    name: 'Canonical Core Entities Foundation (Users, Vehicles, Timeline, Providers)',
    up: (db: DatabaseSync) => {
      // Users & Accounts (GAR-003, GAR-033 §12A)
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'VEHICLE_OWNER',
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          account_type TEXT NOT NULL DEFAULT 'PERSONAL',
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // Vehicles & Identity (GAR-004, GAR-033 §12A)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicles (
          id TEXT PRIMARY KEY,
          owner_scope_type TEXT NOT NULL DEFAULT 'USER',
          owner_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          make TEXT NOT NULL,
          model TEXT NOT NULL,
          model_year INTEGER,
          trim TEXT,
          vin TEXT UNIQUE,
          registration_number TEXT,
          fuel_type TEXT DEFAULT 'PETROL',
          transmission TEXT DEFAULT 'AUTOMATIC',
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          current_odometer_cache INTEGER DEFAULT 0,
          timezone TEXT DEFAULT 'Africa/Nairobi',
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON vehicles(owner_id);
        CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin);

        CREATE TABLE IF NOT EXISTS vehicle_ownerships (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
          owner_id TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS odometer_observations (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
          reading_km INTEGER NOT NULL,
          source_class TEXT NOT NULL,
          source_ref TEXT,
          recorded_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_odometer_vehicle ON odometer_observations(vehicle_id, reading_km DESC);
      `);

      // Vehicle Timeline & Passport Entries (GAR-005, GAR-033 §12A)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_timeline_events (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
          entry_type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          source_class TEXT NOT NULL,
          source_ref TEXT,
          verification_state TEXT NOT NULL DEFAULT 'UNVERIFIED',
          subject_refs TEXT NOT NULL DEFAULT '{}',
          summary_payload TEXT NOT NULL,
          supersedes_entry_id TEXT,
          privacy_class TEXT NOT NULL DEFAULT 'INTERNAL',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        -- Mandatory Indexing Rule 2 (GAR-033 §12B): (vehicle_id, occurred_at desc, id) for cursor pagination
        CREATE INDEX IF NOT EXISTS idx_vehicle_timeline_cursor ON vehicle_timeline_events(vehicle_id, occurred_at DESC, id);
      `);

      // Providers Foundation (GAR-011, GAR-033 §12A)
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          provider_type TEXT NOT NULL, -- 'GARAGE' | 'MOBILE_MECHANIC' | 'TOW_OPERATOR'
          verification_state TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
          phone TEXT,
          email TEXT,
          location_lat REAL,
          location_lng REAL,
          address TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_providers_verification ON service_providers(verification_state, status);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS service_providers;
        DROP TABLE IF EXISTS vehicle_timeline_events;
        DROP TABLE IF EXISTS odometer_observations;
        DROP TABLE IF EXISTS vehicle_ownerships;
        DROP TABLE IF EXISTS vehicles;
        DROP TABLE IF EXISTS accounts;
        DROP TABLE IF EXISTS users;
      `);
    },
  },
  {
    id: '003_identity_auth_and_access_architecture',
    name: 'Canonical Identity, Authentication, Authorization & Account Architecture (GAR-003)',
    up: (db: DatabaseSync) => {
      // 1. Extend users table idempotently
      const userCols = (db.prepare('PRAGMA table_info(users);').all() as Array<{ name: string }>).map((c) => c.name);
      if (!userCols.includes('phone')) db.exec('ALTER TABLE users ADD COLUMN phone TEXT;');
      if (!userCols.includes('account_status')) db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'ACTIVE';");
      if (!userCols.includes('email_verified_at')) db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT;');
      if (!userCols.includes('phone_verified_at')) db.exec('ALTER TABLE users ADD COLUMN phone_verified_at TEXT;');
      if (!userCols.includes('last_authenticated_at')) db.exec('ALTER TABLE users ADD COLUMN last_authenticated_at TEXT;');
      if (!userCols.includes('failed_login_attempts')) db.exec('ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;');
      if (!userCols.includes('locked_until')) db.exec('ALTER TABLE users ADD COLUMN locked_until TEXT;');
      if (!userCols.includes('deleted_at')) db.exec('ALTER TABLE users ADD COLUMN deleted_at TEXT;');

      // 2. User Profiles (Separate from credentials & identity)
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_profiles (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          display_name TEXT NOT NULL,
          first_name TEXT,
          last_name TEXT,
          avatar_url TEXT,
          preferred_language TEXT NOT NULL DEFAULT 'en',
          timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
          country TEXT NOT NULL DEFAULT 'KE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 3. Secure Credentials
      db.exec(`
        CREATE TABLE IF NOT EXISTS credentials (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          credential_type TEXT NOT NULL,
          secret_hash TEXT NOT NULL,
          salt TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);
      `);

      // 4. Authenticated Runtime Sessions
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT UNIQUE NOT NULL,
          device_info TEXT,
          ip_address TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          last_activity_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON sessions(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
      `);

      // 5. Verification Challenges & Password Reset Tokens
      db.exec(`
        CREATE TABLE IF NOT EXISTS verification_challenges (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          challenge_type TEXT NOT NULL,
          identifier TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_challenges_user_type ON verification_challenges(user_id, challenge_type);
        CREATE INDEX IF NOT EXISTS idx_challenges_token_hash ON verification_challenges(token_hash);
      `);

      // 6. Organizations (Tenants)
      db.exec(`
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          organization_type TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_orgs_status ON organizations(status);
        CREATE INDEX IF NOT EXISTS idx_orgs_type ON organizations(organization_type);
      `);

      // 7. Organization Memberships
      db.exec(`
        CREATE TABLE IF NOT EXISTS organization_memberships (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          invited_at TEXT,
          accepted_at TEXT,
          revoked_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(user_id, organization_id)
        );
        CREATE INDEX IF NOT EXISTS idx_memberships_user ON organization_memberships(user_id);
        CREATE INDEX IF NOT EXISTS idx_memberships_org ON organization_memberships(organization_id);
      `);

      // 8. Organization Invitations
      db.exec(`
        CREATE TABLE IF NOT EXISTS organization_invitations (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          inviter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          role TEXT NOT NULL,
          token_hash TEXT UNIQUE NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON organization_invitations(token_hash);
        CREATE INDEX IF NOT EXISTS idx_invitations_org_email ON organization_invitations(organization_id, email);
      `);

      // 9. Platform Global Roles
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_platform_roles (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          assigned_by TEXT NOT NULL,
          assigned_at TEXT NOT NULL,
          PRIMARY KEY (user_id, role)
        );
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS user_platform_roles;
        DROP TABLE IF EXISTS organization_invitations;
        DROP TABLE IF EXISTS organization_memberships;
        DROP TABLE IF EXISTS organizations;
        DROP TABLE IF EXISTS verification_challenges;
        DROP TABLE IF EXISTS sessions;
        DROP TABLE IF EXISTS credentials;
        DROP TABLE IF EXISTS user_profiles;
      `);
    },
  },
  {
    id: '004_canonical_vehicle_domain_kernel',
    name: 'Canonical Vehicle Aggregate, Identifiers, Relationships, Odometer & Catalog Foundation (GAR-004)',
    up: (db: DatabaseSync) => {
      // 1. Dynamic check for vehicles columns and alter
      const vehicleTableInfo = db.prepare("PRAGMA table_info(vehicles);").all() as Array<{ name: string }>;
      const existingVehicleCols = new Set(vehicleTableInfo.map((c) => c.name));

      const addColIfNotExists = (colName: string, colDef: string) => {
        if (!existingVehicleCols.has(colName)) {
          db.exec(`ALTER TABLE vehicles ADD COLUMN ${colName} ${colDef};`);
        }
      };

      addColIfNotExists('nickname', 'TEXT');
      addColIfNotExists('variant', 'TEXT');
      addColIfNotExists('vehicle_type', "TEXT NOT NULL DEFAULT 'SEDAN'");
      addColIfNotExists('body_type', 'TEXT');
      addColIfNotExists('color', 'TEXT');
      addColIfNotExists('drive_type', 'TEXT');
      addColIfNotExists('engine_number', 'TEXT');
      addColIfNotExists('engine_type', 'TEXT');
      addColIfNotExists('engine_displacement_cc', 'INTEGER');
      addColIfNotExists('manufacture_date', 'TEXT');
      addColIfNotExists('first_registration_date', 'TEXT');
      addColIfNotExists('country_of_registration', "TEXT NOT NULL DEFAULT 'KE'");
      addColIfNotExists('verification_status', "TEXT NOT NULL DEFAULT 'OWNER_ASSERTED'");
      addColIfNotExists('primary_image_id', 'TEXT');
      addColIfNotExists('current_odometer_unit', "TEXT NOT NULL DEFAULT 'KM'");
      addColIfNotExists('created_by', 'TEXT');
      addColIfNotExists('archived_at', 'TEXT');

      db.exec(`UPDATE vehicles SET created_by = owner_id WHERE created_by IS NULL;`);

      // 2. Structured Vehicle Identifiers (GAR-004 §6, GAR-033 §12A)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_identifiers (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          value TEXT NOT NULL,
          normalized_value TEXT NOT NULL,
          issuing_country TEXT DEFAULT 'KE',
          source TEXT NOT NULL DEFAULT 'OWNER_ENTERED',
          verification_status TEXT NOT NULL DEFAULT 'OWNER_ASSERTED',
          is_primary INTEGER NOT NULL DEFAULT 1,
          valid_from TEXT NOT NULL,
          valid_until TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vident_vehicle ON vehicle_identifiers(vehicle_id);
        CREATE INDEX IF NOT EXISTS idx_vident_type_val ON vehicle_identifiers(type, normalized_value);
      `);

      // 3. Vehicle Relationships Entity (GAR-004 §9, GAR-030 §5)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_relationships (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id),
          organization_id TEXT REFERENCES organizations(id),
          relationship_type TEXT NOT NULL,
          is_primary_owner INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          provenance_class TEXT NOT NULL DEFAULT 'OWNER_ASSERTED',
          valid_from TEXT NOT NULL,
          valid_until TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vrel_user_status ON vehicle_relationships(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_vrel_vehicle_status ON vehicle_relationships(vehicle_id, status);
        CREATE INDEX IF NOT EXISTS idx_vrel_org ON vehicle_relationships(organization_id);
      `);

      // 4. Enhance Odometer Observations (GAR-004 §11)
      const odoTableInfo = db.prepare("PRAGMA table_info(odometer_observations);").all() as Array<{ name: string }>;
      const existingOdoCols = new Set(odoTableInfo.map((c) => c.name));

      const addOdoColIfNotExists = (colName: string, colDef: string) => {
        if (!existingOdoCols.has(colName)) {
          db.exec(`ALTER TABLE odometer_observations ADD COLUMN ${colName} ${colDef};`);
        }
      };

      addOdoColIfNotExists('reading_value', 'REAL');
      addOdoColIfNotExists('unit', "TEXT NOT NULL DEFAULT 'KM'");
      addOdoColIfNotExists('observed_at', 'TEXT');
      addOdoColIfNotExists('actor_id', 'TEXT');
      addOdoColIfNotExists('provider_id', 'TEXT');
      addOdoColIfNotExists('status', "TEXT NOT NULL DEFAULT 'VALID'");
      addOdoColIfNotExists('flag_reason', 'TEXT');
      addOdoColIfNotExists('superseded_by_id', 'TEXT');
      addOdoColIfNotExists('correction_reason', 'TEXT');
      addOdoColIfNotExists('notes', 'TEXT');

      db.exec(`
        UPDATE odometer_observations
        SET reading_value = reading_km,
            observed_at = recorded_at,
            actor_id = 'usr_foundation_demo',
            status = 'VALID'
        WHERE reading_value IS NULL;
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_odometer_v_status ON odometer_observations(vehicle_id, status, reading_km DESC);
      `);

      // 5. Vehicle Documents Foundation (GAR-004 §14, GAR-038)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_documents (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          document_type TEXT NOT NULL,
          file_id TEXT NOT NULL,
          title TEXT NOT NULL,
          document_number TEXT,
          issuer TEXT,
          issued_at TEXT,
          expires_at TEXT,
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vdoc_vehicle ON vehicle_documents(vehicle_id);
      `);

      // 6. Extensible Make/Model Catalog
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_catalog_makes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          country_of_origin TEXT,
          is_popular INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS vehicle_catalog_models (
          id TEXT PRIMARY KEY,
          make_id TEXT NOT NULL REFERENCES vehicle_catalog_makes(id),
          name TEXT NOT NULL,
          body_type TEXT NOT NULL DEFAULT 'SUV',
          fuel_types TEXT NOT NULL DEFAULT '["PETROL"]',
          transmissions TEXT NOT NULL DEFAULT '["AUTOMATIC"]',
          popular_model_years TEXT NOT NULL DEFAULT '[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]',
          UNIQUE(make_id, name)
        );
        CREATE INDEX IF NOT EXISTS idx_vcat_model_make ON vehicle_catalog_models(make_id);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS vehicle_catalog_models;
        DROP TABLE IF EXISTS vehicle_catalog_makes;
        DROP TABLE IF EXISTS vehicle_documents;
        DROP TABLE IF EXISTS vehicle_relationships;
        DROP TABLE IF EXISTS vehicle_identifiers;
      `);
    },
  },
  {
    id: '005_canonical_vehicle_timeline_and_passport',
    name: 'Canonical Vehicle Timeline and Digital Vehicle Passport Architecture (GAR-005)',
    up: (db: DatabaseSync) => {
      // 1. Canonical Vehicle Timeline Entries Table (GAR-005 §6-§15, GAR-033 §12C)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_timeline_entries (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          entry_type TEXT NOT NULL,
          category TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_reference_type TEXT,
          source_reference_id TEXT,
          source_event_id TEXT UNIQUE,
          actor_type TEXT,
          actor_id TEXT,
          organization_id TEXT,
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
          confidence REAL,
          odometer_value REAL,
          odometer_unit TEXT DEFAULT 'KM',
          location_reference TEXT,
          visibility TEXT NOT NULL DEFAULT 'OWNER_ONLY',
          sensitivity TEXT NOT NULL DEFAULT 'NORMAL',
          supersedes_timeline_entry_id TEXT,
          corrected_by_timeline_entry_id TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_timeline_v_occurred ON vehicle_timeline_entries(vehicle_id, occurred_at DESC, id);
        CREATE INDEX IF NOT EXISTS idx_timeline_v_category ON vehicle_timeline_entries(vehicle_id, category, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS idx_timeline_source_ref ON vehicle_timeline_entries(source_reference_type, source_reference_id);
        CREATE INDEX IF NOT EXISTS idx_timeline_verification ON vehicle_timeline_entries(verification_status);
        CREATE INDEX IF NOT EXISTS idx_timeline_event_id ON vehicle_timeline_entries(source_event_id);
      `);

      // 2. Timeline Non-Destructive Corrections Audit Trail (GAR-005 §17-§19)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_timeline_corrections (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          original_entry_id TEXT NOT NULL REFERENCES vehicle_timeline_entries(id),
          corrected_entry_id TEXT NOT NULL REFERENCES vehicle_timeline_entries(id),
          correction_reason TEXT NOT NULL,
          explanation TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_corrections_original ON vehicle_timeline_corrections(original_entry_id);
        CREATE INDEX IF NOT EXISTS idx_corrections_vehicle ON vehicle_timeline_corrections(vehicle_id);
      `);

      // 3. Timeline Disputes Table (GAR-005 §19)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_timeline_disputes (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          timeline_entry_id TEXT NOT NULL REFERENCES vehicle_timeline_entries(id),
          dispute_reason TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'OPEN',
          resolved_at TEXT,
          resolution_notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_disputes_entry ON vehicle_timeline_disputes(timeline_entry_id);
        CREATE INDEX IF NOT EXISTS idx_disputes_vehicle ON vehicle_timeline_disputes(vehicle_id);
      `);

      // 4. Materialized Digital Vehicle Passport Projections (GAR-005 §22-§26, GAR-033 §12C)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_passport_projections (
          vehicle_id TEXT PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
          version INTEGER NOT NULL DEFAULT 1,
          passport_payload TEXT NOT NULL,
          integrity_hash TEXT NOT NULL,
          source_version INTEGER NOT NULL DEFAULT 1,
          is_stale INTEGER NOT NULL DEFAULT 0,
          last_projected_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_passport_stale ON vehicle_passport_projections(is_stale);
      `);

      // 5. Passport Secure Share Grants (GAR-005 §33-§39)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_passport_share_grants (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          created_by TEXT NOT NULL REFERENCES users(id),
          token_hash TEXT UNIQUE NOT NULL,
          scope TEXT NOT NULL,
          recipient_label TEXT,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_passport_share_token ON vehicle_passport_share_grants(token_hash);
        CREATE INDEX IF NOT EXISTS idx_passport_share_vehicle ON vehicle_passport_share_grants(vehicle_id);
      `);

      // 6. Passport Share Access Audit Logs (GAR-005 §36)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_passport_share_access_logs (
          id TEXT PRIMARY KEY,
          share_grant_id TEXT NOT NULL REFERENCES vehicle_passport_share_grants(id) ON DELETE CASCADE,
          ip_address TEXT,
          user_agent TEXT,
          accessed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_share_access_grant ON vehicle_passport_share_access_logs(share_grant_id, accessed_at DESC);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS vehicle_passport_share_access_logs;
        DROP TABLE IF EXISTS vehicle_passport_share_grants;
        DROP TABLE IF EXISTS vehicle_passport_projections;
        DROP TABLE IF EXISTS vehicle_timeline_disputes;
        DROP TABLE IF EXISTS vehicle_timeline_corrections;
        DROP TABLE IF EXISTS vehicle_timeline_entries;
      `);
    },
  },
  {
    id: '006_canonical_maintenance_and_service_intelligence',
    name: 'Vehicle Maintenance, Service Scheduling & Due-State Intelligence Engine (GAR-006)',
    up: (db: DatabaseSync) => {
      // 1. Canonical Maintenance Requirements (GAR-006 §6, GAR-033 §12D)
      db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_requirements (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          category TEXT NOT NULL,
          component_system TEXT NOT NULL,
          default_severity TEXT NOT NULL DEFAULT 'MEDIUM',
          default_priority INTEGER NOT NULL DEFAULT 50,
          recommended_action TEXT,
          recurring INTEGER NOT NULL DEFAULT 1,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mreq_category ON maintenance_requirements(category);
        CREATE INDEX IF NOT EXISTS idx_mreq_code ON maintenance_requirements(code);
      `);

      // 2. Canonical Maintenance Rules (GAR-006 §8-§14, GAR-033 §12D)
      db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_rules (
          id TEXT PRIMARY KEY,
          requirement_id TEXT NOT NULL REFERENCES maintenance_requirements(id) ON DELETE CASCADE,
          interval_type TEXT NOT NULL,
          distance_interval REAL,
          distance_unit TEXT DEFAULT 'KM',
          time_interval_value INTEGER,
          time_interval_unit TEXT,
          trigger_policy TEXT NOT NULL DEFAULT 'WHICHEVER_COMES_FIRST',
          initial_distance REAL,
          initial_time_offset_days INTEGER,
          approaching_distance_threshold REAL DEFAULT 1000,
          approaching_time_threshold_days INTEGER DEFAULT 30,
          applicability_conditions TEXT DEFAULT '{}',
          source_type TEXT NOT NULL DEFAULT 'GARAGE_OS_CATALOG',
          source_reference TEXT,
          verification_status TEXT NOT NULL DEFAULT 'CATALOG_DEFINED',
          effective_from TEXT,
          effective_until TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mrule_requirement ON maintenance_rules(requirement_id);
        CREATE INDEX IF NOT EXISTS idx_mrule_source ON maintenance_rules(source_type);
      `);

      // 3. Vehicle Maintenance Plans (GAR-006 §15-§17)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_maintenance_plans (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          source TEXT NOT NULL DEFAULT 'GARAGE_OS_CATALOG',
          notes TEXT,
          created_at TEXT NOT NULL,
          activated_at TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vmplan_vehicle ON vehicle_maintenance_plans(vehicle_id, status);
      `);

      // 4. Vehicle Maintenance Plan Entries (GAR-006 §16)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_maintenance_plan_entries (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL REFERENCES vehicle_maintenance_plans(id) ON DELETE CASCADE,
          requirement_id TEXT NOT NULL REFERENCES maintenance_requirements(id) ON DELETE CASCADE,
          rule_id TEXT NOT NULL REFERENCES maintenance_rules(id),
          enabled INTEGER NOT NULL DEFAULT 1,
          priority_override INTEGER,
          custom_distance_interval REAL,
          custom_time_interval_value INTEGER,
          custom_time_interval_unit TEXT,
          last_known_completion_id TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(plan_id, requirement_id)
        );
        CREATE INDEX IF NOT EXISTS idx_vmpe_plan ON vehicle_maintenance_plan_entries(plan_id);
        CREATE INDEX IF NOT EXISTS idx_vmpe_req ON vehicle_maintenance_plan_entries(requirement_id);
      `);

      // 5. Maintenance Cycles (GAR-006 §5, §18-§25)
      db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_cycles (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          plan_entry_id TEXT NOT NULL REFERENCES vehicle_maintenance_plan_entries(id) ON DELETE CASCADE,
          requirement_id TEXT NOT NULL REFERENCES maintenance_requirements(id),
          rule_id TEXT NOT NULL REFERENCES maintenance_rules(id),
          cycle_number INTEGER NOT NULL DEFAULT 1,
          baseline_distance_km REAL NOT NULL,
          baseline_date TEXT NOT NULL,
          due_distance_km REAL,
          due_date TEXT,
          status TEXT NOT NULL DEFAULT 'OK',
          trigger_reason TEXT,
          distance_remaining_km REAL,
          days_remaining INTEGER,
          deferred_until_date TEXT,
          deferred_until_distance_km REAL,
          deferral_reason TEXT,
          completed_at TEXT,
          completion_id TEXT,
          last_evaluated_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mcycle_vehicle ON maintenance_cycles(vehicle_id, status);
        CREATE INDEX IF NOT EXISTS idx_mcycle_plan_entry ON maintenance_cycles(plan_entry_id);
        CREATE INDEX IF NOT EXISTS idx_mcycle_due_date ON maintenance_cycles(due_date);
        CREATE INDEX IF NOT EXISTS idx_mcycle_due_km ON maintenance_cycles(due_distance_km);
      `);

      // 6. Maintenance Completions (GAR-006 §26-§32)
      db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_completions (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          plan_entry_id TEXT REFERENCES vehicle_maintenance_plan_entries(id),
          requirement_id TEXT NOT NULL REFERENCES maintenance_requirements(id),
          cycle_id TEXT REFERENCES maintenance_cycles(id),
          completed_at TEXT NOT NULL,
          odometer_value REAL NOT NULL,
          odometer_unit TEXT NOT NULL DEFAULT 'KM',
          service_provider_id TEXT,
          service_provider_name TEXT,
          service_record_id TEXT,
          performed_actions TEXT NOT NULL DEFAULT '[]',
          replaced_parts TEXT NOT NULL DEFAULT '[]',
          cost_total REAL DEFAULT 0,
          currency TEXT DEFAULT 'KES',
          notes TEXT,
          recorded_by TEXT NOT NULL,
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
          document_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mcomp_vehicle ON maintenance_completions(vehicle_id, completed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_mcomp_req ON maintenance_completions(requirement_id);
      `);

      // 7. Maintenance Deferrals (GAR-006 §33-§35)
      db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_deferrals (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          cycle_id TEXT NOT NULL REFERENCES maintenance_cycles(id),
          plan_entry_id TEXT NOT NULL REFERENCES vehicle_maintenance_plan_entries(id),
          deferred_at TEXT NOT NULL,
          deferred_by TEXT NOT NULL,
          reason TEXT NOT NULL,
          deferred_until_date TEXT,
          deferred_until_distance_km REAL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mdef_vehicle ON maintenance_deferrals(vehicle_id);
        CREATE INDEX IF NOT EXISTS idx_mdef_cycle ON maintenance_deferrals(cycle_id);
      `);

      // 8. Maintenance Reminders (GAR-006 §36-§40)
      db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_reminders (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          cycle_id TEXT NOT NULL REFERENCES maintenance_cycles(id),
          requirement_id TEXT NOT NULL REFERENCES maintenance_requirements(id),
          reminder_type TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'IN_APP',
          target_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'SCHEDULED',
          message TEXT NOT NULL,
          sent_at TEXT,
          acknowledged_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mrem_vehicle ON maintenance_reminders(vehicle_id, status);
        CREATE INDEX IF NOT EXISTS idx_mrem_target ON maintenance_reminders(target_date, status);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS maintenance_reminders;
        DROP TABLE IF EXISTS maintenance_deferrals;
        DROP TABLE IF EXISTS maintenance_completions;
        DROP TABLE IF EXISTS maintenance_cycles;
        DROP TABLE IF EXISTS vehicle_maintenance_plan_entries;
        DROP TABLE IF EXISTS vehicle_maintenance_plans;
        DROP TABLE IF EXISTS maintenance_rules;
        DROP TABLE IF EXISTS maintenance_requirements;
      `);
    },
  },
  {
    id: '006_issue_and_fault_architecture',
    name: 'Canonical Vehicle Issue, Fault Memory & Persistent Problem System (GAR-008, GAR-033)',
    up: (db: DatabaseSync) => {
      // 1. Vehicle Issues Aggregate (GAR-008 §6-§10)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_issues (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          issue_code TEXT,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          category TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'MODERATE',
          status TEXT NOT NULL DEFAULT 'REPORTED',
          persistence_state TEXT NOT NULL DEFAULT 'SINGLE_OCCURRENCE',
          primary_component_category TEXT,
          first_observed_at TEXT NOT NULL,
          last_observed_at TEXT NOT NULL,
          first_observed_odometer_km REAL,
          last_observed_odometer_km REAL,
          occurrence_count INTEGER NOT NULL DEFAULT 1,
          diagnosis_count INTEGER NOT NULL DEFAULT 0,
          intervention_count INTEGER NOT NULL DEFAULT 0,
          last_intervention_id TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_issue_vehicle_status ON vehicle_issues(vehicle_id, status);
        CREATE INDEX IF NOT EXISTS idx_issue_vehicle_category ON vehicle_issues(vehicle_id, category);
        CREATE INDEX IF NOT EXISTS idx_issue_persistence ON vehicle_issues(vehicle_id, persistence_state);
        CREATE INDEX IF NOT EXISTS idx_issue_status_sev ON vehicle_issues(status, severity);
      `);

      // 2. Issue Occurrences (GAR-008 §11-§13)
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_occurrences (
          id TEXT PRIMARY KEY,
          vehicle_issue_id TEXT NOT NULL REFERENCES vehicle_issues(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          occurred_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          odometer_value REAL,
          odometer_unit TEXT NOT NULL DEFAULT 'KM',
          odometer_km REAL,
          description TEXT NOT NULL,
          symptom_category TEXT NOT NULL DEFAULT 'OTHER',
          driving_condition TEXT,
          speed_range TEXT,
          engine_temperature_state TEXT,
          weather_context TEXT,
          road_condition TEXT,
          source_type TEXT NOT NULL DEFAULT 'OWNER_ASSERTED',
          actor_id TEXT NOT NULL,
          location_reference TEXT,
          evidence_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_occ_issue ON issue_occurrences(vehicle_issue_id, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS idx_occ_vehicle ON issue_occurrences(vehicle_id, occurred_at DESC);
      `);

      // 3. Issue Observations (GAR-008 §14)
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_observations (
          id TEXT PRIMARY KEY,
          vehicle_issue_id TEXT NOT NULL REFERENCES vehicle_issues(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          observation_type TEXT NOT NULL DEFAULT 'VISUAL',
          description TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'OWNER_ASSERTED',
          source_reference_id TEXT,
          observed_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          actor_id TEXT,
          provider_id TEXT,
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_obs_issue ON issue_observations(vehicle_issue_id);
      `);

      // 4. Suspected Causes (GAR-008 §16)
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_suspected_causes (
          id TEXT PRIMARY KEY,
          vehicle_issue_id TEXT NOT NULL REFERENCES vehicle_issues(id) ON DELETE CASCADE,
          component_category TEXT NOT NULL,
          description TEXT NOT NULL,
          confidence REAL,
          source_type TEXT NOT NULL DEFAULT 'OWNER_ASSERTED',
          proposed_by TEXT NOT NULL,
          proposed_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'POSSIBLE',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sc_issue ON issue_suspected_causes(vehicle_issue_id);
      `);

      // 5. Professional Diagnoses (GAR-008 §17-§19)
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_diagnoses (
          id TEXT PRIMARY KEY,
          vehicle_issue_id TEXT NOT NULL REFERENCES vehicle_issues(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL,
          provider_name TEXT NOT NULL,
          technician_id TEXT,
          technician_name TEXT,
          diagnosed_at TEXT NOT NULL,
          diagnosis_code TEXT,
          diagnosis_summary TEXT NOT NULL,
          diagnosis_details TEXT NOT NULL,
          confirmed_component TEXT,
          outcome TEXT NOT NULL DEFAULT 'CONFIRMED',
          verification_status TEXT NOT NULL DEFAULT 'PROVIDER_RECORDED',
          evidence_reference_ids TEXT NOT NULL DEFAULT '[]',
          source_work_order_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_diag_issue ON issue_diagnoses(vehicle_issue_id, diagnosed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_diag_vehicle ON issue_diagnoses(vehicle_id);
      `);

      // 6. Interventions & Attempted Repairs (GAR-008 §20-§24)
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_interventions (
          id TEXT PRIMARY KEY,
          vehicle_issue_id TEXT NOT NULL REFERENCES vehicle_issues(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          intervention_type TEXT NOT NULL,
          description TEXT NOT NULL,
          performed_at TEXT NOT NULL,
          odometer_value REAL,
          odometer_unit TEXT NOT NULL DEFAULT 'KM',
          odometer_km REAL,
          provider_id TEXT,
          provider_name TEXT,
          work_order_id TEXT,
          replaced_part_names TEXT NOT NULL DEFAULT '[]',
          cost_total REAL DEFAULT 0,
          currency TEXT DEFAULT 'KES',
          result TEXT NOT NULL DEFAULT 'AWAITING_OBSERVATION',
          verification_status TEXT NOT NULL DEFAULT 'PROVIDER_RECORDED',
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_intv_issue ON issue_interventions(vehicle_issue_id, performed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_intv_vehicle ON issue_interventions(vehicle_id);
      `);

      // 7. Resolutions (GAR-008 §25-§26)
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_resolutions (
          id TEXT PRIMARY KEY,
          vehicle_issue_id TEXT NOT NULL REFERENCES vehicle_issues(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          resolved_at TEXT NOT NULL,
          resolved_odometer_km REAL,
          resolution_type TEXT NOT NULL,
          resolution_summary TEXT NOT NULL,
          resolved_by TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'OWNER_CONFIRMED',
          confirmation_state TEXT NOT NULL DEFAULT 'CONFIRMED',
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_res_issue ON issue_resolutions(vehicle_issue_id);
      `);

      // 8. Follow-ups & "Still Happening?" Checks (GAR-008 §51-§53)
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_followups (
          id TEXT PRIMARY KEY,
          vehicle_issue_id TEXT NOT NULL REFERENCES vehicle_issues(id) ON DELETE CASCADE,
          intervention_id TEXT NOT NULL REFERENCES issue_interventions(id) ON DELETE CASCADE,
          scheduled_at TEXT NOT NULL,
          due_date TEXT NOT NULL,
          due_odometer_km REAL,
          status TEXT NOT NULL DEFAULT 'SCHEDULED',
          prompt_message TEXT NOT NULL,
          response TEXT,
          response_notes TEXT,
          responded_at TEXT,
          responded_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fol_issue ON issue_followups(vehicle_issue_id, status);
        CREATE INDEX IF NOT EXISTS idx_fol_due ON issue_followups(due_date, status);
      `);

      // 9. Issue Evidence Links (GAR-008 §42-§43)
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_evidence_links (
          id TEXT PRIMARY KEY,
          vehicle_issue_id TEXT NOT NULL REFERENCES vehicle_issues(id) ON DELETE CASCADE,
          occurrence_id TEXT REFERENCES issue_occurrences(id) ON DELETE SET NULL,
          file_id TEXT NOT NULL,
          file_url TEXT NOT NULL,
          evidence_type TEXT NOT NULL DEFAULT 'PHOTO',
          title TEXT NOT NULL,
          caption TEXT,
          captured_at TEXT,
          uploaded_at TEXT NOT NULL,
          uploaded_by TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_iev_issue ON issue_evidence_links(vehicle_issue_id);
      `);

      // 10. Issue Merge Records (GAR-008 §57)
      db.exec(`
        CREATE TABLE IF NOT EXISTS issue_merge_records (
          id TEXT PRIMARY KEY,
          surviving_issue_id TEXT NOT NULL REFERENCES vehicle_issues(id) ON DELETE CASCADE,
          merged_issue_id TEXT NOT NULL,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          reason TEXT NOT NULL,
          merged_by TEXT NOT NULL,
          merged_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_imr_surviving ON issue_merge_records(surviving_issue_id);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS issue_merge_records;
        DROP TABLE IF EXISTS issue_evidence_links;
        DROP TABLE IF EXISTS issue_followups;
        DROP TABLE IF EXISTS issue_resolutions;
        DROP TABLE IF EXISTS issue_interventions;
        DROP TABLE IF EXISTS issue_diagnoses;
        DROP TABLE IF EXISTS issue_suspected_causes;
        DROP TABLE IF EXISTS issue_observations;
        DROP TABLE IF EXISTS issue_occurrences;
        DROP TABLE IF EXISTS vehicle_issues;
      `);
    },
  },
  {
    id: '007_canonical_fuel_and_expense_architecture',
    name: 'Canonical Fuel, Expense & Total Cost of Ownership Architecture (GAR-009)',
    up: (db: DatabaseSync) => {
      // 1. Fuel Entries (GAR-009 §2, §21-§22)
      db.exec(`
        CREATE TABLE IF NOT EXISTS fuel_entries (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          fueled_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          odometer_value REAL,
          odometer_unit TEXT,
          odometer_km REAL,
          fuel_type TEXT NOT NULL,
          quantity REAL NOT NULL,
          quantity_unit TEXT NOT NULL,
          quantity_litres REAL NOT NULL,
          total_cost REAL NOT NULL,
          currency TEXT NOT NULL,
          price_per_unit REAL,
          fill_type TEXT NOT NULL,
          tank_level_before REAL,
          tank_level_after REAL,
          station_name TEXT,
          location_reference TEXT,
          source_type TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          is_corrected INTEGER NOT NULL DEFAULT 0,
          correction_of_id TEXT REFERENCES fuel_entries(id) ON DELETE SET NULL,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fuel_vehicle_date ON fuel_entries(vehicle_id, fueled_at ASC, odometer_km ASC);
      `);

      // 2. Fuel Economy Intervals (GAR-009 §3)
      db.exec(`
        CREATE TABLE IF NOT EXISTS fuel_economy_intervals (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          start_fuel_entry_id TEXT NOT NULL REFERENCES fuel_entries(id) ON DELETE CASCADE,
          end_fuel_entry_id TEXT NOT NULL REFERENCES fuel_entries(id) ON DELETE CASCADE,
          distance_km REAL NOT NULL,
          fuel_consumed_litres REAL NOT NULL,
          km_per_litre REAL NOT NULL,
          litres_per_100_km REAL NOT NULL,
          mpg_us REAL NOT NULL,
          mpg_uk REAL NOT NULL,
          confidence TEXT NOT NULL,
          partial_fills_included_count INTEGER NOT NULL DEFAULT 0,
          calculated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fuel_intervals_vehicle ON fuel_economy_intervals(vehicle_id, calculated_at ASC);
      `);

      // 3. Fuel Efficiency Snapshots (GAR-009 §3.3)
      db.exec(`
        CREATE TABLE IF NOT EXISTS fuel_efficiency_snapshots (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          rolling_economy_km_l REAL NOT NULL,
          baseline_economy_km_l REAL NOT NULL,
          delta_percent REAL NOT NULL,
          anomaly_detected INTEGER NOT NULL DEFAULT 0,
          observation_text TEXT,
          data_quality TEXT NOT NULL,
          qualifying_intervals_count INTEGER NOT NULL,
          total_distance_km REAL NOT NULL,
          observed_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fuel_snapshot_vehicle ON fuel_efficiency_snapshots(vehicle_id, observed_at DESC);
      `);

      // 4. Vehicle Expenses (GAR-009 §4, §21-§22)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_expenses (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          expense_category TEXT NOT NULL,
          expense_subcategory TEXT,
          occurred_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL,
          cost_type TEXT NOT NULL,
          status TEXT NOT NULL,
          description TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_reference_type TEXT,
          source_reference_id TEXT,
          merchant_provider_id TEXT,
          recurring_expense_id TEXT,
          odometer_km REAL,
          receipt_document_id TEXT,
          notes TEXT,
          is_corrected INTEGER NOT NULL DEFAULT 0,
          correction_of_id TEXT REFERENCES vehicle_expenses(id) ON DELETE SET NULL,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_expense_vehicle_category ON vehicle_expenses(vehicle_id, expense_category, occurred_at DESC);
      `);

      // 5. Vehicle Expense Corrections (GAR-009 §4.3)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_expense_corrections (
          id TEXT PRIMARY KEY,
          vehicle_expense_id TEXT NOT NULL REFERENCES vehicle_expenses(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          previous_amount REAL NOT NULL,
          new_amount REAL NOT NULL,
          previous_currency TEXT NOT NULL,
          new_currency TEXT NOT NULL,
          previous_category TEXT NOT NULL,
          new_category TEXT NOT NULL,
          reason TEXT NOT NULL,
          corrected_by TEXT NOT NULL,
          corrected_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_expense_corr ON vehicle_expense_corrections(vehicle_expense_id);
      `);

      // 6. Recurring Vehicle Expenses (GAR-009 §5)
      db.exec(`
        CREATE TABLE IF NOT EXISTS recurring_vehicle_expenses (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          description TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL,
          frequency TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT,
          next_due_date TEXT NOT NULL,
          status TEXT NOT NULL,
          auto_create_expense INTEGER NOT NULL DEFAULT 1,
          last_processed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_recurring_vehicle_due ON recurring_vehicle_expenses(status, next_due_date ASC);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS recurring_vehicle_expenses;
        DROP TABLE IF EXISTS vehicle_expense_corrections;
        DROP TABLE IF EXISTS vehicle_expenses;
        DROP TABLE IF EXISTS fuel_efficiency_snapshots;
        DROP TABLE IF EXISTS fuel_economy_intervals;
        DROP TABLE IF EXISTS fuel_entries;
      `);
    },
  },
  {
    id: '008_canonical_parts_tyres_and_configuration_architecture',
    name: 'Canonical Tyres, Parts, Components & Vehicle Configuration Architecture (GAR-010)',
    up: (db: DatabaseSync) => {
      // 1. Component Definitions (Taxonomy / Reference) (GAR-010 §8)
      db.exec(`
        CREATE TABLE IF NOT EXISTS component_definitions (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          subcategory TEXT,
          classification TEXT NOT NULL,
          description TEXT,
          position_sensitive INTEGER NOT NULL DEFAULT 0,
          replaceable INTEGER NOT NULL DEFAULT 1,
          serviceable INTEGER NOT NULL DEFAULT 1,
          serializable INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_comp_def_cat ON component_definitions(category);
      `);

      // 2. Parts Catalog Items (GAR-010 §15)
      db.exec(`
        CREATE TABLE IF NOT EXISTS parts_catalog_items (
          id TEXT PRIMARY KEY,
          component_definition_id TEXT REFERENCES component_definitions(id) ON DELETE SET NULL,
          manufacturer TEXT NOT NULL,
          brand TEXT NOT NULL,
          part_number TEXT NOT NULL,
          oem_number TEXT,
          name TEXT NOT NULL,
          description TEXT,
          classification TEXT NOT NULL,
          condition TEXT NOT NULL DEFAULT 'NEW',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_parts_cat_mfr_num ON parts_catalog_items(manufacturer, part_number);
        CREATE INDEX IF NOT EXISTS idx_parts_cat_def ON parts_catalog_items(component_definition_id);
      `);

      // 3. Vehicle Components (Physical Instances Installed on Vehicles) (GAR-010 §6, §9)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_components (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          component_definition_id TEXT REFERENCES component_definitions(id) ON DELETE SET NULL,
          part_id TEXT REFERENCES parts_catalog_items(id) ON DELETE SET NULL,
          custom_name TEXT NOT NULL,
          category TEXT NOT NULL,
          subcategory TEXT,
          classification TEXT NOT NULL,
          brand TEXT,
          model TEXT,
          part_number TEXT,
          oem_number TEXT,
          serial_number TEXT,
          position TEXT,
          status TEXT NOT NULL DEFAULT 'INSTALLED',
          installed_at TEXT NOT NULL,
          installed_odometer_km REAL,
          installed_odometer_unit TEXT,
          installation_source TEXT NOT NULL,
          installation_provider_id TEXT,
          installation_provider_name TEXT,
          installation_work_order_id TEXT,
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
          removed_at TEXT,
          removed_odometer_km REAL,
          removal_reason TEXT,
          maintenance_completion_id TEXT REFERENCES maintenance_completions(id) ON DELETE SET NULL,
          issue_intervention_id TEXT,
          vehicle_expense_id TEXT REFERENCES vehicle_expenses(id) ON DELETE SET NULL,
          notes TEXT,
          is_current INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_comp_veh_current ON vehicle_components(vehicle_id, is_current, category);
        CREATE INDEX IF NOT EXISTS idx_comp_veh_position ON vehicle_components(vehicle_id, position) WHERE is_current = 1;
      `);

      // 4. Vehicle Component Replacements (Atomic Chain of Custody) (GAR-010 §13)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_component_replacements (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          old_component_id TEXT NOT NULL REFERENCES vehicle_components(id) ON DELETE CASCADE,
          new_component_id TEXT NOT NULL REFERENCES vehicle_components(id) ON DELETE CASCADE,
          replaced_at TEXT NOT NULL,
          odometer_km REAL,
          reason TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_comp_rep_veh ON vehicle_component_replacements(vehicle_id, replaced_at DESC);
        CREATE INDEX IF NOT EXISTS idx_comp_rep_old ON vehicle_component_replacements(old_component_id);
        CREATE INDEX IF NOT EXISTS idx_comp_rep_new ON vehicle_component_replacements(new_component_id);
      `);

      // 5. Vehicle Component Events (GAR-010 §9, §11)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_component_events (
          id TEXT PRIMARY KEY,
          vehicle_component_id TEXT NOT NULL REFERENCES vehicle_components(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          odometer_km REAL,
          actor_id TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          notes TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_comp_events ON vehicle_component_events(vehicle_component_id, occurred_at DESC);
      `);

      // 6. Component Warranties (GAR-010 §22-§26)
      db.exec(`
        CREATE TABLE IF NOT EXISTS component_warranties (
          id TEXT PRIMARY KEY,
          vehicle_component_id TEXT NOT NULL REFERENCES vehicle_components(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          provider_id TEXT,
          provider_name TEXT,
          seller_id TEXT,
          warranty_type TEXT NOT NULL,
          starts_at TEXT NOT NULL,
          expires_at TEXT,
          distance_limit_km REAL,
          distance_limit_value REAL,
          distance_unit TEXT,
          terms_summary TEXT NOT NULL,
          document_reference TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_comp_warr_veh ON component_warranties(vehicle_id, status);
        CREATE INDEX IF NOT EXISTS idx_comp_warr_comp ON component_warranties(vehicle_component_id);
      `);

      // 7. Component Evidence Links (GAR-010 §27)
      db.exec(`
        CREATE TABLE IF NOT EXISTS component_evidence_links (
          id TEXT PRIMARY KEY,
          vehicle_component_id TEXT NOT NULL REFERENCES vehicle_components(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          document_id TEXT,
          evidence_type TEXT NOT NULL,
          file_url TEXT NOT NULL,
          caption TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_comp_evidence ON component_evidence_links(vehicle_component_id);
      `);

      // 8. Vehicle Tyre Sets (GAR-010 §35)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_tyre_sets (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          season_type TEXT NOT NULL DEFAULT 'ALL_SEASON',
          installed_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tyre_set_veh ON vehicle_tyre_sets(vehicle_id, status);
      `);

      // 9. Vehicle Tyres (GAR-010 §28-§31)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_tyres (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          vehicle_component_id TEXT REFERENCES vehicle_components(id) ON DELETE SET NULL,
          part_id TEXT REFERENCES parts_catalog_items(id) ON DELETE SET NULL,
          tyre_set_id TEXT REFERENCES vehicle_tyre_sets(id) ON DELETE SET NULL,
          brand TEXT NOT NULL,
          model TEXT NOT NULL,
          size_raw TEXT NOT NULL,
          width INTEGER NOT NULL,
          aspect_ratio INTEGER NOT NULL,
          rim_diameter INTEGER NOT NULL,
          construction TEXT NOT NULL DEFAULT 'R',
          load_index INTEGER,
          speed_rating TEXT,
          manufacture_dot_code TEXT,
          serial_number TEXT,
          status TEXT NOT NULL DEFAULT 'INSTALLED',
          installed_at TEXT NOT NULL,
          installed_odometer_km REAL,
          removed_at TEXT,
          removed_odometer_km REAL,
          removal_reason TEXT,
          provenance TEXT NOT NULL DEFAULT 'GARAGE_RECORDED',
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tyres_veh_status ON vehicle_tyres(vehicle_id, status);
      `);

      // 10. Tyre Position Assignments (GAR-010 §30, §31, §34)
      db.exec(`
        CREATE TABLE IF NOT EXISTS tyre_position_assignments (
          id TEXT PRIMARY KEY,
          vehicle_tyre_id TEXT NOT NULL REFERENCES vehicle_tyres(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          position TEXT NOT NULL,
          assigned_at TEXT NOT NULL,
          assigned_odometer_km REAL,
          ended_at TEXT,
          ended_odometer_km REAL,
          source TEXT NOT NULL DEFAULT 'INSTALLATION',
          is_current INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tyre_active_pos ON tyre_position_assignments(vehicle_id, position) WHERE is_current = 1;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tyre_active_assignment ON tyre_position_assignments(vehicle_tyre_id) WHERE is_current = 1;
        CREATE INDEX IF NOT EXISTS idx_tyre_pos_history ON tyre_position_assignments(vehicle_tyre_id, assigned_at DESC);
      `);

      // 11. Tyre Rotations (GAR-010 §32, §33, §34)
      db.exec(`
        CREATE TABLE IF NOT EXISTS tyre_rotations (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          performed_at TEXT NOT NULL,
          odometer_km REAL,
          pattern TEXT NOT NULL,
          provider_id TEXT,
          provider_name TEXT,
          work_order_id TEXT,
          notes TEXT,
          maintenance_completion_id TEXT REFERENCES maintenance_completions(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tyre_rot_veh ON tyre_rotations(vehicle_id, performed_at DESC);
      `);

      // 12. Tyre Rotation Moves (GAR-010 §33)
      db.exec(`
        CREATE TABLE IF NOT EXISTS tyre_rotation_moves (
          id TEXT PRIMARY KEY,
          tyre_rotation_id TEXT NOT NULL REFERENCES tyre_rotations(id) ON DELETE CASCADE,
          vehicle_tyre_id TEXT NOT NULL REFERENCES vehicle_tyres(id) ON DELETE CASCADE,
          from_position TEXT NOT NULL,
          to_position TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tyre_rot_moves ON tyre_rotation_moves(tyre_rotation_id);
      `);

      // 13. Tyre Inspections (GAR-010 §42, §43)
      db.exec(`
        CREATE TABLE IF NOT EXISTS tyre_inspections (
          id TEXT PRIMARY KEY,
          vehicle_tyre_id TEXT NOT NULL REFERENCES vehicle_tyres(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          tread_depth_outer_mm REAL,
          tread_depth_center_mm REAL,
          tread_depth_inner_mm REAL,
          pressure_psi REAL,
          condition_rating TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          source_type TEXT NOT NULL,
          provider_id TEXT,
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tyre_insp_tyre ON tyre_inspections(vehicle_tyre_id, observed_at DESC);
      `);

      // 14. Vehicle Modifications (GAR-010 §51-§56)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_modifications (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          installed_at TEXT NOT NULL,
          odometer_km REAL,
          provider_id TEXT,
          provider_name TEXT,
          work_order_id TEXT,
          status TEXT NOT NULL DEFAULT 'INSTALLED',
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
          vehicle_component_id TEXT REFERENCES vehicle_components(id) ON DELETE SET NULL,
          vehicle_expense_id TEXT REFERENCES vehicle_expenses(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_veh_mods ON vehicle_modifications(vehicle_id, status);
      `);

      // 15. Vehicle Configuration Overrides (Factory vs Current) (GAR-010 §53)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_configuration_overrides (
          id TEXT PRIMARY KEY,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          attribute_key TEXT NOT NULL,
          original_value TEXT NOT NULL,
          current_value TEXT NOT NULL,
          source_reference TEXT,
          effective_from TEXT NOT NULL,
          effective_to TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_veh_config_overrides ON vehicle_configuration_overrides(vehicle_id, attribute_key);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS vehicle_configuration_overrides;
        DROP TABLE IF EXISTS vehicle_modifications;
        DROP TABLE IF EXISTS tyre_inspections;
        DROP TABLE IF EXISTS tyre_rotation_moves;
        DROP TABLE IF EXISTS tyre_rotations;
        DROP TABLE IF EXISTS tyre_position_assignments;
        DROP TABLE IF EXISTS vehicle_tyres;
        DROP TABLE IF EXISTS vehicle_tyre_sets;
        DROP TABLE IF EXISTS component_evidence_links;
        DROP TABLE IF EXISTS component_warranties;
        DROP TABLE IF EXISTS vehicle_component_events;
        DROP TABLE IF EXISTS vehicle_component_replacements;
        DROP TABLE IF EXISTS vehicle_components;
        DROP TABLE IF EXISTS parts_catalog_items;
        DROP TABLE IF EXISTS component_definitions;
      `);
    },
  },
  {
    id: '009_canonical_provider_domain_architecture',
    name: 'Canonical Garage & Automotive Service Provider Domain Architecture (GAR-011)',
    up: (db: DatabaseSync) => {
      // 1. Extend service_providers table idempotently
      const providerCols = (db.prepare('PRAGMA table_info(service_providers);').all() as Array<{ name: string }>).map((c) => c.name);
      if (!providerCols.includes('organization_id')) {
        db.exec('ALTER TABLE service_providers ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;');
      }
      if (!providerCols.includes('legal_business_name')) {
        db.exec('ALTER TABLE service_providers ADD COLUMN legal_business_name TEXT;');
      }
      if (!providerCols.includes('description')) {
        db.exec('ALTER TABLE service_providers ADD COLUMN description TEXT;');
      }
      if (!providerCols.includes('verification_status')) {
        db.exec("ALTER TABLE service_providers ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED';");
        // Backfill verification_status from verification_state if present
        if (providerCols.includes('verification_state')) {
          db.exec(`
            UPDATE service_providers
            SET verification_status = CASE
              WHEN verification_state = 'VERIFIED' THEN 'VERIFIED'
              WHEN verification_state = 'REJECTED' THEN 'REJECTED'
              WHEN verification_state = 'PENDING_VERIFICATION' THEN 'PENDING_REVIEW'
              ELSE 'UNVERIFIED'
            END;
          `);
        }
      }
      if (!providerCols.includes('primary_location_id')) {
        db.exec('ALTER TABLE service_providers ADD COLUMN primary_location_id TEXT;');
      }
      if (!providerCols.includes('website')) {
        db.exec('ALTER TABLE service_providers ADD COLUMN website TEXT;');
      }
      if (!providerCols.includes('service_radius_km')) {
        db.exec('ALTER TABLE service_providers ADD COLUMN service_radius_km REAL;');
      }
      if (!providerCols.includes('accepts_bookings')) {
        db.exec('ALTER TABLE service_providers ADD COLUMN accepts_bookings INTEGER NOT NULL DEFAULT 1;');
      }
      if (!providerCols.includes('accepts_mobile_jobs')) {
        db.exec('ALTER TABLE service_providers ADD COLUMN accepts_mobile_jobs INTEGER NOT NULL DEFAULT 0;');
      }
      if (!providerCols.includes('accepts_roadside_jobs')) {
        db.exec('ALTER TABLE service_providers ADD COLUMN accepts_roadside_jobs INTEGER NOT NULL DEFAULT 0;');
      }
      if (!providerCols.includes('accepts_towing_jobs')) {
        db.exec('ALTER TABLE service_providers ADD COLUMN accepts_towing_jobs INTEGER NOT NULL DEFAULT 0;');
      }
      if (!providerCols.includes('currency')) {
        db.exec("ALTER TABLE service_providers ADD COLUMN currency TEXT NOT NULL DEFAULT 'KES';");
      }
      if (!providerCols.includes('callout_fee')) {
        db.exec('ALTER TABLE service_providers ADD COLUMN callout_fee REAL;');
      }

      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_organization ON service_providers(organization_id);
        CREATE INDEX IF NOT EXISTS idx_providers_status_type ON service_providers(status, provider_type);
        CREATE INDEX IF NOT EXISTS idx_providers_verif_status ON service_providers(verification_status);
      `);

      // 2. Provider Locations (Workshops, Mobile Bases, Tow Yards) (GAR-011 §6)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_locations (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          location_type TEXT NOT NULL,
          address_line1 TEXT NOT NULL,
          address_line2 TEXT,
          city TEXT NOT NULL,
          county_state TEXT NOT NULL,
          country TEXT NOT NULL DEFAULT 'KE',
          postal_code TEXT,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
          geocoding_source TEXT NOT NULL DEFAULT 'SYSTEM',
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
          is_primary INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prov_loc_provider ON provider_locations(provider_id, is_primary);
        CREATE INDEX IF NOT EXISTS idx_prov_loc_coords ON provider_locations(latitude, longitude);
      `);

      // 3. Provider Branches (Operating Centers) (GAR-011 §7)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_branches (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          location_id TEXT NOT NULL REFERENCES provider_locations(id) ON DELETE RESTRICT,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          manager_membership_id TEXT REFERENCES organization_memberships(id) ON DELETE SET NULL,
          phone TEXT,
          email TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prov_branch_prov ON provider_branches(provider_id, status);
      `);

      // 4. Service Categories (Canonical Taxonomy) (GAR-011 §9)
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_categories (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          icon TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_service_cat_code ON service_categories(code);
      `);

      // 5. Provider Service Capabilities (GAR-011 §10)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_service_capabilities (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT REFERENCES provider_branches(id) ON DELETE CASCADE,
          service_category_id TEXT NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT,
          service_code TEXT NOT NULL,
          service_name TEXT NOT NULL,
          description TEXT,
          delivery_mode TEXT NOT NULL,
          pricing_type TEXT NOT NULL DEFAULT 'FREE_ESTIMATE',
          indicative_price REAL,
          currency TEXT NOT NULL DEFAULT 'KES',
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          booking_enabled INTEGER NOT NULL DEFAULT 1,
          roadside_eligible INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prov_cap_prov_cat ON provider_service_capabilities(provider_id, service_category_id, status);
      `);

      // 6. Provider Vehicle Make Support (GAR-011 §11)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_vehicle_make_support (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          make_name TEXT NOT NULL,
          support_level TEXT NOT NULL DEFAULT 'SUPPORTED',
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_prov_make ON provider_vehicle_make_support(provider_id, make_name);
      `);

      // 7. Provider Vehicle Class Support (GAR-011 §11)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_vehicle_class_support (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          vehicle_class TEXT NOT NULL,
          support_level TEXT NOT NULL DEFAULT 'SUPPORTED',
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_prov_class ON provider_vehicle_class_support(provider_id, vehicle_class);
      `);

      // 8. Provider Operating Hours (GAR-011 §12)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_operating_hours (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT REFERENCES provider_branches(id) ON DELETE CASCADE,
          day_of_week INTEGER NOT NULL,
          opens_at TEXT NOT NULL,
          closes_at TEXT NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
          is_closed INTEGER NOT NULL DEFAULT 0,
          effective_from TEXT,
          effective_until TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prov_hours ON provider_operating_hours(provider_id, branch_id, day_of_week);
      `);

      // 9. Provider Schedule Exceptions (Holidays, Emergency closures) (GAR-011 §12)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_schedule_exceptions (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT REFERENCES provider_branches(id) ON DELETE CASCADE,
          exception_date TEXT NOT NULL,
          is_closed INTEGER NOT NULL DEFAULT 1,
          opens_at TEXT,
          closes_at TEXT,
          reason TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prov_sched_ex ON provider_schedule_exceptions(provider_id, branch_id, exception_date);
      `);

      // 10. Provider Service Areas (Mobile & Towing Coverage) (GAR-011 §13)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_service_areas (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          area_type TEXT NOT NULL,
          center_lat REAL,
          center_lng REAL,
          radius_km REAL,
          polygon_json TEXT,
          country TEXT NOT NULL DEFAULT 'KE',
          region TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prov_serv_area ON provider_service_areas(provider_id, status);
      `);

      // 11. Provider Staff Profiles (Sprint 2 Membership Link) (GAR-011 §14)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_staff_profiles (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          membership_id TEXT NOT NULL UNIQUE REFERENCES organization_memberships(id) ON DELETE CASCADE,
          job_title TEXT NOT NULL,
          professional_role TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prov_staff_prov ON provider_staff_profiles(provider_id, status);
      `);

      // 12. Provider Staff Branch Assignments (GAR-011 §14)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_staff_branch_assignments (
          id TEXT PRIMARY KEY,
          staff_profile_id TEXT NOT NULL REFERENCES provider_staff_profiles(id) ON DELETE CASCADE,
          branch_id TEXT NOT NULL REFERENCES provider_branches(id) ON DELETE CASCADE,
          is_primary INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_prov_staff_branch ON provider_staff_branch_assignments(staff_profile_id, branch_id);
      `);

      // 13. Technician Skills & Certifications (GAR-011 §14)
      db.exec(`
        CREATE TABLE IF NOT EXISTS technician_skills (
          id TEXT PRIMARY KEY,
          staff_profile_id TEXT NOT NULL REFERENCES provider_staff_profiles(id) ON DELETE CASCADE,
          skill_name TEXT NOT NULL,
          proficiency_level TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tech_skills ON technician_skills(staff_profile_id);
      `);

      // 14. Provider Verification Cases (GAR-011 §15)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_verification_cases (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          verification_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'SUBMITTED',
          document_file_ids TEXT NOT NULL,
          submitted_at TEXT NOT NULL,
          submitted_by_user_id TEXT NOT NULL REFERENCES users(id),
          reviewed_at TEXT,
          reviewed_by_user_id TEXT REFERENCES users(id),
          decision_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prov_verif_cases ON provider_verification_cases(provider_id, status);
      `);

      // 15. Provider Search Projection (Denormalized Query Model) (GAR-011 §16)
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_search_projection (
          provider_id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          provider_type TEXT NOT NULL,
          status TEXT NOT NULL,
          verification_status TEXT NOT NULL,
          latitude REAL,
          longitude REAL,
          city TEXT,
          county_state TEXT,
          service_categories TEXT NOT NULL DEFAULT '[]',
          delivery_modes TEXT NOT NULL DEFAULT '[]',
          supported_makes TEXT NOT NULL DEFAULT '[]',
          supported_classes TEXT NOT NULL DEFAULT '[]',
          service_radius_km REAL,
          accepts_mobile INTEGER NOT NULL DEFAULT 0,
          accepts_roadside INTEGER NOT NULL DEFAULT 0,
          accepts_towing INTEGER NOT NULL DEFAULT 0,
          is_discoverable INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prov_proj_disc ON provider_search_projection(is_discoverable, status);
        CREATE INDEX IF NOT EXISTS idx_prov_proj_type ON provider_search_projection(provider_type);
        CREATE INDEX IF NOT EXISTS idx_prov_proj_coords ON provider_search_projection(latitude, longitude);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS provider_search_projection;
        DROP TABLE IF EXISTS provider_verification_cases;
        DROP TABLE IF EXISTS technician_skills;
        DROP TABLE IF EXISTS provider_staff_branch_assignments;
        DROP TABLE IF EXISTS provider_staff_profiles;
        DROP TABLE IF EXISTS provider_service_areas;
        DROP TABLE IF EXISTS provider_schedule_exceptions;
        DROP TABLE IF EXISTS provider_operating_hours;
        DROP TABLE IF EXISTS provider_vehicle_class_support;
        DROP TABLE IF EXISTS provider_vehicle_make_support;
        DROP TABLE IF EXISTS provider_service_capabilities;
        DROP TABLE IF EXISTS service_categories;
        DROP TABLE IF EXISTS provider_branches;
        DROP TABLE IF EXISTS provider_locations;
      `);
    },
  },
  {
    id: '010_provider_verification_documents',
    name: 'Provider Verification Documents & Audit History (GAR-011 §15)',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_verification_documents (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          document_type TEXT NOT NULL,
          document_number TEXT,
          file_key TEXT,
          file_name TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING',
          rejection_reason TEXT,
          reviewed_by TEXT,
          reviewed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prov_verif_docs ON provider_verification_documents(provider_id, status);

        CREATE TABLE IF NOT EXISTS provider_verification_history (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          document_id TEXT,
          action TEXT NOT NULL,
          reviewed_by TEXT,
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prov_verif_hist ON provider_verification_history(provider_id);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS provider_verification_history;
        DROP TABLE IF EXISTS provider_verification_documents;
      `);
    },
  },
  {
    id: '011_garage_operations',
    name: 'Garage Operations Management System (GAR-012)',
    up: (db: DatabaseSync) => {
      db.exec(`
        -- 1. Service Cases
        CREATE TABLE IF NOT EXISTS service_cases (
          id TEXT PRIMARY KEY,
          service_case_number TEXT UNIQUE NOT NULL,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT NOT NULL REFERENCES provider_branches(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
          customer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          customer_contact_name TEXT,
          customer_contact_phone TEXT,
          customer_contact_email TEXT,
          source_type TEXT NOT NULL,
          source_reference_id TEXT,
          service_advisor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'OPEN',
          intake_odometer_km REAL,
          final_odometer_km REAL,
          opened_at TEXT NOT NULL,
          checked_in_at TEXT,
          completed_at TEXT,
          released_at TEXT,
          cancelled_at TEXT,
          cancellation_reason TEXT,
          prior_service_case_id TEXT REFERENCES service_cases(id) ON DELETE SET NULL,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sc_prov_status ON service_cases(provider_id, status);
        CREATE INDEX IF NOT EXISTS idx_sc_branch_status ON service_cases(branch_id, status);
        CREATE INDEX IF NOT EXISTS idx_sc_veh_opened ON service_cases(vehicle_id, opened_at);
        CREATE INDEX IF NOT EXISTS idx_sc_cust_opened ON service_cases(customer_user_id, opened_at);
        CREATE INDEX IF NOT EXISTS idx_sc_number ON service_cases(service_case_number);

        -- 2. Customer Concerns
        CREATE TABLE IF NOT EXISTS customer_concerns (
          id TEXT PRIMARY KEY,
          service_case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
          concern_type TEXT NOT NULL,
          description TEXT NOT NULL,
          related_issue_id TEXT REFERENCES vehicle_issues(id) ON DELETE SET NULL,
          related_maintenance_requirement_id TEXT REFERENCES maintenance_requirements(id) ON DELETE SET NULL,
          reported_by TEXT NOT NULL,
          reported_at TEXT NOT NULL,
          priority TEXT NOT NULL DEFAULT 'MEDIUM',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_concerns_sc ON customer_concerns(service_case_id);

        -- 3. Vehicle Check-Ins
        CREATE TABLE IF NOT EXISTS vehicle_check_ins (
          id TEXT PRIMARY KEY,
          service_case_id TEXT UNIQUE NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
          checked_in_at TEXT NOT NULL,
          odometer_value REAL NOT NULL,
          odometer_unit TEXT NOT NULL DEFAULT 'KM',
          odometer_observation_id TEXT REFERENCES odometer_observations(id) ON DELETE SET NULL,
          fuel_level TEXT,
          vehicle_condition_summary TEXT,
          keys_received_count INTEGER DEFAULT 1,
          documents_received TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_check_in_sc ON vehicle_check_ins(service_case_id);

        -- 4. Vehicle Intake Observations
        CREATE TABLE IF NOT EXISTS vehicle_intake_observations (
          id TEXT PRIMARY KEY,
          vehicle_check_in_id TEXT NOT NULL REFERENCES vehicle_check_ins(id) ON DELETE CASCADE,
          service_case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          position TEXT,
          description TEXT NOT NULL,
          severity TEXT DEFAULT 'MINOR',
          media_reference_ids TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vio_checkin ON vehicle_intake_observations(vehicle_check_in_id);

        -- 5. Vehicle Intake Items
        CREATE TABLE IF NOT EXISTS vehicle_intake_items (
          id TEXT PRIMARY KEY,
          vehicle_check_in_id TEXT NOT NULL REFERENCES vehicle_check_ins(id) ON DELETE CASCADE,
          service_case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          item_name TEXT NOT NULL,
          item_type TEXT NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 1,
          condition_notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vii_checkin ON vehicle_intake_items(vehicle_check_in_id);

        -- 6. Inspection Templates
        CREATE TABLE IF NOT EXISTS inspection_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          vehicle_class TEXT NOT NULL DEFAULT 'ALL',
          inspection_type TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL
        );

        -- 7. Inspection Template Items
        CREATE TABLE IF NOT EXISTS inspection_template_items (
          id TEXT PRIMARY KEY,
          template_id TEXT NOT NULL REFERENCES inspection_templates(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          item_name TEXT NOT NULL,
          description TEXT,
          requires_measurement INTEGER NOT NULL DEFAULT 0,
          measurement_unit TEXT,
          display_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_iti_template ON inspection_template_items(template_id);

        -- 8. Vehicle Inspections
        CREATE TABLE IF NOT EXISTS vehicle_inspections (
          id TEXT PRIMARY KEY,
          service_case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
          inspection_type TEXT NOT NULL,
          template_id TEXT REFERENCES inspection_templates(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'NOT_STARTED',
          performed_by_technician_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          started_at TEXT,
          completed_at TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_insp_sc ON vehicle_inspections(service_case_id);

        -- 9. Inspection Item Results
        CREATE TABLE IF NOT EXISTS inspection_item_results (
          id TEXT PRIMARY KEY,
          inspection_id TEXT NOT NULL REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
          item_name TEXT NOT NULL,
          category TEXT NOT NULL,
          result TEXT NOT NULL,
          measured_value REAL,
          measurement_unit TEXT,
          notes TEXT,
          media_reference_ids TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_iir_insp ON inspection_item_results(inspection_id);

        -- 10. Inspection Findings
        CREATE TABLE IF NOT EXISTS inspection_findings (
          id TEXT PRIMARY KEY,
          inspection_id TEXT NOT NULL REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
          service_case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
          category TEXT NOT NULL,
          component_definition_id TEXT,
          vehicle_component_id TEXT REFERENCES vehicle_components(id) ON DELETE SET NULL,
          finding_type TEXT NOT NULL,
          severity TEXT NOT NULL,
          description TEXT NOT NULL,
          recommended_action TEXT,
          evidence_references TEXT,
          related_issue_id TEXT REFERENCES vehicle_issues(id) ON DELETE SET NULL,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_find_insp ON inspection_findings(inspection_id);
        CREATE INDEX IF NOT EXISTS idx_find_sc ON inspection_findings(service_case_id);

        -- 11. Recommended Work Items
        CREATE TABLE IF NOT EXISTS recommended_work_items (
          id TEXT PRIMARY KEY,
          service_case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          related_finding_id TEXT REFERENCES inspection_findings(id) ON DELETE SET NULL,
          related_issue_id TEXT REFERENCES vehicle_issues(id) ON DELETE SET NULL,
          maintenance_task_id TEXT REFERENCES maintenance_requirements(id) ON DELETE SET NULL,
          service_category TEXT NOT NULL,
          description TEXT NOT NULL,
          priority TEXT NOT NULL DEFAULT 'MEDIUM',
          estimated_labor_hours REAL DEFAULT 0,
          estimated_labor_cost REAL DEFAULT 0,
          estimated_parts_cost REAL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'KES',
          status TEXT NOT NULL DEFAULT 'PROPOSED',
          declined_reason TEXT,
          declined_at TEXT,
          declined_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rec_sc ON recommended_work_items(service_case_id);

        -- 12. Service Authorizations
        CREATE TABLE IF NOT EXISTS service_authorizations (
          id TEXT PRIMARY KEY,
          service_case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          authorization_type TEXT NOT NULL DEFAULT 'INITIAL',
          scope_version INTEGER NOT NULL DEFAULT 1,
          amount_authorized REAL NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'KES',
          authorized_by TEXT NOT NULL,
          authorized_at TEXT NOT NULL,
          authorization_channel TEXT NOT NULL DEFAULT 'IN_PERSON',
          status TEXT NOT NULL DEFAULT 'AUTHORIZED',
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_sc ON service_authorizations(service_case_id);

        -- 13. Service Authorization Items
        CREATE TABLE IF NOT EXISTS service_authorization_items (
          id TEXT PRIMARY KEY,
          authorization_id TEXT NOT NULL REFERENCES service_authorizations(id) ON DELETE CASCADE,
          recommended_work_item_id TEXT NOT NULL REFERENCES recommended_work_items(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_items ON service_authorization_items(authorization_id);

        -- 14. Work Orders
        CREATE TABLE IF NOT EXISTS work_orders (
          id TEXT PRIMARY KEY,
          service_case_id TEXT UNIQUE NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT NOT NULL REFERENCES provider_branches(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
          work_order_number TEXT UNIQUE NOT NULL,
          status TEXT NOT NULL DEFAULT 'DRAFT',
          opened_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          assigned_service_advisor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wo_prov_status ON work_orders(provider_id, status);
        CREATE INDEX IF NOT EXISTS idx_wo_sc ON work_orders(service_case_id);

        -- 15. Work Order Items
        CREATE TABLE IF NOT EXISTS work_order_items (
          id TEXT PRIMARY KEY,
          work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
          work_type TEXT NOT NULL,
          service_category TEXT NOT NULL,
          description TEXT NOT NULL,
          related_recommended_work_item_id TEXT REFERENCES recommended_work_items(id) ON DELETE SET NULL,
          related_issue_id TEXT REFERENCES vehicle_issues(id) ON DELETE SET NULL,
          related_maintenance_task_id TEXT REFERENCES maintenance_requirements(id) ON DELETE SET NULL,
          related_finding_id TEXT REFERENCES inspection_findings(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'NOT_STARTED',
          authorization_status TEXT NOT NULL DEFAULT 'AUTHORIZED',
          assigned_technician_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          estimated_hours REAL DEFAULT 0,
          actual_hours REAL DEFAULT 0,
          billable_hours REAL DEFAULT 0,
          hourly_rate REAL DEFAULT 0,
          started_at TEXT,
          completed_at TEXT,
          block_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_woi_wo ON work_order_items(work_order_id);

        -- 16. Technician Assignments
        CREATE TABLE IF NOT EXISTS technician_assignments (
          id TEXT PRIMARY KEY,
          work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
          work_order_item_id TEXT REFERENCES work_order_items(id) ON DELETE CASCADE,
          technician_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider_membership_id TEXT REFERENCES organization_memberships(id) ON DELETE SET NULL,
          role TEXT NOT NULL DEFAULT 'PRIMARY',
          assigned_at TEXT NOT NULL,
          assigned_by TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE'
        );
        CREATE INDEX IF NOT EXISTS idx_ta_wo ON technician_assignments(work_order_id);
        CREATE INDEX IF NOT EXISTS idx_ta_tech ON technician_assignments(technician_id, status);

        -- 17. Technician Work Sessions
        CREATE TABLE IF NOT EXISTS technician_work_sessions (
          id TEXT PRIMARY KEY,
          work_order_item_id TEXT NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
          technician_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_minutes INTEGER DEFAULT 0,
          labor_type TEXT NOT NULL DEFAULT 'ACTUAL',
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE'
        );
        CREATE INDEX IF NOT EXISTS idx_tws_woi ON technician_work_sessions(work_order_item_id);

        -- 18. Work Order Parts
        CREATE TABLE IF NOT EXISTS work_order_parts (
          id TEXT PRIMARY KEY,
          work_order_item_id TEXT NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
          work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
          part_number TEXT,
          description TEXT NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 1,
          source TEXT NOT NULL DEFAULT 'WORKSHOP_INVENTORY',
          unit_cost REAL DEFAULT 0,
          unit_price REAL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'KES',
          status TEXT NOT NULL DEFAULT 'REQUIRED',
          vehicle_component_id TEXT REFERENCES vehicle_components(id) ON DELETE SET NULL,
          replaced_component_id TEXT REFERENCES vehicle_components(id) ON DELETE SET NULL,
          installed_at TEXT,
          installed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wop_woi ON work_order_parts(work_order_item_id);
        CREATE INDEX IF NOT EXISTS idx_wop_wo ON work_order_parts(work_order_id);

        -- 19. Work Order Holds
        CREATE TABLE IF NOT EXISTS work_order_holds (
          id TEXT PRIMARY KEY,
          work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
          reason TEXT NOT NULL,
          description TEXT NOT NULL,
          placed_at TEXT NOT NULL,
          placed_by TEXT NOT NULL,
          released_at TEXT,
          released_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_woh_wo ON work_order_holds(work_order_id);

        -- 20. Quality Control Checks
        CREATE TABLE IF NOT EXISTS quality_control_checks (
          id TEXT PRIMARY KEY,
          work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
          inspection_id TEXT REFERENCES vehicle_inspections(id) ON DELETE SET NULL,
          performed_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          performed_at TEXT NOT NULL,
          result TEXT NOT NULL,
          checklist_results TEXT,
          notes TEXT,
          rework_instructions TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_qc_wo ON quality_control_checks(work_order_id);

        -- 21. Road Tests
        CREATE TABLE IF NOT EXISTS road_tests (
          id TEXT PRIMARY KEY,
          work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
          performed_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          start_odometer_km REAL,
          end_odometer_km REAL,
          result TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rt_wo ON road_tests(work_order_id);

        -- 22. Vehicle Releases
        CREATE TABLE IF NOT EXISTS vehicle_releases (
          id TEXT PRIMARY KEY,
          service_case_id TEXT UNIQUE NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
          released_at TEXT NOT NULL,
          released_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          recipient_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          recipient_name TEXT NOT NULL,
          recipient_phone TEXT,
          final_odometer_km REAL,
          final_odometer_observation_id TEXT REFERENCES odometer_observations(id) ON DELETE SET NULL,
          handover_notes TEXT,
          acknowledgement_status TEXT NOT NULL DEFAULT 'ACKNOWLEDGED',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rel_sc ON vehicle_releases(service_case_id);

        -- 23. Service Case Notes
        CREATE TABLE IF NOT EXISTS service_case_notes (
          id TEXT PRIMARY KEY,
          service_case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          author_name TEXT NOT NULL,
          visibility TEXT NOT NULL DEFAULT 'INTERNAL_PROVIDER_NOTE',
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scn_sc ON service_case_notes(service_case_id);

        -- 24. Service Case Activity
        CREATE TABLE IF NOT EXISTS service_case_activity (
          id TEXT PRIMARY KEY,
          service_case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          work_order_id TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          actor_name TEXT,
          details TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_activity_sc ON service_case_activity(service_case_id);

        -- Seed Default Inspection Templates
        INSERT OR IGNORE INTO inspection_templates (id, name, vehicle_class, inspection_type, version, status, created_at)
        VALUES
          ('tmpl_intake_std', 'Standard Vehicle Intake Inspection', 'ALL', 'INTAKE', 1, 'ACTIVE', datetime('now')),
          ('tmpl_diagnostic_std', 'Diagnostic & Mechanical Inspection', 'ALL', 'DIAGNOSTIC', 1, 'ACTIVE', datetime('now')),
          ('tmpl_qc_std', 'Standard Workshop Quality Control Gate', 'ALL', 'QUALITY_CONTROL', 1, 'ACTIVE', datetime('now'));

        -- Seed Items for Intake Inspection Template
        INSERT OR IGNORE INTO inspection_template_items (id, template_id, category, item_name, description, requires_measurement, measurement_unit, display_order)
        VALUES
          ('iti_intake_01', 'tmpl_intake_std', 'BODY', 'Exterior Bodywork Condition', 'Check panels for dents, scratches, or past collision repairs', 0, NULL, 1),
          ('iti_intake_02', 'tmpl_intake_std', 'BODY', 'Windshield & Glass Integrity', 'Inspect for chips, cracks, or wiper streaks', 0, NULL, 2),
          ('iti_intake_03', 'tmpl_intake_std', 'TYRES', 'Tyre Tread & Sidewall Visual', 'Check tyre wear and sidewall cuts or bulges', 1, 'mm', 3),
          ('iti_intake_04', 'tmpl_intake_std', 'FLUIDS', 'Under-hood Fluid Levels Visual', 'Check oil, coolant, brake fluid, washer fluid visible levels', 0, NULL, 4),
          ('iti_intake_05', 'tmpl_intake_std', 'ELECTRICAL', 'Instrument Warning Lights', 'Check for Check Engine, ABS, Airbag, or Battery warning lights illuminated', 0, NULL, 5);

        -- Seed Items for Diagnostic Inspection Template
        INSERT OR IGNORE INTO inspection_template_items (id, template_id, category, item_name, description, requires_measurement, measurement_unit, display_order)
        VALUES
          ('iti_diag_01', 'tmpl_diagnostic_std', 'BRAKES', 'Front Brake Pads Thickness', 'Measure front brake pad lining remaining', 1, 'mm', 1),
          ('iti_diag_02', 'tmpl_diagnostic_std', 'BRAKES', 'Rear Brake Pads Thickness', 'Measure rear brake pad lining remaining', 1, 'mm', 2),
          ('iti_diag_03', 'tmpl_diagnostic_std', 'SUSPENSION', 'Control Arm Bushes & Ball Joints', 'Check lower and upper control arm bushings and ball joints for play/tearing', 0, NULL, 3),
          ('iti_diag_04', 'tmpl_diagnostic_std', 'SUSPENSION', 'Shock Absorbers & Struts', 'Inspect for fluid leaks, damaged dust boots, or weak damping', 0, NULL, 4),
          ('iti_diag_05', 'tmpl_diagnostic_std', 'ENGINE', 'Drive Belts & Pulleys', 'Inspect serpentine belt for cracking, fraying, or squealing', 0, NULL, 5),
          ('iti_diag_06', 'tmpl_diagnostic_std', 'FLUIDS', 'Engine Oil Condition & Level', 'Check viscosity, color, contamination, and dipstick reading', 0, NULL, 6),
          ('iti_diag_07', 'tmpl_diagnostic_std', 'STEERING', 'Tie Rods & Steering Rack', 'Inspect steering play, rack boot condition, and hydraulic leaks', 0, NULL, 7);

        -- Seed Items for Quality Control Template
        INSERT OR IGNORE INTO inspection_template_items (id, template_id, category, item_name, description, requires_measurement, measurement_unit, display_order)
        VALUES
          ('iti_qc_01', 'tmpl_qc_std', 'SAFETY', 'Wheel Lug Nuts Torqued to Spec', 'Verify all road wheels torqued to manufacturer spec', 1, 'Nm', 1),
          ('iti_qc_02', 'tmpl_qc_std', 'SAFETY', 'Brake Pedal Feel & Hydraulic Pressure', 'Firm pedal feel without spongy travel or sinking', 0, NULL, 2),
          ('iti_qc_03', 'tmpl_qc_std', 'FLUIDS', 'Fluid Leaks Post-Service Check', 'Inspect underbody and filter housings with engine running', 0, NULL, 3),
          ('iti_qc_04', 'tmpl_qc_std', 'ELECTRICAL', 'Instrument Cluster Clear of DTCs', 'Verify diagnostic codes cleared and no warning lamps', 0, NULL, 4),
          ('iti_qc_05', 'tmpl_qc_std', 'SAFETY', 'Cabin Cleanliness & Items Replaced', 'Vehicle clean, seat cover removed, tools & lock key returned', 0, NULL, 5);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS service_case_activity;
        DROP TABLE IF EXISTS service_case_notes;
        DROP TABLE IF EXISTS vehicle_releases;
        DROP TABLE IF EXISTS road_tests;
        DROP TABLE IF EXISTS quality_control_checks;
        DROP TABLE IF EXISTS work_order_holds;
        DROP TABLE IF EXISTS work_order_parts;
        DROP TABLE IF EXISTS technician_work_sessions;
        DROP TABLE IF EXISTS technician_assignments;
        DROP TABLE IF EXISTS work_order_items;
        DROP TABLE IF EXISTS work_orders;
        DROP TABLE IF EXISTS service_authorization_items;
        DROP TABLE IF EXISTS service_authorizations;
        DROP TABLE IF EXISTS recommended_work_items;
        DROP TABLE IF EXISTS inspection_findings;
        DROP TABLE IF EXISTS inspection_item_results;
        DROP TABLE IF EXISTS vehicle_inspections;
        DROP TABLE IF EXISTS inspection_template_items;
        DROP TABLE IF EXISTS inspection_templates;
        DROP TABLE IF EXISTS vehicle_intake_items;
        DROP TABLE IF EXISTS vehicle_intake_observations;
        DROP TABLE IF EXISTS vehicle_check_ins;
        DROP TABLE IF EXISTS customer_concerns;
        DROP TABLE IF EXISTS service_cases;
      `);
    },
  },
  {
    id: '012_booking_scheduling_quotes_transactions',
    name: 'Booking, Scheduling, Quotes & Service Transaction Architecture (GAR-013)',
    up: (db: DatabaseSync) => {
      // 1. Service Offerings (Commercial Bookable Offerings)
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_offerings (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT REFERENCES provider_branches(id) ON DELETE SET NULL,
          service_category_id TEXT NOT NULL,
          capability_id TEXT REFERENCES provider_service_capabilities(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          description TEXT,
          delivery_mode TEXT NOT NULL DEFAULT 'WORKSHOP',
          booking_mode TEXT NOT NULL DEFAULT 'PROVIDER_CONFIRMATION',
          estimated_duration_minutes INTEGER,
          pricing_model TEXT NOT NULL DEFAULT 'STARTING_FROM',
          base_price_minor INTEGER,
          currency TEXT NOT NULL DEFAULT 'KES',
          requires_inspection INTEGER NOT NULL DEFAULT 0,
          requires_quote INTEGER NOT NULL DEFAULT 0,
          requires_vehicle INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_so_provider_status ON service_offerings(provider_id, status);
        CREATE INDEX IF NOT EXISTS idx_so_branch ON service_offerings(branch_id);
        CREATE INDEX IF NOT EXISTS idx_so_category ON service_offerings(service_category_id);
      `);

      // 2. Provider Capacity Rules
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_capacity_rules (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT REFERENCES provider_branches(id) ON DELETE CASCADE,
          service_category_id TEXT,
          day_of_week INTEGER NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          max_concurrent_bookings INTEGER NOT NULL DEFAULT 2,
          slot_duration_minutes INTEGER NOT NULL DEFAULT 60,
          buffer_before_minutes INTEGER NOT NULL DEFAULT 0,
          buffer_after_minutes INTEGER NOT NULL DEFAULT 15,
          minimum_notice_minutes INTEGER NOT NULL DEFAULT 120,
          max_advance_days INTEGER NOT NULL DEFAULT 30,
          timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
          effective_from TEXT,
          effective_to TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pcr_provider_branch ON provider_capacity_rules(provider_id, branch_id, day_of_week);
      `);

      // 3. Provider Schedule Blocks
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_schedule_blocks (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT REFERENCES provider_branches(id) ON DELETE SET NULL,
          resource_id TEXT,
          start_at TEXT NOT NULL,
          end_at TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_psb_provider_window ON provider_schedule_blocks(provider_id, branch_id, start_at, end_at);
      `);

      // 4. Capacity Holds (Temporary Reservations)
      db.exec(`
        CREATE TABLE IF NOT EXISTS capacity_holds (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT REFERENCES provider_branches(id) ON DELETE SET NULL,
          slot_start_at TEXT NOT NULL,
          slot_end_at TEXT NOT NULL,
          customer_user_id TEXT NOT NULL,
          booking_id TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ch_slot ON capacity_holds(provider_id, branch_id, slot_start_at, status);
        CREATE INDEX IF NOT EXISTS idx_ch_status_expires ON capacity_holds(status, expires_at);
      `);

      // 5. Bookings
      db.exec(`
        CREATE TABLE IF NOT EXISTS bookings (
          id TEXT PRIMARY KEY,
          customer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT REFERENCES provider_branches(id) ON DELETE SET NULL,
          service_offering_id TEXT REFERENCES service_offerings(id) ON DELETE SET NULL,
          booking_type TEXT NOT NULL DEFAULT 'SERVICE_OFFERING',
          booking_mode TEXT NOT NULL DEFAULT 'PROVIDER_CONFIRMATION',
          status TEXT NOT NULL DEFAULT 'REQUESTED',
          requested_start_at TEXT,
          requested_end_at TEXT,
          confirmed_start_at TEXT,
          confirmed_end_at TEXT,
          proposed_start_at TEXT,
          proposed_end_at TEXT,
          delivery_mode TEXT NOT NULL DEFAULT 'WORKSHOP',
          service_address TEXT,
          customer_notes TEXT,
          source_type TEXT NOT NULL DEFAULT 'DIRECT_CUSTOMER',
          related_maintenance_task_id TEXT,
          related_issue_id TEXT REFERENCES vehicle_issues(id) ON DELETE SET NULL,
          service_case_id TEXT REFERENCES service_cases(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bookings_cust_status ON bookings(customer_user_id, status);
        CREATE INDEX IF NOT EXISTS idx_bookings_prov_status ON bookings(provider_id, status);
        CREATE INDEX IF NOT EXISTS idx_bookings_branch ON bookings(branch_id);
        CREATE INDEX IF NOT EXISTS idx_bookings_vehicle ON bookings(vehicle_id);
        CREATE INDEX IF NOT EXISTS idx_bookings_case ON bookings(service_case_id);
      `);

      // 6. Booking Items
      db.exec(`
        CREATE TABLE IF NOT EXISTS booking_items (
          id TEXT PRIMARY KEY,
          booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
          service_offering_id TEXT REFERENCES service_offerings(id) ON DELETE SET NULL,
          service_category_id TEXT NOT NULL,
          related_maintenance_task_id TEXT,
          related_issue_id TEXT REFERENCES vehicle_issues(id) ON DELETE SET NULL,
          description TEXT NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 1,
          estimated_duration_minutes INTEGER,
          status TEXT NOT NULL DEFAULT 'REQUESTED',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bi_booking ON booking_items(booking_id);
      `);

      // 7. Service Appointments
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_appointments (
          id TEXT PRIMARY KEY,
          booking_id TEXT UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT REFERENCES provider_branches(id) ON DELETE SET NULL,
          scheduled_start_at TEXT NOT NULL,
          scheduled_end_at TEXT NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
          status TEXT NOT NULL DEFAULT 'SCHEDULED',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_apt_provider_time ON service_appointments(provider_id, scheduled_start_at, scheduled_end_at);
        CREATE INDEX IF NOT EXISTS idx_apt_booking ON service_appointments(booking_id);
      `);

      // 8. Booking Schedule Revisions
      db.exec(`
        CREATE TABLE IF NOT EXISTS booking_schedule_revisions (
          id TEXT PRIMARY KEY,
          booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
          previous_start_at TEXT NOT NULL,
          previous_end_at TEXT NOT NULL,
          new_start_at TEXT NOT NULL,
          new_end_at TEXT NOT NULL,
          requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          requested_by_role TEXT NOT NULL,
          reason TEXT NOT NULL,
          requested_at TEXT NOT NULL,
          accepted_at TEXT,
          status TEXT NOT NULL DEFAULT 'PROPOSED',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bsr_booking ON booking_schedule_revisions(booking_id);
      `);

      // 9. Booking Cancellations
      db.exec(`
        CREATE TABLE IF NOT EXISTS booking_cancellations (
          id TEXT PRIMARY KEY,
          booking_id TEXT UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
          cancelled_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          cancelled_by_role TEXT NOT NULL,
          reason_code TEXT NOT NULL,
          reason_text TEXT,
          cancelled_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bkc_booking ON booking_cancellations(booking_id);
      `);

      // 10. Service Estimates
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_estimates (
          id TEXT PRIMARY KEY,
          booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
          service_case_id TEXT REFERENCES service_cases(id) ON DELETE SET NULL,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          version INTEGER NOT NULL DEFAULT 1,
          subtotal_minor INTEGER NOT NULL DEFAULT 0,
          tax_estimate_minor INTEGER NOT NULL DEFAULT 0,
          fees_estimate_minor INTEGER NOT NULL DEFAULT 0,
          total_estimate_minor INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'KES',
          status TEXT NOT NULL DEFAULT 'DRAFT',
          valid_until TEXT,
          notes TEXT,
          created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_se_booking ON service_estimates(booking_id);
        CREATE INDEX IF NOT EXISTS idx_se_case ON service_estimates(service_case_id);
        CREATE INDEX IF NOT EXISTS idx_se_provider_vehicle ON service_estimates(provider_id, vehicle_id);
      `);

      // 11. Estimate Line Items
      db.exec(`
        CREATE TABLE IF NOT EXISTS estimate_line_items (
          id TEXT PRIMARY KEY,
          estimate_id TEXT NOT NULL REFERENCES service_estimates(id) ON DELETE CASCADE,
          line_type TEXT NOT NULL,
          description TEXT NOT NULL,
          related_service_offering_id TEXT REFERENCES service_offerings(id) ON DELETE SET NULL,
          related_work_recommendation_id TEXT REFERENCES recommended_work_items(id) ON DELETE SET NULL,
          quantity REAL NOT NULL DEFAULT 1,
          unit_price_minor INTEGER NOT NULL DEFAULT 0,
          line_total_minor INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'KES',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_eli_estimate ON estimate_line_items(estimate_id);
      `);

      // 12. Service Quotes (Commercial Binding Agreements)
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_quotes (
          id TEXT PRIMARY KEY,
          booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
          service_case_id TEXT REFERENCES service_cases(id) ON DELETE SET NULL,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          branch_id TEXT REFERENCES provider_branches(id) ON DELETE SET NULL,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          customer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          quote_number TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'DRAFT',
          quote_type TEXT NOT NULL DEFAULT 'INITIAL',
          currency TEXT NOT NULL DEFAULT 'KES',
          subtotal_minor INTEGER NOT NULL DEFAULT 0,
          tax_minor INTEGER NOT NULL DEFAULT 0,
          tax_rate REAL NOT NULL DEFAULT 0.16,
          fees_minor INTEGER NOT NULL DEFAULT 0,
          discounts_minor INTEGER NOT NULL DEFAULT 0,
          total_minor INTEGER NOT NULL DEFAULT 0,
          valid_until TEXT NOT NULL,
          terms_and_conditions TEXT,
          supersedes_quote_id TEXT REFERENCES service_quotes(id) ON DELETE SET NULL,
          service_authorization_id TEXT REFERENCES service_authorizations(id) ON DELETE SET NULL,
          created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          issued_at TEXT,
          viewed_at TEXT,
          accepted_at TEXT,
          rejected_at TEXT,
          withdrawal_reason TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sq_booking_ver ON service_quotes(booking_id, version);
        CREATE INDEX IF NOT EXISTS idx_sq_case ON service_quotes(service_case_id);
        CREATE INDEX IF NOT EXISTS idx_sq_prov_status ON service_quotes(provider_id, status);
        CREATE INDEX IF NOT EXISTS idx_sq_cust_status ON service_quotes(customer_user_id, status);
        CREATE INDEX IF NOT EXISTS idx_sq_status_validity ON service_quotes(status, valid_until);
      `);

      // 13. Quote Line Items
      db.exec(`
        CREATE TABLE IF NOT EXISTS quote_line_items (
          id TEXT PRIMARY KEY,
          quote_id TEXT NOT NULL REFERENCES service_quotes(id) ON DELETE CASCADE,
          line_type TEXT NOT NULL,
          service_category TEXT,
          description TEXT NOT NULL,
          quantity REAL NOT NULL DEFAULT 1,
          unit_price_minor INTEGER NOT NULL DEFAULT 0,
          line_total_minor INTEGER NOT NULL DEFAULT 0,
          related_recommended_work_item_id TEXT REFERENCES recommended_work_items(id) ON DELETE SET NULL,
          related_service_offering_id TEXT REFERENCES service_offerings(id) ON DELETE SET NULL,
          related_part_reference_id TEXT,
          authorization_required INTEGER NOT NULL DEFAULT 1,
          is_optional INTEGER NOT NULL DEFAULT 0,
          dependency_group_id TEXT,
          status TEXT NOT NULL DEFAULT 'PROPOSED',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_qli_quote ON quote_line_items(quote_id);
        CREATE INDEX IF NOT EXISTS idx_qli_rec_item ON quote_line_items(related_recommended_work_item_id);
      `);

      // 14. Quote Acceptances (Immutable Authorization Evidence)
      db.exec(`
        CREATE TABLE IF NOT EXISTS quote_acceptances (
          id TEXT PRIMARY KEY,
          quote_id TEXT NOT NULL REFERENCES service_quotes(id) ON DELETE CASCADE,
          quote_version INTEGER NOT NULL,
          accepted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          accepted_by_name TEXT NOT NULL,
          authorization_channel TEXT NOT NULL DEFAULT 'DIGITAL_APP',
          is_partial INTEGER NOT NULL DEFAULT 0,
          amount_authorized_minor INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'KES',
          terms_version TEXT NOT NULL DEFAULT '1.0',
          accepted_at TEXT NOT NULL,
          service_authorization_id TEXT REFERENCES service_authorizations(id) ON DELETE SET NULL,
          metadata_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_qa_quote ON quote_acceptances(quote_id);
      `);

      // 15. Quote Acceptance Items
      db.exec(`
        CREATE TABLE IF NOT EXISTS quote_acceptance_items (
          id TEXT PRIMARY KEY,
          quote_acceptance_id TEXT NOT NULL REFERENCES quote_acceptances(id) ON DELETE CASCADE,
          quote_line_item_id TEXT NOT NULL REFERENCES quote_line_items(id) ON DELETE CASCADE,
          line_total_minor INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_qai_acceptance ON quote_acceptance_items(quote_acceptance_id);
      `);

      // 16. Quote Rejections
      db.exec(`
        CREATE TABLE IF NOT EXISTS quote_rejections (
          id TEXT PRIMARY KEY,
          quote_id TEXT NOT NULL REFERENCES service_quotes(id) ON DELETE CASCADE,
          quote_version INTEGER NOT NULL,
          rejected_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          rejected_by_name TEXT NOT NULL,
          reason_code TEXT NOT NULL,
          reason_text TEXT,
          rejected_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_qrj_quote ON quote_rejections(quote_id);
      `);

      // 17. Booking Activity Log
      db.exec(`
        CREATE TABLE IF NOT EXISTS booking_activity (
          id TEXT PRIMARY KEY,
          booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          actor_name TEXT,
          details TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bka_booking ON booking_activity(booking_id, occurred_at);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP TABLE IF EXISTS booking_activity;
        DROP TABLE IF EXISTS quote_rejections;
        DROP TABLE IF EXISTS quote_acceptance_items;
        DROP TABLE IF EXISTS quote_acceptances;
        DROP TABLE IF EXISTS quote_line_items;
        DROP TABLE IF EXISTS service_quotes;
        DROP TABLE IF EXISTS estimate_line_items;
        DROP TABLE IF EXISTS service_estimates;
        DROP TABLE IF EXISTS booking_cancellations;
        DROP TABLE IF EXISTS booking_schedule_revisions;
        DROP TABLE IF EXISTS service_appointments;
        DROP TABLE IF EXISTS booking_items;
        DROP TABLE IF EXISTS bookings;
        DROP TABLE IF EXISTS capacity_holds;
        DROP TABLE IF EXISTS provider_schedule_blocks;
        DROP TABLE IF EXISTS provider_capacity_rules;
        DROP TABLE IF EXISTS service_offerings;
      `);
    },
  },
  {
    id: '013_roadside_assistance_core',
    name: 'Roadside Assistance Core Architecture (GAR-014)',
    up: (db) => {
      // 1. Roadside Incidents
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_incidents (
          id TEXT PRIMARY KEY,
          incident_number TEXT UNIQUE NOT NULL,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
          organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
          reported_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          reported_by_name TEXT NOT NULL,
          reported_by_phone TEXT,
          incident_type TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'ROUTINE',
          status TEXT NOT NULL DEFAULT 'DRAFT',
          initial_drivability TEXT NOT NULL DEFAULT 'UNKNOWN',
          occupant_safety_state TEXT NOT NULL DEFAULT 'SAFE',
          description TEXT,
          safety_escalation_required INTEGER NOT NULL DEFAULT 0,
          safety_escalation_notes TEXT,
          current_location_id TEXT,
          active_assistance_request_id TEXT,
          active_assignment_id TEXT,
          resolved_at TEXT,
          cancelled_at TEXT,
          closed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rsi_vehicle ON roadside_incidents(vehicle_id);
        CREATE INDEX IF NOT EXISTS idx_rsi_user ON roadside_incidents(reported_by_user_id);
        CREATE INDEX IF NOT EXISTS idx_rsi_status ON roadside_incidents(status);
        CREATE INDEX IF NOT EXISTS idx_rsi_org ON roadside_incidents(organization_id);
      `);

      // 2. Roadside Locations (Privacy & Accuracy)
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_locations (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES roadside_incidents(id) ON DELETE CASCADE,
          source TEXT NOT NULL DEFAULT 'DEVICE_GPS',
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy_meters REAL,
          address_line TEXT,
          road_or_highway TEXT,
          landmark_description TEXT,
          direction_of_travel TEXT,
          is_dangerous_location INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          recorded_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rsl_incident ON roadside_locations(incident_id);
      `);

      // 3. Roadside Triage Records
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_triage_records (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES roadside_incidents(id) ON DELETE CASCADE,
          engine_version TEXT NOT NULL DEFAULT 'v1.0.0',
          triage_result TEXT NOT NULL,
          recommended_assistance_type TEXT NOT NULL,
          safety_escalation_required INTEGER NOT NULL DEFAULT 0,
          tow_required INTEGER NOT NULL DEFAULT 0,
          guidance_notes TEXT,
          conducted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          conducted_at TEXT NOT NULL,
          metadata_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_rtr_incident ON roadside_triage_records(incident_id);
      `);

      // 4. Roadside Triage Answers
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_triage_answers (
          id TEXT PRIMARY KEY,
          triage_record_id TEXT NOT NULL REFERENCES roadside_triage_records(id) ON DELETE CASCADE,
          question_key TEXT NOT NULL,
          answer_value TEXT NOT NULL,
          risk_flag INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rta_record ON roadside_triage_answers(triage_record_id);
      `);

      // 5. Roadside Assistance Requests
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_assistance_requests (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES roadside_incidents(id) ON DELETE CASCADE,
          requested_assistance_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'CREATED',
          dispatch_mode TEXT NOT NULL DEFAULT 'AUTOMATIC_BROADCAST',
          search_radius_km REAL NOT NULL DEFAULT 35.0,
          created_at TEXT NOT NULL,
          expires_at TEXT,
          fulfilled_assignment_id TEXT,
          metadata_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_rsr_incident ON roadside_assistance_requests(incident_id);
        CREATE INDEX IF NOT EXISTS idx_rsr_status ON roadside_assistance_requests(status);
      `);

      // 6. Roadside Provider Offers
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_provider_offers (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL REFERENCES roadside_assistance_requests(id) ON DELETE CASCADE,
          incident_id TEXT NOT NULL REFERENCES roadside_incidents(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          provider_branch_id TEXT REFERENCES provider_branches(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'OFFERED',
          offered_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          responded_at TEXT,
          decline_reason TEXT,
          estimated_arrival_minutes INTEGER,
          callout_charge_minor INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'KES',
          metadata_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_rpo_request ON roadside_provider_offers(request_id);
        CREATE INDEX IF NOT EXISTS idx_rpo_provider ON roadside_provider_offers(provider_id);
        CREATE INDEX IF NOT EXISTS idx_rpo_incident ON roadside_provider_offers(incident_id);
      `);

      // 7. Roadside Assignments (Single Active Assignment Enforcement)
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_assignments (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES roadside_incidents(id) ON DELETE CASCADE,
          request_id TEXT NOT NULL,
          offer_id TEXT REFERENCES roadside_provider_offers(id) ON DELETE SET NULL,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          provider_branch_id TEXT REFERENCES provider_branches(id) ON DELETE SET NULL,
          assigned_technician_id TEXT,
          assigned_technician_name TEXT,
          assigned_technician_phone TEXT,
          assigned_vehicle_reg TEXT,
          status TEXT NOT NULL DEFAULT 'ASSIGNED',
          eta_minutes INTEGER,
          en_route_at TEXT,
          arrived_at TEXT,
          in_progress_at TEXT,
          completed_at TEXT,
          cancelled_at TEXT,
          last_known_latitude REAL,
          last_known_longitude REAL,
          last_location_updated_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rsa_incident ON roadside_assignments(incident_id);
        CREATE INDEX IF NOT EXISTS idx_rsa_provider ON roadside_assignments(provider_id);
        CREATE INDEX IF NOT EXISTS idx_rsa_status ON roadside_assignments(status);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_active_incident_assignment 
          ON roadside_assignments(incident_id) 
          WHERE status IN ('ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS');
      `);

      // 8. Roadside Interventions (On-Site Repair & Diagnostic Record)
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_interventions (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES roadside_incidents(id) ON DELETE CASCADE,
          assignment_id TEXT NOT NULL REFERENCES roadside_assignments(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          technician_id TEXT,
          technician_name TEXT,
          result TEXT NOT NULL,
          summary_notes TEXT NOT NULL,
          labor_duration_minutes INTEGER NOT NULL DEFAULT 0,
          final_drivability TEXT NOT NULL,
          odometer_reading_km REAL,
          tow_required INTEGER NOT NULL DEFAULT 0,
          tow_destination TEXT,
          related_issue_id TEXT REFERENCES vehicle_issues(id) ON DELETE SET NULL,
          related_component_id TEXT REFERENCES vehicle_components(id) ON DELETE SET NULL,
          related_tyre_id TEXT REFERENCES vehicle_tyres(id) ON DELETE SET NULL,
          fee_minor INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'KES',
          recorded_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rsi_assignment ON roadside_interventions(assignment_id);
        CREATE INDEX IF NOT EXISTS idx_rsi_inc ON roadside_interventions(incident_id);
      `);

      // 9. Roadside Intervention Actions (Parts/Fluids/Labor)
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_intervention_actions (
          id TEXT PRIMARY KEY,
          intervention_id TEXT NOT NULL REFERENCES roadside_interventions(id) ON DELETE CASCADE,
          action_type TEXT NOT NULL,
          description TEXT NOT NULL,
          part_name TEXT,
          part_number TEXT,
          quantity REAL NOT NULL DEFAULT 1,
          cost_minor INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rsia_intervention ON roadside_intervention_actions(intervention_id);
      `);

      // 10. Roadside Incident Evidence
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_incident_evidence (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES roadside_incidents(id) ON DELETE CASCADE,
          storage_object_id TEXT REFERENCES file_objects(id) ON DELETE SET NULL,
          evidence_type TEXT NOT NULL,
          caption TEXT,
          file_url TEXT,
          captured_by_role TEXT NOT NULL,
          uploaded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rsie_incident ON roadside_incident_evidence(incident_id);
      `);

      // 11. Roadside Incident Activity Log
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_incident_activity (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES roadside_incidents(id) ON DELETE CASCADE,
          activity_type TEXT NOT NULL,
          actor_id TEXT,
          actor_type TEXT,
          actor_name TEXT,
          title TEXT NOT NULL,
          details TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rsiact_incident ON roadside_incident_activity(incident_id);
      `);

      // 12. Roadside Cancellations
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_cancellations (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES roadside_incidents(id) ON DELETE CASCADE,
          cancelled_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          cancelled_by_role TEXT NOT NULL,
          reason TEXT NOT NULL,
          notes TEXT,
          fee_incurred_minor INTEGER NOT NULL DEFAULT 0,
          cancelled_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rsc_incident ON roadside_cancellations(incident_id);
      `);

      // 13. Roadside Tow Handoffs
      db.exec(`
        CREATE TABLE IF NOT EXISTS roadside_tow_handoffs (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES roadside_incidents(id) ON DELETE CASCADE,
          intervention_id TEXT REFERENCES roadside_interventions(id) ON DELETE SET NULL,
          destination_type TEXT NOT NULL DEFAULT 'REPAIR_FACILITY',
          destination_provider_id TEXT REFERENCES service_providers(id) ON DELETE SET NULL,
          destination_name TEXT NOT NULL,
          destination_address TEXT,
          destination_latitude REAL,
          destination_longitude REAL,
          special_instructions TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING_DISPATCH',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rsth_incident ON roadside_tow_handoffs(incident_id);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS roadside_tow_handoffs;
        DROP TABLE IF EXISTS roadside_cancellations;
        DROP TABLE IF EXISTS roadside_incident_activity;
        DROP TABLE IF EXISTS roadside_incident_evidence;
        DROP TABLE IF EXISTS roadside_intervention_actions;
        DROP TABLE IF EXISTS roadside_interventions;
        DROP TABLE IF EXISTS roadside_assignments;
        DROP TABLE IF EXISTS roadside_provider_offers;
        DROP TABLE IF EXISTS roadside_assistance_requests;
        DROP TABLE IF EXISTS roadside_triage_answers;
        DROP TABLE IF EXISTS roadside_triage_records;
        DROP TABLE IF EXISTS roadside_locations;
        DROP TABLE IF EXISTS roadside_incidents;
      `);
    },
  },
  {
    id: '014_towing_and_recovery_architecture',
    name: 'Towing & Vehicle Recovery Architecture (GAR-015)',
    up: (db) => {
      // 1. Tow Capability Profiles
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_capability_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          supported_classes_json TEXT NOT NULL,
          supported_mobility_states_json TEXT NOT NULL,
          supported_recovery_types_json TEXT NOT NULL,
          required_equipment_json TEXT,
          max_weight_kg REAL,
          created_at TEXT NOT NULL
        );
      `);

      // 2. Recovery Units (Tow Trucks)
      db.exec(`
        CREATE TABLE IF NOT EXISTS recovery_units (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          unit_type TEXT NOT NULL DEFAULT 'FLATBED',
          registration_identifier TEXT NOT NULL,
          fleet_identifier TEXT,
          status TEXT NOT NULL DEFAULT 'AVAILABLE',
          max_vehicle_weight_kg REAL,
          max_vehicle_length_mm REAL,
          max_vehicle_width_mm REAL,
          equipment_profile_id TEXT REFERENCES tow_capability_profiles(id) ON DELETE SET NULL,
          base_location_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ru_provider ON recovery_units(provider_id);
        CREATE INDEX IF NOT EXISTS idx_ru_status ON recovery_units(status);
        CREATE INDEX IF NOT EXISTS idx_ru_type ON recovery_units(unit_type);
      `);

      // 3. Recovery Unit Equipment
      db.exec(`
        CREATE TABLE IF NOT EXISTS recovery_unit_equipment (
          id TEXT PRIMARY KEY,
          recovery_unit_id TEXT NOT NULL REFERENCES recovery_units(id) ON DELETE CASCADE,
          equipment_type TEXT NOT NULL,
          rating_capacity_kg REAL,
          is_operational INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rue_unit ON recovery_unit_equipment(recovery_unit_id);
      `);

      // 4. Recovery Unit Supported Vehicle Classes
      db.exec(`
        CREATE TABLE IF NOT EXISTS recovery_unit_vehicle_class_support (
          id TEXT PRIMARY KEY,
          recovery_unit_id TEXT NOT NULL REFERENCES recovery_units(id) ON DELETE CASCADE,
          vehicle_class TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ruvcs_unit ON recovery_unit_vehicle_class_support(recovery_unit_id);
      `);

      // 5. Tow Requests (Primary Aggregate)
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_requests (
          id TEXT PRIMARY KEY,
          request_number TEXT UNIQUE NOT NULL,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
          requesting_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
          source_type TEXT NOT NULL DEFAULT 'OWNER_REQUEST',
          source_reference_id TEXT,
          status TEXT NOT NULL DEFAULT 'REQUESTED',
          tow_reason TEXT NOT NULL,
          recovery_type TEXT NOT NULL DEFAULT 'STANDARD_TOW',
          vehicle_mobility_state TEXT NOT NULL DEFAULT 'UNKNOWN',
          vehicle_condition_state TEXT NOT NULL DEFAULT 'NORMAL_BREAKDOWN',
          required_capability_profile_id TEXT REFERENCES tow_capability_profiles(id) ON DELETE SET NULL,
          preferred_provider_id TEXT REFERENCES service_providers(id) ON DELETE SET NULL,
          assigned_provider_id TEXT REFERENCES service_providers(id) ON DELETE SET NULL,
          active_assignment_id TEXT,
          related_issue_id TEXT REFERENCES vehicle_issues(id) ON DELETE SET NULL,
          special_instructions TEXT,
          requested_at TEXT NOT NULL,
          assigned_at TEXT,
          completed_at TEXT,
          cancelled_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tr_vehicle ON tow_requests(vehicle_id);
        CREATE INDEX IF NOT EXISTS idx_tr_user ON tow_requests(requesting_user_id);
        CREATE INDEX IF NOT EXISTS idx_tr_status ON tow_requests(status);
        CREATE INDEX IF NOT EXISTS idx_tr_source ON tow_requests(source_type, source_reference_id);
      `);

      // 6. Tow Pickup Locations
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_pickup_locations (
          id TEXT PRIMARY KEY,
          tow_request_id TEXT NOT NULL REFERENCES tow_requests(id) ON DELETE CASCADE,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy_meters REAL,
          address_summary TEXT NOT NULL,
          road_name TEXT,
          landmark TEXT,
          access_notes TEXT,
          source_type TEXT NOT NULL DEFAULT 'MANUAL_ENTRY',
          captured_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tpl_request ON tow_pickup_locations(tow_request_id);
      `);

      // 7. Tow Destinations
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_destinations (
          id TEXT PRIMARY KEY,
          tow_request_id TEXT NOT NULL REFERENCES tow_requests(id) ON DELETE CASCADE,
          destination_type TEXT NOT NULL DEFAULT 'GARAGE',
          provider_id TEXT REFERENCES service_providers(id) ON DELETE SET NULL,
          branch_id TEXT REFERENCES provider_branches(id) ON DELETE SET NULL,
          location_reference_id TEXT,
          address_summary TEXT NOT NULL,
          latitude REAL,
          longitude REAL,
          contact_name TEXT,
          contact_phone TEXT,
          instructions TEXT,
          revision_number INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_td_request ON tow_destinations(tow_request_id);
        CREATE INDEX IF NOT EXISTS idx_td_provider ON tow_destinations(provider_id);
      `);

      // 8. Tow Destination Revisions
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_destination_revisions (
          id TEXT PRIMARY KEY,
          tow_request_id TEXT NOT NULL REFERENCES tow_requests(id) ON DELETE CASCADE,
          previous_destination_id TEXT NOT NULL,
          new_destination_id TEXT NOT NULL,
          changed_by_user_id TEXT NOT NULL,
          changed_by_role TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tdr_request ON tow_destination_revisions(tow_request_id);
      `);

      // 9. Tow Provider Offers
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_provider_offers (
          id TEXT PRIMARY KEY,
          tow_request_id TEXT NOT NULL REFERENCES tow_requests(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          recovery_unit_id TEXT REFERENCES recovery_units(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'OFFERED',
          offered_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          distance_km REAL,
          compatibility_status TEXT NOT NULL DEFAULT 'CONFIRMED',
          estimated_price_minor INTEGER,
          currency TEXT NOT NULL DEFAULT 'KES',
          responded_at TEXT,
          decline_reason TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tpo_request ON tow_provider_offers(tow_request_id);
        CREATE INDEX IF NOT EXISTS idx_tpo_provider ON tow_provider_offers(provider_id);
        CREATE INDEX IF NOT EXISTS idx_tpo_status ON tow_provider_offers(status);
      `);

      // 10. Tow Assignments (Single active assignment guard)
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_assignments (
          id TEXT PRIMARY KEY,
          tow_request_id TEXT NOT NULL REFERENCES tow_requests(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          recovery_unit_id TEXT NOT NULL REFERENCES recovery_units(id) ON DELETE RESTRICT,
          operator_staff_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          operator_name TEXT,
          operator_phone TEXT,
          status TEXT NOT NULL DEFAULT 'ASSIGNED',
          assigned_at TEXT NOT NULL,
          accepted_at TEXT NOT NULL,
          en_route_at TEXT,
          arrived_pickup_at TEXT,
          loading_started_at TEXT,
          loaded_at TEXT,
          transit_started_at TEXT,
          arrived_destination_at TEXT,
          unloading_started_at TEXT,
          unloaded_at TEXT,
          delivery_confirmed_at TEXT,
          completed_at TEXT,
          waiting_started_at TEXT,
          waiting_ended_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ta_request ON tow_assignments(tow_request_id);
        CREATE INDEX IF NOT EXISTS idx_ta_provider ON tow_assignments(provider_id);
        CREATE INDEX IF NOT EXISTS idx_ta_unit ON tow_assignments(recovery_unit_id);
        CREATE INDEX IF NOT EXISTS idx_ta_status ON tow_assignments(status);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_active_tow_assignment
          ON tow_assignments(tow_request_id)
          WHERE status IN ('ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'LOADING', 'VEHICLE_LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING');
        CREATE UNIQUE INDEX IF NOT EXISTS idx_active_unit_assignment
          ON tow_assignments(recovery_unit_id)
          WHERE status IN ('ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'LOADING', 'VEHICLE_LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING');
      `);

      // 11. Tow Pickup Inspections
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_pickup_inspections (
          id TEXT PRIMARY KEY,
          tow_assignment_id TEXT NOT NULL REFERENCES tow_assignments(id) ON DELETE CASCADE,
          performed_at TEXT NOT NULL,
          performed_by_user_id TEXT NOT NULL,
          vehicle_condition_summary TEXT NOT NULL,
          visible_damage_json TEXT,
          mobility_state_confirmed TEXT NOT NULL,
          odometer_reading_km REAL,
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tpi_assignment ON tow_pickup_inspections(tow_assignment_id);
      `);

      // 12. Tow Pickup Evidence
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_pickup_evidence (
          id TEXT PRIMARY KEY,
          inspection_id TEXT NOT NULL REFERENCES tow_pickup_inspections(id) ON DELETE CASCADE,
          storage_object_id TEXT REFERENCES file_objects(id) ON DELETE SET NULL,
          evidence_type TEXT NOT NULL,
          file_url TEXT NOT NULL,
          caption TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tpe_inspection ON tow_pickup_evidence(inspection_id);
      `);

      // 13. Tow Custody Events (Chain of Custody)
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_custody_events (
          id TEXT PRIMARY KEY,
          tow_assignment_id TEXT NOT NULL REFERENCES tow_assignments(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          from_party_type TEXT NOT NULL,
          from_party_id TEXT,
          from_party_name TEXT,
          to_party_type TEXT NOT NULL,
          to_party_id TEXT,
          to_party_name TEXT,
          occurred_at TEXT NOT NULL,
          location_summary TEXT,
          evidence_reference_ids_json TEXT,
          acknowledgement_status TEXT NOT NULL DEFAULT 'CONFIRMED',
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tce_assignment ON tow_custody_events(tow_assignment_id);
        CREATE INDEX IF NOT EXISTS idx_tce_type ON tow_custody_events(event_type);
      `);

      // 14. Tow Delivery Confirmations
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_delivery_confirmations (
          id TEXT PRIMARY KEY,
          tow_assignment_id TEXT NOT NULL REFERENCES tow_assignments(id) ON DELETE CASCADE,
          delivered_at TEXT NOT NULL,
          recipient_type TEXT NOT NULL,
          recipient_id TEXT,
          recipient_name TEXT NOT NULL,
          recipient_signature_reference TEXT,
          destination_provider_id TEXT REFERENCES service_providers(id) ON DELETE SET NULL,
          destination_branch_id TEXT REFERENCES provider_branches(id) ON DELETE SET NULL,
          condition_summary TEXT NOT NULL,
          acknowledgement_method TEXT NOT NULL DEFAULT 'PHOTO_CONFIRMATION',
          service_case_handoff_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tdc_assignment ON tow_delivery_confirmations(tow_assignment_id);
      `);

      // 15. Tow Delivery Evidence
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_delivery_evidence (
          id TEXT PRIMARY KEY,
          delivery_confirmation_id TEXT NOT NULL REFERENCES tow_delivery_confirmations(id) ON DELETE CASCADE,
          storage_object_id TEXT REFERENCES file_objects(id) ON DELETE SET NULL,
          evidence_type TEXT NOT NULL,
          file_url TEXT NOT NULL,
          caption TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tde_confirmation ON tow_delivery_evidence(delivery_confirmation_id);
      `);

      // 16. Tow Cancellations
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_cancellations (
          id TEXT PRIMARY KEY,
          tow_request_id TEXT NOT NULL REFERENCES tow_requests(id) ON DELETE CASCADE,
          cancelled_by_user_id TEXT NOT NULL,
          cancelled_by_role TEXT NOT NULL,
          reason TEXT NOT NULL,
          assignment_state_at_cancellation TEXT,
          callout_fee_incurred_minor INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'KES',
          notes TEXT,
          cancelled_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tc_request ON tow_cancellations(tow_request_id);
      `);

      // 17. Tow Assignment Failures
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_assignment_failures (
          id TEXT PRIMARY KEY,
          assignment_id TEXT NOT NULL REFERENCES tow_assignments(id) ON DELETE CASCADE,
          failure_type TEXT NOT NULL,
          description TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          reported_by_user_id TEXT NOT NULL,
          recoverable INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_taf_assignment ON tow_assignment_failures(assignment_id);
      `);

      // 18. Tow Activity Log
      db.exec(`
        CREATE TABLE IF NOT EXISTS tow_activity (
          id TEXT PRIMARY KEY,
          tow_request_id TEXT NOT NULL REFERENCES tow_requests(id) ON DELETE CASCADE,
          tow_assignment_id TEXT REFERENCES tow_assignments(id) ON DELETE SET NULL,
          activity_type TEXT NOT NULL,
          actor_id TEXT,
          actor_type TEXT,
          actor_name TEXT,
          title TEXT NOT NULL,
          details TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tact_request ON tow_activity(tow_request_id);
        CREATE INDEX IF NOT EXISTS idx_tact_assignment ON tow_activity(tow_assignment_id);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS tow_activity;
        DROP TABLE IF EXISTS tow_assignment_failures;
        DROP TABLE IF EXISTS tow_cancellations;
        DROP TABLE IF EXISTS tow_delivery_evidence;
        DROP TABLE IF EXISTS tow_delivery_confirmations;
        DROP TABLE IF EXISTS tow_custody_events;
        DROP TABLE IF EXISTS tow_pickup_evidence;
        DROP TABLE IF EXISTS tow_pickup_inspections;
        DROP TABLE IF EXISTS tow_assignments;
        DROP TABLE IF EXISTS tow_provider_offers;
        DROP TABLE IF EXISTS tow_destination_revisions;
        DROP TABLE IF EXISTS tow_destinations;
        DROP TABLE IF EXISTS tow_pickup_locations;
        DROP TABLE IF EXISTS tow_requests;
        DROP TABLE IF EXISTS recovery_unit_vehicle_class_support;
        DROP TABLE IF EXISTS recovery_unit_equipment;
        DROP TABLE IF EXISTS recovery_units;
        DROP TABLE IF EXISTS tow_capability_profiles;
      `);
    },
  },
  {
    id: '015_realtime_dispatch_location_matching',
    name: 'Real-Time Dispatch, Location & Provider Matching Architecture (GAR-016)',
    up: (db) => {
      // 1. Dispatch Requests
      db.exec(`
        CREATE TABLE IF NOT EXISTS dispatch_requests (
          id TEXT PRIMARY KEY,
          dispatch_domain TEXT NOT NULL,
          source_reference_type TEXT NOT NULL,
          source_reference_id TEXT NOT NULL,
          required_capability TEXT NOT NULL,
          pickup_latitude REAL NOT NULL,
          pickup_longitude REAL NOT NULL,
          pickup_address TEXT,
          destination_latitude REAL,
          destination_longitude REAL,
          destination_address TEXT,
          vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
          priority TEXT NOT NULL DEFAULT 'NORMAL',
          status TEXT NOT NULL DEFAULT 'CREATED',
          strategy TEXT NOT NULL DEFAULT 'BATCH',
          strategy_version TEXT NOT NULL DEFAULT 'v1.0',
          current_attempt_number INTEGER NOT NULL DEFAULT 1,
          active_attempt_id TEXT,
          assigned_provider_id TEXT REFERENCES service_providers(id) ON DELETE SET NULL,
          assigned_responder_type TEXT,
          assigned_responder_id TEXT,
          lock_version INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_dr_status ON dispatch_requests(status);
        CREATE INDEX IF NOT EXISTS idx_dr_source ON dispatch_requests(source_reference_type, source_reference_id);
        CREATE INDEX IF NOT EXISTS idx_dr_priority ON dispatch_requests(priority);
        CREATE INDEX IF NOT EXISTS idx_dr_created ON dispatch_requests(created_at);
      `);

      // 2. Dispatch Attempts
      db.exec(`
        CREATE TABLE IF NOT EXISTS dispatch_attempts (
          id TEXT PRIMARY KEY,
          dispatch_request_id TEXT NOT NULL REFERENCES dispatch_requests(id) ON DELETE CASCADE,
          attempt_number INTEGER NOT NULL,
          strategy TEXT NOT NULL,
          search_radius_km REAL NOT NULL,
          candidate_ids_json TEXT,
          status TEXT NOT NULL DEFAULT 'STARTED',
          failure_reason TEXT,
          started_at TEXT NOT NULL,
          expires_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_da_request ON dispatch_attempts(dispatch_request_id);
        CREATE INDEX IF NOT EXISTS idx_da_status ON dispatch_attempts(status);
      `);

      // 3. Dispatch Candidates
      db.exec(`
        CREATE TABLE IF NOT EXISTS dispatch_candidates (
          id TEXT PRIMARY KEY,
          dispatch_request_id TEXT NOT NULL REFERENCES dispatch_requests(id) ON DELETE CASCADE,
          dispatch_attempt_id TEXT NOT NULL REFERENCES dispatch_attempts(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          responder_type TEXT NOT NULL,
          responder_reference_id TEXT NOT NULL,
          eligibility_status TEXT NOT NULL DEFAULT 'ELIGIBLE',
          distance_meters REAL,
          distance_type TEXT,
          eta_seconds REAL,
          eta_source TEXT,
          location_freshness TEXT,
          availability_state TEXT,
          capability_score REAL NOT NULL DEFAULT 1.0,
          distance_score REAL NOT NULL DEFAULT 0.0,
          eta_score REAL NOT NULL DEFAULT 0.0,
          workload_score REAL NOT NULL DEFAULT 1.0,
          overall_score REAL NOT NULL DEFAULT 0.0,
          rank INTEGER,
          exclusion_reason TEXT,
          strategy_version TEXT NOT NULL DEFAULT 'v1.0',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dc_request ON dispatch_candidates(dispatch_request_id);
        CREATE INDEX IF NOT EXISTS idx_dc_attempt ON dispatch_candidates(dispatch_attempt_id);
        CREATE INDEX IF NOT EXISTS idx_dc_provider ON dispatch_candidates(provider_id);
        CREATE INDEX IF NOT EXISTS idx_dc_responder ON dispatch_candidates(responder_type, responder_reference_id);
        CREATE INDEX IF NOT EXISTS idx_dc_rank ON dispatch_candidates(dispatch_request_id, rank);
      `);

      // 4. Responder Presence (Distinct from business hours)
      db.exec(`
        CREATE TABLE IF NOT EXISTS responder_presence (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          responder_type TEXT NOT NULL,
          responder_reference_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'OFFLINE',
          last_heartbeat_at TEXT NOT NULL,
          available_since TEXT,
          current_job_reference TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rp_provider ON responder_presence(provider_id);
        CREATE INDEX IF NOT EXISTS idx_rp_status ON responder_presence(status);
        CREATE INDEX IF NOT EXISTS idx_rp_heartbeat ON responder_presence(last_heartbeat_at);
      `);

      // 5. Responder Current Locations (Latest rebuildable projection)
      db.exec(`
        CREATE TABLE IF NOT EXISTS responder_current_locations (
          responder_reference_id TEXT PRIMARY KEY,
          responder_type TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy_meters REAL,
          heading_degrees REAL,
          speed_meters_per_second REAL,
          captured_at TEXT NOT NULL,
          received_at TEXT NOT NULL,
          freshness_state TEXT NOT NULL DEFAULT 'FRESH',
          quality TEXT NOT NULL DEFAULT 'GOOD',
          movement_state TEXT NOT NULL DEFAULT 'UNKNOWN',
          source_type TEXT NOT NULL DEFAULT 'DEVICE_GPS',
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rcl_coords ON responder_current_locations(latitude, longitude);
        CREATE INDEX IF NOT EXISTS idx_rcl_freshness ON responder_current_locations(freshness_state);
        CREATE INDEX IF NOT EXISTS idx_rcl_captured ON responder_current_locations(captured_at);
      `);

      // 6. Responder Location Observations (Raw telemetry with outlier flag)
      db.exec(`
        CREATE TABLE IF NOT EXISTS responder_location_observations (
          id TEXT PRIMARY KEY,
          responder_type TEXT NOT NULL,
          responder_reference_id TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy_meters REAL,
          heading_degrees REAL,
          speed_meters_per_second REAL,
          captured_at TEXT NOT NULL,
          received_at TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'DEVICE_GPS',
          is_outlier INTEGER NOT NULL DEFAULT 0,
          outlier_reason TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rlo_responder ON responder_location_observations(responder_reference_id, captured_at);
        CREATE INDEX IF NOT EXISTS idx_rlo_captured ON responder_location_observations(captured_at);
      `);

      // 7. Dispatch Route Estimates (Cached route / distance calculations)
      db.exec(`
        CREATE TABLE IF NOT EXISTS dispatch_route_estimates (
          id TEXT PRIMARY KEY,
          origin_latitude REAL NOT NULL,
          origin_longitude REAL NOT NULL,
          destination_latitude REAL NOT NULL,
          destination_longitude REAL NOT NULL,
          distance_meters REAL NOT NULL,
          distance_type TEXT NOT NULL,
          duration_seconds REAL,
          provider_name TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dre_lookup ON dispatch_route_estimates(origin_latitude, origin_longitude, destination_latitude, destination_longitude);
        CREATE INDEX IF NOT EXISTS idx_dre_expires ON dispatch_route_estimates(expires_at);
      `);

      // 8. Dispatch ETA Estimates
      db.exec(`
        CREATE TABLE IF NOT EXISTS dispatch_eta_estimates (
          id TEXT PRIMARY KEY,
          dispatch_request_id TEXT NOT NULL REFERENCES dispatch_requests(id) ON DELETE CASCADE,
          responder_reference_id TEXT NOT NULL,
          estimated_arrival_at TEXT,
          duration_seconds REAL,
          source TEXT NOT NULL,
          calculated_at TEXT NOT NULL,
          route_distance_meters REAL,
          confidence TEXT NOT NULL DEFAULT 'HIGH',
          traffic_included INTEGER NOT NULL DEFAULT 0,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dee_request ON dispatch_eta_estimates(dispatch_request_id);
        CREATE INDEX IF NOT EXISTS idx_dee_expires ON dispatch_eta_estimates(expires_at);
      `);

      // 9. Dispatch Tracking Projections (Privacy-safe customer view)
      db.exec(`
        CREATE TABLE IF NOT EXISTS dispatch_tracking_projections (
          id TEXT PRIMARY KEY,
          dispatch_request_id TEXT NOT NULL REFERENCES dispatch_requests(id) ON DELETE CASCADE,
          assignment_id TEXT NOT NULL,
          assignment_domain TEXT NOT NULL,
          assignment_status TEXT NOT NULL,
          customer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          responder_display_name TEXT NOT NULL,
          responder_unit_summary TEXT,
          latitude REAL,
          longitude REAL,
          accuracy_meters REAL,
          location_freshness TEXT NOT NULL DEFAULT 'UNKNOWN',
          location_captured_at TEXT,
          eta_arrival_at TEXT,
          eta_duration_seconds REAL,
          eta_source TEXT,
          eta_calculated_at TEXT,
          eta_freshness TEXT NOT NULL DEFAULT 'UNKNOWN',
          tracking_access_status TEXT NOT NULL DEFAULT 'ACTIVE',
          is_tracking_active INTEGER NOT NULL DEFAULT 1,
          stale_warning TEXT,
          last_updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dtp_request ON dispatch_tracking_projections(dispatch_request_id);
        CREATE INDEX IF NOT EXISTS idx_dtp_assignment ON dispatch_tracking_projections(assignment_id);
        CREATE INDEX IF NOT EXISTS idx_dtp_status ON dispatch_tracking_projections(tracking_access_status);
        CREATE INDEX IF NOT EXISTS idx_dtp_customer ON dispatch_tracking_projections(customer_user_id);
      `);

      // 10. Dispatch Reconciliation Records
      db.exec(`
        CREATE TABLE IF NOT EXISTS dispatch_reconciliation_records (
          id TEXT PRIMARY KEY,
          dispatch_request_id TEXT NOT NULL REFERENCES dispatch_requests(id) ON DELETE CASCADE,
          issue_type TEXT NOT NULL,
          description TEXT NOT NULL,
          resolved INTEGER NOT NULL DEFAULT 0,
          resolution_details TEXT,
          detected_at TEXT NOT NULL,
          resolved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_drr_request ON dispatch_reconciliation_records(dispatch_request_id);
        CREATE INDEX IF NOT EXISTS idx_drr_resolved ON dispatch_reconciliation_records(resolved);
      `);

      // 11. Dispatch Manual Overrides (Audit log for manual dispatches and privileged overrides)
      db.exec(`
        CREATE TABLE IF NOT EXISTS dispatch_manual_overrides (
          id TEXT PRIMARY KEY,
          dispatch_request_id TEXT NOT NULL REFERENCES dispatch_requests(id) ON DELETE CASCADE,
          actor_id TEXT NOT NULL REFERENCES users(id),
          actor_role TEXT NOT NULL,
          provider_id TEXT NOT NULL REFERENCES service_providers(id),
          responder_reference_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          override_flags_json TEXT,
          eligibility_snapshot_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dmo_request ON dispatch_manual_overrides(dispatch_request_id);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS dispatch_manual_overrides;
        DROP TABLE IF EXISTS dispatch_reconciliation_records;
        DROP TABLE IF EXISTS dispatch_tracking_projections;
        DROP TABLE IF EXISTS dispatch_eta_estimates;
        DROP TABLE IF EXISTS dispatch_route_estimates;
        DROP TABLE IF EXISTS responder_location_observations;
        DROP TABLE IF EXISTS responder_current_locations;
        DROP TABLE IF EXISTS responder_presence;
        DROP TABLE IF EXISTS dispatch_candidates;
        DROP TABLE IF EXISTS dispatch_attempts;
        DROP TABLE IF EXISTS dispatch_requests;
      `);
    },
  },
  {
    id: '016_emergency_circle_human_safety_foundation',
    name: 'Emergency Circle & Human Safety Foundation (GAR-017)',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS emergency_contacts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          display_name TEXT NOT NULL,
          relationship_label TEXT,
          phone_e164 TEXT,
          email TEXT,
          priority INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          revoked_at TEXT,
          CHECK (priority >= 1),
          CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
        );
        CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user_status
          ON emergency_contacts(user_id, status, priority, created_at);

        CREATE TABLE IF NOT EXISTS emergency_contact_scopes (
          id TEXT PRIMARY KEY,
          contact_id TEXT NOT NULL REFERENCES emergency_contacts(id) ON DELETE CASCADE,
          incident_level TEXT NOT NULL,
          notify_contact INTEGER NOT NULL DEFAULT 1,
          share_incident_type INTEGER NOT NULL DEFAULT 1,
          share_vehicle_summary INTEGER NOT NULL DEFAULT 1,
          share_live_location INTEGER NOT NULL DEFAULT 0,
          share_assistance_status INTEGER NOT NULL DEFAULT 1,
          share_callback_number INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(contact_id, incident_level),
          CHECK (incident_level IN ('ASSISTANCE', 'BREAKDOWN', 'SERIOUS_EMERGENCY'))
        );
        CREATE INDEX IF NOT EXISTS idx_emergency_contact_scopes_contact
          ON emergency_contact_scopes(contact_id, incident_level);

        CREATE TABLE IF NOT EXISTS human_safety_preferences (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          emergency_circle_enabled INTEGER NOT NULL DEFAULT 1,
          allow_location_sharing INTEGER NOT NULL DEFAULT 0,
          safety_check_enabled INTEGER NOT NULL DEFAULT 1,
          safety_check_timeout_seconds INTEGER NOT NULL DEFAULT 120,
          sos_cancel_countdown_seconds INTEGER NOT NULL DEFAULT 5,
          escalation_sequence_enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (safety_check_timeout_seconds BETWEEN 30 AND 3600),
          CHECK (sos_cancel_countdown_seconds BETWEEN 3 AND 15)
        );

        CREATE TABLE IF NOT EXISTS safety_configuration_history (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          change_type TEXT NOT NULL,
          subject_id TEXT,
          summary_json TEXT NOT NULL,
          actor_id TEXT NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_safety_configuration_history_user
          ON safety_configuration_history(user_id, created_at DESC);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS safety_configuration_history;
        DROP TABLE IF EXISTS human_safety_preferences;
        DROP TABLE IF EXISTS emergency_contact_scopes;
        DROP TABLE IF EXISTS emergency_contacts;
      `);
    },
  },
  {
    id: '017_sos_engine_emergency_activation',
    name: 'SOS Engine & Emergency Activation (GAR-017)',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sos_incidents (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
          incident_level TEXT NOT NULL DEFAULT 'SERIOUS_EMERGENCY',
          incident_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'COUNTDOWN',
          activation_source TEXT NOT NULL DEFAULT 'USER_SOS_BUTTON',
          activation_attempted_at TEXT NOT NULL,
          server_acknowledged_at TEXT NOT NULL,
          cancel_deadline_at TEXT NOT NULL,
          activated_at TEXT,
          cancelled_at TEXT,
          closed_at TEXT,
          cancellation_reason TEXT,
          closure_reason TEXT,
          notification_state TEXT NOT NULL DEFAULT 'NOT_STARTED',
          safety_check_state TEXT NOT NULL DEFAULT 'NOT_STARTED',
          assistance_state TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (incident_level IN ('ASSISTANCE', 'BREAKDOWN', 'SERIOUS_EMERGENCY')),
          CHECK (status IN ('COUNTDOWN', 'ACTIVATED', 'CANCELLED', 'CLOSED'))
        );
        CREATE INDEX IF NOT EXISTS idx_sos_incidents_user
          ON sos_incidents(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sos_incidents_status
          ON sos_incidents(status, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sos_one_active_per_user
          ON sos_incidents(user_id)
          WHERE status IN ('COUNTDOWN', 'ACTIVATED');

        CREATE TABLE IF NOT EXISTS sos_activation_attempts (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES sos_incidents(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          attempt_number INTEGER NOT NULL DEFAULT 1,
          client_requested_at TEXT,
          server_received_at TEXT NOT NULL,
          server_acknowledged_at TEXT NOT NULL,
          activation_source TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACKNOWLEDGED',
          created_at TEXT NOT NULL,
          CHECK (status IN ('ACKNOWLEDGED', 'CANCELLED', 'ACTIVATED', 'FAILED'))
        );
        CREATE INDEX IF NOT EXISTS idx_sos_activation_incident
          ON sos_activation_attempts(incident_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS sos_location_snapshots (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES sos_incidents(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy_meters REAL,
          captured_at TEXT NOT NULL,
          purpose TEXT NOT NULL DEFAULT 'SOS_INITIAL_LOCATION',
          source_type TEXT NOT NULL DEFAULT 'DEVICE_GPS',
          sharing_authorized INTEGER NOT NULL DEFAULT 0,
          expires_at TEXT NOT NULL,
          access_revoked_at TEXT,
          created_at TEXT NOT NULL,
          CHECK (latitude BETWEEN -90 AND 90),
          CHECK (longitude BETWEEN -180 AND 180)
        );
        CREATE INDEX IF NOT EXISTS idx_sos_location_incident
          ON sos_location_snapshots(incident_id, captured_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sos_location_expiry
          ON sos_location_snapshots(expires_at);

        CREATE TABLE IF NOT EXISTS sos_contact_notification_attempts (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES sos_incidents(id) ON DELETE CASCADE,
          contact_id TEXT NOT NULL REFERENCES emergency_contacts(id) ON DELETE RESTRICT,
          priority INTEGER NOT NULL,
          channel TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'QUEUED',
          share_incident_type INTEGER NOT NULL DEFAULT 0,
          share_vehicle_summary INTEGER NOT NULL DEFAULT 0,
          share_live_location INTEGER NOT NULL DEFAULT 0,
          share_assistance_status INTEGER NOT NULL DEFAULT 0,
          share_callback_number INTEGER NOT NULL DEFAULT 0,
          provider_name TEXT,
          provider_message_id TEXT,
          queued_at TEXT NOT NULL,
          attempted_at TEXT,
          provider_accepted_at TEXT,
          delivered_at TEXT,
          failed_at TEXT,
          failure_code TEXT,
          failure_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (channel IN ('SMS', 'EMAIL')),
          CHECK (status IN ('QUEUED', 'ATTEMPTED', 'PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED', 'NOT_CONFIGURED', 'SKIPPED'))
        );
        CREATE INDEX IF NOT EXISTS idx_sos_notification_incident
          ON sos_contact_notification_attempts(incident_id, priority, queued_at);
        CREATE INDEX IF NOT EXISTS idx_sos_notification_status
          ON sos_contact_notification_attempts(status, queued_at);

        CREATE TABLE IF NOT EXISTS sos_safety_checks (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES sos_incidents(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'PENDING',
          prompted_at TEXT NOT NULL,
          due_at TEXT NOT NULL,
          responded_at TEXT,
          response TEXT,
          response_notes TEXT,
          timed_out_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (status IN ('PENDING', 'RESPONDED', 'TIMED_OUT')),
          CHECK (response IS NULL OR response IN ('OKAY', 'NEED_HELP', 'CANNOT_CONFIRM'))
        );
        CREATE INDEX IF NOT EXISTS idx_sos_safety_check_incident
          ON sos_safety_checks(incident_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sos_safety_check_due
          ON sos_safety_checks(status, due_at);

        CREATE TABLE IF NOT EXISTS sos_status_history (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES sos_incidents(id) ON DELETE CASCADE,
          from_status TEXT,
          to_status TEXT NOT NULL,
          actor_id TEXT,
          actor_type TEXT,
          reason TEXT,
          metadata_json TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sos_status_history_incident
          ON sos_status_history(incident_id, occurred_at ASC);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS sos_status_history;
        DROP TABLE IF EXISTS sos_safety_checks;
        DROP TABLE IF EXISTS sos_contact_notification_attempts;
        DROP TABLE IF EXISTS sos_location_snapshots;
        DROP TABLE IF EXISTS sos_activation_attempts;
        DROP TABLE IF EXISTS sos_incidents;
      `);
    },
  },
  {
    id: '018_trusted_contact_experience',
    name: 'Trusted Contact Experience (GAR-017)',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS trusted_contact_access_grants (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL REFERENCES sos_incidents(id) ON DELETE CASCADE,
          contact_id TEXT NOT NULL REFERENCES emergency_contacts(id) ON DELETE RESTRICT,
          notification_attempt_id TEXT NOT NULL REFERENCES sos_contact_notification_attempts(id) ON DELETE CASCADE,
          token_digest TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          expires_at TEXT NOT NULL,
          first_accessed_at TEXT,
          last_accessed_at TEXT,
          revoked_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(notification_attempt_id),
          CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED'))
        );
        CREATE INDEX IF NOT EXISTS idx_trusted_contact_grants_incident
          ON trusted_contact_access_grants(incident_id, status, expires_at);
        CREATE INDEX IF NOT EXISTS idx_trusted_contact_grants_contact
          ON trusted_contact_access_grants(contact_id, status, expires_at);

        CREATE TABLE IF NOT EXISTS trusted_contact_responses (
          id TEXT PRIMARY KEY,
          grant_id TEXT NOT NULL REFERENCES trusted_contact_access_grants(id) ON DELETE CASCADE,
          incident_id TEXT NOT NULL REFERENCES sos_incidents(id) ON DELETE CASCADE,
          contact_id TEXT NOT NULL REFERENCES emergency_contacts(id) ON DELETE RESTRICT,
          response TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (response IN ('ACKNOWLEDGED', 'CONTACTING_USER', 'CANNOT_ASSIST'))
        );
        CREATE INDEX IF NOT EXISTS idx_trusted_contact_responses_grant
          ON trusted_contact_responses(grant_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS trusted_contact_access_audit (
          id TEXT PRIMARY KEY,
          grant_id TEXT NOT NULL REFERENCES trusted_contact_access_grants(id) ON DELETE CASCADE,
          incident_id TEXT NOT NULL REFERENCES sos_incidents(id) ON DELETE CASCADE,
          contact_id TEXT NOT NULL REFERENCES emergency_contacts(id) ON DELETE RESTRICT,
          action TEXT NOT NULL,
          metadata_json TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_trusted_contact_access_audit_grant
          ON trusted_contact_access_audit(grant_id, occurred_at DESC);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS trusted_contact_access_audit;
        DROP TABLE IF EXISTS trusted_contact_responses;
        DROP TABLE IF EXISTS trusted_contact_access_grants;
      `);
    },
  },
  {
    id: '019_accident_management',
    name: 'Accident Management (GAR-018)',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS accident_incidents (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
          status TEXT NOT NULL DEFAULT 'DRAFT',
          incident_type TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'UNKNOWN',
          occurred_at TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          summary TEXT NOT NULL,
          location_label TEXT,
          latitude REAL,
          longitude REAL,
          location_accuracy_meters REAL,
          location_sharing_authorized INTEGER NOT NULL DEFAULT 0,
          police_attended TEXT NOT NULL DEFAULT 'UNKNOWN',
          injuries_reported TEXT NOT NULL DEFAULT 'UNKNOWN',
          vehicle_drivable TEXT NOT NULL DEFAULT 'UNKNOWN',
          timeline_entry_id TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          finalized_at TEXT,
          closed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (status IN ('DRAFT', 'RECORDED', 'REPAIR_IN_PROGRESS', 'CLOSED')),
          CHECK (severity IN ('UNKNOWN', 'MINOR', 'MODERATE', 'MAJOR', 'TOTAL_LOSS_REPORTED')),
          CHECK (police_attended IN ('UNKNOWN', 'YES', 'NO')),
          CHECK (injuries_reported IN ('UNKNOWN', 'YES', 'NO')),
          CHECK (vehicle_drivable IN ('UNKNOWN', 'YES', 'NO')),
          CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
          CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
        );
        CREATE INDEX IF NOT EXISTS idx_accidents_user_created
          ON accident_incidents(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_accidents_vehicle_occurred
          ON accident_incidents(vehicle_id, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS idx_accidents_status
          ON accident_incidents(status, created_at DESC);

        CREATE TABLE IF NOT EXISTS accident_participants (
          id TEXT PRIMARY KEY,
          accident_id TEXT NOT NULL REFERENCES accident_incidents(id) ON DELETE CASCADE,
          participant_type TEXT NOT NULL,
          display_label TEXT NOT NULL,
          name TEXT,
          phone TEXT,
          email TEXT,
          vehicle_registration TEXT,
          vehicle_make TEXT,
          vehicle_model TEXT,
          insurer_name TEXT,
          policy_reference TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          CHECK (participant_type IN ('OTHER_DRIVER', 'PASSENGER', 'PEDESTRIAN', 'CYCLIST', 'PROPERTY_OWNER', 'OTHER'))
        );
        CREATE INDEX IF NOT EXISTS idx_accident_participants_accident
          ON accident_participants(accident_id, created_at);

        CREATE TABLE IF NOT EXISTS accident_witnesses (
          id TEXT PRIMARY KEY,
          accident_id TEXT NOT NULL REFERENCES accident_incidents(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          phone TEXT,
          email TEXT,
          notes TEXT,
          consent_to_contact TEXT NOT NULL DEFAULT 'UNKNOWN',
          created_at TEXT NOT NULL,
          CHECK (consent_to_contact IN ('UNKNOWN', 'YES', 'NO'))
        );
        CREATE INDEX IF NOT EXISTS idx_accident_witnesses_accident
          ON accident_witnesses(accident_id, created_at);

        CREATE TABLE IF NOT EXISTS accident_damage_observations (
          id TEXT PRIMARY KEY,
          accident_id TEXT NOT NULL REFERENCES accident_incidents(id) ON DELETE CASCADE,
          vehicle_area TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'UNKNOWN',
          description TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'OWNER_OBSERVATION',
          created_at TEXT NOT NULL,
          CHECK (severity IN ('UNKNOWN', 'COSMETIC', 'MINOR', 'MODERATE', 'SEVERE')),
          CHECK (source_type IN ('OWNER_OBSERVATION', 'PROVIDER_OBSERVATION', 'EXTERNAL_DOCUMENT'))
        );
        CREATE INDEX IF NOT EXISTS idx_accident_damage_accident
          ON accident_damage_observations(accident_id, created_at);

        CREATE TABLE IF NOT EXISTS accident_evidence (
          id TEXT PRIMARY KEY,
          accident_id TEXT NOT NULL REFERENCES accident_incidents(id) ON DELETE CASCADE,
          file_id TEXT NOT NULL REFERENCES file_objects(id) ON DELETE RESTRICT,
          evidence_type TEXT NOT NULL,
          description TEXT,
          captured_at TEXT,
          source_type TEXT NOT NULL DEFAULT 'OWNER_PROVIDED',
          privacy_class TEXT NOT NULL DEFAULT 'PRIVATE',
          created_at TEXT NOT NULL,
          UNIQUE(accident_id, file_id),
          CHECK (evidence_type IN ('SCENE_PHOTO', 'VEHICLE_PHOTO', 'OTHER_VEHICLE_PHOTO', 'DOCUMENT', 'VIDEO', 'AUDIO', 'OTHER')),
          CHECK (source_type IN ('OWNER_PROVIDED', 'PROVIDER_PROVIDED', 'EXTERNAL_DOCUMENT')),
          CHECK (privacy_class IN ('PRIVATE', 'SHAREABLE_INCIDENT_EVIDENCE'))
        );
        CREATE INDEX IF NOT EXISTS idx_accident_evidence_accident
          ON accident_evidence(accident_id, created_at);

        CREATE TABLE IF NOT EXISTS accident_external_references (
          id TEXT PRIMARY KEY,
          accident_id TEXT NOT NULL REFERENCES accident_incidents(id) ON DELETE CASCADE,
          reference_type TEXT NOT NULL,
          provider_name TEXT,
          reference_number TEXT NOT NULL,
          verification_status TEXT NOT NULL DEFAULT 'OWNER_REPORTED',
          notes TEXT,
          created_at TEXT NOT NULL,
          CHECK (reference_type IN ('POLICE_REFERENCE', 'INSURANCE_CLAIM', 'INSPECTION_REFERENCE', 'LEGAL_REFERENCE', 'OTHER')),
          CHECK (verification_status IN ('OWNER_REPORTED', 'DOCUMENT_SUPPORTED', 'EXTERNAL_VERIFIED'))
        );
        CREATE INDEX IF NOT EXISTS idx_accident_external_refs_accident
          ON accident_external_references(accident_id, created_at);

        CREATE TABLE IF NOT EXISTS accident_handoffs (
          id TEXT PRIMARY KEY,
          accident_id TEXT NOT NULL REFERENCES accident_incidents(id) ON DELETE CASCADE,
          handoff_type TEXT NOT NULL,
          target_reference_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'LINKED',
          notes TEXT,
          created_at TEXT NOT NULL,
          CHECK (handoff_type IN ('TOW_REQUEST', 'ROADSIDE_INCIDENT', 'SERVICE_CASE', 'BOOKING')),
          CHECK (status IN ('LINKED', 'SUPERSEDED', 'CANCELLED'))
        );
        CREATE INDEX IF NOT EXISTS idx_accident_handoffs_accident
          ON accident_handoffs(accident_id, created_at);

        CREATE TABLE IF NOT EXISTS accident_addenda (
          id TEXT PRIMARY KEY,
          accident_id TEXT NOT NULL REFERENCES accident_incidents(id) ON DELETE CASCADE,
          author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          addendum_type TEXT NOT NULL DEFAULT 'OWNER_NOTE',
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (addendum_type IN ('OWNER_NOTE', 'CORRECTION_NOTE', 'REPAIR_UPDATE', 'EXTERNAL_REFERENCE_UPDATE'))
        );
        CREATE INDEX IF NOT EXISTS idx_accident_addenda_accident
          ON accident_addenda(accident_id, created_at);

        CREATE TABLE IF NOT EXISTS accident_status_history (
          id TEXT PRIMARY KEY,
          accident_id TEXT NOT NULL REFERENCES accident_incidents(id) ON DELETE CASCADE,
          from_status TEXT,
          to_status TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          reason TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_accident_status_history
          ON accident_status_history(accident_id, occurred_at);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS accident_status_history;
        DROP TABLE IF EXISTS accident_addenda;
        DROP TABLE IF EXISTS accident_handoffs;
        DROP TABLE IF EXISTS accident_external_references;
        DROP TABLE IF EXISTS accident_evidence;
        DROP TABLE IF EXISTS accident_damage_observations;
        DROP TABLE IF EXISTS accident_witnesses;
        DROP TABLE IF EXISTS accident_participants;
        DROP TABLE IF EXISTS accident_incidents;
      `);
    },
  },
];

/**
 * Ensures the migration tracking table exists
 */
function ensureMigrationTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      batch INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

/**
 * Runs all pending migrations deterministically
 */
export function runMigrations(db: DatabaseSync): { applied: string[]; alreadyUpToDate: boolean } {
  ensureMigrationTable(db);

  const appliedRows = db.prepare('SELECT id, checksum FROM schema_migrations ORDER BY batch ASC, id ASC;').all() as Array<{ id: string; checksum: string }>;
  const appliedSet = new Map(appliedRows.map((r) => [r.id, r.checksum]));

  let currentMaxBatch = 0;
  const batchRow = db.prepare('SELECT MAX(batch) as max_batch FROM schema_migrations;').get() as { max_batch: number | null };
  if (batchRow && batchRow.max_batch) {
    currentMaxBatch = batchRow.max_batch;
  }
  const nextBatch = currentMaxBatch + 1;

  const applied: string[] = [];

  for (const migration of MIGRATIONS) {
    const checksum = crypto.createHash('sha256').update(migration.up.toString()).digest('hex');

    if (appliedSet.has(migration.id)) {
      // Check for migration drift
      const previousChecksum = appliedSet.get(migration.id);
      if (previousChecksum && previousChecksum !== checksum) {
        logger.warn(`Migration drift detected for ${migration.id}: recorded checksum differs from source definition.`);
      }
      continue;
    }

    logger.info(`Applying canonical database migration: ${migration.id} (${migration.name})`);

    // Execute migration inside a transaction
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      migration.up(db);
      const stmt = db.prepare(`
        INSERT INTO schema_migrations (id, name, batch, checksum, applied_at)
        VALUES (?, ?, ?, ?, ?);
      `);
      stmt.run(migration.id, migration.name, nextBatch, checksum, getCurrentUtcIsoString());
      db.exec('COMMIT;');
      applied.push(migration.id);
    } catch (err) {
      db.exec('ROLLBACK;');
      logger.error(`Migration failed for ${migration.id}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  return {
    applied,
    alreadyUpToDate: applied.length === 0,
  };
}

/**
 * Rolls back the latest batch of migrations
 */
export function rollbackLatestMigration(db: DatabaseSync): { rolledBack: string[] } {
  ensureMigrationTable(db);

  const batchRow = db.prepare('SELECT MAX(batch) as max_batch FROM schema_migrations;').get() as { max_batch: number | null };
  if (!batchRow || !batchRow.max_batch) {
    return { rolledBack: [] };
  }

  const latestBatch = batchRow.max_batch;
  const rows = db.prepare('SELECT id FROM schema_migrations WHERE batch = ? ORDER BY id DESC;').all(latestBatch) as Array<{ id: string }>;
  const rolledBack: string[] = [];

  for (const row of rows) {
    const migration = MIGRATIONS.find((m) => m.id === row.id);
    if (!migration) {
      throw new Error(`Cannot rollback unknown migration: ${row.id}`);
    }

    logger.warn(`Rolling back canonical database migration: ${migration.id}`);
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      migration.down(db);
      db.prepare('DELETE FROM schema_migrations WHERE id = ?;').run(migration.id);
      db.exec('COMMIT;');
      rolledBack.push(migration.id);
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  return { rolledBack };
}
