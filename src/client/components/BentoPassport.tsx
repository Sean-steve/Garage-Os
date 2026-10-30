/**
 * Digital Vehicle Passport Interface (GAR-005, GAR-034)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileCheck,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Share2,
  RefreshCw,
  Gauge,
  Wrench,
  AlertTriangle,
  Car,
  CheckCircle,
  Copy,
  ExternalLink,
  Trash2,
  Lock,
  Layers,
  Calendar,
} from 'lucide-react';
import { VehiclePassport, VehicleSummary, PassportShareGrant } from '../types';

interface BentoPassportProps {
  vehicles: VehicleSummary[];
  selectedVehicleId: string;
  onSelectVehicle: (vehicleId: string) => void;
  onNotify?: (msg: string) => void;
}

export const BentoPassport: React.FC<BentoPassportProps> = ({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  onNotify,
}) => {
  const [passport, setPassport] = useState<VehiclePassport | null>(null);
  const [shareGrants, setShareGrants] = useState<PassportShareGrant[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [rebuilding, setRebuilding] = useState<boolean>(false);

  // Share Modal State
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [shareScope, setShareScope] = useState<string>('FULL');
  const [shareExpiresHours, setShareExpiresHours] = useState<number>(72);
  const [shareRecipientLabel, setShareRecipientLabel] = useState<string>('');
  const [createdShareLink, setCreatedShareLink] = useState<string | null>(null);

  // Public Share Preview Modal
  const [publicPreviewToken, setPublicPreviewToken] = useState<string | null>(null);
  const [publicPassport, setPublicPassport] = useState<VehiclePassport | null>(null);
  const [publicShareInfo, setPublicShareInfo] = useState<{ scope: string; expires_at: string } | null>(null);
  const [loadingPublic, setLoadingPublic] = useState<boolean>(false);

  const fetchPassport = useCallback(async () => {
    if (!selectedVehicleId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/passport`);
      if (res.ok) {
        const json = await res.json();
        setPassport(json.data);
      }
    } catch (e) {
      console.error('Failed to load passport', e);
    } finally {
      setLoading(false);
    }
  }, [selectedVehicleId]);

  const fetchShareGrants = useCallback(async () => {
    if (!selectedVehicleId) return;
    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/passport/shares`);
      if (res.ok) {
        const json = await res.json();
        setShareGrants(json.data || []);
      }
    } catch (e) {
      console.error('Failed to load share grants', e);
    }
  }, [selectedVehicleId]);

  useEffect(() => {
    fetchPassport();
    fetchShareGrants();
  }, [fetchPassport, fetchShareGrants]);

  const handleRebuildPassport = async () => {
    if (!selectedVehicleId) return;
    setRebuilding(true);
    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/passport/rebuild`, {
        method: 'POST',
      });
      if (res.ok) {
        const json = await res.json();
        setPassport(json.data);
        if (onNotify) onNotify('Digital Vehicle Passport projection regenerated & hash verified (GAR-005 §21)');
      }
    } catch (e) {
      alert(`Rebuild failed: ${(e as Error).message}`);
    } finally {
      setRebuilding(false);
    }
  };

  const handleCreateShareGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/passport/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: shareScope,
          expires_in_hours: shareExpiresHours,
          recipient_label: shareRecipientLabel.trim() || undefined,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setCreatedShareLink(json.data.share_url);
        if (onNotify) onNotify('Cryptographically secure share link created (GAR-005 §24)');
        await fetchShareGrants();
      } else {
        const err = await res.json();
        alert(`Share creation failed: ${err.message}`);
      }
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    }
  };

  const handleRevokeShare = async (shareId: string) => {
    if (!confirm('Are you sure you want to revoke this passport share link immediately?')) return;
    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/passport/shares/${shareId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        if (onNotify) onNotify('Share grant revoked immediately (GAR-005 §24)');
        await fetchShareGrants();
      }
    } catch (e) {
      alert(`Revoke failed: ${(e as Error).message}`);
    }
  };

  const handleTestPublicPreview = async (token: string) => {
    setPublicPreviewToken(token);
    setLoadingPublic(true);
    try {
      const res = await fetch(`/api/v1/passport-shares/${token}`);
      if (res.ok) {
        const json = await res.json();
        setPublicPassport(json.data);
        setPublicShareInfo(json.share_info);
      } else {
        alert('Public share link is expired or revoked.');
        setPublicPreviewToken(null);
      }
    } catch (e) {
      alert(`Public preview error: ${(e as Error).message}`);
    } finally {
      setLoadingPublic(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <FileCheck className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-tight">
                  {passport?.vehicle_identity.display_name || 'Digital Vehicle Passport'}
                </h2>
                <span className="px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full">
                  GAR-005 Passport
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                <span>Registration: <strong className="text-slate-200">{passport?.vehicle_identity.registration_number || 'N/A'}</strong></span>
                <span>•</span>
                <span>VIN: <strong className="text-slate-200 font-mono">{passport?.vehicle_identity.vin_masked || 'N/A'}</strong></span>
                <span>•</span>
                <span>Status: <strong className="text-emerald-400">{passport?.vehicle_identity.status}</strong></span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Vehicle Selector */}
            <select
              value={selectedVehicleId}
              onChange={(e) => onSelectVehicle(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-white text-xs font-semibold rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.display_name}
                </option>
              ))}
            </select>

            {/* Force Rebuild Projection Button */}
            <button
              onClick={handleRebuildPassport}
              disabled={rebuilding}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all cursor-pointer flex items-center gap-1.5 border border-slate-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${rebuilding ? 'animate-spin text-indigo-400' : ''}`} />
              {rebuilding ? 'Rebuilding...' : 'Rebuild Projection'}
            </button>

            {/* Share Link Button */}
            <button
              onClick={() => {
                setShowShareModal(true);
                setCreatedShareLink(null);
              }}
              className="px-3.5 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-indigo-600/20"
            >
              <Share2 className="w-3.5 h-3.5" /> Share Passport
            </button>
          </div>
        </div>

        {/* Cryptographic Integrity Hash Bar (GAR-005 §21) */}
        {passport && (
          <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-400">Projection SHA-256 Integrity Hash:</span>
              <code className="text-indigo-300 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                {passport.metadata.integrity_hash}
              </code>
            </div>
            <div className="text-slate-400 font-mono text-[11px]">
              Generated: {new Date(passport.metadata.generated_at).toLocaleString()} • Version {passport.metadata.passport_version}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-16 text-center text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800">
          <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin text-indigo-400" />
          <p className="text-sm font-semibold">Generating Materialized Passport Projection...</p>
        </div>
      ) : passport ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {/* Card 1: Mileage History & Odometer Integrity */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Gauge className="w-4 h-4 text-indigo-400" /> Mileage & Odometer Integrity
              </h3>
              {passport.mileage_history.has_rollback_warning ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3" /> Rollback Detected
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Clean Verification
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Current Mileage</span>
                <span className="text-lg font-bold font-mono text-indigo-300">
                  {passport.mileage_history.latest_reading
                    ? `${passport.mileage_history.latest_reading.reading_km.toLocaleString()} KM`
                    : 'N/A'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Readings</span>
                <span className="text-lg font-bold font-mono text-white">
                  {passport.mileage_history.total_observations_count}
                </span>
              </div>
            </div>

            <div className="space-y-1.5 pt-1 text-xs">
              <div className="text-slate-400 font-semibold mb-1">Recent Observations:</div>
              {passport.mileage_history.observations.slice(0, 3).map((obs) => (
                <div key={obs.id} className="flex justify-between items-center py-1 border-b border-slate-800/50">
                  <span className="font-mono text-slate-300">{obs.reading_km.toLocaleString()} KM</span>
                  <span className="text-[11px] text-slate-400">{new Date(obs.observed_at).toLocaleDateString()}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                    {obs.source_class}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Card 2: Ownership History & Privacy (GAR-005 §22B) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400" /> Ownership & Privacy Guard
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                {passport.ownership_summary.total_ownership_periods} Owner(s)
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Ownership Type</span>
                <span className="font-bold text-white">{passport.ownership_summary.current_ownership_type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Current Period Since</span>
                <span className="font-mono text-slate-300">
                  {passport.ownership_summary.current_period_start_date
                    ? new Date(passport.ownership_summary.current_period_start_date).toLocaleDateString()
                    : 'Current Owner'}
                </span>
              </div>
            </div>

            <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-xs text-indigo-200">
              <strong>Privacy Law (GAR-005 §22B):</strong> {passport.ownership_summary.privacy_note}
            </div>
          </div>

          {/* Card 3: Accident History (Truthful Statement, GAR-005 §13) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" /> Accident History
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                {passport.accident_history.known_records_count} Incident(s)
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs">
              <p className="text-slate-300 leading-relaxed font-medium">
                {passport.accident_history.statement}
              </p>
            </div>

            <p className="text-[11px] text-slate-500 italic">
              Garage OS does not claim &quot;no accident history&quot; when only no record exists. Only positive, verified incident reports are recorded.
            </p>
          </div>

          {/* Card 4: Verified Maintenance & Service */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Wrench className="w-4 h-4 text-blue-400" /> Maintenance & Service
              </h3>
              <span className="text-xs font-mono text-indigo-400">
                {passport.maintenance_history.records_count} Records
              </span>
            </div>

            <div className="space-y-2 text-xs">
              {passport.maintenance_history.records.length === 0 ? (
                <p className="text-slate-500 italic py-2">No service history recorded yet.</p>
              ) : (
                passport.maintenance_history.records.map((rec) => (
                  <div key={rec.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-semibold text-white">{rec.title}</span>
                      <span className="text-[10px] text-emerald-400 font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                        {rec.verification_status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">{rec.summary}</p>
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1.5 font-mono">
                      <span>{new Date(rec.occurred_at).toLocaleDateString()}</span>
                      {rec.odometer_km && <span>{rec.odometer_km.toLocaleString()} KM</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Card 5: Known Issues & Repairs */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" /> Diagnostics & Issues
              </h3>
              <span className="text-xs font-mono text-slate-400">
                {passport.known_issues_history.open_count} Open • {passport.known_issues_history.resolved_count} Resolved
              </span>
            </div>

            <div className="space-y-2 text-xs">
              {passport.known_issues_history.records.length === 0 ? (
                <p className="text-slate-500 italic py-2">No diagnostics or active trouble codes logged.</p>
              ) : (
                passport.known_issues_history.records.map((issue) => (
                  <div key={issue.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                    <div className="flex justify-between items-start">
                      <span className="font-semibold text-white">{issue.title}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        issue.status === 'RESOLVED'
                          ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                      }`}>
                        {issue.status}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
                      <span>Reported: {new Date(issue.reported_at).toLocaleDateString()}</span>
                      {issue.resolved_at && <span>Resolved: {new Date(issue.resolved_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Card 6: Equipment, Tyres & Modifications */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" /> Installed Tyres & Parts
              </h3>
              <span className="text-xs font-mono text-purple-300">
                {passport.tyres.installed_records_count + passport.installed_parts.parts_count} Installed
              </span>
            </div>

            <div className="space-y-2 text-xs">
              {passport.tyres.records.map((tyre) => (
                <div key={tyre.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                  <div className="flex justify-between">
                    <span className="font-semibold text-white">{tyre.brand} {tyre.size}</span>
                    <span className="text-[10px] font-mono text-purple-300 bg-purple-950/50 px-1.5 py-0.5 rounded">
                      {tyre.position}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    Fitted on {new Date(tyre.installed_at).toLocaleDateString()}
                  </div>
                </div>
              ))}

              {passport.modifications.records.map((mod) => (
                <div key={mod.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                  <div className="font-semibold text-white">{mod.title}</div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{mod.summary}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Verification & Data Provenance Breakdown (GAR-005 §22) */}
      {passport && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> Verification Breakdown & Provenance Classes
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Externally Verified</span>
              <span className="text-lg font-bold font-mono text-emerald-400">
                {passport.verification_summary.data_sources_breakdown.externally_verified}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Provider Recorded</span>
              <span className="text-lg font-bold font-mono text-blue-400">
                {passport.verification_summary.data_sources_breakdown.provider_recorded}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Owner Asserted</span>
              <span className="text-lg font-bold font-mono text-amber-400">
                {passport.verification_summary.data_sources_breakdown.owner_asserted}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Device Observed</span>
              <span className="text-lg font-bold font-mono text-purple-400">
                {passport.verification_summary.data_sources_breakdown.device_observed}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Total Entries</span>
              <span className="text-lg font-bold font-mono text-white">
                {passport.verification_summary.total_timeline_entries}
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-400 italic">
            Coverage: {passport.verification_summary.coverage_statement}
          </p>
        </div>
      )}

      {/* Active Secure Share Grants Management (GAR-005 §24) */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <Share2 className="w-4 h-4 text-indigo-400" /> Active Passport Share Grants ({shareGrants.length})
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Secure, time-bounded access links generated with SHA-256 token hashing and instant revocation.
            </p>
          </div>
        </div>

        {shareGrants.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-2">No active share grants generated for this vehicle.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-2.5">Scope</th>
                  <th className="py-2.5">Recipient Label</th>
                  <th className="py-2.5">Expires</th>
                  <th className="py-2.5">Status</th>
                  <th className="py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {shareGrants.map((grant) => {
                  const isExpired = new Date(grant.expires_at) < new Date();
                  const isRevoked = Boolean(grant.revoked_at);
                  return (
                    <tr key={grant.id} className="hover:bg-slate-800/30">
                      <td className="py-3 font-semibold text-white">{grant.scope}</td>
                      <td className="py-3 text-slate-300">{grant.recipient_label || 'Unlabeled'}</td>
                      <td className="py-3 font-mono text-slate-400">
                        {new Date(grant.expires_at).toLocaleString()}
                      </td>
                      <td className="py-3">
                        {isRevoked ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            Revoked
                          </span>
                        ) : isExpired ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-400">
                            Expired
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {!isRevoked && !isExpired && (
                          <button
                            onClick={() => handleRevokeShare(grant.id)}
                            className="px-2.5 py-1 text-xs font-semibold rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors cursor-pointer flex items-center gap-1 ml-auto"
                          >
                            <Trash2 className="w-3 h-3" /> Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Share Grant Creation Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Share2 className="w-4 h-4 text-indigo-400" /> Create Secure Passport Share Grant
              </h3>
              <button
                onClick={() => setShowShareModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {createdShareLink ? (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-200">
                  Secure share link generated! Only someone with this link can view the passport view within the granted time window.
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Public Share URL</label>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={createdShareLink}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white font-mono"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(createdShareLink);
                        alert('Link copied to clipboard!');
                      }}
                      className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center gap-1"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                  </div>
                </div>

                <div className="pt-2 flex justify-between">
                  <button
                    onClick={() => {
                      const token = createdShareLink.split('/').pop();
                      if (token) handleTestPublicPreview(token);
                    }}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Test Public View As Guest
                  </button>
                  <button
                    onClick={() => setShowShareModal(false)}
                    className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs font-semibold"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateShareGrant} className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Passport Scope</label>
                  <select
                    value={shareScope}
                    onChange={(e) => setShareScope(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                  >
                    <option value="FULL">Full Passport (Identity, Mileage, Service, Tyres, Issues)</option>
                    <option value="PROVENANCE_ONLY">Provenance Only (Timeline & Source Breakdown)</option>
                    <option value="TECHNICAL_ONLY">Technical Only (Specs, Issues, Tyres)</option>
                    <option value="SERVICE_ONLY">Service History Only</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Validity Duration</label>
                  <select
                    value={shareExpiresHours}
                    onChange={(e) => setShareExpiresHours(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                  >
                    <option value={24}>24 Hours (1 day)</option>
                    <option value={72}>72 Hours (3 days - recommended)</option>
                    <option value={168}>7 Days (1 week)</option>
                    <option value={720}>30 Days (1 month)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Recipient Label (Optional)</label>
                  <input
                    type="text"
                    value={shareRecipientLabel}
                    onChange={(e) => setShareRecipientLabel(e.target.value)}
                    placeholder="e.g. Prospective Buyer - Toyota Dealership"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowShareModal(false)}
                    className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
                  >
                    Generate Secure Link
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Guest Public View Simulator Modal */}
      {publicPreviewToken && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <ExternalLink className="w-4 h-4 text-emerald-400" /> Public Unauthenticated Share Preview
                </h3>
                <p className="text-xs text-slate-400">
                  This view simulates what an external recipient sees via the token link without logging into Garage OS.
                </p>
              </div>
              <button
                onClick={() => setPublicPreviewToken(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {loadingPublic ? (
              <div className="p-8 text-center text-slate-400">
                <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin text-indigo-400" />
                <p className="text-xs font-semibold">Validating token & fetching shared passport...</p>
              </div>
            ) : publicPassport ? (
              <div className="space-y-4 text-xs">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 flex justify-between items-center">
                  <span>Scope Granted: <strong>{publicShareInfo?.scope}</strong></span>
                  <span>Expires: {publicShareInfo?.expires_at ? new Date(publicShareInfo.expires_at).toLocaleString() : 'N/A'}</span>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                  <h4 className="text-sm font-bold text-white">
                    {publicPassport.vehicle_identity.display_name}
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-slate-300">
                    <div>Make/Model: <strong>{publicPassport.vehicle_identity.make} {publicPassport.vehicle_identity.model}</strong></div>
                    <div>Year: <strong>{publicPassport.vehicle_identity.model_year}</strong></div>
                    <div>Masked VIN: <strong className="font-mono">{publicPassport.vehicle_identity.vin_masked}</strong></div>
                    <div>Integrity Hash: <strong className="font-mono text-[10px]">{publicPassport.metadata.integrity_hash.substring(0, 16)}...</strong></div>
                  </div>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800">
                  <h5 className="font-bold text-slate-200 mb-2">Verified Service History</h5>
                  {publicPassport.maintenance_history.records.map((rec) => (
                    <div key={rec.id} className="py-1.5 border-b border-slate-800/60 flex justify-between">
                      <span className="text-white">{rec.title}</span>
                      <span className="text-slate-400 font-mono">{rec.odometer_km ? `${rec.odometer_km.toLocaleString()} KM` : ''}</span>
                    </div>
                  ))}
                </div>

                <div className="text-center pt-2">
                  <button
                    onClick={() => setPublicPreviewToken(null)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold"
                  >
                    Close Preview
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
