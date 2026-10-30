import React from 'react';
import { Shield, CheckCircle2, FileText, Code2, BookOpen } from 'lucide-react';
import { TraceabilityItem } from '../types';

interface BentoTraceabilityProps {
  items: TraceabilityItem[];
  constitutionalLawsCount: number;
}

export const BentoTraceability: React.FC<BentoTraceabilityProps> = ({
  items,
  constitutionalLawsCount,
}) => {
  return (
    <div className="space-y-6">
      {/* Top Banner Card */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-[32px] p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 backdrop-blur-sm">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-bold uppercase tracking-wider border border-indigo-500/20 mb-2">
            GAR-000 • Constitutional Architecture
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Traceability Matrix</h2>
          <p className="text-xs text-slate-400 max-w-xl leading-relaxed mt-1">
            Verification matrix mapping functional and architectural mandates to concrete domain models, repositories, and automated verification suites.
          </p>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-2xl px-5 py-3 text-right">
          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest block">
            Enforced Laws
          </span>
          <span className="text-2xl font-mono font-bold text-emerald-400">
            {constitutionalLawsCount} / 12
          </span>
        </div>
      </div>

      {/* Grid of Traceability Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {items.map((item) => (
          <div
            key={item.id}
            className="bg-slate-900/50 border border-slate-800 rounded-[28px] p-6 flex flex-col justify-between hover:border-slate-700/80 transition-all backdrop-blur-sm"
          >
            <div>
              <div className="flex justify-between items-start mb-3">
                <span className="font-mono text-xs font-bold text-indigo-300">{item.id}</span>
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {item.status}
                </span>
              </div>

              <h4 className="text-sm font-bold text-white mb-2">{item.title}</h4>
              <p className="text-xs text-slate-400 mb-4">{item.constitutional_law}</p>

              {/* Implemented files */}
              <div className="space-y-1 mb-4">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">
                  Implementation
                </span>
                <div className="flex flex-wrap gap-1">
                  {item.implemented_files.map((f) => (
                    <span
                      key={f}
                      className="px-2 py-0.5 bg-slate-950 border border-slate-800 text-slate-300 rounded text-[9px] font-mono"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Test coverage */}
            <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between text-[10px]">
              <span className="text-slate-500 uppercase tracking-widest font-semibold">Verification</span>
              <span className="font-mono text-indigo-300">{item.tests.join(', ')}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
