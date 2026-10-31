import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  Clock3,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

type ContactResponse = 'ACKNOWLEDGED' | 'CONTACTING_USER' | 'CANNOT_ASSIST';

interface PortalView {
  grant: {
    expires_at: string;
    status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  };
  contact: {
    display_name: string;
    relationship_label?: string | null;
  };
  owner: {
    display_name: string;
    callback_number?: string | null;
  };
  incident: {
    id: string;
    status: 'COUNTDOWN' | 'ACTIVATED' | 'CANCELLED' | 'CLOSED';
    incident_type?: string | null;
    incident_level: string;
    activated_at?: string | null;
    created_at: string;
  };
  vehicle?: {
    make?: string | null;
    model?: string | null;
    registration_number?: string | null;
  } | null;
  location?: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number | null;
    captured_at: string;
    expires_at: string;
  } | null;
  assistance?: {
    state: string;
    requested: boolean;
    accepted: boolean;
    arrived: boolean;
  } | null;
  latest_response?: {
    response: ContactResponse;
    created_at: string;
  } | null;
  permissions: {
    incident_type: boolean;
    vehicle_summary: boolean;
    live_location: boolean;
    assistance_status: boolean;
    callback_number: boolean;
  };
  safety_truth: {
    backend_acknowledged: boolean;
    trusted_contact_delivery_confirmed: boolean;
    assistance_requested: boolean;
    assistance_accepted: boolean;
    assistance_arrived: boolean;
  };
}

function unwrap(json: any) {
  return json?.data ?? json;
}

interface TrustedContactPortalProps {
  token: string;
}

