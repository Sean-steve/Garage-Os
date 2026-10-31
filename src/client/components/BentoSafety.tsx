import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Siren,
  Trash2,
  Users,
} from 'lucide-react';

type IncidentLevel = 'ASSISTANCE' | 'BREAKDOWN' | 'SERIOUS_EMERGENCY';

interface ContactScope {
  id: string;
  contact_id: string;
  incident_level: IncidentLevel;
  notify_contact: boolean;
  share_incident_type: boolean;
  share_vehicle_summary: boolean;
  share_live_location: boolean;
  share_assistance_status: boolean;
  share_callback_number: boolean;
}

interface EmergencyContact {
  id: string;
  display_name: string;
  relationship_label?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  priority: number;
  verification_status: string;
  scopes: ContactScope[];
}

interface SafetyPreferences {
  emergency_circle_enabled: boolean;
  allow_location_sharing: boolean;
  safety_check_enabled: boolean;
  safety_check_timeout_seconds: number;
  sos_cancel_countdown_seconds: number;
  escalation_sequence_enabled: boolean;
}

interface SafetyReadiness {
  state: 'DISABLED' | 'INCOMPLETE' | 'CONFIGURED';
  active_contact_count: number;
  contacts_with_phone_count: number;
  location_sharing_enabled: boolean;
  safety_check_enabled: boolean;
  sos_engine_active: boolean;
  notification_engine_active: boolean;
  trusted_contact_portal_active: boolean;
  blockers: string[];
  notes: string[];
}

interface EmergencyCirclePayload {
  contacts: EmergencyContact[];
  preferences: SafetyPreferences;
  readiness: SafetyReadiness;
  execution_capabilities: Record<string, boolean>;
}

interface TrustedAccessGrantSummary {
  id: string;
  contact_id: string;
  contact_name: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expires_at: string;
  first_accessed_at?: string | null;
  last_accessed_at?: string | null;
  notification_status?: string | null;
  latest_response?: {
    response: 'ACKNOWLEDGED' | 'CONTACTING_USER' | 'CANNOT_ASSIST';
    created_at: string;
  } | null;
}

interface SosAggregate {
  incident: {
    id: string;
    status: 'COUNTDOWN' | 'ACTIVATED' | 'CANCELLED' | 'CLOSED';
    incident_type: string;
    server_acknowledged_at: string;
    cancel_deadline_at: string;
    activated_at?: string | null;
    notification_state: string;
    safety_check_state: string;
    assistance_state: string;
  };
  location: {
    latitude: number;
    longitude: number;
    accuracy_meters?: number | null;
    expires_at: string;
  } | null;
  notification_attempts: Array<{
    id: string;
    priority: number;
    channel: 'SMS' | 'EMAIL';
    status: string;
    provider_name?: string | null;
    delivered_at?: string | null;
    failure_code?: string | null;
  }>;
  safety_check: {
    id: string;
    status: 'PENDING' | 'RESPONDED' | 'TIMED_OUT';
    due_at: string;
    response?: 'OKAY' | 'NEED_HELP' | 'CANNOT_CONFIRM' | null;
  } | null;
  acknowledgement: {
    backend_acknowledged: boolean;
    activation_complete: boolean;
    trusted_contact_delivery_confirmed: boolean;
    assistance_requested: boolean;
    assistance_accepted: boolean;
    assistance_arrived: boolean;
  };
}

const levelLabels: Record<IncidentLevel, string> = {
  ASSISTANCE: 'Assistance',
  BREAKDOWN: 'Breakdown',
  SERIOUS_EMERGENCY: 'Serious emergency',
};

function unwrap(json: any) {
  return json?.data ?? json;
}

async function captureLocation(enabled: boolean) {
  if (!enabled || !navigator.geolocation) return null;
  return await new Promise<any>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_meters: position.coords.accuracy,
          captured_at: new Date(position.timestamp).toISOString(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 15000 }
    );
  });
}

