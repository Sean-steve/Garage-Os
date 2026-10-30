/**
 * Canonical Booking, Scheduling & Quote Job Workers (GAR-013 §95-§97, GAR-036)
 *
 * Implements idempotent background sweepers:
 * - Stale Capacity Hold cleanup (releases unconfirmed reservations)
 * - Issued Quote Expiration (transitions valid_until expired quotes)
 * - Pending Booking Expiration (times out unanswered provider requests)
 * - 24-hour Appointment Reminders (emits notification envelopes)
 */

import { jobEngine } from './jobEngine';
import { bookingService } from '../booking/bookingService';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';

export const BOOKING_HOLD_CLEANUP_JOB = 'booking.hold_cleanup';
export const BOOKING_QUOTE_EXPIRY_JOB = 'booking.quote_expiry';
export const BOOKING_REQUEST_EXPIRY_JOB = 'booking.request_expiry';
export const BOOKING_APPOINTMENT_REMINDER_JOB = 'booking.appointment_reminder';

export async function runBookingHoldCleanupJob(
  payload: { as_of_utc?: string },
  correlationId: string
): Promise<{ expiredCount: number }> {
  const asOf = payload.as_of_utc || getCurrentUtcIsoString();
  logger.info(`Running capacity hold cleanup job [correlation: ${correlationId}, asOf: ${asOf}]`);
  const result = bookingService.processCapacityHoldCleanup(asOf);
  logger.info(`Capacity hold cleanup completed: ${result.expiredCount} holds expired.`);
  return result;
}

export async function runQuoteExpiryJob(
  payload: { as_of_utc?: string },
  correlationId: string
): Promise<{ expiredCount: number; quoteIds: string[] }> {
  const asOf = payload.as_of_utc || getCurrentUtcIsoString();
  logger.info(`Running quote expiry sweeper [correlation: ${correlationId}, asOf: ${asOf}]`);
  const result = bookingService.processQuoteExpiration(asOf);
  logger.info(`Quote expiry completed: ${result.expiredCount} quotes expired.`);
  return result;
}

export async function runBookingRequestExpiryJob(
  payload: { timeout_hours?: number; as_of_utc?: string },
  correlationId: string
): Promise<{ expiredCount: number; bookingIds: string[] }> {
  const asOf = payload.as_of_utc || getCurrentUtcIsoString();
  const timeout = payload.timeout_hours || 48;
  logger.info(`Running booking request expiry sweeper [correlation: ${correlationId}, timeout: ${timeout}h, asOf: ${asOf}]`);
  const result = bookingService.processStaleBookingRequests(timeout, asOf);
  logger.info(`Booking request expiry completed: ${result.expiredCount} bookings expired.`);
  return result;
}

export async function runAppointmentReminderJob(
  payload: { window_hours?: number; as_of_utc?: string },
  correlationId: string
): Promise<{ remindedCount: number; appointmentIds: string[] }> {
  const asOf = payload.as_of_utc || getCurrentUtcIsoString();
  const window = payload.window_hours || 24;
  logger.info(`Running appointment reminder worker [correlation: ${correlationId}, window: ${window}h, asOf: ${asOf}]`);
  const result = bookingService.processAppointmentReminders(window, asOf);
  logger.info(`Appointment reminder completed: ${result.remindedCount} reminders queued.`);
  return result;
}

export function registerBookingJobWorkers(): void {
  jobEngine.registerWorker(BOOKING_HOLD_CLEANUP_JOB, async (job) => {
    await runBookingHoldCleanupJob(job.payload as { as_of_utc?: string }, job.correlation_id);
  });

  jobEngine.registerWorker(BOOKING_QUOTE_EXPIRY_JOB, async (job) => {
    await runQuoteExpiryJob(job.payload as { as_of_utc?: string }, job.correlation_id);
  });

  jobEngine.registerWorker(BOOKING_REQUEST_EXPIRY_JOB, async (job) => {
    await runBookingRequestExpiryJob(job.payload as { timeout_hours?: number; as_of_utc?: string }, job.correlation_id);
  });

  jobEngine.registerWorker(BOOKING_APPOINTMENT_REMINDER_JOB, async (job) => {
    await runAppointmentReminderJob(job.payload as { window_hours?: number; as_of_utc?: string }, job.correlation_id);
  });

  logger.info('Registered Sprint 11 booking & quote job workers');
}
