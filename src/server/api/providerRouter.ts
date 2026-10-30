/**
 * Service Provider Network API Router (GAR-011, GAR-034)
 *
 * Exposes endpoints for:
 * - Public & authenticated provider discovery and geospatial search
 * - Provider organization profile & operating lifecycle
 * - Multi-branch and workshop locations management
 * - Taxonomy-backed capability catalogue and pricing
 * - Operating hours, exception dates & live operating status
 * - Service area geofences (radius & polygon)
 * - Supported vehicle makes and body/weight classes
 * - Organization membership-linked staff roster
 * - Multi-tier verification submission and platform review
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { providerService } from '../providers/providerService';
import { rebuildAllProviderSearchProjections } from '../providers/searchProjection';
import {
  CreateBranchInput,
  CreateCapabilityInput,
  CreateLocationInput,
  CreateOperatingHoursInput,
  CreateProviderInput,
  CreateScheduleExceptionInput,
  CreateServiceAreaInput,
  AssignStaffInput,
  DeliveryMode,
  ProviderSearchCriteria,
  ProviderStatus,
  ProviderType,
  ProviderVerificationStatus,
  ReviewVerificationInput,
  SubmitVerificationDocumentInput,
  UpdateProviderInput,
  VehicleClass,
} from '../providers/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';

export const providerRouter = Router();

// Middleware: Authenticate actor context (populates req.actor)
providerRouter.use(authenticate({ optional: true }));

function getActor(req: Request) {
  if (!req.actor) {
    throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Authentication required', 401);
  }
  return req.actor;
}

// ==================== 1. DISCOVERY & SEARCH ====================

/**
 * GET /api/v1/providers/search
 * High-performance geospatial and attribute-based provider discovery
 */
providerRouter.get('/providers/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const criteria: ProviderSearchCriteria = {
      keyword: req.query.q as string | undefined,
      provider_type: req.query.provider_type as ProviderType | undefined,
      service_category: req.query.service_category as string | undefined,
      delivery_mode: req.query.delivery_mode as DeliveryMode | undefined,
      vehicle_make: req.query.vehicle_make as string | undefined,
      vehicle_class: req.query.vehicle_class as VehicleClass | undefined,
      verification_status: req.query.verification_status as ProviderVerificationStatus | undefined,
      near_lat: req.query.lat ? parseFloat(req.query.lat as string) : undefined,
      near_lng: req.query.lng ? parseFloat(req.query.lng as string) : undefined,
      radius_km: req.query.radius_km ? parseFloat(req.query.radius_km as string) : undefined,
      is_open_now: req.query.is_open_now === 'true',
      accepts_mobile: req.query.accepts_mobile === 'true',
      accepts_roadside: req.query.accepts_roadside === 'true',
      accepts_towing: req.query.accepts_towing === 'true',
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    const results = providerService.searchProviders(criteria);
    res.json(results);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/providers/taxonomy
 * Canonical service taxonomy categories
 */
providerRouter.get('/providers/taxonomy', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = providerService.getTaxonomyCategories();
    res.json({ categories });
  } catch (error) {
    next(error);
  }
});

// ==================== 2. PROVIDER PROFILES ====================

/**
 * POST /api/v1/providers
 * Onboard a service provider profile linked to an organization
 */
providerRouter.post('/providers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const body = req.body as CreateProviderInput;

    const provider = providerService.createProvider(body, actor, correlationId);
    res.status(201).json({ provider });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/providers/:id
 * Retrieve provider details, locations, branches, capabilities and live operating state
 */
providerRouter.get('/providers/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const providerId = req.params.id;
    const details = providerService.getProviderById(providerId, req.actor);
    res.json(details);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/v1/providers/:id
 * Update provider profile attributes
 */
providerRouter.patch('/providers/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const body = req.body as UpdateProviderInput;

    const updated = providerService.updateProvider(providerId, body, actor, correlationId);
    res.json({ provider: updated });
  } catch (error) {
    next(error);
  }
});

// ==================== 3. LOCATIONS ====================

/**
 * POST /api/v1/providers/:id/locations
 * Add physical location / workshop address
 */
providerRouter.post('/providers/:id/locations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const body = req.body as CreateLocationInput;

    const location = providerService.createLocation(providerId, body, actor, correlationId);
    res.status(201).json({ location });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/providers/:id/locations
 * List physical locations for a provider
 */
providerRouter.get('/providers/:id/locations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const providerId = req.params.id;
    const locations = providerService.listLocations(providerId);
    res.json({ locations });
  } catch (error) {
    next(error);
  }
});

// ==================== 4. BRANCHES ====================

/**
 * POST /api/v1/providers/:id/branches
 * Add an operational branch
 */
providerRouter.post('/providers/:id/branches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const body = req.body as CreateBranchInput;

    const branch = providerService.createBranch(providerId, body, actor, correlationId);
    res.status(201).json({ branch });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/providers/:id/branches
 * List branches
 */
providerRouter.get('/providers/:id/branches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const providerId = req.params.id;
    const branches = providerService.listBranches(providerId);
    res.json({ branches });
  } catch (error) {
    next(error);
  }
});

// ==================== 5. OPERATING HOURS & SCHEDULE EXCEPTIONS ====================

/**
 * POST /api/v1/providers/:id/operating-hours
 * Configure weekly operating schedule
 */
