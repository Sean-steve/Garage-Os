import React from 'react';
import { Activity, Clock, CheckCircle2, AlertCircle, ArrowUpRight, Cpu } from 'lucide-react';
import { QueueStatus } from '../types';

interface BentoQueuesProps {
  queueStatus: QueueStatus | null;
  onRefresh: () => void;
}

export const BentoQueues: React.FC<BentoQueuesProps> = ({ queueStatus, onRefresh }) => {
  const summary = queueStatus?.summary;
  const outboxEvents = queueStatus?.outbox_events || [];
  const jobs = queueStatus?.jobs || [];
  const deadLetters = queueStatus?.dead_letters || [];

  return (
    <div className="space-y-6">
      {/* Top Bento Row: 3 metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900/50 border border-slate-800 rounded-[28px] p-6 backdrop-blur-sm">
          <div className="flex justify-between items-start mb-4">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Outbox Pending</span>
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse"></span>
          </div>
          <p className="text-3xl font-mono font-bold text-white mb-1">{summary?.outbox_pending ?? 0}</p>
          <p className="text-xs text-slate-400">At-least-once outbox events waiting for worker dispatch</p>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-[28px] p-6 backdrop-blur-sm">
          <div className="flex justify-between items-start mb-4">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Background Jobs</span>
            <Cpu className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-3xl font-mono font-bold text-white mb-1">
            {summary?.queue_depth.running ?? 0} <span className="text-xs font-normal text-slate-400">active</span> / {summary?.queue_depth.queued ?? 0} <span className="text-xs font-normal text-slate-400">queued</span>
          </p>
          <p className="text-xs text-slate-400">Worker leases with exponential backoff retries</p>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-[28px] p-6 backdrop-blur-sm">
          <div className="flex justify-between items-start mb-4">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Dead-Letter Queue</span>
            <AlertCircle className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-3xl font-mono font-bold text-white mb-1">{summary?.dead_letter_count ?? 0}</p>
          <p className="text-xs text-slate-400">Failed tasks routed to dead-letter storage for triage</p>
        </div>
      </div>

      {/* Main Grid: Outbox Table + Job Instances */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Outbox Events Bento Card */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-[32px] p-6 md:p-8 backdrop-blur-sm">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-bold text-white">Recent Outbox Events</h3>
              <p className="text-xs text-slate-400">Table: outbox_events (Transactional Outbox Pattern)</p>
            </div>
            <button
              onClick={onRefresh}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] uppercase font-bold tracking-wider rounded-lg text-slate-300 transition-colors cursor-pointer"
            >
              Refresh
            </button>
          </div>

          <div className="space-y-3 overflow-y-auto max-h-96 pr-1">
            {outboxEvents.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No outbox events in queue. Click "Emit Outbox Event" on the overview to trigger one.
              </div>
            ) : (
              outboxEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 flex items-center justify-between gap-4 text-xs hover:border-slate-700 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-indigo-300 font-bold">{evt.event_type}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        evt.status === 'PUBLISHED'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      }`}>
                        {evt.status}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-slate-500">ID: {evt.event_id}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 font-mono block">
                      {new Date(evt.created_at).toLocaleTimeString()}
                    </span>
                    <span className="text-[9px] text-slate-500">Retries: {evt.retry_count}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Job Instances Bento Card */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-[32px] p-6 md:p-8 backdrop-blur-sm">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-bold text-white">Background Job Instances</h3>
              <p className="text-xs text-slate-400">Table: job_instances (Leased Worker Execution)</p>
            </div>
            <button
              onClick={onRefresh}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] uppercase font-bold tracking-wider rounded-lg text-slate-300 transition-colors cursor-pointer"
            >
              Refresh
            </button>
          </div>

          <div className="space-y-3 overflow-y-auto max-h-96 pr-1">
            {jobs.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No active jobs. Click "Queue Job" on the overview to trigger a background worker task.
              </div>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 flex items-center justify-between gap-4 text-xs hover:border-slate-700 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-purple-300 font-bold">{job.job_name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        job.status === 'SUCCEEDED'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : job.status === 'FAILED' || job.status === 'DEAD_LETTERED'
                          ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          : 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                      }`}>
                        {job.status}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-slate-500">ID: {job.id}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 font-mono block">
                      {new Date(job.created_at).toLocaleTimeString()}
                    </span>
                    <span className="text-[9px] text-slate-500">
                      Tries: {job.retry_count}/{job.max_retries}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
