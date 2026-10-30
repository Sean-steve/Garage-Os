/**
 * Canonical Maintenance Evaluation Job Worker (GAR-006 §36-§40, GAR-036)
 *
 * Runs periodically to evaluate due states across all vehicles and schedule reminders.
 */

import { jobEngine } from './jobEngine';
import { getDatabase } from '../database/connection';
import { maintenanceService } from '../maintenance/maintenanceService';
import { maintenanceRepository } from '../maintenance/maintenanceRepository';
import {
  MaintenanceReminderEntity,
  MaintenanceReminderType,
  MaintenanceReminderChannel,
  MaintenanceReminderStatus,
  MaintenanceCycleStatus,
} from '../maintenance/types';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalUuid } from '../domain/id';
import { logger } from '../observability/logger';

export const MAINTENANCE_EVALUATION_JOB = 'maintenance.evaluation';

export async function runMaintenanceEvaluationJob(payload: { vehicle_id?: string }, correlationId: string): Promise<void> {
  const db = getDatabase();
  const now = getCurrentUtcIsoString();

  let vehicleIds: string[] = [];
  if (payload.vehicle_id) {
    vehicleIds = [payload.vehicle_id];
  } else {
    const rows = db.prepare(`
      SELECT DISTINCT vehicle_id FROM vehicle_maintenance_plans WHERE status = 'ACTIVE';
    `).all() as Array<{ vehicle_id: string }>;
    vehicleIds = rows.map((r) => r.vehicle_id);
  }

  logger.info(`Running maintenance evaluation job for ${vehicleIds.length} vehicles [correlation: ${correlationId}]`);

  for (const vId of vehicleIds) {
    try {
      const summary = maintenanceService.getVehicleMaintenanceStatus(vId);

      // Check for cycles that need reminders
      const existingReminders = maintenanceRepository.listRemindersForVehicle(vId);

      for (const item of summary.active_cycles) {
        if (item.cycle.status === MaintenanceCycleStatus.APPROACHING_DUE || item.cycle.status === MaintenanceCycleStatus.DUE || item.cycle.status === MaintenanceCycleStatus.OVERDUE) {
          const reminderType =
            item.cycle.status === MaintenanceCycleStatus.OVERDUE
              ? MaintenanceReminderType.OVERDUE
              : item.cycle.status === MaintenanceCycleStatus.DUE
              ? MaintenanceReminderType.DUE
              : MaintenanceReminderType.APPROACHING_DUE;

          const alreadyReminded = existingReminders.some(
            (r) => r.cycle_id === item.cycle.id && r.reminder_type === reminderType && r.status !== MaintenanceReminderStatus.DISMISSED
          );

          if (!alreadyReminded) {
            const reminder: MaintenanceReminderEntity = {
              id: `mrem_${generateCanonicalUuid()}`,
              vehicle_id: vId,
              cycle_id: item.cycle.id,
              requirement_id: item.requirement.id,
              reminder_type: reminderType,
              channel: MaintenanceReminderChannel.IN_APP,
              target_date: item.cycle.due_date || now,
              status: MaintenanceReminderStatus.SCHEDULED,
              message: `${item.requirement.name} is ${item.cycle.status.toLowerCase().replace('_', ' ')}. (${item.cycle.trigger_reason})`,
              sent_at: now,
              acknowledged_at: null,
              created_at: now,
              updated_at: now,
            };
            maintenanceRepository.insertReminder(reminder);
          }
        }
      }
    } catch (err) {
      logger.error(`Error evaluating maintenance for vehicle ${vId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Registers maintenance background job worker
 */
export function registerMaintenanceJobWorkers(): void {
  jobEngine.registerWorker(MAINTENANCE_EVALUATION_JOB, runMaintenanceEvaluationJob);
  logger.info(`Registered [${MAINTENANCE_EVALUATION_JOB}] job worker`);
}
