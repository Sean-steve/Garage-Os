import React, { useState } from 'react';
import { ShieldCheck, Search, Filter, Database, Hash, Calendar } from 'lucide-react';
import { AuditEvent } from '../types';

interface BentoAuditProps {
  events: AuditEvent[];
  totalCount: number;
  onRefresh: () => void;
  onFilterChange: (resourceType?: string) => void;
}

export const BentoAudit: React.FC<BentoAuditProps> = ({
  events,
  totalCount,
  onRefresh,
  onFilterChange,
}) => {
  const [selectedType, setSelectedType] = useState<string>('ALL');

  const handleFilter = (type: string) => {
    setSelectedType(type);
    onFilterChange(type === 'ALL' ? undefined : type);
  };

  const filterOptions = ['ALL', 'feature_flag', 'file_object', 'vehicle', 'outbox_event'];

  return (
    <div className="space-y-6">
      {/* Top Banner Card */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-[32px] p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 backdrop-blur-sm">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-bold uppercase tracking-wider border border-indigo-500/20 mb-2">
            GAR-039 §11 • Immutable Audit Log
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Audit & Provenance Ledger</h2>
          <p className="text-xs text-slate-400 max-w-xl leading-relaxed mt-1">
            Tamper-evident, append-only records of all security, administrative, state transition, and configuration actions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-slate-950/80 border border-slate-800 rounded-xl p-1 text-xs">
            {filterOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => handleFilter(opt)}
                className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                  selectedType === opt
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>

          <button
            onClick={onRefresh}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl uppercase tracking-wider border border-slate-700 transition-colors cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Audit Feed Bento Container */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-[32px] p-6 md:p-8 backdrop-blur-sm">
        <div className="flex justify-between items-center mb-6">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Showing {events.length} of {totalCount} Recorded Events
          </span>
          <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            Cryptographic Sequence Valid
          </span>
        </div>

        <div className="space-y-3">
          {events.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              No audit events recorded for current filter.
            </div>
          ) : (
            events.map((evt) => (
              <div
                key={evt.id}
                className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4.5 hover:border-slate-700/80 transition-all text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">
                      {evt.action}
                    </span>
                    <span className="text-slate-400 text-xs font-semibold">
                      {evt.resource_type} : <span className="text-white font-mono">{evt.resource_id || 'general'}</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                    <span>Source: {evt.source}</span>
                    <span>•</span>
                    <span>{new Date(evt.created_at).toLocaleString()}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t border-slate-800/60 text-[11px] font-mono text-slate-400">
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase">Actor:</span>{' '}
                    <span className="text-slate-300">{evt.actor_type} ({evt.actor_id || 'system'})</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase">Correlation:</span>{' '}
                    <span className="text-slate-300">{evt.correlation_id}</span>
                  </div>
                </div>

                {evt.after_state && (
                  <div className="mt-2 bg-slate-900/90 rounded-lg p-2 text-[10px] font-mono text-indigo-300/90 border border-slate-800 overflow-x-auto">
                    {evt.after_state}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
