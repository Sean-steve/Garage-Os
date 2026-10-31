/**
 * Canonical Vehicle Components, Tyres & Configuration API Router (GAR-010, GAR-034)
 *
 * Exposes endpoints for:
 * - Physical vehicle components lifecycle (install, replace, remove, history)
 * - Vehicle tyres management (install, position mapping, atomic rotation, replacement, inspection)
 * - Vehicle configuration & modifications (factory vs current, overrides)
 * - Component warranties and parts catalog
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { vehicleComponentService } from '../components/componentService';
import { vehicleTyreService } from '../components/tyreService';
import { componentRepository } from '../components/componentRepository';
import {
  ComponentCategory,
  ComponentClassification,
  ComponentStatus,
  InstallComponentInput,
  InstallTyreInput,
  PartProvenance,
  PartVerificationStatus,
  RecordModificationInput,
  RemovalReason,
  ReplaceComponentInput,
  ReplaceTyreInput,
  RotateTyresInput,
  InspectTyreInput,
  TyreConditionRating,
  TyrePosition,
  TyreRotationPattern,
  WarrantyType,
  WarrantyStatus,
} from '../components/types';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import crypto from 'node:crypto';

export const componentRouter = Router();

// Middleware: Authenticate actor context (populates req.actor)
componentRouter.use(authenticate());

function getActor(req: Request) {
  if (!req.actor) {
    throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED, 'Authentication required', 401);
  }
  return req.actor;
}

// ==================== 1. COMPONENT LIFECYCLE ENDPOINTS ====================

/**
 * GET /api/v1/vehicles/:id/components
 * Lists installed and historical components for a vehicle
 */
