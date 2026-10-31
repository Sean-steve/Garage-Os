import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Wrench, LifeBuoy, Truck, Radio, RefreshCw, ShieldAlert } from 'lucide-react';

export type DomainConsoleMode = 'providers' | 'workshop' | 'roadside' | 'towing' | 'dispatch';

interface BentoDomainConsoleProps {
  mode: DomainConsoleMode;
}

const config: Record<DomainConsoleMode, { title: string; subtitle: string; endpoint: string; icon: React.ComponentType<{ className?: string }> }> = {
  providers: {
    title: 'Provider Network',
    subtitle: 'GAR-011 service providers, branches, capabilities and discovery.',
    endpoint: '/api/v1/providers/search',
    icon: Building2,
  },
  workshop: {
    title: 'Garage Operations',
    subtitle: 'GAR-012 service cases and workshop execution state.',
    endpoint: '/api/v1/operations/service-cases',
    icon: Wrench,
  },
  roadside: {
    title: 'Roadside Assistance',
    subtitle: 'GAR-014 roadside incidents and assistance lifecycle.',
    endpoint: '/api/v1/roadside/incidents',
    icon: LifeBuoy,
  },
  towing: {
    title: 'Towing & Recovery',
    subtitle: 'GAR-015 tow requests, recovery and custody workflow.',
    endpoint: '/api/v1/towing/requests',
    icon: Truck,
  },
  dispatch: {
    title: 'Real-Time Dispatch',
    subtitle: 'GAR-016 authenticated operations overview. Platform-operations access is required.',
    endpoint: '/api/v1/dispatch/operations/overview',
    icon: Radio,
  },
};

function normalizeRecords(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['items', 'providers', 'service_cases', 'incidents', 'requests', 'data']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function labelFor(record: any): string {
  return record.display_name || record.name || record.title || record.work_order_number ||
    record.registration_number || record.id || 'Record';
}

function statusFor(record: any): string {
  return record.status || record.provider_status || record.assignment_status || record.state || 'ACTIVE';
}

export const BentoDomainConsole: React.FC<BentoDomainConsoleProps> = ({ mode }) => {
  const meta = config[mode];
  const Icon = meta.icon;
  const [payload, setPayload] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(meta.endpoint);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || json?.message || json?.error || `HTTP ${res.status}`);
      }
      setPayload(json.data ?? json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load domain data');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [meta.endpoint]);

  useEffect(() => { load(); }, [load]);

  const records = useMemo(() => normalizeRecords(payload), [payload]);

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-4">
            <div className="h-12 w-12 rounded-xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{meta.title}</h2>
              <p className="text-sm text-slate-400 mt-1">{meta.subtitle}</p>
            </div>
          </div>
          <button onClick={load} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-800 flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-amber-800/60 bg-amber-950/20 p-6">
          <div className="flex gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0" />
            <div>
              <p className="font-semibold text-amber-200">Access or data unavailable</p>
              <p className="text-sm text-amber-300/80 mt-1">{error}</p>
              <p className="text-xs text-slate-500 mt-3">This view deliberately respects the canonical backend authorization boundary; it does not fall back to mock data.</p>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="rounded-2xl border border-slate-800 p-8 text-sm text-slate-400">Loading canonical domain state…</div>
      ) : records.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {records.slice(0, 18).map((record, index) => (
            <article key={record.id || index} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-slate-100 break-words">{labelFor(record)}</h3>
                <span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300">{statusFor(record)}</span>
              </div>
              <dl className="mt-4 space-y-2 text-xs text-slate-400">
                {record.vehicle_id && <div><dt className="inline text-slate-500">Vehicle: </dt><dd className="inline">{record.vehicle_id}</dd></div>}
                {record.provider_id && <div><dt className="inline text-slate-500">Provider: </dt><dd className="inline">{record.provider_id}</dd></div>}
                {record.branch_id && <div><dt className="inline text-slate-500">Branch: </dt><dd className="inline">{record.branch_id}</dd></div>}
                {record.created_at && <div><dt className="inline text-slate-500">Created: </dt><dd className="inline">{new Date(record.created_at).toLocaleString()}</dd></div>}
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
          <p className="font-semibold">No records in this authorized view.</p>
          <p className="text-sm text-slate-500 mt-2">Garage OS will show real persisted state here as the workflow is used; no demo records are fabricated by this component.</p>
        </div>
      )}
    </section>
  );
};
