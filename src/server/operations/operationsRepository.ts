/**
 * Canonical Operations Domain Repository (GAR-012)
 *
 * Implements persistence for Service Cases, Check-ins, Inspections,
 * Findings, Recommendations, Authorizations, Work Orders, Assignments,
 * Time Tracking Sessions, Parts, QC, and Release.
 */

import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import {
  ServiceCaseEntity,
  ServiceCaseStatus,
  CustomerConcernEntity,
  VehicleCheckInEntity,
  VehicleIntakeObservationEntity,
  VehicleIntakeItemEntity,
  InspectionTemplateEntity,
  InspectionTemplateItemEntity,
  VehicleInspectionEntity,
  InspectionItemResultEntity,
  InspectionFindingEntity,
  RecommendedWorkItemEntity,
  ServiceAuthorizationEntity,
  WorkOrderEntity,
  WorkOrderItemEntity,
  TechnicianAssignmentEntity,
  TechnicianWorkSessionEntity,
  WorkOrderPartEntity,
  WorkOrderHoldEntity,
  QualityControlCheckEntity,
  RoadTestEntity,
  VehicleReleaseEntity,
  ServiceCaseNoteEntity,
  ServiceCaseActivityEntity,
} from './types';

export class OperationsRepository {
  // ---------------- Service Cases ----------------

  createServiceCase(entity: ServiceCaseEntity): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO service_cases (
        id, service_case_number, provider_id, branch_id, vehicle_id,
        customer_user_id, customer_contact_name, customer_contact_phone, customer_contact_email,
        source_type, source_reference_id, service_advisor_id, status,
        intake_odometer_km, final_odometer_km, opened_at, checked_in_at,
        completed_at, released_at, cancelled_at, cancellation_reason,
        prior_service_case_id, created_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    stmt.run(
      entity.id,
      entity.service_case_number,
      entity.provider_id,
      entity.branch_id,
      entity.vehicle_id,
      entity.customer_user_id,
      entity.customer_contact_name,
      entity.customer_contact_phone,
      entity.customer_contact_email,
      entity.source_type,
      entity.source_reference_id,
      entity.service_advisor_id,
      entity.status,
      entity.intake_odometer_km,
      entity.final_odometer_km,
      entity.opened_at,
      entity.checked_in_at,
      entity.completed_at,
      entity.released_at,
      entity.cancelled_at,
      entity.cancellation_reason,
      entity.prior_service_case_id,
      entity.created_by,
      entity.created_at,
      entity.updated_at
    );
  }

  getServiceCaseById(id: string): ServiceCaseEntity | null {
    const db = getDatabase();
    const stmt = db.prepare(`SELECT * FROM service_cases WHERE id = ?`);
    const row = stmt.get(id);
    return (row as unknown as ServiceCaseEntity) || null;
  }

  getServiceCaseByNumber(serviceCaseNumber: string): ServiceCaseEntity | null {
    const db = getDatabase();
    const stmt = db.prepare(`SELECT * FROM service_cases WHERE service_case_number = ?`);
    const row = stmt.get(serviceCaseNumber);
    return (row as unknown as ServiceCaseEntity) || null;
  }

