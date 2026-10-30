/**
 * Canonical Vehicle Issue Follow-up Job Worker (GAR-008 §51-§53, GAR-036)
 *
 * Runs periodically to evaluate due follow-up checks on resolved or monitoring issues.
 */

import { jobEngine } from './jobEngine';
import { issueRepository } from '../issues/issueRepository';
import { FollowupStatus } from '../issues/types';
import { getCurrentUtcIsoString } from '../domain/time';
import { logger } from '../observability/logger';

export const ISSUE_FOLLOWUP_EVALUATION_JOB = 'issue.followup.evaluation';

export async function runIssueFollowupJob(
  _payload: Record<string, unknown>,
  correlationId: string
): Promise<void> {
  const now = getCurrentUtcIsoString();
  const dueFollowups = issueRepository.listDueFollowups(now);

  logger.info(`Evaluating issue follow-ups: ${dueFollowups.length} candidate(s) due [correlation: ${correlationId}]`);

  for (const followup of dueFollowups) {
    try {
      if (followup.status === FollowupStatus.SCHEDULED) {
        issueRepository.updateFollowup(followup.id, {
          status: FollowupStatus.DUE,
        });
        logger.info(`Follow-up ${followup.id} transitioned to DUE for issue ${followup.vehicle_issue_id}`);
      }
    } catch (err) {
      logger.error(`Failed to process follow-up ${followup.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function registerIssueFollowupJobWorkers(): void {
  jobEngine.registerWorker(ISSUE_FOLLOWUP_EVALUATION_JOB, runIssueFollowupJob);
}
