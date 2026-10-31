import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
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
  sos_engine_active: false;
  notification_engine_active: false;
  trusted_contact_portal_active: false;
  blockers: string[];
  notes: string[];
}

interface EmergencyCirclePayload {
  contacts: EmergencyContact[];
  preferences: SafetyPreferences;
  readiness: SafetyReadiness;
  execution_capabilities: {
    sos_activation: false;
    trusted_contact_notifications: false;
    trusted_contact_portal: false;
    live_location_streaming: false;
    automatic_escalation: false;
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

export const BentoSafety: React.FC = () => {
  const [data, setData] = useState<EmergencyCirclePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
      const res = await fetch('/api/v1/safety/emergency-circle');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json?.message || 'Unable to load Safety Center');
      setData(unwrap(json));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to load Safety Center');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addContact = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
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
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/safety/emergency-circle/contacts/${contactId}`, {
        method: 'DELETE',
      });
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
    setMessage(null);
    try {
      const next = { ...data.preferences, ...patch };
      const res = await fetch('/api/v1/safety/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
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

  const updateScope = async (
    contact: EmergencyContact,
    scope: ContactScope,
    patch: Partial<ContactScope>
  ) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = { ...scope, ...patch };
      const res = await fetch(
        `/api/v1/safety/emergency-circle/contacts/${contact.id}/scopes/${scope.incident_level}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
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
        <button onClick={load} className="mt-4 rounded-lg border border-slate-700 px-3 py-2 text-xs">
          Retry
        </button>
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
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex gap-4">
            <div className="h-12 w-12 rounded-xl bg-rose-500/15 text-rose-300 flex items-center justify-center">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Safety Center</h2>
              <p className="text-sm text-slate-400 mt-1">
                Configure who Garage OS may contact and what they may receive during a future safety incident.
              </p>
            </div>
          </div>
          <button onClick={load} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-amber-800/50 bg-amber-950/20 p-4 text-sm text-amber-200">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Sprint 15 is configuration only.</p>
              <p className="text-amber-300/80 mt-1">
                SOS activation, emergency notification delivery, live-location streaming and automatic escalation are not active yet.
                Garage OS will not claim that help was notified or dispatched from this screen.
              </p>
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">{message}</div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className={`rounded-xl border p-5 ${readinessTone}`}>
          <p className="text-xs uppercase tracking-wider opacity-70">Circle readiness</p>
          <p className="text-2xl font-bold mt-2">{data.readiness.state}</p>
          <p className="text-xs mt-2 opacity-80">{data.readiness.active_contact_count} active contact(s)</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500">Location policy</p>
          <p className="text-lg font-bold mt-2">{data.preferences.allow_location_sharing ? 'Allowed by user' : 'Blocked by default'}</p>
          <p className="text-xs text-slate-500 mt-2">Per-contact location scope cannot override this master setting.</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500">Execution engines</p>
          <p className="text-lg font-bold mt-2">Not active</p>
          <p className="text-xs text-slate-500 mt-2">SOS + notifications begin in later safety sprints.</p>
        </div>
      </div>

      {data.readiness.blockers.length > 0 && (
        <div className="rounded-xl border border-amber-800/50 bg-amber-950/10 p-5">
          <p className="font-semibold text-amber-200">Configuration blockers</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-300/80">
            {data.readiness.blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.6fr]">
        <form onSubmit={addContact} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-indigo-300" />
            <h3 className="font-bold">Add trusted contact</h3>
          </div>
          <input
            required
            placeholder="Full name"
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
          <input
            placeholder="Relationship (e.g. spouse, sibling)"
            value={form.relationship_label}
            onChange={(e) => setForm({ ...form, relationship_label: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
          <input
            placeholder="+254700000000"
            value={form.phone_e164}
            onChange={(e) => setForm({ ...form, phone_e164: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
          <input
            type="email"
            placeholder="Email (optional)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
          <label className="block text-xs text-slate-400">
            Priority
            <input
              type="number"
              min={1}
              max={99}
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
          </label>
          <button disabled={busy} className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold disabled:opacity-50">
            Add to Emergency Circle
          </button>
          <p className="text-xs text-slate-500">
            Contacts are unverified in Sprint 15. Adding someone here does not send them a message.
          </p>
        </form>

        <div className="space-y-4">
          {data.contacts.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
              <Users className="h-8 w-8 mx-auto text-slate-500" />
              <p className="font-semibold mt-3">No Emergency Circle contacts yet</p>
              <p className="text-sm text-slate-500 mt-1">Add at least one reachable person to configure the safety foundation.</p>
            </div>
          ) : data.contacts.map((contact) => (
            <article key={contact.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold">{contact.display_name}</h3>
                    <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
                      Priority {contact.priority}
                    </span>
                    <span className="rounded-full border border-amber-800/50 px-2 py-0.5 text-[10px] text-amber-300">
                      {contact.verification_status}
                    </span>
                  </div>
                  {contact.relationship_label && <p className="text-xs text-slate-500 mt-1">{contact.relationship_label}</p>}
                  <div className="flex gap-4 flex-wrap mt-3 text-xs text-slate-400">
                    {contact.phone_e164 && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{contact.phone_e164}</span>}
                    {contact.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{contact.email}</span>}
                  </div>
                </div>
                <button
                  disabled={busy}
                  onClick={() => revokeContact(contact.id)}
                  className="rounded-lg border border-red-900/60 p-2 text-red-300 hover:bg-red-950/30 disabled:opacity-50"
                  title="Remove contact"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {contact.scopes.map((scope) => (
                  <div key={scope.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <p className="text-xs font-bold">{levelLabels[scope.incident_level]}</p>
                    <label className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                      Notify contact
                      <input
                        type="checkbox"
                        checked={scope.notify_contact}
                        disabled={busy}
                        onChange={(e) => updateScope(contact, scope, { notify_contact: e.target.checked })}
                      />
                    </label>
                    <label className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
                      Share location
                      <input
                        type="checkbox"
                        checked={scope.share_live_location}
                        disabled={busy}
                        onChange={(e) => updateScope(contact, scope, { share_live_location: e.target.checked })}
                      />
                    </label>
                    <div className="mt-3 flex items-center gap-1 text-[10px] text-slate-500">
                      <LockKeyhole className="h-3 w-3" />
                      Incident + vehicle + assistance status are scoped separately.
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-center gap-2">
          <Save className="h-5 w-5 text-indigo-300" />
          <h3 className="font-bold">Human safety preferences</h3>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="rounded-xl border border-slate-800 p-4 text-sm flex items-center justify-between gap-4">
            <span>
              <span className="block font-semibold">Emergency Circle enabled</span>
              <span className="block text-xs text-slate-500 mt-1">Allows future safety workflows to use this configuration.</span>
            </span>
            <input
              type="checkbox"
              checked={data.preferences.emergency_circle_enabled}
              disabled={busy}
              onChange={(e) => updatePreferences({ emergency_circle_enabled: e.target.checked })}
            />
          </label>
          <label className="rounded-xl border border-slate-800 p-4 text-sm flex items-center justify-between gap-4">
            <span>
              <span className="block font-semibold">Allow location sharing</span>
              <span className="block text-xs text-slate-500 mt-1">Master opt-in. Default is off.</span>
            </span>
            <input
              type="checkbox"
              checked={data.preferences.allow_location_sharing}
              disabled={busy}
              onChange={(e) => updatePreferences({ allow_location_sharing: e.target.checked })}
            />
          </label>
          <label className="rounded-xl border border-slate-800 p-4 text-sm flex items-center justify-between gap-4">
            <span>
              <span className="block font-semibold">Safety check preference</span>
              <span className="block text-xs text-slate-500 mt-1">Configuration only; no automatic escalation in Sprint 15.</span>
            </span>
            <input
              type="checkbox"
              checked={data.preferences.safety_check_enabled}
              disabled={busy}
              onChange={(e) => updatePreferences({ safety_check_enabled: e.target.checked })}
            />
          </label>
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400">
          <MapPin className="h-4 w-4 shrink-0 text-slate-500" />
          <p>
            Location is treated as highly sensitive. A contact-level “share location” flag is only permission configuration;
            Sprint 15 does not collect or stream emergency location data.
          </p>
        </div>
        <div className="mt-3 flex items-start gap-3 text-xs text-slate-500">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <p>Failure to respond to a future safety check must never be interpreted as proof of injury.</p>
        </div>
      </div>
    </section>
  );
};
