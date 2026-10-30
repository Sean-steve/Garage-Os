/**
 * Canonical Maintenance Domain Repository (GAR-006, GAR-033 §12D)
 */

import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/connection';
import { getCurrentUtcIsoString } from '../domain/time';
import {
  MaintenanceRequirementEntity,
  MaintenanceRuleEntity,
  VehicleMaintenancePlanEntity,
  VehicleMaintenancePlanEntryEntity,
  MaintenanceCycleEntity,
  MaintenanceCompletionEntity,
  MaintenanceDeferralEntity,
  MaintenanceReminderEntity,
  MaintenanceCategory,
  MaintenanceIntervalType,
  MaintenanceTriggerPolicy,
  MaintenanceRuleSourceType,
  MaintenanceVerificationStatus,
  MaintenancePlanStatus,
  MaintenancePlanSource,
  MaintenanceCycleStatus,
  MaintenanceSeverity,
  MaintenanceReminderType,
  MaintenanceReminderChannel,
  MaintenanceReminderStatus,
} from './types';
import { OdometerUnit } from '../vehicle/types';

export class MaintenanceRepository {
  // ----------------------------------------------------------------
  // Requirements & Rules
  // ----------------------------------------------------------------

  listRequirements(category?: MaintenanceCategory): MaintenanceRequirementEntity[] {
    const db = getDatabase();
    let query = 'SELECT * FROM maintenance_requirements WHERE active = 1';
    const params: (string | number)[] = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    query += ' ORDER BY default_priority DESC, name ASC;';

    const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    return rows.map(this.mapRequirementRow);
  }