componentRouter.get('/vehicles/:id/components', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const isCurrentOnly = req.query.is_current === 'true' || req.query.current_only === 'true';
    const category = req.query.category as ComponentCategory | undefined;
    const status = req.query.status as ComponentStatus | undefined;

    const components = vehicleComponentService.listComponents(actor, vehicleId, {
      isCurrentOnly: isCurrentOnly || undefined,
      category,
      status,
    });

    res.json({
      success: true,
      data: components,
      meta: {
        total: components.length,
        is_current_only: isCurrentOnly,
        category: category || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:id/components
 * Installs a physical component on a vehicle
 */
componentRouter.post('/vehicles/:id/components', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const b = req.body;

    const input: InstallComponentInput = {
      vehicle_id: vehicleId,
      component_definition_id: b.component_definition_id,
      category: b.category || ComponentCategory.OTHER,
      classification: b.classification || ComponentClassification.DURABLE_COMPONENT,
      custom_name: b.custom_name || b.name,
      part_id: b.part_id || b.part_reference_id,
      brand: b.brand,
      part_number: b.part_number,
      oem_number: b.oem_number,
      position: b.position,
      serial_number: b.serial_number,
      installed_at: b.installed_at,
      installed_odometer_km: b.installed_odometer_km !== undefined ? Number(b.installed_odometer_km) : undefined,
      installed_odometer_unit: b.installed_odometer_unit,
      installation_source: b.installation_source || PartProvenance.OWNER_ENTERED,
      installation_provider_id: b.provider_id,
      installation_provider_name: b.provider_name,
      installation_work_order_id: b.work_order_id,
      verification_status: b.verification_status || PartVerificationStatus.OWNER_ASSERTED,
      maintenance_completion_id: b.maintenance_completion_id,
      issue_intervention_id: b.issue_intervention_id,
      vehicle_expense_id: b.vehicle_expense_id,
      warranty: b.warranty ? {
        warranty_type: b.warranty.warranty_type || WarrantyType.MANUFACTURER,
        starts_at: b.warranty.starts_at,
        expires_at: b.warranty.expires_at,
        distance_limit_km: b.warranty.distance_limit_km !== undefined ? Number(b.warranty.distance_limit_km) : undefined,
        terms_summary: b.warranty.terms_summary || 'Standard warranty terms',
        provider_name: b.warranty.provider_name || b.provider_name,
      } : undefined,
    };

    const result = vehicleComponentService.installComponent(actor, input);

    res.status(201).json({
      success: true,
      data: result.component,
      warranty: result.warranty || null,
      message: 'Vehicle component installed successfully',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/vehicles/:id/components/:componentId
 * Retrieves single component details with warranties and event trail
 */
componentRouter.get('/vehicles/:id/components/:componentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const componentId = req.params.componentId;

    const result = vehicleComponentService.getComponent(actor, componentId);

    res.json({
      success: true,
      data: result.component,
      warranties: result.warranties,
      events: result.events,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:id/components/:componentId/replace
 * Atomically replaces an installed component with a new one
 */
componentRouter.post('/vehicles/:id/components/:componentId/replace', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const componentId = req.params.componentId;
    const b = req.body;

    const input: ReplaceComponentInput = {
      old_component_id: componentId,
      new_component: {
        vehicle_id: vehicleId,
        category: b.new_component?.category || b.category,
        custom_name: b.new_component?.custom_name || b.new_component?.name || b.custom_name || b.name,
        classification: b.new_component?.classification || b.classification || ComponentClassification.DURABLE_COMPONENT,
        brand: b.new_component?.brand || b.brand,
        part_number: b.new_component?.part_number || b.part_number,
        oem_number: b.new_component?.oem_number || b.oem_number,
        position: b.new_component?.position || b.position,
        serial_number: b.new_component?.serial_number || b.serial_number,
        installed_at: b.replaced_at || b.new_component?.installed_at,
        installed_odometer_km: b.odometer_km !== undefined ? Number(b.odometer_km) : (b.new_component?.installed_odometer_km !== undefined ? Number(b.new_component.installed_odometer_km) : undefined),
        installation_source: b.new_component?.installation_source || PartProvenance.GARAGE_RECORDED,
        installation_provider_id: b.new_component?.provider_id || b.provider_id,
        installation_provider_name: b.new_component?.provider_name || b.provider_name,
        installation_work_order_id: b.new_component?.work_order_id || b.work_order_id,
        verification_status: b.new_component?.verification_status || PartVerificationStatus.PROVIDER_RECORDED,
        issue_intervention_id: b.issue_intervention_id || b.new_component?.issue_intervention_id,
        maintenance_completion_id: b.maintenance_completion_id || b.new_component?.maintenance_completion_id,
        vehicle_expense_id: b.vehicle_expense_id || b.new_component?.vehicle_expense_id,
        warranty: b.new_component?.warranty || b.warranty,
      },
      reason: b.reason || RemovalReason.WORN,
      notes: b.notes,
      replaced_at: b.replaced_at,
      odometer_km: b.odometer_km !== undefined ? Number(b.odometer_km) : undefined,
    };

    const result = vehicleComponentService.replaceComponent(actor, input);

    res.status(200).json({
      success: true,
      data: {
        replacement: result.replacement,
        new_component: result.new_component,
      },
      message: 'Component replaced successfully with chain of custody preserved',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:id/components/:componentId/remove
 * Marks an installed component as removed
 */
componentRouter.post('/vehicles/:id/components/:componentId/remove', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const componentId = req.params.componentId;
    const b = req.body;

    const removed = vehicleComponentService.removeComponent(actor, {
      component_id: componentId,
      reason: b.reason || RemovalReason.WORN,
      notes: b.notes,
      removed_at: b.removed_at,
      removed_odometer_km: b.odometer_km !== undefined ? Number(b.odometer_km) : undefined,
    });

    res.json({
      success: true,
      data: removed,
      message: 'Component marked as removed',
    });
  } catch (err) {
    next(err);
  }
});

// ==================== 2. TYRE LIFECYCLE & ROTATION ENDPOINTS ====================

/**
 * GET /api/v1/vehicles/:id/tyres
 * Lists all tyres with current wheel assignments and latest inspection
 */
componentRouter.get('/vehicles/:id/tyres', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;

    const tyres = vehicleTyreService.listTyres(actor, vehicleId);
    const currentAssignments = componentRepository.findCurrentTyrePositions(vehicleId);
    const rotations = componentRepository.findTyreRotationsByVehicleId(vehicleId);

    res.json({
      success: true,
      data: tyres,
      current_positions: currentAssignments,
      recent_rotations: rotations.slice(0, 5),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:id/tyres
 * Installs a tyre at a specific position or batch-installs a 4-tyre set
 */
componentRouter.post('/vehicles/:id/tyres', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const b = req.body;

    // Support batch installation of a tyre set if provided as an array
    if (Array.isArray(b.tyres) && b.tyres.length > 0) {
      const results: Array<{ tyre: any; position_assignment: any }> = [];
      for (const t of b.tyres) {
        const input: InstallTyreInput = {
          vehicle_id: vehicleId,
          brand: t.brand,
          model: t.model,
          size_raw: t.size_raw || `${t.width}/${t.aspect_ratio}R${t.rim_diameter}`,
          width: Number(t.width),
          aspect_ratio: Number(t.aspect_ratio),
          rim_diameter: Number(t.rim_diameter),
          load_index: t.load_index !== undefined ? Number(t.load_index) : undefined,
          speed_rating: t.speed_rating,
          position: t.position as TyrePosition,
          manufacture_dot_code: t.manufacture_dot_code,
          installed_at: t.installed_at || b.installed_at,
          installed_odometer_km: t.installed_odometer_km !== undefined ? Number(t.installed_odometer_km) : (b.installed_odometer_km !== undefined ? Number(b.installed_odometer_km) : undefined),
          provenance: t.provenance || b.provenance || PartProvenance.GARAGE_RECORDED,
          verification_status: t.verification_status || b.verification_status || PartVerificationStatus.PROVIDER_RECORDED,
        };
        results.push(vehicleTyreService.installTyre(actor, input));
      }

      res.status(201).json({
        success: true,
        data: results.map((r) => r.tyre),
        message: `Installed tyre set of ${results.length} tyres successfully`,
      });
      return;
    }

    // Single tyre installation
    const input: InstallTyreInput = {
      vehicle_id: vehicleId,
      brand: b.brand,
      model: b.model,
      size_raw: b.size_raw || `${b.width}/${b.aspect_ratio}R${b.rim_diameter}`,
      width: Number(b.width),
      aspect_ratio: Number(b.aspect_ratio),
      rim_diameter: Number(b.rim_diameter),
      load_index: b.load_index !== undefined ? Number(b.load_index) : undefined,
      speed_rating: b.speed_rating,
      position: b.position as TyrePosition,
      manufacture_dot_code: b.manufacture_dot_code,
      installed_at: b.installed_at,
      installed_odometer_km: b.installed_odometer_km !== undefined ? Number(b.installed_odometer_km) : undefined,
      provenance: b.provenance || PartProvenance.GARAGE_RECORDED,
      verification_status: b.verification_status || PartVerificationStatus.PROVIDER_RECORDED,
    };

    const result = vehicleTyreService.installTyre(actor, input);

    res.status(201).json({
      success: true,
      data: result.tyre,
      position_assignment: result.position_assignment,
      message: `Tyre installed successfully at ${result.position_assignment.position}`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/vehicles/:id/tyres/:tyreId
 * Gets detailed tyre record including position history and inspections
 */
componentRouter.get('/vehicles/:id/tyres/:tyreId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const tyreId = req.params.tyreId;

    const tyre = componentRepository.findTyreById(tyreId);
    if (!tyre || tyre.vehicle_id !== vehicleId) {
      throw new CanonicalAppError(ErrorCode.VEHICLE_TYRE_NOT_FOUND, `Tyre ${tyreId} not found`, 404);
    }

    const positionHistory = componentRepository.findPositionHistoryByTyreId(tyreId);
    const inspections = componentRepository.findInspectionsByTyreId(tyreId);

    res.json({
      success: true,
      data: tyre,
      position_history: positionHistory,
      inspections,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:id/tyres/rotate
 * Performs an atomic tyre rotation across positions
 */
componentRouter.post('/vehicles/:id/tyres/rotate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const b = req.body;

    const input: RotateTyresInput = {
      vehicle_id: vehicleId,
      performed_at: b.performed_at,
      odometer_km: b.odometer_km !== undefined ? Number(b.odometer_km) : undefined,
      pattern: b.pattern || TyreRotationPattern.FORWARD_CROSS,
      provider_id: b.provider_id,
      provider_name: b.provider_name,
      work_order_id: b.work_order_id,
      notes: b.notes,
      moves: Array.isArray(b.moves) ? b.moves : [],
      maintenance_completion_id: b.maintenance_completion_id,
    };

    const rotation = vehicleTyreService.rotateTyres(actor, input);

    res.json({
      success: true,
      data: rotation,
      message: `Tyre rotation completed successfully (${rotation.moves?.length || 0} moves)`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:id/tyres/:tyreId/replace
 * Replaces a tyre at its current wheel position
 */
componentRouter.post('/vehicles/:id/tyres/:tyreId/replace', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const tyreId = req.params.tyreId;
    const b = req.body;

    const input: ReplaceTyreInput = {
      old_tyre_id: tyreId,
      new_tyre: {
        vehicle_id: vehicleId,
        brand: b.new_tyre?.brand || b.brand,
        model: b.new_tyre?.model || b.model,
        size_raw: b.new_tyre?.size_raw || b.size_raw || `${b.new_tyre?.width || b.width}/${b.new_tyre?.aspect_ratio || b.aspect_ratio}R${b.new_tyre?.rim_diameter || b.rim_diameter}`,
        width: Number(b.new_tyre?.width || b.width),
        aspect_ratio: Number(b.new_tyre?.aspect_ratio || b.aspect_ratio),
        rim_diameter: Number(b.new_tyre?.rim_diameter || b.rim_diameter),
        load_index: b.new_tyre?.load_index !== undefined ? Number(b.new_tyre.load_index) : (b.load_index !== undefined ? Number(b.load_index) : undefined),
        speed_rating: b.new_tyre?.speed_rating || b.speed_rating,
        position: (b.new_tyre?.position || b.position) as TyrePosition,
        manufacture_dot_code: b.new_tyre?.manufacture_dot_code || b.manufacture_dot_code,
        installed_at: b.replaced_at || b.new_tyre?.installed_at,
        installed_odometer_km: b.odometer_km !== undefined ? Number(b.odometer_km) : (b.new_tyre?.installed_odometer_km !== undefined ? Number(b.new_tyre.installed_odometer_km) : undefined),
        provenance: b.new_tyre?.provenance || b.provenance || PartProvenance.GARAGE_RECORDED,
        verification_status: b.new_tyre?.verification_status || b.verification_status || PartVerificationStatus.PROVIDER_RECORDED,
      },
      reason: b.reason || RemovalReason.WORN,
      notes: b.notes,
      replaced_at: b.replaced_at,
      odometer_km: b.odometer_km !== undefined ? Number(b.odometer_km) : undefined,
    };

    const result = vehicleTyreService.replaceTyre(actor, input);

    res.json({
      success: true,
      data: {
        old_tyre: result.old_tyre,
        new_tyre: result.new_tyre,
      },
      message: 'Tyre replaced successfully, position reassigned and history preserved',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:id/tyres/:tyreId/inspect
 * Records a tyre physical inspection (tread depths, pressure, condition)
 */
componentRouter.post('/vehicles/:id/tyres/:tyreId/inspect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const tyreId = req.params.tyreId;
    const b = req.body;

    const input: InspectTyreInput = {
      vehicle_tyre_id: tyreId,
      tread_depth_outer_mm: b.tread_depth_outer_mm !== undefined ? Number(b.tread_depth_outer_mm) : undefined,
      tread_depth_center_mm: b.tread_depth_center_mm !== undefined ? Number(b.tread_depth_center_mm) : undefined,
      tread_depth_inner_mm: b.tread_depth_inner_mm !== undefined ? Number(b.tread_depth_inner_mm) : undefined,
      pressure_psi: b.pressure_psi !== undefined ? Number(b.pressure_psi) : undefined,
      condition_rating: b.condition_rating || TyreConditionRating.GOOD,
      observed_at: b.observed_at,
      source_type: b.source_type || 'GARAGE_INSPECTION',
      provider_id: b.provider_id,
      notes: b.notes,
    };

    const inspection = vehicleTyreService.inspectTyre(actor, input);

    res.status(201).json({
      success: true,
      data: inspection,
      message: 'Tyre inspection recorded successfully',
    });
  } catch (err) {
    next(err);
  }
});

// ==================== 3. CONFIGURATION & MODIFICATIONS ENDPOINTS ====================

/**
 * GET /api/v1/vehicles/:id/configuration
 * Returns full vehicle configuration summary: factory specs, current components, tyres, modifications, and overrides
 */
componentRouter.get('/vehicles/:id/configuration', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;

    const summary = vehicleComponentService.getConfigurationSummary(actor, vehicleId);

    res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/vehicles/:id/modifications
 * Lists recorded modifications for a vehicle
 */
componentRouter.get('/vehicles/:id/modifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;

    const modifications = componentRepository.findModificationsByVehicleId(vehicleId);

    res.json({
      success: true,
      data: modifications,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/vehicles/:id/modifications
 * Records a vehicle modification and any resulting configuration overrides
 */
componentRouter.post('/vehicles/:id/modifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;
    const b = req.body;

    const input: RecordModificationInput = {
      vehicle_id: vehicleId,
      category: b.category,
      name: b.name,
      description: b.description,
      installed_at: b.installed_at,
      odometer_km: b.odometer_km !== undefined ? Number(b.odometer_km) : undefined,
      provider_id: b.provider_id,
      provider_name: b.provider_name,
      work_order_id: b.work_order_id,
      verification_status: b.verification_status,
      vehicle_component_id: b.vehicle_component_id,
      vehicle_expense_id: b.vehicle_expense_id,
      overrides: Array.isArray(b.overrides) ? b.overrides : undefined,
    };

    const mod = vehicleComponentService.recordModification(actor, input);

    res.status(201).json({
      success: true,
      data: mod,
      message: 'Vehicle modification recorded successfully',
    });
  } catch (err) {
    next(err);
  }
});

// ==================== 4. WARRANTIES ENDPOINTS ====================

/**
 * GET /api/v1/vehicles/:id/component-warranties
 * Lists all component warranties for a vehicle
 */
componentRouter.get('/vehicles/:id/component-warranties', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req);
    const vehicleId = req.params.id;

    const warranties = componentRepository.findWarrantiesByVehicleId(vehicleId);

    res.json({
      success: true,
      data: warranties,
    });
  } catch (err) {
    next(err);
  }
});

// ==================== 5. PARTS CATALOG & DEFINITIONS ====================

/**
 * GET /api/v1/components/definitions
 * Returns canonical component definitions taxonomy
 */
componentRouter.get('/components/definitions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = req.query.category as ComponentCategory | undefined;
    const definitions = componentRepository.listComponentDefinitions();
    const filtered = category ? definitions.filter((d) => d.category === category) : definitions;

    res.json({
      success: true,
      data: filtered,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/components/catalog
 * Searches or lists catalog parts foundation
 */
componentRouter.get('/components/catalog', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = req.query.q as string | undefined;
    const items = componentRepository.listPartsCatalog(query);

    res.json({
      success: true,
      data: items,
    });
  } catch (err) {
    next(err);
  }
});
