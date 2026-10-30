/**
 * Canonical Recurring Expense Processor Job Worker (GAR-009 §38, §70, GAR-036)
 *
 * Runs periodically to evaluate due recurring vehicle expenses and emit notification events.
 */

import { jobEngine } from './jobEngine';
import { fuelExpenseService } from '../finance/fuelExpenseService';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';

export const RECURRING_EXPENSE_PROCESSOR_JOB = 'recurring_expense.processor';

export async function runRecurringExpenseProcessorJob(
  payload: { as_of_utc?: string },
  correlationId: string
): Promise<{ processedCount: number; eventsEmitted: number }> {
  const asOfUtc = payload.as_of_utc || getCurrentUtcIsoString();
  logger.info(`Running recurring expense processor job [correlation: ${correlationId}, asOf: ${asOfUtc}]`);

  const result = fuelExpenseService.processDueRecurringExpenses(asOfUtc);
  logger.info(
    `Recurring expense processing completed: ${result.processedCount} processed, ${result.eventsEmitted} events emitted`
  );
  return result;
}

export function registerRecurringExpenseJobWorkers(): void {
  jobEngine.registerWorker(RECURRING_EXPENSE_PROCESSOR_JOB, async (job) => {
    await runRecurringExpenseProcessorJob(job.payload as { as_of_utc?: string }, job.correlation_id);
  });
  logger.info('Registered recurring expense processor job worker');
}