  getRequirementById(id: string): MaintenanceRequirementEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM maintenance_requirements WHERE id = ?;').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRequirementRow(row) : null;
  }

  getRequirementByCode(code: string): MaintenanceRequirementEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM maintenance_requirements WHERE code = ?;').get(code) as Record<string, unknown> | undefined;
    return row ? this.mapRequirementRow(row) : null;
  }

  insertRequirement(req: MaintenanceRequirementEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO maintenance_requirements (
        id, code, name, description, category, component_system,
        default_severity, default_priority, recommended_action,
        recurring, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      req.id,
      req.code,
      req.name,
      req.description,
      req.category,
      req.component_system,
      req.default_severity,
      req.default_priority,
      req.recommended_action,
      req.recurring ? 1 : 0,
      req.active ? 1 : 0,
      req.created_at,
      req.updated_at
    );
  }

  listRulesForRequirement(requirementId: string): MaintenanceRuleEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM maintenance_rules WHERE requirement_id = ? ORDER BY created_at ASC;
    `).all(requirementId) as Array<Record<string, unknown>>;
    return rows.map(this.mapRuleRow);
  }

  getRuleById(id: string): MaintenanceRuleEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM maintenance_rules WHERE id = ?;').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRuleRow(row) : null;
  }

  insertRule(rule: MaintenanceRuleEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO maintenance_rules (
        id, requirement_id, interval_type, distance_interval, distance_unit,
        time_interval_value, time_interval_unit, trigger_policy, initial_distance,
        initial_time_offset_days, approaching_distance_threshold, approaching_time_threshold_days,
        applicability_conditions, source_type, source_reference, verification_status,
        effective_from, effective_until, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      );
    `).run(
      rule.id,
      rule.requirement_id,
      rule.interval_type,
      rule.distance_interval,
      rule.distance_unit,
      rule.time_interval_value,
      rule.time_interval_unit,
      rule.trigger_policy,
      rule.initial_distance,
      rule.initial_time_offset_days,
      rule.approaching_distance_threshold,
      rule.approaching_time_threshold_days,
      JSON.stringify(rule.applicability_conditions || {}),
      rule.source_type,
      rule.source_reference,
      rule.verification_status,
      rule.effective_from,
      rule.effective_until,
      rule.created_at,
      rule.updated_at
    );
  }

  // ----------------------------------------------------------------
  // Vehicle Maintenance Plans & Entries
  // ----------------------------------------------------------------

  getActivePlanForVehicle(vehicleId: string): VehicleMaintenancePlanEntity | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM vehicle_maintenance_plans
      WHERE vehicle_id = ? AND status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1;
    `).get(vehicleId) as Record<string, unknown> | undefined;
    return row ? this.mapPlanRow(row) : null;
  }

  insertPlan(plan: VehicleMaintenancePlanEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_maintenance_plans (
        id, vehicle_id, name, status, source, notes, created_at, activated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      plan.id,
      plan.vehicle_id,
      plan.name,
      plan.status,
      plan.source,
      plan.notes,
      plan.created_at,
      plan.activated_at,
      plan.updated_at
    );
  }

  listPlanEntries(planId: string): VehicleMaintenancePlanEntryEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM vehicle_maintenance_plan_entries
      WHERE plan_id = ?
      ORDER BY priority_override DESC, created_at ASC;
    `).all(planId) as Array<Record<string, unknown>>;
    return rows.map(this.mapPlanEntryRow);
  }

  getPlanEntryById(id: string): VehicleMaintenancePlanEntryEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM vehicle_maintenance_plan_entries WHERE id = ?;').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapPlanEntryRow(row) : null;
  }

  getPlanEntryByRequirement(planId: string, requirementId: string): VehicleMaintenancePlanEntryEntity | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM vehicle_maintenance_plan_entries
      WHERE plan_id = ? AND requirement_id = ?;
    `).get(planId, requirementId) as Record<string, unknown> | undefined;
    return row ? this.mapPlanEntryRow(row) : null;
  }

  insertPlanEntry(entry: VehicleMaintenancePlanEntryEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO vehicle_maintenance_plan_entries (
        id, plan_id, requirement_id, rule_id, enabled, priority_override,
        custom_distance_interval, custom_time_interval_value, custom_time_interval_unit,
        last_known_completion_id, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      entry.id,
      entry.plan_id,
      entry.requirement_id,
      entry.rule_id,
      entry.enabled ? 1 : 0,
      entry.priority_override ?? null,
      entry.custom_distance_interval ?? null,
      entry.custom_time_interval_value ?? null,
      entry.custom_time_interval_unit ?? null,
      entry.last_known_completion_id ?? null,
      entry.notes ?? null,
      entry.created_at,
      entry.updated_at
    );
  }

  updatePlanEntry(
    id: string,
    updates: Partial<VehicleMaintenancePlanEntryEntity>
  ): void {
    const db = getDatabase();
    const fields: string[] = [];
    const params: (string | number | null)[] = [];

    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      params.push(updates.enabled ? 1 : 0);
    }
    if (updates.priority_override !== undefined) {
      fields.push('priority_override = ?');
      params.push(updates.priority_override);
    }
    if (updates.custom_distance_interval !== undefined) {
      fields.push('custom_distance_interval = ?');
      params.push(updates.custom_distance_interval);
    }
    if (updates.custom_time_interval_value !== undefined) {
      fields.push('custom_time_interval_value = ?');
      params.push(updates.custom_time_interval_value);
    }
    if (updates.custom_time_interval_unit !== undefined) {
      fields.push('custom_time_interval_unit = ?');
      params.push(updates.custom_time_interval_unit);
    }
    if (updates.last_known_completion_id !== undefined) {
      fields.push('last_known_completion_id = ?');
      params.push(updates.last_known_completion_id);
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      params.push(updates.notes);
    }

    fields.push('updated_at = ?');
    params.push(getCurrentUtcIsoString());

    params.push(id);
    db.prepare(`UPDATE vehicle_maintenance_plan_entries SET ${fields.join(', ')} WHERE id = ?;`).run(...params);
  }

  // ----------------------------------------------------------------
  // Maintenance Cycles
  // ----------------------------------------------------------------

  listCyclesForVehicle(vehicleId: string, activeOnly = true): MaintenanceCycleEntity[] {
    const db = getDatabase();
    let query = 'SELECT * FROM maintenance_cycles WHERE vehicle_id = ?';
    if (activeOnly) {
      query += " AND status != 'COMPLETED' AND status != 'DISMISSED'";
    }
    query += ' ORDER BY due_date ASC, due_distance_km ASC;';

    const rows = db.prepare(query).all(vehicleId) as Array<Record<string, unknown>>;
    return rows.map(this.mapCycleRow);
  }

  getActiveCycleForPlanEntry(planEntryId: string): MaintenanceCycleEntity | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM maintenance_cycles
      WHERE plan_entry_id = ? AND status != 'COMPLETED' AND status != 'DISMISSED'
      ORDER BY cycle_number DESC
      LIMIT 1;
    `).get(planEntryId) as Record<string, unknown> | undefined;
    return row ? this.mapCycleRow(row) : null;
  }

  getCycleById(id: string): MaintenanceCycleEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM maintenance_cycles WHERE id = ?;').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapCycleRow(row) : null;
  }

  insertCycle(cycle: MaintenanceCycleEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO maintenance_cycles (
        id, vehicle_id, plan_entry_id, requirement_id, rule_id,
        cycle_number, baseline_distance_km, baseline_date,
        due_distance_km, due_date, status, trigger_reason,
        distance_remaining_km, days_remaining,
        deferred_until_date, deferred_until_distance_km, deferral_reason,
        completed_at, completion_id, last_evaluated_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?
      );
    `).run(
      cycle.id,
      cycle.vehicle_id,
      cycle.plan_entry_id,
      cycle.requirement_id,
      cycle.rule_id,
      cycle.cycle_number,
      cycle.baseline_distance_km,
      cycle.baseline_date,
      cycle.due_distance_km ?? null,
      cycle.due_date ?? null,
      cycle.status,
      cycle.trigger_reason ?? null,
      cycle.distance_remaining_km ?? null,
      cycle.days_remaining ?? null,
      cycle.deferred_until_date ?? null,
      cycle.deferred_until_distance_km ?? null,
      cycle.deferral_reason ?? null,
      cycle.completed_at ?? null,
      cycle.completion_id ?? null,
      cycle.last_evaluated_at,
      cycle.created_at,
      cycle.updated_at
    );
  }

  updateCycleEvaluation(
    id: string,
    updates: {
      status: MaintenanceCycleStatus;
      due_distance_km: number | null;
      due_date: string | null;
      distance_remaining_km: number | null;
      days_remaining: number | null;
      trigger_reason: string;
      last_evaluated_at: string;
    }
  ): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE maintenance_cycles
      SET status = ?, due_distance_km = ?, due_date = ?,
          distance_remaining_km = ?, days_remaining = ?, trigger_reason = ?,
          last_evaluated_at = ?, updated_at = ?
      WHERE id = ?;
    `).run(
      updates.status,
      updates.due_distance_km ?? null,
      updates.due_date ?? null,
      updates.distance_remaining_km ?? null,
      updates.days_remaining ?? null,
      updates.trigger_reason,
      updates.last_evaluated_at,
      getCurrentUtcIsoString(),
      id
    );
  }

  markCycleCompleted(cycleId: string, completionId: string, completedAt: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE maintenance_cycles
      SET status = 'COMPLETED', completion_id = ?, completed_at = ?, updated_at = ?
      WHERE id = ?;
    `).run(completionId, completedAt, getCurrentUtcIsoString(), cycleId);
  }

  deferCycle(
    cycleId: string,
    deferral: {
      deferred_until_date?: string | null;
      deferred_until_distance_km?: number | null;
      deferral_reason: string;
    }
  ): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE maintenance_cycles
      SET status = 'DEFERRED',
          deferred_until_date = ?,
          deferred_until_distance_km = ?,
          deferral_reason = ?,
          updated_at = ?
      WHERE id = ?;
    `).run(
      deferral.deferred_until_date ?? null,
      deferral.deferred_until_distance_km ?? null,
      deferral.deferral_reason,
      getCurrentUtcIsoString(),
      cycleId
    );
  }

  // ----------------------------------------------------------------
  // Maintenance Completions
  // ----------------------------------------------------------------

  insertCompletion(comp: MaintenanceCompletionEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO maintenance_completions (
        id, vehicle_id, plan_entry_id, requirement_id, cycle_id,
        completed_at, odometer_value, odometer_unit,
        service_provider_id, service_provider_name, service_record_id,
        performed_actions, replaced_parts, cost_total, currency,
        notes, recorded_by, verification_status, document_id,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      );
    `).run(
      comp.id,
      comp.vehicle_id,
      comp.plan_entry_id ?? null,
      comp.requirement_id,
      comp.cycle_id ?? null,
      comp.completed_at,
      comp.odometer_value,
      comp.odometer_unit,
      comp.service_provider_id ?? null,
      comp.service_provider_name ?? null,
      comp.service_record_id ?? null,
      JSON.stringify(comp.performed_actions || []),
      JSON.stringify(comp.replaced_parts || []),
      comp.cost_total ?? 0,
      comp.currency ?? 'KES',
      comp.notes ?? null,
      comp.recorded_by,
      comp.verification_status,
      comp.document_id ?? null,
      comp.created_at,
      comp.updated_at
    );
  }

  listCompletionsForVehicle(vehicleId: string, limit = 50): MaintenanceCompletionEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM maintenance_completions
      WHERE vehicle_id = ?
      ORDER BY completed_at DESC, created_at DESC
      LIMIT ?;
    `).all(vehicleId, limit) as Array<Record<string, unknown>>;
    return rows.map(this.mapCompletionRow);
  }

  getCompletionById(id: string): MaintenanceCompletionEntity | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM maintenance_completions WHERE id = ?;').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapCompletionRow(row) : null;
  }

  // ----------------------------------------------------------------
  // Maintenance Deferrals
  // ----------------------------------------------------------------

  insertDeferral(def: MaintenanceDeferralEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO maintenance_deferrals (
        id, vehicle_id, cycle_id, plan_entry_id, deferred_at, deferred_by,
        reason, deferred_until_date, deferred_until_distance_km, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      def.id,
      def.vehicle_id,
      def.cycle_id,
      def.plan_entry_id,
      def.deferred_at,
      def.deferred_by,
      def.reason,
      def.deferred_until_date,
      def.deferred_until_distance_km,
      def.created_at
    );
  }

  listDeferralsForVehicle(vehicleId: string): MaintenanceDeferralEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM maintenance_deferrals WHERE vehicle_id = ? ORDER BY deferred_at DESC;
    `).all(vehicleId) as Array<Record<string, unknown>>;
    return rows.map(this.mapDeferralRow);
  }

  // ----------------------------------------------------------------
  // Maintenance Reminders
  // ----------------------------------------------------------------

  insertReminder(reminder: MaintenanceReminderEntity): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO maintenance_reminders (
        id, vehicle_id, cycle_id, requirement_id, reminder_type,
        channel, target_date, status, message, sent_at,
        acknowledged_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      reminder.id,
      reminder.vehicle_id,
      reminder.cycle_id,
      reminder.requirement_id,
      reminder.reminder_type,
      reminder.channel,
      reminder.target_date,
      reminder.status,
      reminder.message,
      reminder.sent_at,
      reminder.acknowledged_at,
      reminder.created_at,
      reminder.updated_at
    );
  }

  listRemindersForVehicle(vehicleId: string): MaintenanceReminderEntity[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM maintenance_reminders WHERE vehicle_id = ? ORDER BY target_date ASC;
    `).all(vehicleId) as Array<Record<string, unknown>>;
    return rows.map(this.mapReminderRow);
  }

  // ----------------------------------------------------------------
  // Row Mappers
  // ----------------------------------------------------------------

  private mapRequirementRow(r: Record<string, unknown>): MaintenanceRequirementEntity {
    return {
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      description: r.description ? String(r.description) : null,
      category: r.category as MaintenanceCategory,
      component_system: String(r.component_system),
      default_severity: r.default_severity as MaintenanceSeverity,
      default_priority: Number(r.default_priority || 50),
      recommended_action: r.recommended_action ? String(r.recommended_action) : null,
      recurring: Number(r.recurring) === 1,
      active: Number(r.active) === 1,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  private mapRuleRow(r: Record<string, unknown>): MaintenanceRuleEntity {
    let conditions = {};
    try {
      if (r.applicability_conditions) {
        conditions = JSON.parse(String(r.applicability_conditions));
      }
    } catch {
      conditions = {};
    }

    return {
      id: String(r.id),
      requirement_id: String(r.requirement_id),
      interval_type: r.interval_type as MaintenanceIntervalType,
      distance_interval: r.distance_interval !== null ? Number(r.distance_interval) : null,
      distance_unit: (r.distance_unit as OdometerUnit) || OdometerUnit.KM,
      time_interval_value: r.time_interval_value !== null ? Number(r.time_interval_value) : null,
      time_interval_unit: r.time_interval_unit ? String(r.time_interval_unit) : null,
      trigger_policy: (r.trigger_policy as MaintenanceTriggerPolicy) || MaintenanceTriggerPolicy.WHICHEVER_COMES_FIRST,
      initial_distance: r.initial_distance !== null ? Number(r.initial_distance) : null,
      initial_time_offset_days: r.initial_time_offset_days !== null ? Number(r.initial_time_offset_days) : null,
      approaching_distance_threshold: Number(r.approaching_distance_threshold || 1000),
      approaching_time_threshold_days: Number(r.approaching_time_threshold_days || 30),
      applicability_conditions: conditions,
      source_type: (r.source_type as MaintenanceRuleSourceType) || MaintenanceRuleSourceType.GARAGE_OS_CATALOG,
      source_reference: r.source_reference ? String(r.source_reference) : null,
      verification_status: (r.verification_status as MaintenanceVerificationStatus) || MaintenanceVerificationStatus.CATALOG_DEFINED,
      effective_from: r.effective_from ? String(r.effective_from) : null,
      effective_until: r.effective_until ? String(r.effective_until) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  private mapPlanRow(r: Record<string, unknown>): VehicleMaintenancePlanEntity {
    return {
      id: String(r.id),
      vehicle_id: String(r.vehicle_id),
      name: String(r.name),
      status: r.status as MaintenancePlanStatus,
      source: r.source as MaintenancePlanSource,
      notes: r.notes ? String(r.notes) : null,
      created_at: String(r.created_at),
      activated_at: r.activated_at ? String(r.activated_at) : null,
      updated_at: String(r.updated_at),
    };
  }

  private mapPlanEntryRow(r: Record<string, unknown>): VehicleMaintenancePlanEntryEntity {
    return {
      id: String(r.id),
      plan_id: String(r.plan_id),
      requirement_id: String(r.requirement_id),
      rule_id: String(r.rule_id),
      enabled: Number(r.enabled) === 1,
      priority_override: r.priority_override !== null ? Number(r.priority_override) : null,
      custom_distance_interval: r.custom_distance_interval !== null ? Number(r.custom_distance_interval) : null,
      custom_time_interval_value: r.custom_time_interval_value !== null ? Number(r.custom_time_interval_value) : null,
      custom_time_interval_unit: r.custom_time_interval_unit ? String(r.custom_time_interval_unit) : null,
      last_known_completion_id: r.last_known_completion_id ? String(r.last_known_completion_id) : null,
      notes: r.notes ? String(r.notes) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  private mapCycleRow(r: Record<string, unknown>): MaintenanceCycleEntity {
    return {
      id: String(r.id),
      vehicle_id: String(r.vehicle_id),
      plan_entry_id: String(r.plan_entry_id),
      requirement_id: String(r.requirement_id),
      rule_id: String(r.rule_id),
      cycle_number: Number(r.cycle_number || 1),
      baseline_distance_km: Number(r.baseline_distance_km || 0),
      baseline_date: String(r.baseline_date),
      due_distance_km: r.due_distance_km !== null ? Number(r.due_distance_km) : null,
      due_date: r.due_date ? String(r.due_date) : null,
      status: r.status as MaintenanceCycleStatus,
      trigger_reason: r.trigger_reason ? String(r.trigger_reason) : null,
      distance_remaining_km: r.distance_remaining_km !== null ? Number(r.distance_remaining_km) : null,
      days_remaining: r.days_remaining !== null ? Number(r.days_remaining) : null,
      deferred_until_date: r.deferred_until_date ? String(r.deferred_until_date) : null,
      deferred_until_distance_km: r.deferred_until_distance_km !== null ? Number(r.deferred_until_distance_km) : null,
      deferral_reason: r.deferral_reason ? String(r.deferral_reason) : null,
      completed_at: r.completed_at ? String(r.completed_at) : null,
      completion_id: r.completion_id ? String(r.completion_id) : null,
      last_evaluated_at: String(r.last_evaluated_at),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  private mapCompletionRow(r: Record<string, unknown>): MaintenanceCompletionEntity {
    let actions: string[] = [];
    let parts = [];
    try {
      if (r.performed_actions) actions = JSON.parse(String(r.performed_actions));
    } catch {
      actions = [];
    }
    try {
      if (r.replaced_parts) parts = JSON.parse(String(r.replaced_parts));
    } catch {
      parts = [];
    }

    return {
      id: String(r.id),
      vehicle_id: String(r.vehicle_id),
      plan_entry_id: r.plan_entry_id ? String(r.plan_entry_id) : null,
      requirement_id: String(r.requirement_id),
      cycle_id: r.cycle_id ? String(r.cycle_id) : null,
      completed_at: String(r.completed_at),
      odometer_value: Number(r.odometer_value || 0),
      odometer_unit: (r.odometer_unit as OdometerUnit) || OdometerUnit.KM,
      service_provider_id: r.service_provider_id ? String(r.service_provider_id) : null,
      service_provider_name: r.service_provider_name ? String(r.service_provider_name) : null,
      service_record_id: r.service_record_id ? String(r.service_record_id) : null,
      performed_actions: actions,
      replaced_parts: parts,
      cost_total: Number(r.cost_total || 0),
      currency: String(r.currency || 'KES'),
      notes: r.notes ? String(r.notes) : null,
      recorded_by: String(r.recorded_by),
      verification_status: (r.verification_status as MaintenanceVerificationStatus) || MaintenanceVerificationStatus.UNVERIFIED,
      document_id: r.document_id ? String(r.document_id) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  private mapDeferralRow(r: Record<string, unknown>): MaintenanceDeferralEntity {
    return {
      id: String(r.id),
      vehicle_id: String(r.vehicle_id),
      cycle_id: String(r.cycle_id),
      plan_entry_id: String(r.plan_entry_id),
      deferred_at: String(r.deferred_at),
      deferred_by: String(r.deferred_by),
      reason: String(r.reason),
      deferred_until_date: r.deferred_until_date ? String(r.deferred_until_date) : null,
      deferred_until_distance_km: r.deferred_until_distance_km !== null ? Number(r.deferred_until_distance_km) : null,
      created_at: String(r.created_at),
    };
  }

  private mapReminderRow(r: Record<string, unknown>): MaintenanceReminderEntity {
    return {
      id: String(r.id),
      vehicle_id: String(r.vehicle_id),
      cycle_id: String(r.cycle_id),
      requirement_id: String(r.requirement_id),
      reminder_type: r.reminder_type as MaintenanceReminderType,
      channel: r.channel as MaintenanceReminderChannel,
      target_date: String(r.target_date),
      status: r.status as MaintenanceReminderStatus,
      message: String(r.message),
      sent_at: r.sent_at ? String(r.sent_at) : null,
      acknowledged_at: r.acknowledged_at ? String(r.acknowledged_at) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }
}

export const maintenanceRepository = new MaintenanceRepository();
