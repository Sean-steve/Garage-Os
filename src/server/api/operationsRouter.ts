/**
 * Canonical Garage Operations API Router (GAR-012, GAR-034)
 *
 * Implements endpoints for workshop execution:
 * - Service Case lifecycle & tracking
 * - Vehicle intake, odometer capture & check-in
 * - Structured inspection & diagnostic findings
 * - Recommended work & authorization gating
 * - Work order generation, technician assignment & labor tracking
 * - Work order parts consumption & holds
 * - Quality Control (QC) inspection gate & road tests
 * - Vehicle release & handover
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { garageOperationsService } from '../operations/garageOperationsService';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import {
  AccountStatus,
  AuthenticatedActorContext,
  MembershipRole,
  MembershipStatus,
  OrganizationStatus,
  OrganizationType,
} from '../identity/types';
import {
  CreateServiceCaseDto,
  PerformCheckInDto,
  CreateInspectionDto,
  RecordInspectionResultsDto,
  RecommendWorkItemDto,
  AuthorizeServiceDto,
  CreateWorkOrderDto,
  AssignTechnicianDto,
  StartLaborSessionDto,
  EndLaborSessionDto,
  AddWorkOrderPartDto,
  PerformQcCheckDto,
  PerformRoadTestDto,
  ReleaseVehicleDto,
} from '../operations/types';

export const operationsRouter = Router();

// Middleware: Authenticate actor context (populates req.actor)
operationsRouter.use(authenticate());

function getActor(req: Request): AuthenticatedActorContext & { actor_id: string } {
  return {
    ...req.actor!,
    actor_id: req.actor!.user_id || req.actor!.id,
  };
}

// ---------------- Service Cases ----------------

// 1. Create Service Case
operationsRouter.post(
  '/operations/service-cases',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      assertAuthorized(actor, CanonicalPermission.SERVICE_CASE_CREATE);
      const dto: CreateServiceCaseDto = req.body;
      const result = garageOperationsService.createServiceCase(actor, dto);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// 2. List Service Cases
operationsRouter.get(
  '/operations/service-cases',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { provider_id, branch_id, vehicle_id, status } = req.query;
      const list = garageOperationsService.listServiceCases({
        provider_id: provider_id ? String(provider_id) : undefined,
        branch_id: branch_id ? String(branch_id) : undefined,
        vehicle_id: vehicle_id ? String(vehicle_id) : undefined,
        status: status ? String(status) : undefined,
      });
      res.json({ success: true, count: list.length, data: list });
    } catch (err) {
      next(err);
    }
  }
);

// 3. Get Service Case Aggregate
operationsRouter.get(
  '/operations/service-cases/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const aggregate = garageOperationsService.getServiceCaseAggregate(req.params.id);
      if (!aggregate) {
        throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Service Case not found', 404);
      }
      res.json({ success: true, data: aggregate });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Perform Vehicle Check-In
operationsRouter.post(
  '/operations/service-cases/:id/check-in',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      assertAuthorized(actor, CanonicalPermission.SERVICE_CASE_CHECK_IN);
      const dto: PerformCheckInDto = {
        ...req.body,
        service_case_id: req.params.id,
      };
      const result = garageOperationsService.performCheckIn(actor, dto);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// 5. Add Customer Concern
operationsRouter.post(
  '/operations/service-cases/:id/concerns',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const concern = garageOperationsService.addCustomerConcern(actor, req.params.id, req.body);
      res.status(201).json({ success: true, data: concern });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------- Inspection Templates & Inspections ----------------

// 6. List Inspection Templates
operationsRouter.get(
  '/operations/templates',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const templates = garageOperationsService.listInspectionTemplates();
      res.json({ success: true, data: templates });
    } catch (err) {
      next(err);
    }
  }
);

// 7. Get Inspection Template Details
operationsRouter.get(
  '/operations/templates/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const template = garageOperationsService.getInspectionTemplate(req.params.id);
      res.json({ success: true, data: template });
    } catch (err) {
      next(err);
    }
  }
);

// 8. Start Vehicle Inspection
operationsRouter.post(
  '/operations/inspections',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      assertAuthorized(actor, CanonicalPermission.INSPECTION_PERFORM);
      const dto: CreateInspectionDto = req.body;
      const inspection = garageOperationsService.startInspection(actor, dto);
      res.status(201).json({ success: true, data: inspection });
    } catch (err) {
      next(err);
    }
  }
);

// 9. Record Inspection Results & Diagnostic Findings
operationsRouter.post(
  '/operations/inspections/:id/results',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      assertAuthorized(actor, CanonicalPermission.INSPECTION_PERFORM);
      const dto: RecordInspectionResultsDto = {
        ...req.body,
        inspection_id: req.params.id,
      };
      const updated = garageOperationsService.recordInspectionResults(actor, dto);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------- Recommended Work & Authorization ----------------

// 10. Recommend Work Item
operationsRouter.post(
  '/operations/service-cases/:id/recommendations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      assertAuthorized(actor, CanonicalPermission.RECOMMENDATION_CREATE);
      const dto: RecommendWorkItemDto = {
        ...req.body,
        service_case_id: req.params.id,
      };
      const item = garageOperationsService.recommendWorkItem(actor, dto);
      res.status(201).json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }
);

// 11. Authorize Service Scope
operationsRouter.post(
  '/operations/service-cases/:id/authorizations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      assertAuthorized(actor, CanonicalPermission.SERVICE_AUTHORIZATION_MANAGE);
      const dto: AuthorizeServiceDto = {
        ...req.body,
        service_case_id: req.params.id,
      };
      const auth = garageOperationsService.authorizeService(actor, dto);
      res.status(201).json({ success: true, data: auth });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------- Work Orders & Execution ----------------

// 12. Create Work Order
operationsRouter.post(
  '/operations/work-orders',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      assertAuthorized(actor, CanonicalPermission.WORK_ORDER_MANAGE);
      const dto: CreateWorkOrderDto = req.body;
      const workOrder = garageOperationsService.createWorkOrder(actor, dto);
      res.status(201).json({ success: true, data: workOrder });
    } catch (err) {
      next(err);
    }
  }
);

// 13. List Work Orders
operationsRouter.get(
  '/operations/work-orders',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { provider_id, status } = req.query;
      const list = garageOperationsService.listWorkOrders({
        provider_id: provider_id ? String(provider_id) : undefined,
        status: status ? String(status) : undefined,
      });
      res.json({ success: true, count: list.length, data: list });
    } catch (err) {
      next(err);
    }
  }
);

// 14. Get Work Order Aggregate
operationsRouter.get(
  '/operations/work-orders/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const order = garageOperationsService.getWorkOrderAggregate(req.params.id);
      if (!order) {
        throw new CanonicalAppError(ErrorCode.RESOURCE_NOT_FOUND, 'Work Order not found', 404);
      }
      res.json({ success: true, data: order });
    } catch (err) {
      next(err);
    }
  }
);

// 15. Assign Technician
operationsRouter.post(
  '/operations/work-orders/:id/assign',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      assertAuthorized(actor, CanonicalPermission.WORK_ORDER_MANAGE);
      const dto: AssignTechnicianDto = {
        ...req.body,
        work_order_id: req.params.id,
      };
      const assignment = garageOperationsService.assignTechnician(actor, dto);
      res.status(201).json({ success: true, data: assignment });
    } catch (err) {
      next(err);
    }
  }
);

// 16. Start Labor Tracking Session
operationsRouter.post(
  '/operations/work-orders/sessions/start',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const dto: StartLaborSessionDto = req.body;
      const session = garageOperationsService.startLaborSession(actor, dto);
      res.status(201).json({ success: true, data: session });
    } catch (err) {
      next(err);
    }
  }
);

// 17. End Labor Tracking Session
operationsRouter.post(
  '/operations/work-orders/sessions/end',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const dto: EndLaborSessionDto = req.body;
      const session = garageOperationsService.endLaborSession(actor, dto);
      res.json({ success: true, data: session });
    } catch (err) {
      next(err);
    }
  }
);

// 18. Add Part to Work Order
operationsRouter.post(
  '/operations/work-orders/:id/parts',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const dto: AddWorkOrderPartDto = {
        ...req.body,
        work_order_id: req.params.id,
      };
      const part = garageOperationsService.addWorkOrderPart(actor, dto);
      res.status(201).json({ success: true, data: part });
    } catch (err) {
      next(err);
    }
  }
);

// 19. Update Work Order Part Status (e.g. mark INSTALLED)
operationsRouter.patch(
  '/operations/parts/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const { status, replaced_component_id, vehicle_component_id } = req.body;
      garageOperationsService.updateWorkOrderPartStatus(actor, req.params.id, status, {
        replaced_component_id,
        vehicle_component_id,
      });
      res.json({ success: true, message: 'Part status updated' });
    } catch (err) {
      next(err);
    }
  }
);

// 20. Update Work Order Item Status (e.g. IN_PROGRESS, COMPLETED)
operationsRouter.patch(
  '/operations/work-order-items/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const { status, block_reason } = req.body;
      garageOperationsService.updateWorkOrderItemStatus(actor, req.params.id, status, block_reason);
      res.json({ success: true, message: 'Work order item status updated' });
    } catch (err) {
      next(err);
    }
  }
);

// 21. Place Work Order On Hold
operationsRouter.post(
  '/operations/work-orders/:id/holds',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const { reason, description } = req.body;
      const hold = garageOperationsService.placeWorkOrderHold(actor, req.params.id, reason, description);
      res.status(201).json({ success: true, data: hold });
    } catch (err) {
      next(err);
    }
  }
);

// 22. Release Work Order Hold
operationsRouter.post(
  '/operations/holds/:id/release',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      garageOperationsService.releaseWorkOrderHold(actor, req.params.id);
      res.json({ success: true, message: 'Work order hold released' });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------- Quality Control & Road Tests ----------------

// 23. Perform Quality Control Check
operationsRouter.post(
  '/operations/work-orders/:id/qc',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      assertAuthorized(actor, CanonicalPermission.QUALITY_CONTROL_PERFORM);
      const dto: PerformQcCheckDto = {
        ...req.body,
        work_order_id: req.params.id,
      };
      const qc = garageOperationsService.performQualityControlCheck(actor, dto);
      res.status(201).json({ success: true, data: qc });
    } catch (err) {
      next(err);
    }
  }
);

// 24. Record Road Test
operationsRouter.post(
  '/operations/work-orders/:id/road-tests',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const dto: PerformRoadTestDto = {
        ...req.body,
        work_order_id: req.params.id,
      };
      const rt = garageOperationsService.recordRoadTest(actor, dto);
      res.status(201).json({ success: true, data: rt });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------- Release, Notes & Cancellation ----------------

// 25. Release Vehicle
operationsRouter.post(
  '/operations/service-cases/:id/release',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      assertAuthorized(actor, CanonicalPermission.VEHICLE_RELEASE_PERFORM);
      const dto: ReleaseVehicleDto = {
        ...req.body,
        service_case_id: req.params.id,
      };
      const release = garageOperationsService.releaseVehicle(actor, dto);
      res.status(201).json({ success: true, data: release });
    } catch (err) {
      next(err);
    }
  }
);

// 26. Add Note
operationsRouter.post(
  '/operations/service-cases/:id/notes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const { content, visibility } = req.body;
      const note = garageOperationsService.addNote(actor, req.params.id, content, visibility);
      res.status(201).json({ success: true, data: note });
    } catch (err) {
      next(err);
    }
  }
);

// 27. Cancel Service Case
operationsRouter.post(
  '/operations/service-cases/:id/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req);
      const { reason } = req.body;
      garageOperationsService.cancelServiceCase(actor, req.params.id, reason || 'Cancelled by user');
      res.json({ success: true, message: 'Service case cancelled' });
    } catch (err) {
      next(err);
    }
  }
);
