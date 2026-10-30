/**
 * Canonical Vehicle Timeline Interface (GAR-005, GAR-034)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  ShieldCheck,
  Wrench,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Filter,
  FileText,
  Car,
  AlertCircle,
  Eye,
  Edit3,
  Calendar,
  Gauge,
  UserCheck,
} from 'lucide-react';
import { VehicleTimelineEntry, VehicleSummary, TimelineCorrection, TimelineDispute } from '../types';

interface BentoTimelineProps {
  vehicles: VehicleSummary[];
  selectedVehicleId: string;
  onSelectVehicle: (vehicleId: string) => void;
  onNotify?: (msg: string) => void;
}

export const BentoTimeline: React.FC<BentoTimelineProps> = ({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  onNotify,
}) => {
  const [entries, setEntries] = useState<VehicleTimelineEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [includeSuperseded, setIncludeSuperseded] = useState<boolean>(false);
  const [activeEntryDetails, setActiveEntryDetails] = useState<{
    entry: VehicleTimelineEntry;
    corrections: TimelineCorrection[];
    disputes: TimelineDispute[];
  } | null>(null);

  // Correction Modal State
  const [correctingEntry, setCorrectingEntry] = useState<VehicleTimelineEntry | null>(null);
  const [correctionReason, setCorrectionReason] = useState<string>('DATA_ENTRY_ERROR');
  const [correctionExplanation, setCorrectionExplanation] = useState<string>('');
  const [updatedTitle, setUpdatedTitle] = useState<string>('');
  const [updatedOdometer, setUpdatedOdometer] = useState<string>('');

  // Dispute Modal State
  const [disputingEntry, setDisputingEntry] = useState<VehicleTimelineEntry | null>(null);
  const [disputeReason, setDisputeReason] = useState<string>('');

  const fetchTimeline = useCallback(async () => {
    if (!selectedVehicleId) return;
    setLoading(true);
    try {
      let url = `/api/v1/vehicles/${selectedVehicleId}/timeline?include_superseded=${includeSuperseded}`;
      if (selectedCategory !== 'ALL') {
        url += `&category=${selectedCategory}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setEntries(json.data || []);
      }
    } catch (e) {
      console.error('Failed to fetch timeline entries', e);
    } finally {
      setLoading(false);
    }
  }, [selectedVehicleId, selectedCategory, includeSuperseded]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  const viewEntryDetails = async (entryId: string) => {
    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/timeline/${entryId}`);
      if (res.ok) {
        const json = await res.json();
        setActiveEntryDetails(json.data);
      }
    } catch (e) {
      console.error('Failed to fetch entry details', e);
    }
  };

  const handleCorrectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctingEntry) return;

    try {
      const payload: Record<string, unknown> = {
        reason: correctionReason,
        explanation: correctionExplanation,
      };
      if (updatedTitle.trim()) payload.updated_title = updatedTitle.trim();
      if (updatedOdometer.trim()) payload.updated_odometer_value = Number(updatedOdometer);

      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/timeline/${correctingEntry.id}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        if (onNotify) onNotify(`Entry corrected non-destructively (GAR-005 §17)`);
        setCorrectingEntry(null);
        setCorrectionExplanation('');
        setUpdatedTitle('');
        setUpdatedOdometer('');
        await fetchTimeline();
      } else {
        const err = await res.json();
        alert(`Correction failed: ${err.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    }
  };

  const handleDisputeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputingEntry) return;

    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/timeline/${disputingEntry.id}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: disputeReason }),
      });

      if (res.ok) {
        if (onNotify) onNotify(`Dispute recorded for entry (GAR-005 §19)`);
        setDisputingEntry(null);
        setDisputeReason('');
        await fetchTimeline();
      } else {
        const err = await res.json();
        alert(`Dispute failed: ${err.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Error: ${(err as Error).message}`);
    }
  };

  const categories = [
    'ALL',
    'IDENTITY',
    'OWNERSHIP',
    'MILEAGE',
    'SERVICE',
    'REPAIR',
    'ISSUE',
    'TYRES',
    'MODIFICATION',
    'DOCUMENT',
  ];

  const getVerificationBadge = (status: string) => {
    switch (status) {
      case 'VERIFIED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <ShieldCheck className="w-3 h-3" /> Verified
          </span>
        );
      case 'PROVIDER_RECORDED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
            <Wrench className="w-3 h-3" /> Provider Recorded
          </span>
        );
      case 'OWNER_ASSERTED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <UserCheck className="w-3 h-3" /> Owner Asserted
          </span>
        );
      case 'DISPUTED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
            <AlertCircle className="w-3 h-3" /> Disputed
          </span>
        );
      case 'SUPERSEDED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-500/20 text-slate-400 border border-slate-500/30 line-through">
            <RotateCcw className="w-3 h-3" /> Superseded
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-700/50 text-slate-300 border border-slate-600">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Controls: Vehicle Switcher & Category Filter */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Vehicle Switcher */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                Target Vehicle
              </label>
              <select
                value={selectedVehicleId}
                onChange={(e) => onSelectVehicle(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-white text-sm font-semibold rounded-lg px-3 py-1.5 mt-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.display_name} ({v.registration_number || v.vin?.substring(0, 8) || 'No Reg'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-slate-400 font-semibold mr-1 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" /> Filter:
            </span>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                    : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Superseded Checkbox */}
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer self-start lg:self-center">
            <input
              type="checkbox"
              checked={includeSuperseded}
              onChange={(e) => setIncludeSuperseded(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
            />
            Show Superseded
          </label>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline Feed (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" /> Canonical Vehicle Timeline
            </h2>
            <span className="text-xs text-slate-400 font-mono">
              {entries.length} {entries.length === 1 ? 'event' : 'events'} recorded
            </span>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800">
              <Clock className="w-8 h-8 mx-auto mb-2 animate-spin text-indigo-400" />
              <p className="text-sm font-medium">Loading timeline records...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="p-12 text-center text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800">
              <FileText className="w-8 h-8 mx-auto mb-2 text-slate-500" />
              <p className="text-sm font-semibold">No timeline entries found for this vehicle/filter.</p>
              <p className="text-xs text-slate-500 mt-1">
                Domain events and backfilled history will automatically populate here.
              </p>
            </div>
          ) : (
            <div className="relative border-l-2 border-slate-800 ml-4 space-y-6 pl-6 py-2">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className={`relative p-5 rounded-2xl border transition-all ${
                    entry.is_active
                      ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700 shadow-md'
                      : 'bg-slate-950/60 border-slate-800/60 opacity-60'
                  }`}
                >
                  {/* Timeline Dot */}
                  <div
                    className={`absolute -left-[33px] top-6 w-4 h-4 rounded-full border-2 ${
                      entry.verification_status === 'VERIFIED'
                        ? 'bg-emerald-500 border-slate-950'
                        : entry.verification_status === 'DISPUTED'
                        ? 'bg-rose-500 border-slate-950'
                        : entry.verification_status === 'SUPERSEDED'
                        ? 'bg-slate-600 border-slate-950'
                        : 'bg-indigo-500 border-slate-950'
                    }`}
                  />

                  {/* Header info */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {entry.category}
                      </span>
                      {getVerificationBadge(entry.verification_status)}
                      {entry.odometer_value && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-indigo-300 bg-indigo-950/50 border border-indigo-800/40 px-2 py-0.5 rounded">
                          <Gauge className="w-3 h-3" />
                          {entry.odometer_value.toLocaleString()} {entry.odometer_unit || 'KM'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-400 font-mono">
                      <Calendar className="w-3 h-3 text-slate-500" />
                      {new Date(entry.occurred_at).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Title & Summary */}
                  <h3 className="text-base font-bold text-white mb-1">{entry.title}</h3>
                  <p className="text-sm text-slate-300 leading-relaxed mb-3">{entry.summary}</p>

                  {/* Location & Source info */}
                  <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/80 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400">
                        Source: <strong className="text-slate-300 font-medium">{entry.source_type}</strong>
                      </span>
                      {entry.location_reference && (
                        <span className="text-[11px] text-slate-500">• {entry.location_reference}</span>
                      )}
                    </div>

                    {/* Actions: View Details, Correct, Dispute */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => viewEntryDetails(entry.id)}
                        className="px-2.5 py-1 text-xs font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <Eye className="w-3 h-3" /> Details
                      </button>

                      {entry.is_active && entry.verification_status !== 'SUPERSEDED' && (
                        <>
                          <button
                            onClick={() => {
                              setCorrectingEntry(entry);
                              setUpdatedTitle(entry.title);
                              setUpdatedOdometer(entry.odometer_value ? String(entry.odometer_value) : '');
                            }}
                            className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" /> Correct
                          </button>
                          <button
                            onClick={() => setDisputingEntry(entry)}
                            className="px-2.5 py-1 text-xs font-semibold rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <AlertCircle className="w-3 h-3" /> Dispute
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar: Entry Details & Provenance Inspector (1 col) */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> Entry Provenance & Audit
          </h2>

          {activeEntryDetails ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <span className="text-xs font-mono text-indigo-400">{activeEntryDetails.entry.id}</span>
                {getVerificationBadge(activeEntryDetails.entry.verification_status)}
              </div>

              <div>
                <h4 className="text-sm font-bold text-white mb-1">{activeEntryDetails.entry.title}</h4>
                <p className="text-xs text-slate-400">{activeEntryDetails.entry.summary}</p>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Occurred At</span>
                  <span className="font-mono text-slate-200">
                    {new Date(activeEntryDetails.entry.occurred_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Recorded At</span>
                  <span className="font-mono text-slate-200">
                    {new Date(activeEntryDetails.entry.recorded_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Provenance</span>
                  <span className="font-semibold text-slate-200">{activeEntryDetails.entry.source_type}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Actor</span>
                  <span className="text-slate-200 font-mono">
                    {activeEntryDetails.entry.actor_id || 'System Generated'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Visibility</span>
                  <span className="text-slate-200">{activeEntryDetails.entry.visibility}</span>
                </div>
              </div>

              {/* Non-destructive Corrections History (GAR-005 §17) */}
              <div className="pt-2">
                <h5 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" /> Non-Destructive Corrections ({activeEntryDetails.corrections.length})
                </h5>
                {activeEntryDetails.corrections.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No corrections recorded for this entry.</p>
                ) : (
                  <div className="space-y-2">
                    {activeEntryDetails.corrections.map((corr) => (
                      <div key={corr.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                        <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                          <span className="font-semibold text-amber-300">{corr.correction_reason}</span>
                          <span>{new Date(corr.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="text-slate-300">{corr.explanation}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Disputes (GAR-005 §19) */}
              <div className="pt-2">
                <h5 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" /> Disputes & Claims ({activeEntryDetails.disputes.length})
                </h5>
                {activeEntryDetails.disputes.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No disputes registered.</p>
                ) : (
                  <div className="space-y-2">
                    {activeEntryDetails.disputes.map((disp) => (
                      <div key={disp.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                        <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                          <span className="font-semibold text-rose-300">Status: {disp.status}</span>
                          <span>{new Date(disp.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="text-slate-300">{disp.dispute_reason}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-center text-slate-400">
              <Eye className="w-8 h-8 mx-auto mb-2 text-slate-600" />
              <p className="text-xs font-medium">Select any timeline entry to inspect its provenance, source verification and immutable audit history.</p>
            </div>
          )}
        </div>
      </div>

      {/* Non-destructive Correction Modal (GAR-005 §17) */}
      {correctingEntry && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-amber-400" /> Non-Destructive Entry Correction
              </h3>
              <button
                onClick={() => setCorrectingEntry(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-200">
              <strong>Audit Law (GAR-005 §17):</strong> Historical records are never silently rewritten. Submitting this correction marks the original entry as superseded and links the new entry to it in the public audit trail.
            </div>

            <form onSubmit={handleCorrectSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Correction Reason</label>
                <select
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                >
                  <option value="DATA_ENTRY_ERROR">Data Entry Error</option>
                  <option value="WRONG_ODOMETER">Wrong Odometer Reading</option>
                  <option value="WRONG_DATE">Wrong Occurrence Date</option>
                  <option value="DUPLICATE_RECORD">Duplicate Record</option>
                  <option value="INCORRECT_PROVIDER">Incorrect Provider Name</option>
                  <option value="OTHER">Other Reason</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Explanation & Justification *</label>
                <textarea
                  required
                  rows={3}
                  value={correctionExplanation}
                  onChange={(e) => setCorrectionExplanation(e.target.value)}
                  placeholder="Provide complete business justification for this correction..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Updated Title</label>
                <input
                  type="text"
                  value={updatedTitle}
                  onChange={(e) => setUpdatedTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Updated Odometer (KM)</label>
                <input
                  type="number"
                  value={updatedOdometer}
                  onChange={(e) => setUpdatedOdometer(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCorrectingEntry(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold"
                >
                  Submit Correction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dispute Modal (GAR-005 §19) */}
      {disputingEntry && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400" /> Dispute Timeline Entry
              </h3>
              <button
                onClick={() => setDisputingEntry(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDisputeSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Dispute Reason *</label>
                <textarea
                  required
                  rows={4}
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Explain why this entry is disputed or inaccurate..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setDisputingEntry(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold"
                >
                  Register Dispute
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
