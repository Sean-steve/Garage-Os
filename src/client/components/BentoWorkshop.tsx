import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, ClipboardCheck, RefreshCw, Wrench, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface ProviderSummary {
  id: string;
  name: string;
  status: string;
  verification_status?: string;
}

interface ServiceCase {
  id: string;
  service_case_number?: string;
  vehicle_id: string;
  status: string;
  source_type?: string;
  opened_at?: string;
}

interface WorkOrder {
  id: string;
  work_order_number?: string;
  service_case_id: string;
  vehicle_id: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
}

interface BentoWorkshopProps {
  onNotify?: (message: string) => void;
}

function statusClass(status: string): string {
  if (/COMPLETED|RELEASED|PASS/.test(status)) return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300';
  if (/CANCELLED|FAILED/.test(status)) return 'bg-rose-500/10 border-rose-500/30 text-rose-300';
  if (/IN_PROGRESS|QUALITY|CHECKED_IN/.test(status)) return 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300';
  return 'bg-amber-500/10 border-amber-500/30 text-amber-300';
}

export const BentoWorkshop: React.FC<BentoWorkshopProps> = ({ onNotify }) => {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providerId, setProviderId] = useState('');
  const [serviceCases, setServiceCases] = useState<ServiceCase[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    const response = await fetch('/api/v1/providers/mine', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to resolve your provider workspace.');
    const payload = await response.json();
    const list = payload.providers || payload.data?.providers || [];
    setProviders(list);
    setProviderId((current) => current || list[0]?.id || '');
    return list as ProviderSummary[];
  }, []);

  const loadOperations = useCallback(async (selectedProviderId: string) => {
    if (!selectedProviderId) {
      setServiceCases([]);
      setWorkOrders([]);
      return;
    }
    const query = encodeURIComponent(selectedProviderId);
    const [casesResponse, ordersResponse] = await Promise.all([
      fetch(`/api/v1/operations/service-cases?provider_id=${query}`, { credentials: 'same-origin' }),
      fetch(`/api/v1/operations/work-orders?provider_id=${query}`, { credentials: 'same-origin' }),
    ]);
    if (!casesResponse.ok || !ordersResponse.ok) {
      throw new Error('Workshop operations are not accessible for this provider role.');
    }
    const casesPayload = await casesResponse.json();
    const ordersPayload = await ordersResponse.json();
    setServiceCases(casesPayload.data || []);
    setWorkOrders(ordersPayload.data || []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = providers.length ? providers : await loadProviders();
      const selected = providerId || list[0]?.id || '';
      await loadOperations(selected);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load workshop workspace.';
      setError(message);
      onNotify?.(message);
    } finally {
      setLoading(false);
    }
  }, [providers, providerId, loadProviders, loadOperations, onNotify]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (providerId) loadOperations(providerId).catch((err) => setError(err.message));
  }, [providerId, loadOperations]);

  const activeCases = useMemo(
    () => serviceCases.filter((item) => !/RELEASED|CANCELLED|CLOSED|COMPLETED/.test(item.status)),
    [serviceCases]
  );
  const activeOrders = useMemo(
    () => workOrders.filter((item) => !/COMPLETED|CANCELLED/.test(item.status)),
    [workOrders]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-300">
            <Building2 className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Sprints 9–10</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">Workshop Operations</h2>
          <p className="mt-1 text-sm text-slate-400">
            Provider-scoped service cases and work orders. Internal workshop records are not exposed through the owner experience.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {providers.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Provider workspace
          </label>
          <select
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white md:max-w-lg"
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="flex gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Vehicles in workflow</p>
          <p className="mt-2 text-3xl font-black text-white">{activeCases.length}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Active work orders</p>
          <p className="mt-2 text-3xl font-black text-white">{activeOrders.length}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Completed work orders</p>
          <p className="mt-2 text-3xl font-black text-white">
            {workOrders.filter((item) => item.status === 'COMPLETED').length}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-indigo-300" />
            <h3 className="font-bold text-white">Service cases</h3>
          </div>
          <div className="space-y-3">
            {!loading && serviceCases.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-800 p-5 text-sm text-slate-500">
                No service cases are available for this provider.
              </p>
            )}
            {serviceCases.slice(0, 12).map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">{item.service_case_number || item.id}</p>
                    <p className="mt-1 text-xs text-slate-500">Vehicle {item.vehicle_id}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${statusClass(item.status)}`}>
                    {item.status.replaceAll('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Wrench className="h-4 w-4 text-amber-300" />
            <h3 className="font-bold text-white">Work orders</h3>
          </div>
          <div className="space-y-3">
            {!loading && workOrders.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-800 p-5 text-sm text-slate-500">
                No work orders are available for this provider.
              </p>
            )}
            {workOrders.slice(0, 12).map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">{item.work_order_number || item.id}</p>
                    <p className="mt-1 text-xs text-slate-500">Case {item.service_case_id}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${statusClass(item.status)}`}>
                    {item.status.replaceAll('_', ' ')}
                  </span>
                </div>
                {item.status === 'COMPLETED' && (
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Workshop execution complete
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
