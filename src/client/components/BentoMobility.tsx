import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Car,
  Crosshair,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldAlert,
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
  safety_escalation_required?: boolean;
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

interface LocationDraft {
  latitude: string;
  longitude: string;
  accuracy: number | null;
  landmark: string;
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

function unwrapError(payload: any, fallback: string): string {
  return payload?.error?.message || payload?.message || fallback;
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
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [incidentType, setIncidentType] = useState('BATTERY_DEAD');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [injuriesPresent, setInjuriesPresent] = useState(false);
  const [smokeOrFire, setSmokeOrFire] = useState(false);
  const [liveLane, setLiveLane] = useState(false);
  const [occupantsUnsafe, setOccupantsUnsafe] = useState(false);

  const [towReason, setTowReason] = useState('BREAKDOWN');
  const [towDestination, setTowDestination] = useState('');
  const [towMobility, setTowMobility] = useState('UNKNOWN');

  const [location, setLocation] = useState<LocationDraft>({
    latitude: '',
    longitude: '',
    accuracy: null,
    landmark: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const vehicleQuery = selectedVehicleId
        ? `?vehicle_id=${encodeURIComponent(selectedVehicleId)}`
        : '';
      const [roadsideRes, towRes, providerRes] = await Promise.all([
        fetch(`/api/v1/roadside/incidents${vehicleQuery}`, { credentials: 'same-origin' }),
        fetch(`/api/v1/towing/requests${vehicleQuery}`, { credentials: 'same-origin' }),
        fetch('/api/v1/providers/search?accepts_roadside=true&limit=8', { credentials: 'same-origin' }),
      ]);

      if (!roadsideRes.ok || !towRes.ok) {
        throw new Error('Mobility records could not be loaded for the current session.');
      }

      const roadsideJson = await roadsideRes.json();
      const towJson = await towRes.json();
      const providerJson = providerRes.ok ? await providerRes.json() : { data: [] };

      setRoadside(roadsideJson.data || []);
      setTows(towJson.data || []);
      setProviders(providerJson.data || providerJson.items || providerJson.data?.items || []);
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

  const captureCurrentLocation = async () => {
    setActionMessage(null);
    if (!navigator.geolocation) {
      setActionMessage('Geolocation is unavailable. Enter latitude and longitude manually.');
      return;
    }

    setActionBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation((current) => ({
          ...current,
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
          accuracy: position.coords.accuracy,
        }));
        setActionMessage(
          `Location captured with approximately ${Math.round(position.coords.accuracy)} m accuracy. Confirm before requesting help.`
        );
        setActionBusy(false);
      },
      () => {
        setActionMessage('Location could not be read. Enter latitude and longitude manually.');
        setActionBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  };

  const parsedLocation = () => {
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new Error('Confirm a valid vehicle location before continuing.');
    }
    return { latitude, longitude };
  };

  const submitRoadside = async () => {
    if (!selectedVehicleId) return;
    setActionBusy(true);
    setError(null);
    setActionMessage(null);
    try {
      const coords = parsedLocation();
      const answers = {
        injuries_present: injuriesPresent,
        smoke_or_fire_detected: smokeOrFire,
        is_live_highway_lane: liveLane,
        occupants_feel_unsafe: occupantsUnsafe,
      };

      const createResponse = await fetch('/api/v1/roadside/incidents', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: selectedVehicleId,
          incident_type: incidentType,
          description: incidentDescription || undefined,
          location: {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy_meters: location.accuracy,
            landmark_description: location.landmark || undefined,
            source: location.accuracy != null ? 'DEVICE_GPS' : 'USER_MANUAL',
            is_dangerous_location: liveLane,
          },
          initial_answers: answers,
        }),
      });
      const createPayload = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(unwrapError(createPayload, 'Roadside incident could not be created.'));
      }

      const incident = createPayload.data?.incident || createPayload.data;
      const incidentId = incident?.id;
      if (!incidentId) throw new Error('Roadside incident was created without a canonical ID.');

