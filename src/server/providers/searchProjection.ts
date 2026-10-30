/**
 * Provider Search Projection Engine (GAR-011 §16)
 *
 * Implements:
 * - Denormalized read-model for low-latency search and discovery
 * - Atomic incremental projection updates on domain mutations
 * - Full idempotent projection rebuild capability
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { getCurrentUtcIsoString } from '../domain/time';
import { ProviderStatus, ProviderVerificationStatus } from './types';

/**
 * Updates or inserts the projection row for a specific provider
 */
export function updateProviderSearchProjection(
  providerId: string,
  customDb?: DatabaseSync
): void {
  const db = customDb || getDatabase();

  // 1. Fetch provider record
  const provider = db
    .prepare(
      `SELECT id, name, provider_type, status, verification_status,
              service_radius_km, accepts_mobile_jobs, accepts_roadside_jobs, accepts_towing_jobs
       FROM service_providers WHERE id = ?;`
    )
    .get(providerId) as {
    id: string;
    name: string;
    provider_type: string;
    status: string;
    verification_status: string;
    service_radius_km: number | null;
    accepts_mobile_jobs: number;
    accepts_roadside_jobs: number;
    accepts_towing_jobs: number;
  } | undefined;

  if (!provider) {
    db.prepare('DELETE FROM provider_search_projection WHERE provider_id = ?;').run(providerId);
    return;
  }

  // 2. Fetch primary or first location coordinates
  const location = db
    .prepare(
      `SELECT latitude, longitude, city, county_state
       FROM provider_locations
       WHERE provider_id = ?
       ORDER BY is_primary DESC, created_at ASC
       LIMIT 1;`
    )
    .get(providerId) as {
    latitude: number;
    longitude: number;
    city: string;
    county_state: string;
  } | undefined;

  // 3. Fetch active service categories
  const categoryRows = db
    .prepare(
      `SELECT DISTINCT sc.code
       FROM provider_service_capabilities psc
       JOIN service_categories sc ON psc.service_category_id = sc.id
       WHERE psc.provider_id = ? AND psc.status = 'ACTIVE';`
    )
    .all(providerId) as Array<{ code: string }>;
  const serviceCategories = categoryRows.map((r) => r.code);

  // 4. Fetch delivery modes
  const modeRows = db
    .prepare(
      `SELECT DISTINCT delivery_mode
       FROM provider_service_capabilities
       WHERE provider_id = ? AND status = 'ACTIVE';`
    )
    .all(providerId) as Array<{ delivery_mode: string }>;
  const deliveryModes = modeRows.map((r) => r.delivery_mode);

  // 5. Fetch supported vehicle makes
  const makeRows = db
    .prepare(
      `SELECT make_name FROM provider_vehicle_make_support WHERE provider_id = ?;`
    )
    .all(providerId) as Array<{ make_name: string }>;
  const supportedMakes = makeRows.map((r) => r.make_name);

  // 6. Fetch supported vehicle classes
  const classRows = db
    .prepare(
      `SELECT vehicle_class FROM provider_vehicle_class_support WHERE provider_id = ?;`
    )
    .all(providerId) as Array<{ vehicle_class: string }>;
  const supportedClasses = classRows.map((r) => r.vehicle_class);

  // 7. Determine discoverability
  const isDiscoverable =
    provider.status === ProviderStatus.ACTIVE &&
    (location != null || provider.accepts_mobile_jobs === 1 || provider.accepts_towing_jobs === 1)
      ? 1
      : 0;

  const now = getCurrentUtcIsoString();

  const stmt = db.prepare(`
    INSERT INTO provider_search_projection (
      provider_id, display_name, provider_type, status, verification_status,
      latitude, longitude, city, county_state, service_categories, delivery_modes,
      supported_makes, supported_classes, service_radius_km, accepts_mobile,
      accepts_roadside, accepts_towing, is_discoverable, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )
    ON CONFLICT(provider_id) DO UPDATE SET
      display_name = excluded.display_name,
      provider_type = excluded.provider_type,
      status = excluded.status,
      verification_status = excluded.verification_status,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      city = excluded.city,
      county_state = excluded.county_state,
      service_categories = excluded.service_categories,
      delivery_modes = excluded.delivery_modes,
      supported_makes = excluded.supported_makes,
      supported_classes = excluded.supported_classes,
      service_radius_km = excluded.service_radius_km,
      accepts_mobile = excluded.accepts_mobile,
      accepts_roadside = excluded.accepts_roadside,
      accepts_towing = excluded.accepts_towing,
      is_discoverable = excluded.is_discoverable,
      updated_at = excluded.updated_at;
  `);

  stmt.run(
    provider.id,
    provider.name,
    provider.provider_type,
    provider.status,
    provider.verification_status,
    location ? location.latitude : null,
    location ? location.longitude : null,
    location ? location.city : null,
    location ? location.county_state : null,
    JSON.stringify(serviceCategories),
    JSON.stringify(deliveryModes),
    JSON.stringify(supportedMakes),
    JSON.stringify(supportedClasses),
    provider.service_radius_km,
    provider.accepts_mobile_jobs,
    provider.accepts_roadside_jobs,
    provider.accepts_towing_jobs,
    isDiscoverable,
    now
  );
}

/**
 * Rebuilds the search projection completely for all providers in the database
 */
export function rebuildAllProviderSearchProjections(customDb?: DatabaseSync): number {
  const db = customDb || getDatabase();
  const providers = db
    .prepare('SELECT id FROM service_providers;')
    .all() as Array<{ id: string }>;

  for (const p of providers) {
    updateProviderSearchProjection(p.id, db);
  }

  return providers.length;
}