export const BentoSafety: React.FC = () => {
  const [data, setData] = useState<EmergencyCirclePayload | null>(null);
  const [activeSos, setActiveSos] = useState<SosAggregate | null>(null);
  const [trustedAccess, setTrustedAccess] = useState<TrustedAccessGrantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [form, setForm] = useState({
    display_name: '',
    relationship_label: '',
    phone_e164: '',
    email: '',
    priority: 1,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [circleRes, sosRes] = await Promise.all([
        fetch('/api/v1/safety/emergency-circle'),
        fetch('/api/v1/safety/sos/active'),
      ]);
      const circleJson = await circleRes.json();
      const sosJson = await sosRes.json();
      if (!circleRes.ok) throw new Error(circleJson?.error?.message || circleJson?.message || 'Unable to load Safety Center');
      if (!sosRes.ok) throw new Error(sosJson?.error?.message || sosJson?.message || 'Unable to load SOS state');
      const sosData = unwrap(sosJson) || null;
      setData(unwrap(circleJson));
      setActiveSos(sosData);
      if (sosData?.incident?.id) {
        const accessRes = await fetch(`/api/v1/safety/sos/incidents/${sosData.incident.id}/trusted-contact-access`);
        if (accessRes.ok) {
          const accessJson = await accessRes.json();
          setTrustedAccess(unwrap(accessJson) || []);
        }
      } else {
        setTrustedAccess([]);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to load Safety Center');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!activeSos || !['COUNTDOWN', 'ACTIVATED'].includes(activeSos.incident.status)) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/v1/safety/sos/active');
        if (!res.ok) return;
        const json = await res.json();
        const sosData = unwrap(json) || null;
        setActiveSos(sosData);
        if (sosData?.incident?.id) {
          const accessRes = await fetch(`/api/v1/safety/sos/incidents/${sosData.incident.id}/trusted-contact-access`);
          if (accessRes.ok) {
            const accessJson = await accessRes.json();
            setTrustedAccess(unwrap(accessJson) || []);
          }
        }
      } catch {
        // Keep the last authoritative server state visible.
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [activeSos?.incident.id, activeSos?.incident.status]);

  const countdownSeconds = useMemo(() => {
    if (!activeSos || activeSos.incident.status !== 'COUNTDOWN') return 0;
    return Math.max(0, Math.ceil((new Date(activeSos.incident.cancel_deadline_at).getTime() - now) / 1000));
  }, [activeSos, now]);

  const startSos = async () => {
    if (!data) return;
    setBusy(true);
    setMessage('Requesting backend acknowledgement…');
    try {
      const location = await captureLocation(data.preferences.allow_location_sharing);
      const res = await fetch('/api/v1/safety/sos/attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `sos-${Date.now()}` },
        body: JSON.stringify({
          incident_level: 'SERIOUS_EMERGENCY',
          incident_type: 'USER_REQUESTED_SOS',
          activation_source: 'USER_SOS_BUTTON',
          client_requested_at: new Date().toISOString(),
          location,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json?.message || 'SOS activation attempt failed');
      const aggregate = unwrap(json) as SosAggregate;
      setActiveSos(aggregate);
      setMessage(
        aggregate.acknowledgement.backend_acknowledged
          ? 'Garage OS backend acknowledged the SOS attempt. Cancel during the countdown if this was accidental.'
          : 'SOS attempt has not been acknowledged by the backend.'
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'SOS activation attempt failed');
    } finally {
      setBusy(false);
    }
  };

  const cancelSos = async () => {
    if (!activeSos) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/safety/sos/incidents/${activeSos.incident.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'USER_CANCELLED_DURING_COUNTDOWN' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json?.message || 'Unable to cancel SOS');
      setActiveSos(null);
      setMessage('SOS cancelled before activation. No new trusted-contact notifications were queued.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to cancel SOS');
    } finally {
      setBusy(false);
    }
  };

  const answerSafetyCheck = async (response: 'OKAY' | 'NEED_HELP' | 'CANNOT_CONFIRM') => {
    if (!activeSos) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/safety/sos/incidents/${activeSos.incident.id}/safety-check-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json?.message || 'Unable to record safety check');
      setActiveSos(unwrap(json));
      setMessage(
        response === 'NEED_HELP'
          ? 'Your need-help response is recorded. This does not mean an external emergency provider has accepted or arrived.'
          : 'Safety check response recorded.'
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to record safety check');
    } finally {
      setBusy(false);
    }
  };

  const closeSos = async () => {
    if (!activeSos) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/safety/sos/incidents/${activeSos.incident.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'USER_CONFIRMED_INCIDENT_CLOSED' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json?.message || 'Unable to close SOS');
      setActiveSos(null);
      setMessage('SOS incident closed. Emergency-location access has been revoked.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to close SOS');
    } finally {
      setBusy(false);
    }
  };

  const revokeTrustedAccess = async () => {
    if (!activeSos) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/safety/sos/incidents/${activeSos.incident.id}/trusted-contact-access/revoke`,
        { method: 'POST' }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json?.message || 'Unable to revoke trusted-contact access');
      setMessage(`Revoked ${unwrap(json)?.revoked_grant_count || 0} active trusted-contact link(s).`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to revoke trusted-contact access');
    } finally {
      setBusy(false);
    }
  };

  const addContact = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/v1/safety/emergency-circle/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: form.display_name,
          relationship_label: form.relationship_label || null,
          phone_e164: form.phone_e164 || null,
          email: form.email || null,
          priority: Number(form.priority),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json?.message || 'Could not add contact');
      setForm({ display_name: '', relationship_label: '', phone_e164: '', email: '', priority: 1 });
      setMessage('Emergency Circle contact added.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not add contact');
    } finally {
      setBusy(false);
    }
  };

  const revokeContact = async (contactId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/safety/emergency-circle/contacts/${contactId}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error?.message || json?.message || 'Could not remove contact');
      }
      setMessage('Emergency Circle contact removed.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not remove contact');
    } finally {
      setBusy(false);
    }
  };

  const updatePreferences = async (patch: Partial<SafetyPreferences>) => {
    if (!data) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/safety/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data.preferences, ...patch }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json?.message || 'Could not update safety preferences');
      setMessage('Safety preferences updated.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update safety preferences');
    } finally {
      setBusy(false);
    }
  };

  const updateScope = async (contact: EmergencyContact, scope: ContactScope, patch: Partial<ContactScope>) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/safety/emergency-circle/contacts/${contact.id}/scopes/${scope.incident_level}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...scope, ...patch }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json?.message || 'Could not update sharing scope');
      setMessage(`${levelLabels[scope.incident_level]} sharing updated for ${contact.display_name}.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update sharing scope');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <div className="rounded-2xl border border-slate-800 p-8 text-sm text-slate-400">Loading Safety Center…</div>;
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-red-900/60 bg-red-950/20 p-6">
        <p className="font-semibold text-red-200">Safety Center unavailable</p>
        <p className="text-sm text-red-300/80 mt-2">{message || 'Unable to load your safety configuration.'}</p>
        <button onClick={load} className="mt-4 rounded-lg border border-slate-700 px-3 py-2 text-xs">Retry</button>
      </div>
    );
  }

  const readinessTone =
    data.readiness.state === 'CONFIGURED'
      ? 'border-emerald-800/60 bg-emerald-950/20 text-emerald-200'
      : data.readiness.state === 'DISABLED'
        ? 'border-slate-700 bg-slate-900/60 text-slate-300'
        : 'border-amber-800/60 bg-amber-950/20 text-amber-200';

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-rose-900/60 bg-rose-950/20 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex gap-4">
            <div className="h-12 w-12 rounded-xl bg-rose-500/15 text-rose-300 flex items-center justify-center">
              <Siren className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">SOS & Safety Center</h2>
              <p className="text-sm text-slate-400 mt-1">Server-backed emergency activation with explicit acknowledgement and delivery states.</p>
            </div>
          </div>
          <button onClick={load} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {!activeSos ? (
          <div className="mt-6">
            <button
              onClick={startSos}
              disabled={busy}
              className="w-full rounded-2xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 px-6 py-5 text-lg font-black tracking-wide"
            >
              ACTIVATE SOS
            </button>
            <p className="mt-3 text-xs text-rose-200/70">
              This starts a {data.preferences.sos_cancel_countdown_seconds}-second cancel window. Backend acknowledgement is not the same as contact delivery or external assistance.
            </p>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-rose-800/60 bg-slate-950/50 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-xs uppercase tracking-wider text-rose-300">SOS state</p>
                <p className="text-2xl font-bold mt-1">{activeSos.incident.status}</p>
                <p className="text-xs text-slate-400 mt-2">
                  Backend acknowledged: {activeSos.acknowledgement.backend_acknowledged ? 'YES' : 'NO'}
                </p>
              </div>
              {activeSos.incident.status === 'COUNTDOWN' && (
                <div className="text-right">
                  <p className="text-4xl font-black text-rose-300">{countdownSeconds}</p>
                  <p className="text-xs text-slate-500">seconds to activation</p>
                </div>
              )}
            </div>

            {activeSos.incident.status === 'COUNTDOWN' && (
              <button
                onClick={cancelSos}
                disabled={busy}
                className="mt-5 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel accidental SOS
              </button>
            )}

            {activeSos.incident.status === 'ACTIVATED' && (
              <div className="mt-5 space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-800 p-4">
                    <p className="text-[10px] uppercase text-slate-500">Contact notifications</p>
                    <p className="font-bold mt-1">{activeSos.incident.notification_state}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 p-4">
                    <p className="text-[10px] uppercase text-slate-500">External assistance</p>
                    <p className="font-bold mt-1 text-amber-300">{activeSos.incident.assistance_state}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 p-4">
                    <p className="text-[10px] uppercase text-slate-500">Safety check</p>
                    <p className="font-bold mt-1">{activeSos.incident.safety_check_state}</p>
                  </div>
                </div>

                {!activeSos.acknowledgement.assistance_requested && (
                  <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-4 text-sm text-amber-200 flex gap-3">
                    <CircleAlert className="h-5 w-5 shrink-0" />
                    <p>Garage OS has activated the SOS, but no external emergency or roadside provider is currently recorded as requested, accepted, or en route.</p>
                  </div>
                )}

                {activeSos.notification_attempts.length > 0 && (
                  <div className="rounded-xl border border-slate-800 p-4">
                    <p className="text-xs font-bold mb-3">Trusted-contact delivery evidence</p>
                    <div className="space-y-2">
                      {activeSos.notification_attempts.map((attempt) => (
                        <div key={attempt.id} className="flex items-center justify-between gap-3 text-xs border-t border-slate-800 pt-2 first:border-0 first:pt-0">
                          <span>Priority {attempt.priority} • {attempt.channel}</span>
                          <span className={attempt.status === 'DELIVERED' ? 'text-emerald-300' : 'text-amber-300'}>
                            {attempt.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {trustedAccess.length > 0 && (
                  <div className="rounded-xl border border-slate-800 p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <p className="text-xs font-bold">Temporary trusted-contact access</p>
                        <p className="text-[10px] text-slate-500 mt-1">Links are scoped, expiring and revocable. Raw tokens are never shown here.</p>
                      </div>
                      {trustedAccess.some((grant) => grant.status === 'ACTIVE') && (
                        <button
                          disabled={busy}
                          onClick={revokeTrustedAccess}
                          className="rounded-lg border border-red-900/60 px-3 py-1.5 text-[11px] font-semibold text-red-300 disabled:opacity-50"
                        >
                          Revoke active links
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {trustedAccess.map((grant) => (
                        <div key={grant.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold">{grant.contact_name}</span>
                            <span className={grant.status === 'ACTIVE' ? 'text-emerald-300' : 'text-slate-500'}>{grant.status}</span>
                          </div>
                          <p className="mt-1 text-slate-500">
                            Notification: {grant.notification_status || 'UNKNOWN'} • Portal viewed: {grant.first_accessed_at ? 'Yes' : 'No'}
                          </p>
                          {grant.latest_response && (
                            <p className="mt-1 text-indigo-300">Response: {grant.latest_response.response.replaceAll('_', ' ')}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeSos.safety_check?.status === 'PENDING' && (
                  <div className="rounded-xl border border-indigo-800/60 bg-indigo-950/20 p-4">
                    <p className="font-semibold">Are you okay?</p>
                    <p className="text-xs text-slate-400 mt-1">No response is never interpreted as proof of injury.</p>
                    <div className="grid gap-2 sm:grid-cols-3 mt-4">
                      <button disabled={busy} onClick={() => answerSafetyCheck('OKAY')} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold">I’m okay</button>
                      <button disabled={busy} onClick={() => answerSafetyCheck('NEED_HELP')} className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold">I need help</button>
                      <button disabled={busy} onClick={() => answerSafetyCheck('CANNOT_CONFIRM')} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold">Cannot confirm</button>
                    </div>
                  </div>
                )}

                <button onClick={closeSos} disabled={busy} className="w-full rounded-xl border border-slate-600 px-4 py-3 font-semibold">
                  Close SOS incident
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {message && <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">{message}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <div className={`rounded-xl border p-5 ${readinessTone}`}>
          <p className="text-xs uppercase tracking-wider opacity-70">Circle readiness</p>
          <p className="text-2xl font-bold mt-2">{data.readiness.state}</p>
          <p className="text-xs mt-2 opacity-80">{data.readiness.active_contact_count} active contact(s)</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500">Location policy</p>
          <p className="text-lg font-bold mt-2">{data.preferences.allow_location_sharing ? 'Allowed by user' : 'Blocked by default'}</p>
          <p className="text-xs text-slate-500 mt-2">SOS requests location only after explicit activation and only when this master permission is enabled.</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500">Execution engines</p>
          <p className="text-lg font-bold mt-2">{data.readiness.sos_engine_active ? 'SOS engine active' : 'Unavailable'}</p>
          <p className="text-xs text-slate-500 mt-2">Trusted-contact portal is active; automatic escalation remains a later-sprint capability.</p>
        </div>
      </div>

      {data.readiness.blockers.length > 0 && (
        <div className="rounded-xl border border-amber-800/50 bg-amber-950/10 p-5">
          <p className="font-semibold text-amber-200">Emergency Circle configuration</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-300/80">
            {data.readiness.blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}
          </ul>
          <p className="mt-3 text-xs text-slate-500">These blockers do not prevent the SOS backend from acknowledging an activation attempt.</p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.6fr]">
        <form onSubmit={addContact} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center gap-2"><Plus className="h-5 w-5 text-indigo-300" /><h3 className="font-bold">Add trusted contact</h3></div>
          <input required placeholder="Full name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input placeholder="Relationship" value={form.relationship_label} onChange={(e) => setForm({ ...form, relationship_label: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input placeholder="+254700000000" value={form.phone_e164} onChange={(e) => setForm({ ...form, phone_e164: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input type="email" placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <label className="block text-xs text-slate-400">Priority
            <input type="number" min={1} max={99} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          </label>
          <button disabled={busy} className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold disabled:opacity-50">Add to Emergency Circle</button>
          <p className="text-xs text-slate-500">Adding a contact does not itself send a message. Delivery is tracked separately during an activated SOS.</p>
        </form>

        <div className="space-y-4">
          {data.contacts.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
              <Users className="h-8 w-8 mx-auto text-slate-500" />
              <p className="font-semibold mt-3">No Emergency Circle contacts yet</p>
            </div>
          ) : data.contacts.map((contact) => (
            <article key={contact.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold">{contact.display_name}</h3>
                    <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">Priority {contact.priority}</span>
                    <span className="rounded-full border border-amber-800/50 px-2 py-0.5 text-[10px] text-amber-300">{contact.verification_status}</span>
                  </div>
                  {contact.relationship_label && <p className="text-xs text-slate-500 mt-1">{contact.relationship_label}</p>}
                  <div className="flex gap-4 flex-wrap mt-3 text-xs text-slate-400">
                    {contact.phone_e164 && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{contact.phone_e164}</span>}
                    {contact.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{contact.email}</span>}
                  </div>
                </div>
                <button disabled={busy} onClick={() => revokeContact(contact.id)} className="rounded-lg border border-red-900/60 p-2 text-red-300 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {contact.scopes.map((scope) => (
                  <div key={scope.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <p className="text-xs font-bold">{levelLabels[scope.incident_level]}</p>
                    <label className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                      Notify contact
                      <input type="checkbox" checked={scope.notify_contact} disabled={busy} onChange={(e) => updateScope(contact, scope, { notify_contact: e.target.checked })} />
                    </label>
                    <label className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
                      Share location
                      <input type="checkbox" checked={scope.share_live_location} disabled={busy} onChange={(e) => updateScope(contact, scope, { share_live_location: e.target.checked })} />
                    </label>
                    <div className="mt-3 flex items-center gap-1 text-[10px] text-slate-500"><LockKeyhole className="h-3 w-3" />Scope is snapshotted when SOS activates.</div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-center gap-2"><Save className="h-5 w-5 text-indigo-300" /><h3 className="font-bold">Human safety preferences</h3></div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="rounded-xl border border-slate-800 p-4 text-sm flex items-center justify-between gap-4">
            <span><span className="block font-semibold">Emergency Circle enabled</span><span className="block text-xs text-slate-500 mt-1">Controls trusted-contact orchestration, not SOS acknowledgement.</span></span>
            <input type="checkbox" checked={data.preferences.emergency_circle_enabled} disabled={busy} onChange={(e) => updatePreferences({ emergency_circle_enabled: e.target.checked })} />
          </label>
          <label className="rounded-xl border border-slate-800 p-4 text-sm flex items-center justify-between gap-4">
            <span><span className="block font-semibold">Allow location sharing</span><span className="block text-xs text-slate-500 mt-1">Master opt-in; default off.</span></span>
            <input type="checkbox" checked={data.preferences.allow_location_sharing} disabled={busy} onChange={(e) => updatePreferences({ allow_location_sharing: e.target.checked })} />
          </label>
          <label className="rounded-xl border border-slate-800 p-4 text-sm flex items-center justify-between gap-4">
            <span><span className="block font-semibold">Safety check</span><span className="block text-xs text-slate-500 mt-1">Prompts after SOS activation; timeout never proves injury.</span></span>
            <input type="checkbox" checked={data.preferences.safety_check_enabled} disabled={busy} onChange={(e) => updatePreferences({ safety_check_enabled: e.target.checked })} />
          </label>
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400">
          <MapPin className="h-4 w-4 shrink-0 text-slate-500" />
          <p>Emergency location is requested only on explicit SOS activation, retained for a limited purpose window, and access is revoked when the incident closes or is cancelled.</p>
        </div>
        <div className="mt-3 flex items-start gap-3 text-xs text-slate-500">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <p>Backend acknowledgement, trusted-contact delivery, external provider acceptance, provider arrival and incident closure are separate states.</p>
        </div>
      </div>
    </section>
  );
};