  listServiceCases(filter: {
    provider_id?: string;
    branch_id?: string;
    vehicle_id?: string;
    status?: string;
  }): ServiceCaseEntity[] {
    const db = getDatabase();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.provider_id) {
      clauses.push('provider_id = ?');
      params.push(filter.provider_id);
    }
    if (filter.branch_id) {
      clauses.push('branch_id = ?');
      params.push(filter.branch_id);
    }
    if (filter.vehicle_id) {
      clauses.push('vehicle_id = ?');
      params.push(filter.vehicle_id);
    }
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `SELECT * FROM service_cases ${where} ORDER BY opened_at DESC`;
    return db.prepare(sql).all(...(params as any[])) as unknown as ServiceCaseEntity[];
  }

  updateServiceCaseStatus(
    id: string,
    status: ServiceCaseStatus,
    extras: Partial<ServiceCaseEntity> = {}
  ): void {
    const db = getDatabase();
    const assignments = ['status = ?', 'updated_at = ?'];
    const now = new Date().toISOString();
    const params: any[] = [status, extras.updated_at || now];

    if (extras.checked_in_at !== undefined) {
      assignments.push('checked_in_at = ?');
      params.push(extras.checked_in_at);
    }
    if (extras.intake_odometer_km !== undefined) {
      assignments.push('intake_odometer_km = ?');
      params.push(extras.intake_odometer_km);
    }
    if (extras.final_odometer_km !== undefined) {
      assignments.push('final_odometer_km = ?');
      params.push(extras.final_odometer_km);
    }
    if (extras.completed_at !== undefined) {
      assignments.push('completed_at = ?');
      params.push(extras.completed_at);
    }
    if (extras.released_at !== undefined) {
      assignments.push('released_at = ?');
      params.push(extras.released_at);
    }
    if (extras.cancelled_at !== undefined) {
      assignments.push('cancelled_at = ?');
      params.push(extras.cancelled_at);
    }
    if (extras.cancellation_reason !== undefined) {
      assignments.push('cancellation_reason = ?');
      params.push(extras.cancellation_reason);
    }
    if (extras.service_advisor_id !== undefined) {
      assignments.push('service_advisor_id = ?');
      params.push(extras.service_advisor_id);
    }

    params.push(id);
    db.prepare(`UPDATE service_cases SET ${assignments.join(', ')} WHERE id = ?`).run(...(params as any[]));
  }

  // ---------------- Customer Concerns ----------------

  createCustomerConcern(concern: CustomerConcernEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO customer_concerns (
        id, service_case_id, vehicle_id, concern_type, description,
        related_issue_id, related_maintenance_requirement_id,
        reported_by, reported_at, priority, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      concern.id,
      concern.service_case_id,
      concern.vehicle_id,
      concern.concern_type,
      concern.description,
      concern.related_issue_id,
      concern.related_maintenance_requirement_id,
      concern.reported_by,
      concern.reported_at,
      concern.priority,
      concern.created_at
    );
  }

  listCustomerConcerns(serviceCaseId: string): CustomerConcernEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM customer_concerns WHERE service_case_id = ? ORDER BY created_at ASC`)
      .all(serviceCaseId) as unknown as CustomerConcernEntity[];
  }

  // ---------------- Vehicle Check-In ----------------

  createVehicleCheckIn(
    checkIn: VehicleCheckInEntity,
    observations: VehicleIntakeObservationEntity[] = [],
    items: VehicleIntakeItemEntity[] = []
  ): void {
    withTransaction(({ db }) => {
      db.prepare(`
        INSERT INTO vehicle_check_ins (
          id, service_case_id, vehicle_id, checked_in_at,
          odometer_value, odometer_unit, odometer_observation_id,
          fuel_level, vehicle_condition_summary,
          keys_received_count, documents_received,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        checkIn.id,
        checkIn.service_case_id,
        checkIn.vehicle_id,
        checkIn.checked_in_at,
        checkIn.odometer_value,
        checkIn.odometer_unit,
        checkIn.odometer_observation_id,
        checkIn.fuel_level,
        checkIn.vehicle_condition_summary,
        checkIn.keys_received_count,
        checkIn.documents_received,
        checkIn.created_by,
        checkIn.created_at
      );

      const obsStmt = db.prepare(`
        INSERT INTO vehicle_intake_observations (
          id, vehicle_check_in_id, service_case_id, category, position,
          description, severity, media_reference_ids, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const obs of observations) {
        obsStmt.run(
          obs.id,
          obs.vehicle_check_in_id,
          obs.service_case_id,
          obs.category,
          obs.position,
          obs.description,
          obs.severity,
          obs.media_reference_ids,
          obs.created_by,
          obs.created_at
        );
      }

      const itemStmt = db.prepare(`
        INSERT INTO vehicle_intake_items (
          id, vehicle_check_in_id, service_case_id, item_name,
          item_type, quantity, condition_notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const it of items) {
        itemStmt.run(
          it.id,
          it.vehicle_check_in_id,
          it.service_case_id,
          it.item_name,
          it.item_type,
          it.quantity,
          it.condition_notes,
          it.created_at
        );
      }
    });
  }

  getVehicleCheckIn(serviceCaseId: string): VehicleCheckInEntity | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM vehicle_check_ins WHERE service_case_id = ?`).get(serviceCaseId);
    return (row as unknown as VehicleCheckInEntity) || null;
  }

  listIntakeObservations(checkInId: string): VehicleIntakeObservationEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM vehicle_intake_observations WHERE vehicle_check_in_id = ? ORDER BY created_at ASC`)
      .all(checkInId) as unknown as VehicleIntakeObservationEntity[];
  }

  listIntakeItems(checkInId: string): VehicleIntakeItemEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM vehicle_intake_items WHERE vehicle_check_in_id = ? ORDER BY created_at ASC`)
      .all(checkInId) as unknown as VehicleIntakeItemEntity[];
  }

  // ---------------- Inspection Templates ----------------

  listInspectionTemplates(): InspectionTemplateEntity[] {
    const db = getDatabase();
    return db.prepare(`SELECT * FROM inspection_templates WHERE status = 'ACTIVE' ORDER BY name ASC`).all() as unknown as InspectionTemplateEntity[];
  }

  getInspectionTemplateWithItems(
    templateId: string
  ): { template: InspectionTemplateEntity; items: InspectionTemplateItemEntity[] } | null {
    const db = getDatabase();
    const template = db.prepare(`SELECT * FROM inspection_templates WHERE id = ?`).get(templateId);
    if (!template) return null;

    const items = db
      .prepare(`SELECT * FROM inspection_template_items WHERE template_id = ? ORDER BY display_order ASC`)
      .all(templateId) as unknown as InspectionTemplateItemEntity[];

    return {
      template: template as unknown as InspectionTemplateEntity,
      items,
    };
  }

  // ---------------- Vehicle Inspections ----------------

  createVehicleInspection(inspection: VehicleInspectionEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_inspections (
        id, service_case_id, vehicle_id, inspection_type, template_id,
        status, performed_by_technician_id, started_at, completed_at,
        notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      inspection.id,
      inspection.service_case_id,
      inspection.vehicle_id,
      inspection.inspection_type,
      inspection.template_id,
      inspection.status,
      inspection.performed_by_technician_id,
      inspection.started_at,
      inspection.completed_at,
      inspection.notes,
      inspection.created_at,
      inspection.updated_at
    );
  }

  getVehicleInspection(id: string): VehicleInspectionEntity | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM vehicle_inspections WHERE id = ?`).get(id);
    return (row as unknown as VehicleInspectionEntity) || null;
  }

  listInspectionsForCase(serviceCaseId: string): VehicleInspectionEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM vehicle_inspections WHERE service_case_id = ? ORDER BY created_at ASC`)
      .all(serviceCaseId) as unknown as VehicleInspectionEntity[];
  }

  updateVehicleInspection(id: string, updates: Partial<VehicleInspectionEntity>): void {
    const db = getDatabase();
    const assignments: string[] = ['updated_at = ?'];
    const params: unknown[] = [updates.updated_at || new Date().toISOString()];

    if (updates.status !== undefined) {
      assignments.push('status = ?');
      params.push(updates.status);
    }
    if (updates.started_at !== undefined) {
      assignments.push('started_at = ?');
      params.push(updates.started_at);
    }
    if (updates.completed_at !== undefined) {
      assignments.push('completed_at = ?');
      params.push(updates.completed_at);
    }
    if (updates.performed_by_technician_id !== undefined) {
      assignments.push('performed_by_technician_id = ?');
      params.push(updates.performed_by_technician_id);
    }
    if (updates.notes !== undefined) {
      assignments.push('notes = ?');
      params.push(updates.notes);
    }

    params.push(id);
    db.prepare(`UPDATE vehicle_inspections SET ${assignments.join(', ')} WHERE id = ?`).run(...(params as any[]));
  }

  // ---------------- Inspection Results & Findings ----------------

  recordInspectionResults(
    inspectionId: string,
    results: InspectionItemResultEntity[],
    findings: InspectionFindingEntity[] = []
  ): void {
    withTransaction(({ db }) => {
      const resStmt = db.prepare(`
        INSERT INTO inspection_item_results (
          id, inspection_id, item_name, category, result,
          measured_value, measurement_unit, notes, media_reference_ids, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const res of results) {
        resStmt.run(
          res.id,
          res.inspection_id,
          res.item_name,
          res.category,
          res.result,
          res.measured_value,
          res.measurement_unit,
          res.notes,
          res.media_reference_ids,
          res.created_at
        );
      }

      const findStmt = db.prepare(`
        INSERT INTO inspection_findings (
          id, inspection_id, service_case_id, vehicle_id, category,
          component_definition_id, vehicle_component_id, finding_type,
          severity, description, recommended_action, evidence_references,
          related_issue_id, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const f of findings) {
        findStmt.run(
          f.id,
          f.inspection_id,
          f.service_case_id,
          f.vehicle_id,
          f.category,
          f.component_definition_id,
          f.vehicle_component_id,
          f.finding_type,
          f.severity,
          f.description,
          f.recommended_action,
          f.evidence_references,
          f.related_issue_id,
          f.created_by,
          f.created_at
        );
      }
    });
  }

  listInspectionItemResults(inspectionId: string): InspectionItemResultEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM inspection_item_results WHERE inspection_id = ? ORDER BY created_at ASC`)
      .all(inspectionId) as unknown as InspectionItemResultEntity[];
  }

  listInspectionFindings(inspectionId: string): InspectionFindingEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM inspection_findings WHERE inspection_id = ? ORDER BY created_at ASC`)
      .all(inspectionId) as unknown as InspectionFindingEntity[];
  }

  listInspectionFindingsForCase(serviceCaseId: string): InspectionFindingEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM inspection_findings WHERE service_case_id = ? ORDER BY created_at ASC`)
      .all(serviceCaseId) as unknown as InspectionFindingEntity[];
  }

  // ---------------- Recommended Work Items ----------------

  createRecommendedWorkItem(item: RecommendedWorkItemEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO recommended_work_items (
        id, service_case_id, related_finding_id, related_issue_id,
        maintenance_task_id, service_category, description, priority,
        estimated_labor_hours, estimated_labor_cost, estimated_parts_cost,
        currency, status, declined_reason, declined_at, declined_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.service_case_id,
      item.related_finding_id,
      item.related_issue_id,
      item.maintenance_task_id,
      item.service_category,
      item.description,
      item.priority,
      item.estimated_labor_hours,
      item.estimated_labor_cost,
      item.estimated_parts_cost,
      item.currency,
      item.status,
      item.declined_reason,
      item.declined_at,
      item.declined_by,
      item.created_at,
      item.updated_at
    );
  }

  listRecommendedWorkItems(serviceCaseId: string): RecommendedWorkItemEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM recommended_work_items WHERE service_case_id = ? ORDER BY created_at ASC`)
      .all(serviceCaseId) as unknown as RecommendedWorkItemEntity[];
  }

  getRecommendedWorkItemById(id: string): RecommendedWorkItemEntity | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM recommended_work_items WHERE id = ?`).get(id);
    return (row as unknown as RecommendedWorkItemEntity) || null;
  }

  updateRecommendedWorkItem(id: string, updates: Partial<RecommendedWorkItemEntity>): void {
    const db = getDatabase();
    const assignments: string[] = ['updated_at = ?'];
    const params: unknown[] = [updates.updated_at || new Date().toISOString()];

    if (updates.status !== undefined) {
      assignments.push('status = ?');
      params.push(updates.status);
    }
    if (updates.declined_reason !== undefined) {
      assignments.push('declined_reason = ?');
      params.push(updates.declined_reason);
    }
    if (updates.declined_at !== undefined) {
      assignments.push('declined_at = ?');
      params.push(updates.declined_at);
    }
    if (updates.declined_by !== undefined) {
      assignments.push('declined_by = ?');
      params.push(updates.declined_by);
    }
    if (updates.estimated_labor_hours !== undefined) {
      assignments.push('estimated_labor_hours = ?');
      params.push(updates.estimated_labor_hours);
    }
    if (updates.estimated_labor_cost !== undefined) {
      assignments.push('estimated_labor_cost = ?');
      params.push(updates.estimated_labor_cost);
    }
    if (updates.estimated_parts_cost !== undefined) {
      assignments.push('estimated_parts_cost = ?');
      params.push(updates.estimated_parts_cost);
    }

    params.push(id);
    db.prepare(`UPDATE recommended_work_items SET ${assignments.join(', ')} WHERE id = ?`).run(...(params as any[]));
  }

  // ---------------- Service Authorizations ----------------

  createServiceAuthorization(auth: ServiceAuthorizationEntity, itemIds: string[]): void {
    withTransaction(({ db }) => {
      db.prepare(`
        INSERT INTO service_authorizations (
          id, service_case_id, authorization_type, scope_version,
          amount_authorized, currency, authorized_by, authorized_at,
          authorization_channel, status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        auth.id,
        auth.service_case_id,
        auth.authorization_type,
        auth.scope_version,
        auth.amount_authorized,
        auth.currency,
        auth.authorized_by,
        auth.authorized_at,
        auth.authorization_channel,
        auth.status,
        auth.notes,
        auth.created_at
      );

      const itemStmt = db.prepare(`
        INSERT INTO service_authorization_items (id, authorization_id, recommended_work_item_id, created_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const recId of itemIds) {
        const joinId = `sai_${auth.id.substring(5)}_${recId.substring(4, 12)}`;
        itemStmt.run(joinId, auth.id, recId, auth.created_at);

        db.prepare(
          `UPDATE recommended_work_items SET status = 'AUTHORIZED', updated_at = ? WHERE id = ?`
        ).run(auth.authorized_at, recId);
      }
    });
  }

  listServiceAuthorizations(
    serviceCaseId: string
  ): Array<ServiceAuthorizationEntity & { item_ids: string[] }> {
    const db = getDatabase();
    const auths = db
      .prepare(`SELECT * FROM service_authorizations WHERE service_case_id = ? ORDER BY scope_version ASC`)
      .all(serviceCaseId) as unknown as ServiceAuthorizationEntity[];

    const result: Array<ServiceAuthorizationEntity & { item_ids: string[] }> = [];
    for (const auth of auths) {
      const itemRows = db
        .prepare(`SELECT recommended_work_item_id FROM service_authorization_items WHERE authorization_id = ?`)
        .all(auth.id) as Array<{ recommended_work_item_id: string }>;
      result.push({
        ...auth,
        item_ids: itemRows.map((r) => r.recommended_work_item_id),
      });
    }

    return result;
  }

  // ---------------- Work Orders ----------------

  createWorkOrder(order: WorkOrderEntity, items: WorkOrderItemEntity[]): void {
    withTransaction(({ db }) => {
      db.prepare(`
        INSERT INTO work_orders (
          id, service_case_id, provider_id, branch_id, vehicle_id,
          work_order_number, status, opened_at, started_at, completed_at,
          assigned_service_advisor_id, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        order.id,
        order.service_case_id,
        order.provider_id,
        order.branch_id,
        order.vehicle_id,
        order.work_order_number,
        order.status,
        order.opened_at,
        order.started_at,
        order.completed_at,
        order.assigned_service_advisor_id,
        order.created_by,
        order.created_at,
        order.updated_at
      );

      const itemStmt = db.prepare(`
        INSERT INTO work_order_items (
          id, work_order_id, work_type, service_category, description,
          related_recommended_work_item_id, related_issue_id,
          related_maintenance_task_id, related_finding_id,
          status, authorization_status, assigned_technician_id,
          estimated_hours, actual_hours, billable_hours, hourly_rate,
          started_at, completed_at, block_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        itemStmt.run(
          item.id,
          item.work_order_id,
          item.work_type,
          item.service_category,
          item.description,
          item.related_recommended_work_item_id,
          item.related_issue_id,
          item.related_maintenance_task_id,
          item.related_finding_id,
          item.status,
          item.authorization_status,
          item.assigned_technician_id,
          item.estimated_hours,
          item.actual_hours,
          item.billable_hours,
          item.hourly_rate,
          item.started_at,
          item.completed_at,
          item.block_reason,
          item.created_at,
          item.updated_at
        );
      }
    });
  }

  getWorkOrderById(id: string): WorkOrderEntity | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM work_orders WHERE id = ?`).get(id);
    return (row as unknown as WorkOrderEntity) || null;
  }

  getWorkOrderByCaseId(serviceCaseId: string): WorkOrderEntity | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM work_orders WHERE service_case_id = ?`).get(serviceCaseId);
    return (row as unknown as WorkOrderEntity) || null;
  }

  listWorkOrders(filter: { provider_id?: string; status?: string }): WorkOrderEntity[] {
    const db = getDatabase();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.provider_id) {
      clauses.push('provider_id = ?');
      params.push(filter.provider_id);
    }
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM work_orders ${where} ORDER BY opened_at DESC`).all(...(params as any[])) as unknown as WorkOrderEntity[];
  }

  updateWorkOrderStatus(id: string, status: string, extras: Partial<WorkOrderEntity> = {}): void {
    const db = getDatabase();
    const assignments = ['status = ?', 'updated_at = ?'];
    const params: any[] = [status, extras.updated_at || new Date().toISOString()];

    if (extras.started_at !== undefined) {
      assignments.push('started_at = ?');
      params.push(extras.started_at);
    }
    if (extras.completed_at !== undefined) {
      assignments.push('completed_at = ?');
      params.push(extras.completed_at);
    }
    if (extras.assigned_service_advisor_id !== undefined) {
      assignments.push('assigned_service_advisor_id = ?');
      params.push(extras.assigned_service_advisor_id);
    }

    params.push(id);
    db.prepare(`UPDATE work_orders SET ${assignments.join(', ')} WHERE id = ?`).run(...(params as any[]));
  }

  getWorkOrderItems(workOrderId: string): WorkOrderItemEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY created_at ASC`)
      .all(workOrderId) as unknown as WorkOrderItemEntity[];
  }

  getWorkOrderItemById(id: string): WorkOrderItemEntity | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM work_order_items WHERE id = ?`).get(id);
    return (row as unknown as WorkOrderItemEntity) || null;
  }

  updateWorkOrderItem(id: string, updates: Partial<WorkOrderItemEntity>): void {
    const db = getDatabase();
    const assignments: string[] = ['updated_at = ?'];
    const params: unknown[] = [updates.updated_at || new Date().toISOString()];

    if (updates.status !== undefined) {
      assignments.push('status = ?');
      params.push(updates.status);
    }
    if (updates.assigned_technician_id !== undefined) {
      assignments.push('assigned_technician_id = ?');
      params.push(updates.assigned_technician_id);
    }
    if (updates.actual_hours !== undefined) {
      assignments.push('actual_hours = ?');
      params.push(updates.actual_hours);
    }
    if (updates.billable_hours !== undefined) {
      assignments.push('billable_hours = ?');
      params.push(updates.billable_hours);
    }
    if (updates.started_at !== undefined) {
      assignments.push('started_at = ?');
      params.push(updates.started_at);
    }
    if (updates.completed_at !== undefined) {
      assignments.push('completed_at = ?');
      params.push(updates.completed_at);
    }
    if (updates.block_reason !== undefined) {
      assignments.push('block_reason = ?');
      params.push(updates.block_reason);
    }

    params.push(id);
    db.prepare(`UPDATE work_order_items SET ${assignments.join(', ')} WHERE id = ?`).run(...(params as any[]));
  }

  // ---------------- Technician Assignments & Work Sessions ----------------

  createTechnicianAssignment(assignment: TechnicianAssignmentEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO technician_assignments (
        id, work_order_id, work_order_item_id, technician_id,
        provider_membership_id, role, assigned_at, assigned_by, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assignment.id,
      assignment.work_order_id,
      assignment.work_order_item_id,
      assignment.technician_id,
      assignment.provider_membership_id,
      assignment.role,
      assignment.assigned_at,
      assignment.assigned_by,
      assignment.status
    );
  }

  listTechnicianAssignments(workOrderId: string): TechnicianAssignmentEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM technician_assignments WHERE work_order_id = ? ORDER BY assigned_at ASC`)
      .all(workOrderId) as unknown as TechnicianAssignmentEntity[];
  }

  createTechnicianWorkSession(session: TechnicianWorkSessionEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO technician_work_sessions (
        id, work_order_item_id, technician_id, started_at,
        ended_at, duration_minutes, labor_type, notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.work_order_item_id,
      session.technician_id,
      session.started_at,
      session.ended_at,
      session.duration_minutes,
      session.labor_type,
      session.notes,
      session.status
    );
  }

  getTechnicianWorkSession(sessionId: string): TechnicianWorkSessionEntity | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM technician_work_sessions WHERE id = ?`).get(sessionId);
    return (row as unknown as TechnicianWorkSessionEntity) || null;
  }

  endTechnicianWorkSession(
    sessionId: string,
    endedAt: string,
    durationMinutes: number,
    notes?: string
  ): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE technician_work_sessions
      SET ended_at = ?, duration_minutes = ?, notes = coalesce(?, notes), status = 'COMPLETED'
      WHERE id = ?
    `).run(endedAt, durationMinutes, notes || null, sessionId);
  }

  listTechnicianWorkSessions(workOrderItemId: string): TechnicianWorkSessionEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM technician_work_sessions WHERE work_order_item_id = ? ORDER BY started_at ASC`)
      .all(workOrderItemId) as unknown as TechnicianWorkSessionEntity[];
  }

  // ---------------- Work Order Parts ----------------

  createWorkOrderPart(part: WorkOrderPartEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO work_order_parts (
        id, work_order_item_id, work_order_id, part_number, description,
        quantity, source, unit_cost, unit_price, currency,
        status, vehicle_component_id, replaced_component_id,
        installed_at, installed_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      part.id,
      part.work_order_item_id,
      part.work_order_id,
      part.part_number,
      part.description,
      part.quantity,
      part.source,
      part.unit_cost,
      part.unit_price,
      part.currency,
      part.status,
      part.vehicle_component_id,
      part.replaced_component_id,
      part.installed_at,
      part.installed_by,
      part.created_at,
      part.updated_at
    );
  }

  updateWorkOrderPart(id: string, updates: Partial<WorkOrderPartEntity>): void {
    const db = getDatabase();
    const assignments: string[] = ['updated_at = ?'];
    const params: unknown[] = [updates.updated_at || new Date().toISOString()];

    if (updates.status !== undefined) {
      assignments.push('status = ?');
      params.push(updates.status);
    }
    if (updates.installed_at !== undefined) {
      assignments.push('installed_at = ?');
      params.push(updates.installed_at);
    }
    if (updates.installed_by !== undefined) {
      assignments.push('installed_by = ?');
      params.push(updates.installed_by);
    }
    if (updates.vehicle_component_id !== undefined) {
      assignments.push('vehicle_component_id = ?');
      params.push(updates.vehicle_component_id);
    }
    if (updates.replaced_component_id !== undefined) {
      assignments.push('replaced_component_id = ?');
      params.push(updates.replaced_component_id);
    }

    params.push(id);
    db.prepare(`UPDATE work_order_parts SET ${assignments.join(', ')} WHERE id = ?`).run(...(params as any[]));
  }

  listWorkOrderParts(workOrderId: string): WorkOrderPartEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM work_order_parts WHERE work_order_id = ? ORDER BY created_at ASC`)
      .all(workOrderId) as unknown as WorkOrderPartEntity[];
  }

  // ---------------- Work Order Holds ----------------

  createWorkOrderHold(hold: WorkOrderHoldEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO work_order_holds (
        id, work_order_id, reason, description, placed_at, placed_by
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(hold.id, hold.work_order_id, hold.reason, hold.description, hold.placed_at, hold.placed_by);
  }

  releaseWorkOrderHold(holdId: string, releasedBy: string, releasedAt: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE work_order_holds SET released_at = ?, released_by = ? WHERE id = ?
    `).run(releasedAt, releasedBy, holdId);
  }

  listWorkOrderHolds(workOrderId: string): WorkOrderHoldEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM work_order_holds WHERE work_order_id = ? ORDER BY placed_at DESC`)
      .all(workOrderId) as unknown as WorkOrderHoldEntity[];
  }

  // ---------------- Quality Control & Road Tests ----------------

  createQualityControlCheck(qc: QualityControlCheckEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO quality_control_checks (
        id, work_order_id, inspection_id, performed_by,
        performed_at, result, checklist_results, notes,
        rework_instructions, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      qc.id,
      qc.work_order_id,
      qc.inspection_id,
      qc.performed_by,
      qc.performed_at,
      qc.result,
      qc.checklist_results,
      qc.notes,
      qc.rework_instructions,
      qc.created_at
    );
  }

  listQualityControlChecks(workOrderId: string): QualityControlCheckEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM quality_control_checks WHERE work_order_id = ? ORDER BY performed_at DESC`)
      .all(workOrderId) as unknown as QualityControlCheckEntity[];
  }

  createRoadTest(rt: RoadTestEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO road_tests (
        id, work_order_id, performed_by, started_at, ended_at,
        start_odometer_km, end_odometer_km, result, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rt.id,
      rt.work_order_id,
      rt.performed_by,
      rt.started_at,
      rt.ended_at,
      rt.start_odometer_km,
      rt.end_odometer_km,
      rt.result,
      rt.notes,
      rt.created_at
    );
  }

  listRoadTests(workOrderId: string): RoadTestEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM road_tests WHERE work_order_id = ? ORDER BY started_at DESC`)
      .all(workOrderId) as unknown as RoadTestEntity[];
  }

  // ---------------- Vehicle Releases ----------------

  createVehicleRelease(release: VehicleReleaseEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_releases (
        id, service_case_id, work_order_id, released_at, released_by,
        recipient_user_id, recipient_name, recipient_phone,
        final_odometer_km, final_odometer_observation_id,
        handover_notes, acknowledgement_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      release.id,
      release.service_case_id,
      release.work_order_id,
      release.released_at,
      release.released_by,
      release.recipient_user_id,
      release.recipient_name,
      release.recipient_phone,
      release.final_odometer_km,
      release.final_odometer_observation_id,
      release.handover_notes,
      release.acknowledgement_status,
      release.created_at
    );
  }

  getVehicleRelease(serviceCaseId: string): VehicleReleaseEntity | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT * FROM vehicle_releases WHERE service_case_id = ?`).get(serviceCaseId);
    return (row as unknown as VehicleReleaseEntity) || null;
  }

  // ---------------- Service Case Notes & Activity ----------------

  addNote(note: ServiceCaseNoteEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO service_case_notes (
        id, service_case_id, author_id, author_name, visibility, content, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      note.id,
      note.service_case_id,
      note.author_id,
      note.author_name,
      note.visibility,
      note.content,
      note.created_at
    );
  }

  listNotes(serviceCaseId: string): ServiceCaseNoteEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM service_case_notes WHERE service_case_id = ? ORDER BY created_at ASC`)
      .all(serviceCaseId) as unknown as ServiceCaseNoteEntity[];
  }

  logActivity(activity: ServiceCaseActivityEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO service_case_activity (
        id, service_case_id, work_order_id, action, actor_id, actor_name, details, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      activity.id,
      activity.service_case_id,
      activity.work_order_id,
      activity.action,
      activity.actor_id,
      activity.actor_name,
      activity.details,
      activity.occurred_at
    );
  }

  listActivity(serviceCaseId: string): ServiceCaseActivityEntity[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT * FROM service_case_activity WHERE service_case_id = ? ORDER BY occurred_at DESC`)
      .all(serviceCaseId) as unknown as ServiceCaseActivityEntity[];
  }
}

export const operationsRepository = new OperationsRepository();