export const TrustedContactPortal: React.FC<TrustedContactPortalProps> = ({ token }) => {
  const [view, setView] = useState<PortalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError('This trusted-contact link is missing its access token.');
      return;
    }

    try {
      const res = await fetch('/api/v1/safety/trusted-contact/access', {
        headers: { 'X-Trusted-Contact-Token': token },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.error?.message ||
          json?.message ||
          'This trusted-contact link is invalid, expired, or no longer active.'
        );
      }
      setView(unwrap(json));
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setView(null);
      setError(err instanceof Error ? err.message : 'Trusted-contact access is unavailable.');
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!view || view.incident.status !== 'ACTIVATED') return;
    const poll = window.setInterval(load, 10000);
    return () => window.clearInterval(poll);
  }, [view?.incident.id, view?.incident.status, load]);

  const respond = async (response: ContactResponse) => {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/safety/trusted-contact/response', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Trusted-Contact-Token': token,
        },
        body: JSON.stringify({ response }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || json?.message || 'Could not record your response.');
      }
      setView(unwrap(json));
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your response.');
    } finally {
      setBusy(false);
    }
  };

  const mapUrl = useMemo(() => {
    if (!view?.location) return null;
    const q = encodeURIComponent(`${view.location.latitude},${view.location.longitude}`);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }, [view?.location]);

  if (!view) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/80 p-7">
          <div className="h-12 w-12 rounded-xl bg-rose-500/15 text-rose-300 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-xl font-bold">Garage OS Trusted Contact</h1>
          <p className="mt-2 text-sm text-slate-400">
            {error || 'Loading the safety incident view…'}
          </p>
          <button
            onClick={load}
            className="mt-5 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold"
          >
            Try again
          </button>
          <p className="mt-5 text-xs text-slate-500">
            If you believe someone is in immediate danger, contact the appropriate local emergency service directly.
          </p>
        </div>
      </div>
    );
  }

  const incidentTime = view.incident.activated_at || view.incident.created_at;
  const vehicleLabel = view.vehicle
    ? [view.vehicle.make, view.vehicle.model, view.vehicle.registration_number].filter(Boolean).join(' ')
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-5 md:p-8">
      <main className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-2xl border border-rose-900/60 bg-rose-950/20 p-6">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-rose-500/15 text-rose-300 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest font-bold text-rose-300">Trusted contact safety view</p>
              <h1 className="text-2xl font-bold mt-1">{view.owner.display_name} activated Garage OS SOS</h1>
              <p className="text-sm text-slate-400 mt-2">
                This temporary link shows only the information authorized for you. It expires automatically and can be revoked at any time.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-amber-800/60 bg-amber-950/20 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-amber-200">Do not assume external help is on the way.</p>
              <p className="text-amber-300/80 mt-1">
                Garage OS backend acknowledgement, trusted-contact notification, and professional emergency/roadside assistance are separate states.
              </p>
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-3 text-sm text-amber-200">
            {error}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wider">
              <UserRound className="h-4 w-4" /> Incident
            </div>
            <p className="mt-3 text-lg font-bold">
              {view.incident.incident_type
                ? view.incident.incident_type.replaceAll('_', ' ')
                : 'Safety incident'}
            </p>
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
              <Clock3 className="h-4 w-4" />
              {new Date(incidentTime).toLocaleString()}
            </div>
            <p className="mt-2 text-xs text-slate-500">Status: {view.incident.status}</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-500">External assistance</p>
            {view.assistance ? (
              <>
                <p className={`mt-3 text-lg font-bold ${view.assistance.requested ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {view.assistance.state}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Requested: {view.assistance.requested ? 'Yes' : 'No'} • Accepted: {view.assistance.accepted ? 'Yes' : 'No'} • Arrived: {view.assistance.arrived ? 'Yes' : 'No'}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Assistance status was not shared with this contact.</p>
            )}
          </div>
        </section>

        {vehicleLabel && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
              <Car className="h-4 w-4" /> Vehicle
            </div>
            <p className="mt-3 font-semibold">{vehicleLabel}</p>
          </section>
        )}

        {view.location && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
              <MapPin className="h-4 w-4" /> Shared incident location
            </div>
            <p className="mt-3 text-sm">
              {view.location.latitude.toFixed(5)}, {view.location.longitude.toFixed(5)}
            </p>
            {view.location.accuracy_meters != null && (
              <p className="mt-1 text-xs text-slate-500">Approx. accuracy: {Math.round(view.location.accuracy_meters)} m</p>
            )}
            {mapUrl && (
              <a
                href={mapUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold"
              >
                <Navigation className="h-4 w-4" /> Navigate to location
              </a>
            )}
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2">
          {view.owner.callback_number && (
            <a
              href={`tel:${view.owner.callback_number}`}
              className="rounded-xl bg-emerald-700 px-4 py-3 text-center font-semibold flex items-center justify-center gap-2"
            >
              <Phone className="h-4 w-4" /> Call {view.owner.display_name}
            </a>
          )}
          <button
            onClick={load}
            className="rounded-xl border border-slate-700 px-4 py-3 font-semibold flex items-center justify-center gap-2"
          >
            <RefreshCw className="h-4 w-4" /> Refresh status
          </button>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="font-semibold">Let Garage OS know you saw this alert</p>
          <p className="mt-1 text-xs text-slate-500">
            Your response informs the owner’s incident record only. It does not mean a professional responder accepted the job.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <button
              disabled={busy}
              onClick={() => respond('ACKNOWLEDGED')}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Acknowledged
            </button>
            <button
              disabled={busy}
              onClick={() => respond('CONTACTING_USER')}
              className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-300 disabled:opacity-50"
            >
              Contacting them
            </button>
            <button
              disabled={busy}
              onClick={() => respond('CANNOT_ASSIST')}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Cannot assist
            </button>
          </div>

          {view.latest_response && (
            <div className="mt-4 flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              Latest response: {view.latest_response.response.replaceAll('_', ' ')}
            </div>
          )}
        </section>

        <footer className="pb-8 text-xs text-slate-500 space-y-2">
          <p>Link expires: {new Date(view.grant.expires_at).toLocaleString()}.</p>
          <p>
            If you believe there is immediate danger, contact the appropriate local emergency service directly rather than relying only on this page.
          </p>
          {lastUpdated && <p>Last refreshed: {lastUpdated.toLocaleTimeString()}.</p>}
        </footer>
      </main>
    </div>
  );
};
