import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Car,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldCheck,
  Truck,
  Wrench,
} from 'lucide-react';
import { VehicleSummary } from '../types';

interface BentoMobilityProps {
  vehicles: VehicleSummary[];
  selectedVehicleId: string;
  onSelectVehicle: (id: string) => void;
  onNotify?: (message: string) => void;
}

interface RoadsideIncident {
  id: string;
  incident_number?: string;
  vehicle_id: string;
  incident_type: string;
  severity?: string;
  status: string;
  initial_drivability?: string;
  occupant_safety_state?: string;
  active_assignment_id?: string | null;
  created_at?: string;
}

interface TowRequest {
  id: string;
  request_number?: string;
  vehicle_id: string;
  tow_reason: string;
  recovery_type?: string;
  status: string;
  assigned_provider_id?: string | null;
  active_assignment_id?: string | null;
  requested_at?: string;
  created_at?: string;
}

function badgeClass(status: string): string {
  if (/COMPLETED|CLOSED|RESOLVED|DELIVERED/i.test(status)) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  if (/FAILED|CANCELLED|EXHAUSTED/i.test(status)) {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  }
  if (/ASSIGNED|EN_ROUTE|ARRIVED|IN_PROGRESS|TRANSIT|LOADING/i.test(status)) {
    return 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300';
  }
  return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
}

export const BentoMobility: React.FC<BentoMobilityProps> = ({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  onNotify,
}) => {
  const [roadside, setRoadside] = useState<RoadsideIncident[]>([]);
  const [tows, setTows] = useState<TowRequest[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const vehicleQuery = selectedVehicleId
        ? `?vehicle_id=${encodeURIComponent(selectedVehicleId)}`
        : '';
      const [roadsideRes, towRes, providerRes] = await Promise.all([
        fetch(`/api/v1/roadside/incidents${vehicleQuery}`),
        fetch(`/api/v1/towing/requests${vehicleQuery}`),
        fetch('/api/v1/providers/search?accepts_roadside=true&limit=8'),
      ]);

      if (!roadsideRes.ok || !towRes.ok) {
        throw new Error('Mobility records could not be loaded for the current session.');
      }

      const roadsideJson = await roadsideRes.json();
      const towJson = await towRes.json();
      const providerJson = providerRes.ok ? await providerRes.json() : { data: [] };

      setRoadside(roadsideJson.data || []);
      setTows(towJson.data || []);
      setProviders(providerJson.data || providerJson.items || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load mobility state.';
      setError(message);
      onNotify?.(message);
    } finally {
      setLoading(false);
    }
  }, [selectedVehicleId, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  const activeRoadside = useMemo(
    () => roadside.filter((item) => !/CLOSED|CANCELLED|RESOLVED/.test(item.status)),
    [roadside]
  );
  const activeTows = useMemo(
    () => tows.filter((item) => !/COMPLETED|CANCELLED|DELIVERED|FAILED/.test(item.status)),
    [tows]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-300">
            <Navigation className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Sprints 12–14</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">Roadside, Towing & Dispatch</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            State-truthful mobility operations. A request is not shown as assigned, en route or delivered until the canonical backend reaches that state.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:border-indigo-500/50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Vehicle context
        </label>
        <select
          value={selectedVehicleId}
          onChange={(event) => onSelectVehicle(event.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white md:max-w-md"
        >
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.display_name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <Wrench className="h-5 w-5 text-amber-300" />
            <span className="text-2xl font-black text-white">{activeRoadside.length}</span>
          </div>
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-slate-400">Active roadside</p>
          <p className="mt-1 text-xs text-slate-500">{roadside.length} total incident records</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <Truck className="h-5 w-5 text-indigo-300" />
            <span className="text-2xl font-black text-white">{activeTows.length}</span>
          </div>
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-slate-400">Active recovery</p>
          <p className="mt-1 text-xs text-slate-500">{tows.length} total tow records</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            <span className="text-2xl font-black text-white">{providers.length}</span>
          </div>
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-slate-400">Roadside network</p>
          <p className="mt-1 text-xs text-slate-500">Eligible discoverable providers in current result set</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-300" />
            <h3 className="font-bold text-white">Roadside incidents</h3>
          </div>
          <div className="space-y-3">
            {roadside.length === 0 && !loading && (
              <p className="rounded-lg border border-dashed border-slate-800 p-5 text-sm text-slate-500">
                No roadside incident has been recorded for this vehicle.
              </p>
            )}
            {roadside.map((incident) => (
              <div key={incident.id} className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">
                      {incident.incident_number || incident.id}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {incident.incident_type.replaceAll('_', ' ')}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${badgeClass(incident.status)}`}>
                    {incident.status.replaceAll('_', ' ')}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                  <span>Safety: {incident.occupant_safety_state || 'UNKNOWN'}</span>
                  <span>Drivability: {incident.initial_drivability || 'UNKNOWN'}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Truck className="h-4 w-4 text-indigo-300" />
            <h3 className="font-bold text-white">Tow & recovery</h3>
          </div>
          <div className="space-y-3">
            {tows.length === 0 && !loading && (
              <p className="rounded-lg border border-dashed border-slate-800 p-5 text-sm text-slate-500">
                No tow request has been recorded for this vehicle.
              </p>
            )}
            {tows.map((tow) => (
              <div key={tow.id} className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">{tow.request_number || tow.id}</p>
                    <p className="mt-1 text-xs text-slate-400">{tow.tow_reason.replaceAll('_', ' ')}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${badgeClass(tow.status)}`}>
                    {tow.status.replaceAll('_', ' ')}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                  <Car className="h-3 w-3" />
                  <span>{tow.recovery_type?.replaceAll('_', ' ') || 'Recovery type pending'}</span>
                  {tow.assigned_provider_id && (
                    <>
                      <MapPin className="ml-2 h-3 w-3" />
                      <span>Provider assigned</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-xs text-slate-400">
        <span className="font-bold text-indigo-300">Dispatch safety:</span>{' '}
        live responder location and ETA remain protected behind assignment-scoped authorization. Stale tracking is represented as stale/unavailable rather than as a live location.
      </div>
    </div>
  );
};
