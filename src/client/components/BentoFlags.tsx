import React, { useState } from 'react';
import { Sliders, Check, Shield, Users, Sparkles } from 'lucide-react';
import { FeatureFlag } from '../types';

interface BentoFlagsProps {
  flags: FeatureFlag[];
  onToggleFlag: (key: string, enabled: boolean, percentage?: number) => Promise<void>;
  onRefresh: () => void;
}

export const BentoFlags: React.FC<BentoFlagsProps> = ({ flags, onToggleFlag, onRefresh }) => {
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const handleToggle = async (key: string, current: boolean) => {
    setUpdatingKey(key);
    try {
      await onToggleFlag(key, !current);
    } finally {
      setUpdatingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Card */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-[32px] p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 backdrop-blur-sm">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-bold uppercase tracking-wider border border-indigo-500/20 mb-2">
            GAR-046 • Controlled Rollout Engine
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">System Feature Flags</h2>
          <p className="text-xs text-slate-400 max-w-xl leading-relaxed mt-1">
            Dynamic capability gating with percentage-based exposure, deterministic user hashing, and role verification.
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl uppercase tracking-wider border border-slate-700 transition-colors cursor-pointer"
        >
          Reload Flags
        </button>
      </div>

      {/* Bento Grid of Feature Flags */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {flags.map((flag) => {
          const isUpdating = updatingKey === flag.key;
          return (
            <div
              key={flag.key}
              className={`border rounded-[28px] p-6 flex flex-col justify-between transition-all duration-300 backdrop-blur-sm ${
                flag.enabled
                  ? 'bg-slate-900/60 border-slate-800 hover:border-indigo-500/40 shadow-lg shadow-indigo-950/10'
                  : 'bg-slate-950/40 border-slate-900 opacity-80'
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-3">
                  <span className="font-mono text-xs font-bold text-indigo-300">{flag.key}</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                      flag.enabled
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {flag.enabled ? 'ACTIVE' : 'DISABLED'}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-white mb-2">{flag.description}</h4>

                {/* Roles allowed */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {flag.roles.map((r) => (
                    <span
                      key={r}
                      className="px-2 py-0.5 bg-slate-800/80 border border-slate-700/60 text-slate-300 rounded-md text-[9px] font-mono"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>

              {/* Bottom control row */}
              <div className="pt-4 border-t border-slate-800/60 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">Rollout: {flag.percentage}%</span>

                {/* Toggle switch */}
                <button
                  disabled={isUpdating}
                  onClick={() => handleToggle(flag.key, flag.enabled)}
                  className={`w-11 h-6 rounded-full relative p-0.5 transition-colors cursor-pointer ${
                    flag.enabled ? 'bg-indigo-600' : 'bg-slate-800'
                  } ${isUpdating ? 'opacity-50' : ''}`}
                  title={`Toggle ${flag.key}`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transition-transform duration-200 shadow-sm ${
                      flag.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