      const triageResponse = await fetch(
        `/api/v1/roadside/incidents/${encodeURIComponent(incidentId)}/triage`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        }
      );
      const triagePayload = await triageResponse.json();
      if (!triageResponse.ok) {
        throw new Error(unwrapError(triagePayload, 'Roadside triage could not be completed.'));
      }

      const triage = triagePayload.data?.triage_record || triagePayload.data?.triage || triagePayload.data;
      if (triage?.safety_escalation_required) {
        setActionMessage(
          'Immediate safety escalation is required. Ordinary roadside dispatch has not been started. Use emergency services appropriate to your location while Garage OS preserves the incident record.'
        );
        await load();
        return;
      }

      const assistanceResponse = await fetch(
        `/api/v1/roadside/incidents/${encodeURIComponent(incidentId)}/request-assistance`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ search_radius_km: 35 }),
        }
      );
      const assistancePayload = await assistanceResponse.json();
      if (!assistanceResponse.ok) {
        throw new Error(unwrapError(assistancePayload, 'Roadside assistance could not be requested.'));
      }

      const offerCount = assistancePayload.data?.offers?.length || 0;
      setActionMessage(
        offerCount > 0
          ? `Roadside request created and offered to ${offerCount} eligible provider(s). No provider is shown as assigned until one accepts.`
          : 'Roadside request created. No eligible provider has accepted or been sourced yet.'
      );
      setIncidentDescription('');
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Roadside request failed.';
      setError(message);
      onNotify?.(message);
    } finally {
      setActionBusy(false);
    }
  };

  const submitTow = async () => {
    if (!selectedVehicleId) return;
    setActionBusy(true);
    setError(null);
    setActionMessage(null);
    try {
      const coords = parsedLocation();
      if (!towDestination.trim()) {
        throw new Error('Enter the tow destination before requesting recovery.');
      }

      const response = await fetch('/api/v1/towing/requests', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: selectedVehicleId,
          tow_reason: towReason,
          recovery_type: 'STANDARD_TOW',
          vehicle_mobility_state: towMobility,
          vehicle_condition_state: 'NORMAL_BREAKDOWN',
          pickup_location: {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy_meters: location.accuracy,
            landmark: location.landmark || undefined,
            address_summary: location.landmark || 'Current vehicle location',
            source_type: location.accuracy != null ? 'DEVICE_GPS' : 'MANUAL_ENTRY',
          },
          destination: {
            destination_type: 'OTHER',
            address_summary: towDestination.trim(),
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(unwrapError(payload, 'Tow request could not be created.'));
      }

      setActionMessage(
        'Tow request created. Provider acceptance, recovery-unit assignment, loading, transit and delivery will appear only when each canonical state is actually reached.'
      );
      setTowDestination('');
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tow request failed.';
      setError(message);
      onNotify?.(message);
    } finally {
      setActionBusy(false);
    }
  };

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
            State-truthful mobility operations. Request creation, provider acceptance, assignment,
            en-route, arrival and delivery remain distinct states.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading || actionBusy}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:border-indigo-500/50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label>
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Vehicle context
            </span>
            <select
              value={selectedVehicleId}
              onChange={(event) => onSelectVehicle(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.display_name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={captureCurrentLocation}
            disabled={actionBusy}
            className="flex items-center justify-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-bold text-indigo-200 disabled:opacity-50"
          >
            <Crosshair className="h-3.5 w-3.5" />
            Use current location
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <input
            value={location.latitude}
            onChange={(event) => setLocation((current) => ({ ...current, latitude: event.target.value, accuracy: null }))}
            placeholder="Latitude"
            inputMode="decimal"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          />
          <input
            value={location.longitude}
            onChange={(event) => setLocation((current) => ({ ...current, longitude: event.target.value, accuracy: null }))}
            placeholder="Longitude"
            inputMode="decimal"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          />
          <input
            value={location.landmark}
            onChange={(event) => setLocation((current) => ({ ...current, landmark: event.target.value }))}
            placeholder="Landmark / road"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          />
        </div>
      </div>

      {actionMessage && (
        <div className="flex items-start gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4 text-sm text-indigo-100">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-amber-500/20 bg-slate-900/70 p-5">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-amber-300" />
            <div>
              <h3 className="font-bold text-white">Request roadside help</h3>
              <p className="text-xs text-slate-500">Safety triage is mandatory before provider sourcing.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <select
              value={incidentType}
              onChange={(event) => setIncidentType(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="BATTERY_DEAD">Dead battery / no start</option>
              <option value="PUNCTURE_OR_FLAT_TYRE">Flat tyre / puncture</option>
              <option value="ENGINE_OVERHEAT">Overheating</option>
              <option value="ELECTRICAL_OR_STARTER">Electrical / starter</option>
              <option value="MECHANICAL_BREAKDOWN">Mechanical breakdown</option>
              <option value="FUEL_STARVATION_OR_CONTAMINATION">Fuel problem</option>
              <option value="LOCKOUT">Lockout</option>
              <option value="UNKNOWN_NOISE_OR_SMOKE">Unknown noise / smoke</option>
              <option value="OTHER_BREAKDOWN">Other breakdown</option>
            </select>

            <textarea
              value={incidentDescription}
              onChange={(event) => setIncidentDescription(event.target.value)}
              placeholder="What is happening?"
              rows={3}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />

            <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <input type="checkbox" checked={injuriesPresent} onChange={(event) => setInjuriesPresent(event.target.checked)} />
                Injuries reported
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <input type="checkbox" checked={smokeOrFire} onChange={(event) => setSmokeOrFire(event.target.checked)} />
                Smoke or fire
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <input type="checkbox" checked={liveLane} onChange={(event) => setLiveLane(event.target.checked)} />
                Vehicle is in a live traffic lane
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <input type="checkbox" checked={occupantsUnsafe} onChange={(event) => setOccupantsUnsafe(event.target.checked)} />
                Occupants feel unsafe
              </label>
            </div>

            {(injuriesPresent || smokeOrFire || liveLane || occupantsUnsafe) && (
              <div className="flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-100">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                These answers may require an emergency safety route. Garage OS will not pretend ordinary roadside dispatch is sufficient.
              </div>
            )}

            <button
              onClick={submitRoadside}
              disabled={actionBusy || !selectedVehicleId}
              className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-black text-slate-950 disabled:opacity-50"
            >
              {actionBusy ? 'Processing…' : 'Run triage & request help'}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-indigo-500/20 bg-slate-900/70 p-5">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-indigo-300" />
            <div>
              <h3 className="font-bold text-white">Request towing</h3>
              <p className="text-xs text-slate-500">A tow request is not a dispatched truck.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <select
              value={towReason}
              onChange={(event) => setTowReason(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="BREAKDOWN">Breakdown</option>
              <option value="NON_START">Vehicle will not start</option>
              <option value="OVERHEATING">Overheating</option>
              <option value="TYRE_FAILURE">Tyre failure</option>
              <option value="ACCIDENT_DAMAGE">Accident damage</option>
              <option value="TRANSPORT_TO_GARAGE">Transport to garage</option>
              <option value="VEHICLE_RELOCATION">Vehicle relocation</option>
              <option value="OTHER">Other</option>
            </select>

            <select
              value={towMobility}
              onChange={(event) => setTowMobility(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="UNKNOWN">Mobility unknown</option>
              <option value="ROLLS_AND_STEERS">Vehicle rolls and steers</option>
              <option value="ROLLS_NOT_STEERS">Rolls but does not steer</option>
              <option value="STEERS_NOT_ROLLS">Steers but does not roll</option>
              <option value="IMMOBILE">Vehicle is immobile</option>
              <option value="WHEELS_LOCKED">Wheels locked</option>
              <option value="DAMAGED_SUSPENSION">Suspension / wheel damage</option>
            </select>

            <textarea
              value={towDestination}
              onChange={(event) => setTowDestination(event.target.value)}
              placeholder="Destination garage / address"
              rows={3}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs leading-5 text-slate-500">
              Tow price remains unknown until an authoritative provider quote/rate is available. Straight-line distance is never converted into a fake mileage charge.
            </div>

            <button
              onClick={submitTow}
              disabled={actionBusy || !selectedVehicleId}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
            >
              {actionBusy ? 'Processing…' : 'Request tow'}
            </button>
          </div>
        </section>
      </div>

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
          <p className="mt-1 text-xs text-slate-500">Discoverable providers in current result set</p>
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
                {incident.safety_escalation_required && (
                  <div className="mt-3 flex items-center gap-2 text-[11px] font-bold text-rose-300">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Emergency safety escalation required
                  </div>
                )}
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
        live responder location and ETA remain protected behind assignment-scoped authorization.
        Stale tracking is represented as stale/unavailable rather than as a live location.
      </div>
    </div>
  );
};
