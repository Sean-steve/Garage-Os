/**
 * Service Provider Domain Service (GAR-011)
 *
 * Implements business logic and data access for:
 * - Provider organization profiles & operating configurations
 * - Multi-location & branch networks
 * - Taxonomy-backed service capabilities
 * - Weekly operating schedules, exception dates & live operating state
 * - Geospatial service areas (radial & polygonal geofences)
 * - Vehicle make & class compatibility
 * - Staff assignments linked directly to Organization Memberships (Sprint 2)
 * - Multi-tier verification workflows & audit trails
 * - High-performance search projection maintenance & discovery queries
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { generateCanonicalId } from '../domain/id';
import { getCurrentUtcIsoString } from '../domain/time';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { recordAuditEvent } from '../security/audit';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import { AuthenticatedActorContext } from '../identity/types';
import {
  AssignStaffInput,
  CreateBranchInput,
  CreateCapabilityInput,
  CreateLocationInput,
  CreateOperatingHoursInput,
  CreateProviderInput,
  CreateScheduleExceptionInput,
  CreateServiceAreaInput,
  DeliveryMode,
  OperatingState,
  ProviderBranchEntity,
  ProviderCapabilityEntity,
  ProviderDetailResponse,
  ProviderEntity,
  ProviderLocationEntity,
  ProviderLocationType,
  ProviderOperatingHoursEntity,
  ProviderScheduleExceptionEntity,
  ProviderSearchCriteria,
  ProviderSearchResultItem,
  ProviderSearchResponse,
  ProviderServiceAreaEntity,
  ProviderStaffEntity,
  ProviderStatus,
  ProviderType,
  ProviderVerificationDocumentEntity,
  ProviderVerificationStatus,
  ReviewVerificationInput,
  ServicePricingType,
  StaffProfessionalRole,
  StaffStatus,
  SubmitVerificationDocumentInput,
  UpdateProviderInput,
  VehicleClass,
} from './types';
import {
  haversineDistanceKm,
  isPointInServiceArea,
  isValidCoordinate,
  PolygonPoint,
} from './geoUtils';
import { computeOperatingState } from './hoursCalculator';
import { updateProviderSearchProjection } from './searchProjection';

export class ProviderService {
  /**
   * Creates a new automotive service provider profile linked to an organization
   */
  public createProvider(
    input: CreateProviderInput,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): ProviderEntity {
    const db = getDatabase();

    // Verify actor has permission to manage provider profile for the organization
    assertAuthorized(actor, CanonicalPermission.PROVIDER_PROFILE_UPDATE, {
      organizationId: input.organization_id,
    });

    // Validate provider type
    if (!Object.values(ProviderType).includes(input.provider_type)) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid provider type: ${input.provider_type}`
      );
    }

    if (!input.name || input.name.trim().length === 0) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Provider name is required');
    }

    // Verify organization exists and is active
    const org = db
      .prepare('SELECT id, status FROM organizations WHERE id = ?;')
      .get(input.organization_id) as { id: string; status: string } | undefined;

    if (!org) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Organization not found');
    }

    if (org.status === 'SUSPENDED' || org.status === 'DISABLED') {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE,
        `Cannot create provider for organization in ${org.status} state`
      );
    }

    const providerId = generateCanonicalId('srv');
    const now = getCurrentUtcIsoString();

    const provider: ProviderEntity = {
      id: providerId,
      organization_id: input.organization_id,
      name: input.name.trim(),
      legal_business_name: input.legal_business_name?.trim() || (input as any).legal_name?.trim() || null,
      provider_type: input.provider_type,
      status: ProviderStatus.ACTIVE,
      verification_status: ProviderVerificationStatus.UNVERIFIED,
      primary_location_id: null,
      phone: input.phone?.trim() || (input as any).primary_phone?.trim() || null,
      email: input.email?.trim() || (input as any).primary_email?.trim() || null,
      website: input.website?.trim() || (input as any).website_url?.trim() || null,
      description: input.description?.trim() || null,
      service_radius_km: input.service_radius_km ?? 25,
      accepts_bookings: input.accepts_bookings !== false,
      accepts_mobile_jobs: Boolean(input.accepts_mobile_jobs),
      accepts_roadside_jobs: Boolean(input.accepts_roadside_jobs),
      accepts_towing_jobs: Boolean(input.accepts_towing_jobs),
      currency: input.currency || 'KES',
      callout_fee: input.callout_fee ?? null,
      created_at: now,
      updated_at: now,
    };

    withTransaction(() => {
      db.prepare(`
        INSERT INTO service_providers (
          id, organization_id, name, legal_business_name, provider_type,
          phone, email, website, description, status, verification_status,
          verification_state, service_radius_km, accepts_bookings, accepts_mobile_jobs,
          accepts_roadside_jobs, accepts_towing_jobs, currency, callout_fee,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?
        );
      `).run(
        provider.id,
        provider.organization_id,
        provider.name,
        provider.legal_business_name,
        provider.provider_type,
        provider.phone,
        provider.email,
        provider.website,
        provider.description,
        provider.status,
        provider.verification_status,
        'PENDING_VERIFICATION',
        provider.service_radius_km,
        provider.accepts_bookings ? 1 : 0,
        provider.accepts_mobile_jobs ? 1 : 0,
        provider.accepts_roadside_jobs ? 1 : 0,
        provider.accepts_towing_jobs ? 1 : 0,
        provider.currency,
        provider.callout_fee,
        provider.created_at,
        provider.updated_at
      );

      // Default standard operating hours (Mon-Sat 08:00-17:00)
      const insertHoursStmt = db.prepare(`
        INSERT INTO provider_operating_hours (
          id, provider_id, branch_id, day_of_week, opens_at, closes_at, is_closed, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?);
      `);

      for (let day = 0; day <= 6; day++) {
        const isClosed = day === 0 ? 1 : 0; // Sunday closed by default
        insertHoursStmt.run(
          generateCanonicalId('poh'),
          provider.id,
          day,
          '08:00',
          '17:00',
          isClosed,
          now,
          now
        );
      }

      updateProviderSearchProjection(provider.id, db);

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: 'PROVIDER_CREATED',
          resource_type: 'service_provider',
          resource_id: provider.id,
          correlation_id: correlationId,
          source: 'ProviderService',
          after_state: provider as unknown as Record<string, unknown>,
          metadata: { organization_id: input.organization_id },
        },
        db
      );
    });

    return provider;
  }

  /**
   * Fetches provider detail with comprehensive relations and computed state
   */
  public getProviderById(
    providerId: string,
    actor?: AuthenticatedActorContext
  ): ProviderDetailResponse {
    const db = getDatabase();

    const provider = db
      .prepare('SELECT * FROM service_providers WHERE id = ?;')
      .get(providerId) as unknown as ProviderEntity | undefined;

    if (!provider) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Provider not found: ${providerId}`);
    }

    // Check read authorization if actor is provided
    if (actor) {
      assertAuthorized(actor, CanonicalPermission.PROVIDER_PROFILE_READ, {
        organizationId: provider.organization_id,
      });
    }

    // Fetch locations
    const locations = db
      .prepare(
        'SELECT * FROM provider_locations WHERE provider_id = ? ORDER BY is_primary DESC, created_at ASC;'
      )
      .all(providerId) as unknown as ProviderLocationEntity[];

    // Fetch branches
    const branches = db
      .prepare(
        'SELECT * FROM provider_branches WHERE provider_id = ? ORDER BY created_at ASC;'
      )
      .all(providerId) as unknown as ProviderBranchEntity[];

    // Fetch capabilities
    const capabilities = db
      .prepare(`
        SELECT psc.*, sc.code as category_code, sc.name as category_name
        FROM provider_service_capabilities psc
        JOIN service_categories sc ON psc.service_category_id = sc.id
        WHERE psc.provider_id = ?
        ORDER BY psc.status ASC, psc.created_at ASC;
      `)
      .all(providerId) as unknown as Array<ProviderCapabilityEntity & { category_code: string; category_name: string }>;

    // Fetch operating hours
    const operatingHours = db
      .prepare(
        'SELECT * FROM provider_operating_hours WHERE provider_id = ? AND branch_id IS NULL ORDER BY day_of_week ASC, opens_at ASC;'
      )
      .all(providerId) as unknown as ProviderOperatingHoursEntity[];

    // Fetch schedule exceptions
    const scheduleExceptions = db
      .prepare(
        'SELECT * FROM provider_schedule_exceptions WHERE provider_id = ? AND branch_id IS NULL ORDER BY exception_date ASC;'
      )
      .all(providerId) as unknown as ProviderScheduleExceptionEntity[];

    // Fetch service areas
    const serviceAreas = db
      .prepare('SELECT * FROM provider_service_areas WHERE provider_id = ? ORDER BY created_at ASC;')
      .all(providerId) as unknown as ProviderServiceAreaEntity[];

    // Fetch supported makes
    const makesRows = db
      .prepare('SELECT make_name FROM provider_vehicle_make_support WHERE provider_id = ?;')
      .all(providerId) as Array<{ make_name: string }>;
    const supportedMakes = makesRows.map((r) => r.make_name);

    // Fetch supported classes
    const classesRows = db
      .prepare('SELECT vehicle_class FROM provider_vehicle_class_support WHERE provider_id = ?;')
      .all(providerId) as Array<{ vehicle_class: VehicleClass }>;
    const supportedClasses = classesRows.map((r) => r.vehicle_class);

    // Count active staff
    const staffCountRow = db
      .prepare(
        "SELECT COUNT(*) as count FROM provider_staff_profiles WHERE provider_id = ? AND status = 'ACTIVE';"
      )
      .get(providerId) as { count: number };

    // Compute live operating state
    const operatingEvaluation = computeOperatingState(
      operatingHours,
      scheduleExceptions,
      'Africa/Nairobi'
    );

    return {
      provider,
      locations,
      branches,
      capabilities,
      operating_hours: operatingHours,
      schedule_exceptions: scheduleExceptions,
      service_areas: serviceAreas,
      supported_makes: supportedMakes,
      supported_classes: supportedClasses,
      active_staff_count: staffCountRow.count,
      current_operating_state: operatingEvaluation.state,
      operating_state_reason: operatingEvaluation.reason,
    };
  }

  /**
   * Updates provider profile fields
   */
  public updateProvider(
    providerId: string,
    input: UpdateProviderInput,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): ProviderEntity {
    const db = getDatabase();

    const existing = db
      .prepare('SELECT * FROM service_providers WHERE id = ?;')
      .get(providerId) as unknown as ProviderEntity | undefined;

    if (!existing) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');
    }

    assertAuthorized(actor, CanonicalPermission.PROVIDER_PROFILE_UPDATE, {
      organizationId: existing.organization_id,
    });

    const now = getCurrentUtcIsoString();

    const updated: ProviderEntity = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      legal_business_name: input.legal_business_name !== undefined ? input.legal_business_name?.trim() || null : ((input as any).legal_name !== undefined ? (input as any).legal_name?.trim() || null : existing.legal_business_name),
      provider_type: input.provider_type || existing.provider_type,
      phone: input.phone !== undefined ? input.phone?.trim() || null : ((input as any).primary_phone !== undefined ? (input as any).primary_phone?.trim() || null : existing.phone),
      email: input.email !== undefined ? input.email?.trim() || null : ((input as any).primary_email !== undefined ? (input as any).primary_email?.trim() || null : existing.email),
      website: input.website !== undefined ? input.website?.trim() || null : ((input as any).website_url !== undefined ? (input as any).website_url?.trim() || null : existing.website),
      description: input.description !== undefined ? input.description?.trim() || null : existing.description,
      service_radius_km: input.service_radius_km !== undefined ? input.service_radius_km : existing.service_radius_km,
      accepts_bookings: input.accepts_bookings !== undefined ? Boolean(input.accepts_bookings) : existing.accepts_bookings,
      accepts_mobile_jobs: input.accepts_mobile_jobs !== undefined ? Boolean(input.accepts_mobile_jobs) : existing.accepts_mobile_jobs,
      accepts_roadside_jobs: input.accepts_roadside_jobs !== undefined ? Boolean(input.accepts_roadside_jobs) : existing.accepts_roadside_jobs,
      accepts_towing_jobs: input.accepts_towing_jobs !== undefined ? Boolean(input.accepts_towing_jobs) : existing.accepts_towing_jobs,
      currency: input.currency || existing.currency,
      callout_fee: input.callout_fee !== undefined ? input.callout_fee : existing.callout_fee,
      status: input.status || existing.status,
      updated_at: now,
    };

    withTransaction(() => {
      db.prepare(`
        UPDATE service_providers SET
          name = ?, legal_business_name = ?, provider_type = ?, phone = ?,
          email = ?, website = ?, description = ?, service_radius_km = ?,
          accepts_bookings = ?, accepts_mobile_jobs = ?, accepts_roadside_jobs = ?,
          accepts_towing_jobs = ?, currency = ?, callout_fee = ?, status = ?, updated_at = ?
        WHERE id = ?;
      `).run(
        updated.name,
        updated.legal_business_name,
        updated.provider_type,
        updated.phone,
        updated.email,
        updated.website,
        updated.description,
        updated.service_radius_km,
        updated.accepts_bookings ? 1 : 0,
        updated.accepts_mobile_jobs ? 1 : 0,
        updated.accepts_roadside_jobs ? 1 : 0,
        updated.accepts_towing_jobs ? 1 : 0,
        updated.currency,
        updated.callout_fee,
        updated.status,
        updated.updated_at,
        providerId
      );

      updateProviderSearchProjection(providerId, db);

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: 'PROVIDER_UPDATED',
          resource_type: 'service_provider',
          resource_id: providerId,
          correlation_id: correlationId,
          source: 'ProviderService',
          before_state: existing as unknown as Record<string, unknown>,
          after_state: updated as unknown as Record<string, unknown>,
        },
        db
      );
    });

    return updated;
  }

  // =========================================================================
  // LOCATIONS
  // =========================================================================

  public createLocation(
    providerId: string,
    input: CreateLocationInput,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): ProviderLocationEntity {
    const db = getDatabase();

    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');
    }

    assertAuthorized(actor, CanonicalPermission.PROVIDER_LOCATION_MANAGE, {
      organizationId: provider.organization_id,
    });

    if (!isValidCoordinate(input.latitude, input.longitude)) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid coordinates: lat ${input.latitude}, lng ${input.longitude}`
      );
    }

    if (!input.address_line1 || !input.city) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        'Address line 1 and city are required'
      );
    }

    const locationId = generateCanonicalId('prvloc');
    const now = getCurrentUtcIsoString();
    const isPrimary = Boolean(input.is_primary);

    const location: ProviderLocationEntity = {
      id: locationId,
      provider_id: providerId,
      name: input.name?.trim() || (input as any).location_name?.trim() || 'Main Facility',
      location_type: (input.location_type as ProviderLocationType) || ProviderLocationType.WORKSHOP,
      address_line1: input.address_line1.trim(),
      address_line2: input.address_line2?.trim() || null,
      city: input.city.trim(),
      county_state: input.county_state?.trim() || 'Nairobi',
      country: (input.country?.trim() || (input as any).country_code?.trim() || 'KE').toUpperCase(),
      postal_code: input.postal_code?.trim() || null,
      latitude: input.latitude,
      longitude: input.longitude,
      timezone: input.timezone || 'Africa/Nairobi',
      geocoding_source: 'SYSTEM',
      verification_status: ProviderVerificationStatus.UNVERIFIED,
      is_primary: isPrimary,
      created_at: now,
      updated_at: now,
    };

    withTransaction(() => {
      // If setting this location as primary, unmark other primary locations
      if (isPrimary) {
        db.prepare('UPDATE provider_locations SET is_primary = 0 WHERE provider_id = ?;').run(
          providerId
        );
      }

      db.prepare(`
        INSERT INTO provider_locations (
          id, provider_id, name, location_type, address_line1, address_line2, city, county_state,
          country, postal_code, latitude, longitude, timezone, geocoding_source,
          verification_status, is_primary, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        );
      `).run(
        location.id,
        location.provider_id,
        location.name,
        location.location_type,
        location.address_line1,
        location.address_line2,
        location.city,
        location.county_state,
        location.country,
        location.postal_code,
        location.latitude,
        location.longitude,
        location.timezone,
        location.geocoding_source,
        location.verification_status,
        location.is_primary ? 1 : 0,
        location.created_at,
        location.updated_at
      );

      updateProviderSearchProjection(providerId, db);

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: 'PROVIDER_LOCATION_CREATED',
          resource_type: 'provider_location',
          resource_id: location.id,
          correlation_id: correlationId,
          source: 'ProviderService',
          after_state: location as unknown as Record<string, unknown>,
        },
        db
      );
    });

    return location;
  }

  public listLocations(providerId: string): ProviderLocationEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM provider_locations WHERE provider_id = ? ORDER BY is_primary DESC, created_at ASC;')
      .all(providerId) as unknown as ProviderLocationEntity[];
  }

  // =========================================================================
  // BRANCHES
  // =========================================================================

  public createBranch(
    providerId: string,
    input: CreateBranchInput,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): ProviderBranchEntity {
    const db = getDatabase();

    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');
    }

    assertAuthorized(actor, CanonicalPermission.PROVIDER_LOCATION_MANAGE, {
      organizationId: provider.organization_id,
    });

    if (!input.name || input.name.trim().length === 0) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Branch name is required');
    }

    let locationId = input.location_id;
    if (!locationId) {
      const primaryLoc = db
        .prepare('SELECT id FROM provider_locations WHERE provider_id = ? ORDER BY is_primary DESC LIMIT 1;')
        .get(providerId) as { id: string } | undefined;
      if (primaryLoc) {
        locationId = primaryLoc.id;
      } else {
        throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Branch requires a valid location. Please create a provider location first.');
      }
    } else {
      const loc = db
        .prepare('SELECT id FROM provider_locations WHERE id = ? AND provider_id = ?;')
        .get(locationId, providerId);
      if (!loc) {
        throw new CanonicalAppError(
          ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,
          'Location does not exist or belong to this provider'
        );
      }
    }

    const branchId = generateCanonicalId('prvbr');
    const now = getCurrentUtcIsoString();

    const branch: ProviderBranchEntity = {
      id: branchId,
      provider_id: providerId,
      location_id: locationId,
      name: input.name.trim(),
      status: 'ACTIVE',
      manager_membership_id: input.manager_membership_id || null,
      phone: input.phone?.trim() || (input as any).contact_phone?.trim() || null,
      email: input.email?.trim() || (input as any).contact_email?.trim() || null,
      created_at: now,
      updated_at: now,
    };

    withTransaction(() => {
      db.prepare(`
        INSERT INTO provider_branches (
          id, provider_id, location_id, name, status, manager_membership_id, phone, email, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `).run(
        branch.id,
        branch.provider_id,
        branch.location_id,
        branch.name,
        branch.status,
        branch.manager_membership_id ?? null,
        branch.phone ?? null,
        branch.email ?? null,
        branch.created_at,
        branch.updated_at
      );

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: 'PROVIDER_BRANCH_CREATED',
          resource_type: 'provider_branch',
          resource_id: branch.id,
          correlation_id: correlationId,
          source: 'ProviderService',
          after_state: branch as unknown as Record<string, unknown>,
        },
        db
      );
    });

    return branch;
  }

  public listBranches(providerId: string): ProviderBranchEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM provider_branches WHERE provider_id = ? ORDER BY created_at ASC;')
      .all(providerId) as unknown as ProviderBranchEntity[];
  }

  // =========================================================================
  // OPERATING HOURS & SCHEDULE EXCEPTIONS
  // =========================================================================

  public setOperatingHours(
    providerId: string,
    hours: CreateOperatingHoursInput[],
    branchId: string | null = null,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): ProviderOperatingHoursEntity[] {
    const db = getDatabase();

    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');
    }

    assertAuthorized(actor, CanonicalPermission.PROVIDER_HOURS_MANAGE, {
      organizationId: provider.organization_id,
    });

    const timeFormat = /^([01]\d|2[0-3]):([0-5]\d)$/;

    for (const h of hours) {
      if (h.day_of_week < 0 || h.day_of_week > 6) {
        throw new CanonicalAppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid day_of_week: ${h.day_of_week}. Must be 0 (Sunday) to 6 (Saturday).`
        );
      }
      if (!h.is_closed) {
        if (!timeFormat.test(h.opens_at) || !timeFormat.test(h.closes_at)) {
          throw new CanonicalAppError(
            ErrorCode.VALIDATION_ERROR,
            `Invalid time format: ${h.opens_at} - ${h.closes_at}. Must be HH:MM.`
          );
        }
      }
    }

    const now = getCurrentUtcIsoString();
    const results: ProviderOperatingHoursEntity[] = [];

    withTransaction(() => {
      // Clear existing schedule for provider & branch
      if (branchId) {
        db.prepare(
          'DELETE FROM provider_operating_hours WHERE provider_id = ? AND branch_id = ?;'
        ).run(providerId, branchId);
      } else {
        db.prepare(
          'DELETE FROM provider_operating_hours WHERE provider_id = ? AND branch_id IS NULL;'
        ).run(providerId);
      }

      const insertStmt = db.prepare(`
        INSERT INTO provider_operating_hours (
          id, provider_id, branch_id, day_of_week, opens_at, closes_at, timezone, is_closed, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);

      for (const h of hours) {
        const id = generateCanonicalId('poh');
        const entity: ProviderOperatingHoursEntity = {
          id,
          provider_id: providerId,
          branch_id: branchId,
          day_of_week: h.day_of_week,
          opens_at: h.opens_at,
          closes_at: h.closes_at,
          timezone: h.timezone || 'Africa/Nairobi',
          is_closed: Boolean(h.is_closed),
          created_at: now,
          updated_at: now,
        };
        insertStmt.run(
          entity.id,
          entity.provider_id,
          entity.branch_id ?? null,
          entity.day_of_week,
          entity.opens_at,
          entity.closes_at,
          entity.timezone,
          entity.is_closed ? 1 : 0,
          entity.created_at,
          entity.updated_at
        );
        results.push(entity);
      }

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: 'PROVIDER_HOURS_UPDATED',
          resource_type: 'provider_operating_hours',
          resource_id: providerId,
          correlation_id: correlationId,
          source: 'ProviderService',
          metadata: { branch_id: branchId, entries_count: hours.length },
        },
        db
      );
    });

    return results;
  }

  public addScheduleException(
    providerId: string,
    input: CreateScheduleExceptionInput,
    branchId: string | null = null,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): ProviderScheduleExceptionEntity {
    const db = getDatabase();

    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');
    }

    assertAuthorized(actor, CanonicalPermission.PROVIDER_HOURS_MANAGE, {
      organizationId: provider.organization_id,
    });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.exception_date)) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid exception date format: ${input.exception_date}. Must be YYYY-MM-DD.`
      );
    }

    const id = generateCanonicalId('pexc');
    const now = getCurrentUtcIsoString();

    const exception: ProviderScheduleExceptionEntity = {
      id,
      provider_id: providerId,
      branch_id: branchId,
      exception_date: input.exception_date,
      opens_at: input.opens_at || null,
      closes_at: input.closes_at || null,
      is_closed: Boolean(input.is_closed),
      reason: input.reason?.trim() || null,
      created_at: now,
    };

    db.prepare(`
      INSERT INTO provider_schedule_exceptions (
        id, provider_id, branch_id, exception_date, opens_at, closes_at, is_closed, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, branch_id, exception_date) DO UPDATE SET
        opens_at = excluded.opens_at,
        closes_at = excluded.closes_at,
        is_closed = excluded.is_closed,
        reason = excluded.reason;
    `).run(
      exception.id,
      exception.provider_id,
      exception.branch_id ?? null,
      exception.exception_date,
      exception.opens_at ?? null,
      exception.closes_at ?? null,
      exception.is_closed ? 1 : 0,
      exception.reason ?? null,
      exception.created_at
    );

    recordAuditEvent(
      {
        actor_id: actor.user_id,
        actor_type: 'USER',
        action: 'PROVIDER_SCHEDULE_EXCEPTION_ADDED',
        resource_type: 'provider_schedule_exception',
        resource_id: exception.id,
        correlation_id: correlationId,
        source: 'ProviderService',
        after_state: exception as unknown as Record<string, unknown>,
      },
      db
    );

    return exception;
  }

  // =========================================================================
  // SERVICE AREAS
  // =========================================================================

  public createServiceArea(
    providerId: string,
    input: CreateServiceAreaInput,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): ProviderServiceAreaEntity {
    const db = getDatabase();

    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');
    }

    assertAuthorized(actor, CanonicalPermission.PROVIDER_SERVICE_AREA_MANAGE, {
      organizationId: provider.organization_id,
    });

    if (input.area_type === 'RADIUS') {
      if (
        input.center_lat == null ||
        input.center_lng == null ||
        !isValidCoordinate(input.center_lat, input.center_lng)
      ) {
        throw new CanonicalAppError(
          ErrorCode.VALIDATION_ERROR,
          'Valid center_lat and center_lng required for RADIUS service area'
        );
      }
      if (input.radius_km == null || input.radius_km <= 0) {
        throw new CanonicalAppError(
          ErrorCode.VALIDATION_ERROR,
          'Positive radius_km required for RADIUS service area'
        );
      }
    } else if (input.area_type === 'POLYGON') {
      if (!input.polygon_coords || input.polygon_coords.length < 3) {
        throw new CanonicalAppError(
          ErrorCode.VALIDATION_ERROR,
          'Polygon requires at least 3 coordinate points'
        );
      }
    }

    const id = generateCanonicalId('prvsar');
    const now = getCurrentUtcIsoString();

    const area: ProviderServiceAreaEntity = {
      id,
      provider_id: providerId,
      branch_id: input.branch_id || null,
      name: input.name?.trim() || 'Default Service Area',
      area_type: input.area_type,
      center_lat: input.center_lat ?? null,
      center_lng: input.center_lng ?? null,
      radius_km: input.radius_km ?? null,
      polygon_json: input.polygon_coords ? JSON.stringify(input.polygon_coords) : null,
      country: input.country || 'KE',
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };

    db.prepare(`
      INSERT INTO provider_service_areas (
        id, provider_id, branch_id, name, area_type, center_lat, center_lng,
        radius_km, polygon_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      area.id,
      area.provider_id,
      area.branch_id,
      area.name,
      area.area_type,
      area.center_lat,
      area.center_lng,
      area.radius_km,
      area.polygon_json,
      area.status,
      area.created_at,
      area.updated_at
    );

    recordAuditEvent(
      {
        actor_id: actor.user_id,
        actor_type: 'USER',
        action: 'PROVIDER_SERVICE_AREA_CREATED',
        resource_type: 'provider_service_area',
        resource_id: area.id,
        correlation_id: correlationId,
        source: 'ProviderService',
        after_state: area as unknown as Record<string, unknown>,
      },
      db
    );

    return area;
  }

  public listServiceAreas(providerId: string): ProviderServiceAreaEntity[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM provider_service_areas WHERE provider_id = ? ORDER BY created_at ASC;')
      .all(providerId) as unknown as ProviderServiceAreaEntity[];
  }

  // =========================================================================
  // SERVICE CAPABILITIES & TAXONOMY
  // =========================================================================

  public getTaxonomyCategories(): Array<{
    id: string;
    code: string;
    name: string;
    parent_id: string | null;
    level: number;
    is_active: number;
  }> {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM service_categories WHERE is_active = 1 ORDER BY level ASC, name ASC;')
      .all() as Array<{
      id: string;
      code: string;
      name: string;
      parent_id: string | null;
      level: number;
      is_active: number;
    }>;
  }

  public addCapability(
    providerId: string,
    input: CreateCapabilityInput,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): ProviderCapabilityEntity {
    const db = getDatabase();

    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');
    }

    assertAuthorized(actor, CanonicalPermission.PROVIDER_SERVICES_MANAGE, {
      organizationId: provider.organization_id,
    });

    // Verify service category exists
    const cat = db
      .prepare('SELECT id FROM service_categories WHERE id = ?;')
      .get(input.service_category_id);
    if (!cat) {
      throw new CanonicalAppError(
        ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,
        `Service category ${input.service_category_id} does not exist`
      );
    }

    if (!Object.values(DeliveryMode).includes(input.delivery_mode)) {
      throw new CanonicalAppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid delivery mode: ${input.delivery_mode}`
      );
    }

    const id = generateCanonicalId('prvcap');
    const now = getCurrentUtcIsoString();

    const pricingType = (input.pricing_type || (input.pricing_model as any) || ServicePricingType.FREE_ESTIMATE) as ServicePricingType;
    const indicativePrice = input.indicative_price ?? input.base_price ?? null;

    const capability: ProviderCapabilityEntity = {
      id,
      provider_id: providerId,
      branch_id: input.branch_id || null,
      service_category_id: input.service_category_id,
      service_code: input.service_code || input.service_name?.toLowerCase().replace(/\s+/g, '_') || 'srv',
      service_name: input.service_name || 'Automotive Service',
      description: input.description?.trim() || null,
      delivery_mode: input.delivery_mode,
      pricing_type: pricingType,
      indicative_price: indicativePrice,
      currency: input.currency?.toUpperCase() || 'KES',
      status: 'ACTIVE',
      booking_enabled: input.booking_enabled !== false,
      roadside_eligible: Boolean(input.roadside_eligible),
      created_at: now,
      updated_at: now,
    };

    withTransaction(() => {
      db.prepare(`
        INSERT INTO provider_service_capabilities (
          id, provider_id, branch_id, service_category_id, service_code, service_name,
          description, delivery_mode, pricing_type, indicative_price, currency,
          status, booking_enabled, roadside_eligible, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        );
      `).run(
        capability.id,
        capability.provider_id,
        capability.branch_id,
        capability.service_category_id,
        capability.service_code,
        capability.service_name,
        capability.description,
        capability.delivery_mode,
        capability.pricing_type,
        capability.indicative_price,
        capability.currency,
        capability.status,
        capability.booking_enabled ? 1 : 0,
        capability.roadside_eligible ? 1 : 0,
        capability.created_at,
        capability.updated_at
      );

      updateProviderSearchProjection(providerId, db);

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: 'PROVIDER_CAPABILITY_ADDED',
          resource_type: 'provider_capability',
          resource_id: capability.id,
          correlation_id: correlationId,
          source: 'ProviderService',
          after_state: capability as unknown as Record<string, unknown>,
        },
        db
      );
    });

    return capability;
  }

  public listCapabilities(providerId: string) {
    const db = getDatabase();
    return db
      .prepare(`
        SELECT psc.*, sc.code as category_code, sc.name as category_name
        FROM provider_service_capabilities psc
        JOIN service_categories sc ON psc.service_category_id = sc.id
        WHERE psc.provider_id = ?
        ORDER BY psc.status ASC, sc.name ASC;
      `)
      .all(providerId);
  }

  public removeCapability(
    providerId: string,
    capabilityId: string,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): void {
    const db = getDatabase();

    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');
    }

    assertAuthorized(actor, CanonicalPermission.PROVIDER_SERVICES_MANAGE, {
      organizationId: provider.organization_id,
    });

    withTransaction(() => {
      db.prepare(
        'DELETE FROM provider_service_capabilities WHERE id = ? AND provider_id = ?;'
      ).run(capabilityId, providerId);

      updateProviderSearchProjection(providerId, db);

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: 'PROVIDER_CAPABILITY_REMOVED',
          resource_type: 'provider_capability',
          resource_id: capabilityId,
          correlation_id: correlationId,
          source: 'ProviderService',
        },
        db
      );
    });
  }

  // =========================================================================
  // SUPPORTED MAKES & CLASSES
  // =========================================================================

  public setSupportedMakes(
    providerId: string,
    makes: string[],
    actor: AuthenticatedActorContext
  ): void {
    const db = getDatabase();
    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');

    assertAuthorized(actor, CanonicalPermission.PROVIDER_SERVICES_MANAGE, {
      organizationId: provider.organization_id,
    });

    const now = getCurrentUtcIsoString();

    withTransaction(() => {
      db.prepare('DELETE FROM provider_vehicle_make_support WHERE provider_id = ?;').run(
        providerId
      );
      const insert = db.prepare(`
        INSERT INTO provider_vehicle_make_support (id, provider_id, make_name, created_at)
        VALUES (?, ?, ?, ?);
      `);
      for (const m of makes) {
        if (m && m.trim().length > 0) {
          insert.run(generateCanonicalId('pvms'), providerId, m.trim().toUpperCase(), now);
        }
      }
      updateProviderSearchProjection(providerId, db);
    });
  }

  public setSupportedClasses(
    providerId: string,
    classes: VehicleClass[],
    actor: AuthenticatedActorContext
  ): void {
    const db = getDatabase();
    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');

    assertAuthorized(actor, CanonicalPermission.PROVIDER_SERVICES_MANAGE, {
      organizationId: provider.organization_id,
    });

    const now = getCurrentUtcIsoString();

    withTransaction(() => {
      db.prepare('DELETE FROM provider_vehicle_class_support WHERE provider_id = ?;').run(
        providerId
      );
      const insert = db.prepare(`
        INSERT INTO provider_vehicle_class_support (id, provider_id, vehicle_class, created_at)
        VALUES (?, ?, ?, ?);
      `);
      for (const c of classes) {
        insert.run(generateCanonicalId('pvcs'), providerId, c, now);
      }
      updateProviderSearchProjection(providerId, db);
    });
  }

  // =========================================================================
  // STAFF (Reusing Sprint 2 Memberships)
  // =========================================================================

  public assignStaff(
    providerId: string,
    input: AssignStaffInput,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): ProviderStaffEntity {
    const db = getDatabase();

    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');
    }

    assertAuthorized(actor, CanonicalPermission.PROVIDER_STAFF_MANAGE, {
      organizationId: provider.organization_id,
    });

    // Crucial: Validate membership exists in the same organization (GAR-011 §11/§14)
    const membershipId = input.membership_id || input.organization_membership_id || '';
    if (!membershipId) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'Membership ID is required');
    }

    const membership = db
      .prepare('SELECT id, user_id, organization_id, role, status FROM organization_memberships WHERE id = ?;')
      .get(membershipId) as {
      id: string;
      user_id: string;
      organization_id: string;
      role: string;
      status: string;
    } | undefined;

    if (!membership) {
      throw new CanonicalAppError(
        ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,
        'Organization membership record not found'
      );
    }

    if (membership.organization_id !== provider.organization_id) {
      throw new CanonicalAppError(
        ErrorCode.NOT_AUTHORIZED,
        'Forbidden: Cannot assign staff from a different organization'
      );
    }

    if (membership.status !== 'ACTIVE') {
      throw new CanonicalAppError(
        ErrorCode.INVALID_STATE,
        `Cannot assign staff member with status: ${membership.status}`
      );
    }

    const branchIds = input.branch_ids || (input.branch_id ? [input.branch_id] : []);
    for (const bId of branchIds) {
      const branch = db
        .prepare('SELECT id FROM provider_branches WHERE id = ? AND provider_id = ?;')
        .get(bId, providerId);
      if (!branch) {
        throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, `Branch ${bId} not found for this provider`);
      }
    }

    const id = generateCanonicalId('prvstf');
    const now = getCurrentUtcIsoString();

    const professionalRole = input.professional_role || StaffProfessionalRole.MECHANIC;
    const jobTitle = input.job_title || 'Automotive Technician';

    const staff: ProviderStaffEntity = {
      id,
      provider_id: providerId,
      membership_id: membershipId,
      organization_membership_id: membershipId,
      job_title: jobTitle,
      professional_role: professionalRole,
      status: StaffStatus.ACTIVE,
      branch_id: branchIds[0] || null,
      specialization: input.specialization?.trim() || null,
      certifications: typeof input.certifications === 'string' ? input.certifications : input.certifications ? JSON.stringify(input.certifications) : null,
      years_experience: input.years_experience ?? null,
      created_at: now,
      updated_at: now,
    };

    withTransaction(() => {
      db.prepare(`
        INSERT INTO provider_staff_profiles (
          id, provider_id, membership_id, job_title, professional_role, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(membership_id) DO UPDATE SET
          job_title = excluded.job_title,
          professional_role = excluded.professional_role,
          status = 'ACTIVE',
          updated_at = excluded.updated_at;
      `).run(
        staff.id,
        staff.provider_id,
        staff.membership_id,
        staff.job_title,
        staff.professional_role,
        staff.status,
        staff.created_at,
        staff.updated_at
      );

      // Handle branch assignments
      if (branchIds.length > 0) {
        db.prepare('DELETE FROM provider_staff_branch_assignments WHERE staff_profile_id = ?;').run(staff.id);
        const assignBranchStmt = db.prepare(`
          INSERT INTO provider_staff_branch_assignments (id, staff_profile_id, branch_id, is_primary, created_at)
          VALUES (?, ?, ?, ?, ?);
        `);
        branchIds.forEach((bId, idx) => {
          assignBranchStmt.run(generateCanonicalId('stfbrn'), staff.id, bId, idx === 0 ? 1 : 0, now);
        });
      }

      // Handle skills if provided
      if (input.skills && input.skills.length > 0) {
        db.prepare('DELETE FROM technician_skills WHERE staff_profile_id = ?;').run(staff.id);
        const insertSkillStmt = db.prepare(`
          INSERT INTO technician_skills (id, staff_profile_id, skill_name, proficiency_level, created_at)
          VALUES (?, ?, ?, ?, ?);
        `);
        for (const sk of input.skills) {
          insertSkillStmt.run(generateCanonicalId('tskill'), staff.id, sk.skill_name, sk.proficiency_level, now);
        }
      }

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: 'PROVIDER_STAFF_ASSIGNED',
          resource_type: 'provider_staff_profile',
          resource_id: staff.id,
          correlation_id: correlationId,
          source: 'ProviderService',
          metadata: {
            membership_id: membershipId,
            user_id: membership.user_id,
          },
        },
        db
      );
    });

    return staff;
  }

  public listStaff(providerId: string, actor: AuthenticatedActorContext) {
    const db = getDatabase();
    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');

    assertAuthorized(actor, CanonicalPermission.PROVIDER_STAFF_READ, {
      organizationId: provider.organization_id,
    });

    return db
      .prepare(`
        SELECT
          psp.*,
          om.role as organization_role,
          om.status as membership_status,
          u.name as user_name,
          u.email as user_email,
          pb.name as branch_name
        FROM provider_staff_profiles psp
        JOIN organization_memberships om ON psp.organization_membership_id = om.id
        JOIN users u ON om.user_id = u.id
        LEFT JOIN provider_branches pb ON psp.branch_id = pb.id
        WHERE psp.provider_id = ?
        ORDER BY psp.status ASC, u.name ASC;
      `)
      .all(providerId);
  }

  // =========================================================================
  // VERIFICATION WORKFLOW
  // =========================================================================

  public submitVerificationDocument(
    providerId: string,
    input: SubmitVerificationDocumentInput,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): ProviderVerificationDocumentEntity {
    const db = getDatabase();

    const provider = db
      .prepare('SELECT organization_id, verification_status FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string; verification_status: string } | undefined;

    if (!provider) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');

    assertAuthorized(actor, CanonicalPermission.PROVIDER_VERIFICATION_SUBMIT, {
      organizationId: provider.organization_id,
    });

    const id = generateCanonicalId('prvdoc');
    const now = getCurrentUtcIsoString();

    const doc: ProviderVerificationDocumentEntity = {
      id,
      provider_id: providerId,
      document_type: input.document_type,
      document_number: input.document_number?.trim() || null,
      file_key: input.file_key.trim(),
      file_name: input.file_name?.trim() || null,
      status: 'PENDING',
      rejection_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: now,
      updated_at: now,
    };

    withTransaction(() => {
      db.prepare(`
        INSERT INTO provider_verification_documents (
          id, provider_id, document_type, document_number, file_key, file_name,
          status, rejection_reason, reviewed_by, reviewed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `).run(
        doc.id,
        doc.provider_id,
        doc.document_type,
        doc.document_number,
        doc.file_key,
        doc.file_name,
        doc.status,
        doc.rejection_reason,
        doc.reviewed_by,
        doc.reviewed_at,
        doc.created_at,
        doc.updated_at
      );

      // If currently unverified or rejected, switch provider to PENDING review
      if (
        provider.verification_status === ProviderVerificationStatus.UNVERIFIED ||
        provider.verification_status === ProviderVerificationStatus.REJECTED
      ) {
        db.prepare(`
          UPDATE service_providers
          SET verification_status = 'PENDING', updated_at = ?
          WHERE id = ?;
        `).run(now, providerId);
      }

      updateProviderSearchProjection(providerId, db);

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: 'PROVIDER_VERIFICATION_DOCUMENT_SUBMITTED',
          resource_type: 'provider_verification_document',
          resource_id: doc.id,
          correlation_id: correlationId,
          source: 'ProviderService',
          metadata: { document_type: input.document_type },
        },
        db
      );
    });

    return doc;
  }

  public listVerificationDocuments(
    providerId: string,
    actor: AuthenticatedActorContext
  ): ProviderVerificationDocumentEntity[] {
    const db = getDatabase();
    const provider = db
      .prepare('SELECT organization_id FROM service_providers WHERE id = ?;')
      .get(providerId) as { organization_id: string } | undefined;

    if (!provider) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Provider not found');

    // Rule: Do not expose verification documents publicly (GAR-011 §15)
    // Only platform admin or member of same organization can view verification docs
    const isPlatformPrivileged =
      actor.platform_roles?.includes('PLATFORM_ADMIN' as any) ||
      actor.platform_roles?.includes('TRUST_AND_SAFETY' as any);

    const isOrgMember = actor.memberships?.some(
      (m) => m.organization_id === provider.organization_id
    );

    if (!isPlatformPrivileged && !isOrgMember) {
      throw new CanonicalAppError(
        ErrorCode.NOT_AUTHORIZED,
        'Verification documents are confidential and accessible only to authorized personnel'
      );
    }

    return db
      .prepare(
        'SELECT * FROM provider_verification_documents WHERE provider_id = ? ORDER BY created_at DESC;'
      )
      .all(providerId) as unknown as ProviderVerificationDocumentEntity[];
  }

  public reviewVerification(
    providerId: string,
    input: ReviewVerificationInput,
    actor: AuthenticatedActorContext,
    correlationId: string = generateCanonicalId('corr')
  ): void {
    const db = getDatabase();

    // Requires platform-level permission
    assertAuthorized(actor, CanonicalPermission.ADMIN_PROVIDER_VERIFY);

    const doc = db
      .prepare('SELECT * FROM provider_verification_documents WHERE id = ? AND provider_id = ?;')
      .get(input.document_id, providerId) as unknown as ProviderVerificationDocumentEntity | undefined;

    if (!doc) {
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE, 'Verification document not found');
    }

    const now = getCurrentUtcIsoString();

    withTransaction(() => {
      // 1. Update document
      db.prepare(`
        UPDATE provider_verification_documents
        SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ?;
      `).run(
        input.status,
        input.notes?.trim() || null,
        actor.user_id,
        now,
        now,
        input.document_id
      );

      // 2. Insert into verification history
      db.prepare(`
        INSERT INTO provider_verification_history (
          id, provider_id, document_id, action, reviewed_by, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?);
      `).run(
        generateCanonicalId('pvh'),
        providerId,
        input.document_id,
        input.status,
        actor.user_id,
        input.notes?.trim() || null,
        now
      );

      // 3. Determine if provider verification status should transition
      // If rejected, provider becomes REJECTED
      if (input.status === 'REJECTED') {
        db.prepare(`
          UPDATE service_providers
          SET verification_status = 'REJECTED', updated_at = ?
          WHERE id = ?;
        `).run(now, providerId);
      } else if (input.status === 'VERIFIED') {
        // If at least one verified document and none currently pending or rejected
        const pendingCountRow = db
          .prepare(
            "SELECT COUNT(*) as count FROM provider_verification_documents WHERE provider_id = ? AND status = 'PENDING';"
          )
          .get(providerId) as { count: number };

        if (pendingCountRow.count === 0) {
          db.prepare(`
            UPDATE service_providers
            SET verification_status = 'VERIFIED', verified_at = ?, verified_by = ?, updated_at = ?
            WHERE id = ?;
          `).run(now, actor.user_id, now, providerId);
        }
      }

      updateProviderSearchProjection(providerId, db);

      recordAuditEvent(
        {
          actor_id: actor.user_id,
          actor_type: 'USER',
          action: 'PROVIDER_VERIFICATION_REVIEWED',
          resource_type: 'provider_verification_document',
          resource_id: input.document_id,
          correlation_id: correlationId,
          source: 'ProviderService',
          metadata: { status: input.status, provider_id: providerId },
        },
        db
      );
    });
  }

  // =========================================================================
  // SEARCH & DISCOVERY (High Performance)
  // =========================================================================

  public searchProviders(criteria: ProviderSearchCriteria): ProviderSearchResponse {
    const db = getDatabase();

    const limit = Math.min(Math.max(criteria.limit || 20, 1), 100);
    const offset = Math.max(criteria.offset || 0, 0);

    const keyword = criteria.query || criteria.keyword;
    const category = criteria.category || criteria.service_category;
    const make = criteria.make || criteria.vehicle_make;
    const latitude = criteria.latitude ?? criteria.near_lat;
    const longitude = criteria.longitude ?? criteria.near_lng;
    const openNow = criteria.open_now ?? criteria.is_open_now;

    const conditions: string[] = ['is_discoverable = 1'];
    const params: (string | number)[] = [];

    // Filter by Provider Type
    if (criteria.provider_type) {
      conditions.push('provider_type = ?');
      params.push(criteria.provider_type);
    }

    // Filter by Verification Status
    if (criteria.verified_only) {
      conditions.push("verification_status = 'VERIFIED'");
    } else if (criteria.verification_status) {
      conditions.push('verification_status = ?');
      params.push(criteria.verification_status);
    }

    // Filter by Mobile / Roadside / Towing acceptance
    if (criteria.accepts_mobile) {
      conditions.push('accepts_mobile = 1');
    }
    if (criteria.accepts_roadside) {
      conditions.push('accepts_roadside = 1');
    }
    if (criteria.accepts_towing) {
      conditions.push('accepts_towing = 1');
    }

    // Keyword Search
    if (keyword && keyword.trim().length > 0) {
      conditions.push('(display_name LIKE ? OR city LIKE ? OR county_state LIKE ?)');
      const term = `%${keyword.trim()}%`;
      params.push(term, term, term);
    }

    // Category Filter (JSON array search)
    if (category) {
      conditions.push('service_categories LIKE ?');
      params.push(`%"${category}"%`);
    }

    // Delivery Mode Filter
    if (criteria.delivery_mode) {
      conditions.push('delivery_modes LIKE ?');
      params.push(`%"${criteria.delivery_mode}"%`);
    }

    // Vehicle Make Support
    if (make) {
      conditions.push('(supported_makes LIKE ? OR supported_makes = "[]")');
      params.push(`%"${make.toUpperCase()}"%`);
    }

    // Vehicle Class Support
    if (criteria.vehicle_class) {
      conditions.push('(supported_classes LIKE ? OR supported_classes = "[]")');
      params.push(`%"${criteria.vehicle_class}"%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch candidate rows
    const query = `
      SELECT provider_id, display_name, provider_type, status, verification_status,
             latitude, longitude, city, county_state, service_categories, delivery_modes,
             supported_makes, supported_classes, service_radius_km, accepts_mobile,
             accepts_roadside, accepts_towing
      FROM provider_search_projection
      ${whereClause};
    `;

    const candidates = db.prepare(query).all(...params) as Array<{
      provider_id: string;
      display_name: string;
      provider_type: ProviderType;
      status: ProviderStatus;
      verification_status: ProviderVerificationStatus;
      latitude: number | null;
      longitude: number | null;
      city: string | null;
      county_state: string | null;
      service_categories: string;
      delivery_modes: string;
      supported_makes: string;
      supported_classes: string;
      service_radius_km: number | null;
      accepts_mobile: number;
      accepts_roadside: number;
      accepts_towing: number;
    }>;

    // Post-process candidates: distance filtering and operating state
    let results: ProviderSearchResultItem[] = [];

    const hasGeoCoords =
      latitude != null &&
      longitude != null &&
      isValidCoordinate(latitude, longitude);

    const searchRadiusKm = criteria.radius_km || 50;

    for (const row of candidates) {
      let distanceKm: number | null = null;

      if (hasGeoCoords && row.latitude != null && row.longitude != null) {
        distanceKm = haversineDistanceKm(
          latitude!,
          longitude!,
          row.latitude,
          row.longitude
        );

        // Filter out if beyond specified search radius
        if (distanceKm > searchRadiusKm) {
          continue;
        }
      }

      // Compute live operating state
      const hours = db
        .prepare(
          'SELECT * FROM provider_operating_hours WHERE provider_id = ? AND branch_id IS NULL;'
        )
        .all(row.provider_id) as unknown as ProviderOperatingHoursEntity[];

      const exceptions = db
        .prepare(
          'SELECT * FROM provider_schedule_exceptions WHERE provider_id = ? AND branch_id IS NULL;'
        )
        .all(row.provider_id) as unknown as ProviderScheduleExceptionEntity[];

      const opEvaluation = computeOperatingState(hours, exceptions, 'Africa/Nairobi');

      if (openNow && opEvaluation.state !== OperatingState.OPEN) {
        continue;
      }

      results.push({
        id: row.provider_id,
        name: row.display_name,
        legal_business_name: null,
        provider_type: row.provider_type as ProviderType,
        status: row.status as ProviderStatus,
        verification_status: row.verification_status as ProviderVerificationStatus,
        primary_location: row.latitude && row.longitude ? {
          id: '',
          name: row.city || '',
          city: row.city || '',
          county_state: row.county_state || '',
          latitude: row.latitude,
          longitude: row.longitude,
          address_line1: '',
        } : null,
        distance_km: distanceKm,
        operating_state: opEvaluation.state,
        service_categories: JSON.parse(row.service_categories || '[]'),
        delivery_modes: JSON.parse(row.delivery_modes || '[]'),
        supported_makes: JSON.parse(row.supported_makes || '[]'),
        supported_classes: JSON.parse(row.supported_classes || '[]'),
        accepts_bookings: true,
        accepts_mobile_jobs: row.accepts_mobile === 1,
        accepts_roadside_jobs: row.accepts_roadside === 1,
        accepts_towing_jobs: row.accepts_towing === 1,
        callout_fee: null,
        currency: 'KES',
      });
    }

    // Sort results: If geospatial search, sort ascending by distance; else sort by display_name
    if (hasGeoCoords) {
      results.sort((a, b) => {
        if (a.distance_km == null) return 1;
        if (b.distance_km == null) return -1;
        return a.distance_km - b.distance_km;
      });
    } else {
      results.sort((a, b) => a.name.localeCompare(b.name));
    }

    const total = results.length;
    const paginated = results.slice(offset, offset + limit);

    return {
      items: paginated,
      total,
      limit,
      offset,
    };
  }
}

export const providerService = new ProviderService();
