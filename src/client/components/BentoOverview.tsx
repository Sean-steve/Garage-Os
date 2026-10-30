import React, { useState } from 'react';
import {
  Car,
  Activity,
  Zap,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Database,
  Radio,
  Sparkles,
  AlertTriangle,
  Play,
  RotateCw
} from 'lucide-react';
import { PlatformCapabilities, QueueStatus } from '../types';

interface BentoOverviewProps {
  capabilities: PlatformCapabilities | null;
  queueStatus: QueueStatus | null;
  onRefresh: () => void;
  onEmitTestEvent: () => Promise<void>;
  onEnqueueJob: () => Promise<void>;
  onTestIdempotency: () => Promise<void>;
  actionStatus: string | null;
}

export const BentoOverview: React.FC<BentoOverviewProps> = ({
  capabilities,
  queueStatus,
  onRefresh,
  onEmitTestEvent,
  onEnqueueJob,
  onTestIdempotency,
  actionStatus,
}) => {
  const [optimizationMode, setOptimizationMode] = useState(true);
  const [isActing, setIsActing] = useState(false);

  const handleAction = async (action: () => Promise<void>) => {
    setIsActing(true);
    try {
      await action();
    } finally {
      setIsActing(false);
    }
  };

  const dbLatency = capabilities?.subsystems.database.latency_ms ?? 1.2;
  const pendingOutbox = queueStatus?.summary.outbox_pending ?? 0;
  const activeJobs = queueStatus?.summary.queue_depth.running ?? 0;
  const queuedJobs = queueStatus?.summary.queue_depth.queued ?? 0;
  const deadLetters = queueStatus?.summary.dead_letter_count ?? 0;

  return (
    <div className="space-y-6">
      {/* Toast / Action feedback banner if present */}
      {actionStatus && (
        <div className="bg-indigo-950/80 border border-indigo-500/40 text-indigo-200 px-5 py-3 rounded-2xl flex items-center justify-between text-xs font-semibold backdrop-blur-md animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
            <span>{actionStatus}</span>
          </div>
          <span className="text-[10px] text-indigo-400 uppercase tracking-widest font-mono">200 OK</span>
        </div>
      )}

      {/* Main Bento Grid */}
      <main className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 auto-rows-fr">
        {/* ========================================================
            TILE 1: Large Focal Tile (Span 2x2)
            Vehicle Kernel & Digital Passport Intelligence
        ======================================================== */}
        <div className="col-span-1 md:col-span-2 lg:col-span-2 row-span-2 bg-slate-900/50 border border-slate-800 rounded-[32px] p-7 md:p-8 flex flex-col justify-between relative overflow-hidden backdrop-blur-sm group hover:border-slate-700/80 transition-all duration-300">
          {/* Subtle Watermark Icon */}
          <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity">
            <Car className="w-64 h-64 text-indigo-300" />
          </div>

          {/* Top content */}
          <div className="z-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-bold uppercase tracking-wider border border-indigo-500/20 mb-6">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
              Canonical Aggregate Alpha • GAR-004
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-[1.12] tracking-tight mb-4 text-white">
              Vehicle Kernel &<br />Fleet Intelligence
            </h2>

            <p className="text-slate-400 text-sm md:text-base max-w-md leading-relaxed mb-6">
              Deterministic, event-sourced vehicle passport with append-only service timeline and cryptographic provenance guarantees.
            </p>

            {/* Vehicle Spec Capsule */}
            <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 max-w-lg mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-bold text-base tracking-tight">Toyota Land Cruiser Prado</h3>
                  <p className="text-xs text-slate-400">TX-L 2.8L Diesel • 2021 • Reg: <span className="font-mono text-indigo-300 font-bold">KDA 789X</span></p>
                </div>
                <div className="text-right">
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/60 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-semibold">Odometer</span>
                  <span className="font-mono font-bold text-white text-sm">54,200 km</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-semibold">Health Score</span>
                  <span className="font-mono font-bold text-emerald-400 text-sm">98.4%</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-semibold">Next Service</span>
                  <span className="font-mono font-bold text-indigo-300 text-sm">60,000 km</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom stats and trust avatars */}
          <div className="z-10 flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-800/60">
            <div className="space-y-1">
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Digital Passport Entries</p>
              <p className="text-2xl sm:text-3xl font-mono font-bold text-white flex items-center gap-2">
                1,842 <span className="text-emerald-400 text-xs font-sans font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full">+4.2%</span>
              </p>
            </div>

            {/* Provider avatars */}
            <div className="flex items-center gap-2">
              <div className="text-right mr-2 hidden sm:block">
                <p className="text-xs text-slate-300 font-semibold">Nairobi Premier Clinic</p>
                <p className="text-[9px] text-indigo-400 uppercase tracking-wider font-bold">Verified Provider</p>
              </div>
              <div className="flex -space-x-3">
                <div className="w-10 h-10 rounded-full border-2 border-slate-900 bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-300 shadow">
                  NC
                </div>
                <div className="w-10 h-10 rounded-full border-2 border-slate-900 bg-indigo-900/90 flex items-center justify-center text-[10px] font-bold text-indigo-200 shadow">
                  VK
                </div>
                <div className="w-10 h-10 rounded-full border-2 border-slate-900 bg-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shadow">
                  +12
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================
            TILE 2: Uptime & Database WAL Engine
        ======================================================== */}
        <div className="col-span-1 row-span-1 bg-slate-900/50 border border-slate-800 rounded-[32px] p-6 flex flex-col justify-between group hover:border-slate-700/80 transition-all duration-300 backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-sm">
              <Activity className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="text-right">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Platform Uptime</p>
              <p className="text-xl font-bold font-mono text-white">99.99%</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
              <span>SQLite WAL Pulse</span>
              <span className="text-emerald-400 font-mono">100% ACID</span>
            </div>
            {/* Dynamic Activity Bars */}
            <div className="h-8 flex items-end gap-1.5">
              <div className="flex-grow h-[35%] bg-slate-800 rounded-sm"></div>
              <div className="flex-grow h-[50%] bg-slate-800 rounded-sm"></div>
              <div className="flex-grow h-[70%] bg-emerald-500/70 rounded-sm"></div>
              <div className="flex-grow h-[90%] bg-emerald-500 rounded-sm shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
              <div className="flex-grow h-[75%] bg-emerald-500/80 rounded-sm"></div>
              <div className="flex-grow h-[100%] bg-emerald-400 rounded-sm shadow-[0_0_10px_rgba(52,211,153,0.7)]"></div>
            </div>
          </div>
        </div>

        {/* ========================================================
            TILE 3: Accent Tile - Subsystem Latency & Mode
        ======================================================== */}
        <div className="col-span-1 row-span-1 bg-indigo-600 rounded-[32px] p-6 flex flex-col justify-between text-white shadow-xl shadow-indigo-600/25 relative overflow-hidden group">
          {/* Subtle background glow */}
          <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none"></div>

          <div className="flex justify-between items-start">
            <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-sm">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div className="text-right">
              <p className="text-[10px] text-indigo-200 font-bold uppercase tracking-widest">Outbox Latency</p>
              <p className="text-xl font-bold font-mono text-white">{dbLatency.toFixed(1)} ms</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-indigo-500/50">
            <div>
              <p className="text-xs font-bold text-white">Execution Mode</p>
              <p className="text-[10px] text-indigo-200">Zero-Loss Durability</p>
            </div>
            <button
              onClick={() => setOptimizationMode(!optimizationMode)}
              className="w-11 h-6 bg-white/25 hover:bg-white/35 rounded-full relative p-0.5 transition-colors cursor-pointer"
              title="Toggle Optimization Mode"
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform duration-200 shadow-sm ${
                  optimizationMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* ========================================================
            TILE 4: Resource Heat & Background Worker Capacity
        ======================================================== */}
        <div className="col-span-1 row-span-1 bg-slate-900/50 border border-slate-800 rounded-[32px] p-6 flex flex-col justify-between group hover:border-slate-700/80 transition-all duration-300 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Queue & Worker Depth</h3>
            <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
              GAR-036
            </span>
          </div>

          <div className="space-y-3.5 my-auto">
            {/* Outbox Event Stream */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] font-bold uppercase">
                <span className="text-slate-400">Outbox Pending</span>
                <span className="text-indigo-400 font-mono">{pendingOutbox} events</span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(Math.max((pendingOutbox / 20) * 100, 8), 100)}%` }}
                />
              </div>
            </div>

            {/* Active Jobs */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] font-bold uppercase">
                <span className="text-slate-400">Worker Jobs</span>
                <span className="text-purple-400 font-mono">{activeJobs} active / {queuedJobs} queued</span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(Math.max(((activeJobs + queuedJobs) / 10) * 100, 12), 100)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center text-[10px] text-slate-500 pt-2 border-t border-slate-800/60 font-mono">
            <span>Dead Letters: {deadLetters}</span>
            <span className="text-emerald-400 font-semibold">Worker Alive</span>
          </div>
        </div>

        {/* ========================================================
            TILE 5: Active Invariants & Security Guard
        ======================================================== */}
        <div className="col-span-1 row-span-1 bg-slate-900/50 border border-slate-800 rounded-[32px] p-6 flex flex-col justify-between group hover:border-slate-700/80 transition-all duration-300 backdrop-blur-sm">
          <div className="flex justify-between items-center">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active Alerts</h3>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>

          <div className="flex items-center gap-4 my-auto">
            <div className="text-4xl font-bold font-mono text-white">00</div>
            <div className="h-10 w-[2px] bg-slate-800"></div>
            <p className="text-[10px] text-slate-400 leading-tight uppercase font-bold tracking-wider">
              12 Constitutional Laws active & strictly enforced across all domain boundaries
            </p>
          </div>

          <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold pt-2 border-t border-slate-800/60 flex items-center justify-between">
            <span>Security Headers</span>
            <span className="text-emerald-400">HSTS / CSP OK</span>
          </div>
        </div>

        {/* ========================================================
            TILE 6: Bottom Wide Tile (Span 2x1)
            Transactional Event Mesh & Interactive Actions
        ======================================================== */}
        <div className="col-span-1 md:col-span-2 row-span-1 bg-slate-900/50 border border-slate-800 rounded-[32px] p-7 md:p-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 relative overflow-hidden group hover:border-slate-700/80 transition-all duration-300 backdrop-blur-sm">
          <div className="z-10 max-w-md">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 bg-slate-800 text-slate-300 rounded-full text-[9px] font-bold uppercase tracking-wider mb-2">
              <Radio className="w-3 h-3 text-indigo-400" />
              Event-Driven Outbox Mesh
            </div>
            <h4 className="text-xl font-bold text-white mb-1">Transactional Event Pipeline</h4>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Dispatches at-least-once domain envelopes atomically with SQLite transactions (GAR-035).
            </p>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap gap-2.5">
              <button
                disabled={isActing}
                onClick={() => handleAction(onEmitTestEvent)}
                className="px-4 py-2 bg-white text-slate-950 text-xs font-bold rounded-xl uppercase tracking-wider hover:bg-indigo-400 hover:text-white transition-all cursor-pointer shadow-md disabled:opacity-50 flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                Emit Outbox Event
              </button>

              <button
                disabled={isActing}
                onClick={() => handleAction(onEnqueueJob)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl uppercase tracking-wider border border-slate-700 hover:border-indigo-500/50 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                Queue Job
              </button>

              <button
                disabled={isActing}
                onClick={() => handleAction(onTestIdempotency)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl uppercase tracking-wider border border-slate-700 hover:border-indigo-500/50 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <RotateCw className="w-3.5 h-3.5 text-emerald-400" />
                Test Idempotency
              </button>
            </div>
          </div>

          {/* Graphical mesh equalizer bars matching design HTML */}
          <div className="flex gap-2 items-end h-24 self-end sm:self-center pr-2">
            <div className="w-3.5 bg-indigo-500/20 h-[30%] rounded-full animate-pulse"></div>
            <div className="w-3.5 bg-indigo-500/40 h-[60%] rounded-full"></div>
            <div className="w-3.5 bg-indigo-500/60 h-[45%] rounded-full"></div>
            <div className="w-3.5 bg-indigo-500 h-[100%] rounded-full shadow-[0_0_12px_rgba(99,102,241,0.6)]"></div>
            <div className="w-3.5 bg-indigo-500/80 h-[75%] rounded-full"></div>
            <div className="w-3.5 bg-indigo-500/50 h-[55%] rounded-full"></div>
          </div>
        </div>
      </main>
    </div>
  );
};