providerRouter.post('/providers/:id/operating-hours', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const branchId = req.query.branch_id as string | undefined;
    const body = req.body as { hours: CreateOperatingHoursInput[] };

    if (!Array.isArray(body.hours)) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'hours array is required');
    }

    const saved = providerService.setOperatingHours(
      providerId,
      body.hours,
      branchId || null,
      actor,
      correlationId
    );
    res.json({ operating_hours: saved });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/providers/:id/schedule-exceptions
 * Add holiday / special hours override
 */
providerRouter.post('/providers/:id/schedule-exceptions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const branchId = req.query.branch_id as string | undefined;
    const body = req.body as CreateScheduleExceptionInput;

    const exception = providerService.addScheduleException(
      providerId,
      body,
      branchId || null,
      actor,
      correlationId
    );
    res.status(201).json({ exception });
  } catch (error) {
    next(error);
  }
});

// ==================== 6. SERVICE AREAS ====================

/**
 * POST /api/v1/providers/:id/service-areas
 * Create radial or polygonal service area geofence
 */
providerRouter.post('/providers/:id/service-areas', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const body = req.body as CreateServiceAreaInput;

    const area = providerService.createServiceArea(providerId, body, actor, correlationId);
    res.status(201).json({ service_area: area });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/providers/:id/service-areas
 * List service areas
 */
providerRouter.get('/providers/:id/service-areas', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const providerId = req.params.id;
    const areas = providerService.listServiceAreas(providerId);
    res.json({ service_areas: areas });
  } catch (error) {
    next(error);
  }
});

// ==================== 7. SERVICE CAPABILITIES ====================

/**
 * POST /api/v1/providers/:id/capabilities
 * Register a service offering backed by canonical taxonomy
 */
providerRouter.post('/providers/:id/capabilities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const body = req.body as CreateCapabilityInput;

    const capability = providerService.addCapability(providerId, body, actor, correlationId);
    res.status(201).json({ capability });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/providers/:id/capabilities
 * List capabilities
 */
providerRouter.get('/providers/:id/capabilities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const providerId = req.params.id;
    const capabilities = providerService.listCapabilities(providerId);
    res.json({ capabilities });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/v1/providers/:id/capabilities/:capabilityId
 * Remove capability
 */
providerRouter.delete('/providers/:id/capabilities/:capabilityId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const { id: providerId, capabilityId } = req.params;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;

    providerService.removeCapability(providerId, capabilityId, actor, correlationId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// ==================== 8. VEHICLE MAKE & CLASS SUPPORT ====================

/**
 * PUT /api/v1/providers/:id/supported-makes
 * Set vehicle makes supported
 */
providerRouter.put('/providers/:id/supported-makes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const body = req.body as { makes: string[] };

    if (!Array.isArray(body.makes)) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'makes must be an array of strings');
    }

    providerService.setSupportedMakes(providerId, body.makes, actor);
    res.json({ success: true, count: body.makes.length });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/v1/providers/:id/supported-classes
 * Set vehicle classes supported
 */
providerRouter.put('/providers/:id/supported-classes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const body = req.body as { classes: VehicleClass[] };

    if (!Array.isArray(body.classes)) {
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR, 'classes must be an array');
    }

    providerService.setSupportedClasses(providerId, body.classes, actor);
    res.json({ success: true, count: body.classes.length });
  } catch (error) {
    next(error);
  }
});

// ==================== 9. STAFF MANAGEMENT ====================

/**
 * POST /api/v1/providers/:id/staff
 * Assign an organization member to provider staff profile
 */
providerRouter.post('/providers/:id/staff', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const body = req.body as AssignStaffInput;

    const staff = providerService.assignStaff(providerId, body, actor, correlationId);
    res.status(201).json({ staff });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/providers/:id/staff
 * List provider staff
 */
providerRouter.get('/providers/:id/staff', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const staff = providerService.listStaff(providerId, actor);
    res.json({ staff });
  } catch (error) {
    next(error);
  }
});

// ==================== 10. VERIFICATION WORKFLOW ====================

/**
 * POST /api/v1/providers/:id/verification/documents
 * Submit verification document (license, certificate, tax, insurance)
 */
providerRouter.post('/providers/:id/verification/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const body = req.body as SubmitVerificationDocumentInput;

    const doc = providerService.submitVerificationDocument(providerId, body, actor, correlationId);
    res.status(201).json({ document: doc });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/providers/:id/verification/documents
 * List submitted verification documents (confidential - requires privileges)
 */
providerRouter.get('/providers/:id/verification/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const documents = providerService.listVerificationDocuments(providerId, actor);
    res.json({ documents });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/providers/:id/verification/review
 * Review verification document (Platform Admin / Trust & Safety)
 */
providerRouter.post('/providers/:id/verification/review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const providerId = req.params.id;
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    const body = req.body as ReviewVerificationInput;

    providerService.reviewVerification(providerId, body, actor, correlationId);
    res.json({ success: true, message: `Document ${body.document_id} reviewed as ${body.status}` });
  } catch (error) {
    next(error);
  }
});

// ==================== 11. PROJECTION ADMIN ====================

/**
 * POST /api/v1/providers/projection/rebuild
 * Idempotently rebuilds the entire search projection read model (Platform Admin)
 */
providerRouter.post('/providers/projection/rebuild', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    assertAuthorized(actor, CanonicalPermission.ADMIN_PLATFORM_MANAGE);

    const count = rebuildAllProviderSearchProjections();
    res.json({ success: true, projections_rebuilt: count });
  } catch (error) {
    next(error);
  }
});
