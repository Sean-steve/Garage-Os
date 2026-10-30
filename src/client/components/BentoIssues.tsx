import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Wrench,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  HelpCircle,
  FileText,
  Building,
  User,
  Gauge,
  Calendar,
  X,
  Repeat,
  Sparkles,
  ChevronRight,
  Eye,
  Check,
  AlertCircle,
  Car,
  Activity,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import {
  VehicleSummary,
  ClientVehicleIssue,
  ClientEnrichedVehicleIssue,
  ClientIssueOccurrence,
  ClientIssueDiagnosis,
  ClientIssueIntervention,
  ClientIssueFollowup,
} from '../types';

interface BentoIssuesProps {
  vehicles: VehicleSummary[];
  selectedVehicleId: string;
  onSelectVehicle: (id: string) => void;
  onNotify?: (msg: string) => void;
}

export const BentoIssues: React.FC<BentoIssuesProps> = ({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  onNotify,
}) => {
  const [issues, setIssues] = useState<ClientVehicleIssue[]>([]);
  const [persistentIssues, setPersistentIssues] = useState<ClientVehicleIssue[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<ClientEnrichedVehicleIssue | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals state
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [showOccurrenceModal, setShowOccurrenceModal] = useState<boolean>(false);
  const [showDiagnosisModal, setShowDiagnosisModal] = useState<boolean>(false);
  const [showInterventionModal, setShowInterventionModal] = useState<boolean>(false);
  const [showResolveModal, setShowResolveModal] = useState<boolean>(false);
  const [showRecurModal, setShowRecurModal] = useState<boolean>(false);
  const [targetIssueId, setTargetIssueId] = useState<string | null>(null);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) || vehicles[0];

  const fetchIssues = useCallback(async () => {
    if (!selectedVehicleId) return;
    setLoading(true);
    try {
      const [listRes, persRes] = await Promise.all([
        fetch(`/api/v1/vehicles/${selectedVehicleId}/issues`),
        fetch(`/api/v1/vehicles/${selectedVehicleId}/issues/persistent`),
      ]);

      if (listRes.ok) {
        const json = await listRes.json();
        setIssues(json.data || []);
      }
      if (persRes.ok) {
        const json = await persRes.json();
        setPersistentIssues(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch issues:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedVehicleId]);

  const fetchIssueDetail = useCallback(async (issueId: string) => {
    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/issues/${issueId}`);
      if (res.ok) {
        const json = await res.json();
        setSelectedIssue(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch issue detail:', err);
    }
  }, [selectedVehicleId]);

  useEffect(() => {
    fetchIssues();
    setSelectedIssue(null);
  }, [fetchIssues]);

  // Handle follow-up response
  const handleFollowupResponse = async (
    issueId: string,
    followupId: string,
    response: 'YES' | 'NO' | 'NOT_SURE',
    notes: string
  ) => {
    try {
      const res = await fetch(
        `/api/v1/vehicles/${selectedVehicleId}/issues/${issueId}/followups/${followupId}/response`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response, notes }),
        }
      );
      if (res.ok) {
        onNotify?.('Follow-up verification recorded.');
        await fetchIssues();
        if (selectedIssue && selectedIssue.id === issueId) {
          await fetchIssueDetail(issueId);
        }
      } else {
        const errJson = await res.json();
        onNotify?.(`Failed: ${errJson.error || 'Server error'}`);
      }
    } catch (e) {
      onNotify?.(`Error: ${(e as Error).message}`);
    }
  };

  // Filter issues
  const filteredIssues = issues.filter((iss) => {
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'ACTIVE' && (iss.status === 'RESOLVED' || iss.status === 'DISMISSED')) return false;
      if (statusFilter === 'RESOLVED' && iss.status !== 'RESOLVED') return false;
      if (statusFilter === 'MONITORING' && iss.status !== 'MONITORING') return false;
      if (statusFilter === 'RECURRED' && iss.status !== 'RECURRED') return false;
    }
    if (severityFilter !== 'ALL' && iss.severity !== severityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        iss.title.toLowerCase().includes(q) ||
        iss.summary.toLowerCase().includes(q) ||
        iss.category.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const safetyCriticalCount = issues.filter((i) => i.is_safety_critical || i.requires_immediate_grounding).length;
  const activeCount = issues.filter((i) => i.status !== 'RESOLVED' && i.status !== 'DISMISSED').length;
  const monitoringCount = issues.filter((i) => i.status === 'MONITORING').length;
  const resolvedCount = issues.filter((i) => i.status === 'RESOLVED').length;

  return (
    <div className="space-y-6">
      {/* Top Banner: Vehicle Selector & Overview */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-bold text-white tracking-tight">
                  {selectedVehicle?.display_name || 'Vehicle Issues'}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  {selectedVehicle?.registration_number || 'NO REG'}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                  {selectedVehicle?.current_odometer_cache
                    ? `${selectedVehicle.current_odometer_cache.toLocaleString()} ${selectedVehicle.current_odometer_unit || 'KM'}`
                    : 'Odo Unrecorded'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Persistent Vehicle Problem Memory & Diagnostic History • GAR-008
              </p>
            </div>
          </div>

          {/* Vehicle switcher dropdown & Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            {vehicles.length > 1 && (
              <select
                aria-label="Select vehicle for issue records"
                value={selectedVehicleId}
                onChange={(e) => onSelectVehicle(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.display_name} ({v.registration_number || 'N/A'})
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={fetchIssues}
              className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors"
              title="Refresh issues"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={() => setShowReportModal(true)}
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-lg shadow-amber-600/30 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Report Issue</span>
            </button>
          </div>
        </div>

        {/* Quick KPI stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Active Issues
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-white">{activeCount}</span>
              <span className="text-xs text-slate-400">logged</span>
            </div>
          </div>

          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Persistent / Recurring
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-amber-400">{persistentIssues.length}</span>
              <span className="text-xs text-amber-400/80">memory tracked</span>
            </div>
          </div>

          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Post-Repair Monitoring
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-cyan-400">{monitoringCount}</span>
              <span className="text-xs text-cyan-400/80">under watch</span>
            </div>
          </div>

          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Safety Advisories
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-2xl font-black ${safetyCriticalCount > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {safetyCriticalCount}
              </span>
              <span className="text-xs text-slate-400">{safetyCriticalCount > 0 ? 'action required' : 'nominal'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Safety Hazard / Grounding Warning Alert */}
      {safetyCriticalCount > 0 && (
        <div className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-5 shadow-lg flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30 shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-rose-200 uppercase tracking-wide">
                Safety-Critical Advisory Active
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-rose-500/30 text-rose-300 border border-rose-500/50">
                GAR-008 §48 Safety Screening
              </span>
            </div>
            <p className="text-xs text-rose-300/90 mt-1 leading-relaxed">
              One or more issues have triggered critical chassis/steering/brake or powertrain safety rules.
              Review recommendations immediately and avoid high-speed or heavy-load driving until diagnosed by a qualified workshop.
            </p>
          </div>
        </div>
      )}

      {/* Persistent Problem Memory Section */}
      {persistentIssues.length > 0 && (
        <div className="bg-gradient-to-r from-amber-950/30 via-slate-900 to-slate-900 border border-amber-500/30 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wider">
                Persistent Vehicle Problem Memory
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-300 rounded-full border border-amber-500/30">
                {persistentIssues.length} Flagged
              </span>
            </div>
            <span className="text-[11px] text-slate-400 italic">
              Remembers symptoms across repairs & mileage
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
            {persistentIssues.map((pIss) => (
              <div
                key={pIss.id}
                onClick={() => {
                  fetchIssueDetail(pIss.id);
                }}
                className="bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-amber-500/50 rounded-xl p-3.5 transition-all cursor-pointer group flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors line-clamp-1">
                      {pIss.title}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-300 uppercase shrink-0">
                      {pIss.persistence_state} ({pIss.occurrence_count}x)
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 line-clamp-2">{pIss.summary}</p>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-3 pt-2 border-t border-slate-700/50">
                  <span>First: {new Date(pIss.first_observed_at).toLocaleDateString()}</span>
                  <span className="text-amber-400 font-medium flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    Inspect memory <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content Layout: Issue List & Details Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Issue Feed & Filters (7 cols on lg, or 12 if no issue selected) */}
        <div className={selectedIssue ? 'lg:col-span-6 space-y-4' : 'lg:col-span-12 space-y-4'}>
          {/* Controls Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1.5 bg-slate-800/80 p-1 rounded-xl border border-slate-700/60 overflow-x-auto text-xs">
              {(['ALL', 'ACTIVE', 'MONITORING', 'RESOLVED', 'RECURRED'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setStatusFilter(tab)}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all uppercase text-[11px] ${
                    statusFilter === tab
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Search & Severity Filter */}
            <div className="flex items-center gap-2 flex-grow sm:flex-grow-0">
              <div className="relative flex-grow sm:w-48">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter issues..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 outline-none w-full"
                />
              </div>

              <select
                aria-label="Filter by issue severity"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-xl px-2.5 py-1.5 font-medium outline-none cursor-pointer"
              >
                <option value="ALL">All Severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="SIGNIFICANT">Significant</option>
                <option value="MODERATE">Moderate</option>
                <option value="LOW">Low</option>
              </select>
            </div>
          </div>

          {/* Issue Cards */}
          {filteredIssues.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-slate-300">No issues found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                No issues match your current filters. Log a new symptom or select a different category.
              </p>
              <button
                onClick={() => setShowReportModal(true)}
                className="mt-4 inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-indigo-300 text-xs font-bold px-4 py-2 rounded-xl"
              >
                <Plus className="w-3.5 h-3.5" />
                Log Symptom
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredIssues.map((iss) => {
                const isSelected = selectedIssue?.id === iss.id;

                const severityBadgeColor =
                  iss.severity === 'CRITICAL' || iss.severity === 'SAFETY_HAZARD'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : iss.severity === 'SIGNIFICANT'
                    ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                    : iss.severity === 'MODERATE'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-700 text-slate-300 border-slate-600';

                const statusBadgeColor =
                  iss.status === 'RESOLVED'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : iss.status === 'MONITORING'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : iss.status === 'RECURRED'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : iss.status === 'DIAGNOSED'
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40';

                return (
                  <div
                    key={iss.id}
                    className={`bg-slate-900 border rounded-2xl p-4 transition-all ${
                      isSelected
                        ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-xl'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${severityBadgeColor}`}>
                            {iss.severity}
                          </span>
                          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${statusBadgeColor}`}>
                            {iss.status}
                          </span>
                          {iss.persistence_state !== 'SINGLE_OCCURRENCE' && (
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-950/60 text-amber-300 border border-amber-500/30">
                              {iss.persistence_state} ({iss.occurrence_count}x)
                            </span>
                          )}
                          <span className="text-[11px] text-slate-500 font-mono">
                            {iss.category}
                          </span>
                        </div>

                        <h4 className="text-sm font-bold text-white leading-snug">{iss.title}</h4>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">{iss.summary}</p>
                      </div>

                      <button
                        onClick={() => {
                          if (isSelected) {
                            setSelectedIssue(null);
                          } else {
                            fetchIssueDetail(iss.id);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                        }`}
                      >
                        {isSelected ? 'Close' : 'View Detail'}
                      </button>
                    </div>

                    {/* Next recommended action pill */}
                    {iss.next_recommended_action && (
                      <div className="mt-3 p-2.5 bg-slate-800/70 border border-slate-700/60 rounded-xl flex items-start gap-2 text-xs">
                        <ArrowRight className="w-3.5 h-3.5 text-indigo-400 mt-0.5 shrink-0" />
                        <span className="text-slate-300">
                          <strong className="text-indigo-300">Next Action: </strong>
                          {iss.next_recommended_action}
                        </span>
                      </div>
                    )}

                    {/* Footer bar with quick action buttons */}
                    <div className="flex items-center justify-between text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800">
                      <div className="flex items-center gap-3 text-[11px]">
                        <span>
                          1st: {new Date(iss.first_observed_at).toLocaleDateString()}
                          {iss.first_observed_odometer_km ? ` (${iss.first_observed_odometer_km.toLocaleString()} KM)` : ''}
                        </span>
                        <span>•</span>
                        <span>{iss.intervention_count} repair attempt(s)</span>
                      </div>

                      {/* Action trigger buttons */}
                      <div className="flex items-center gap-1.5">
                        {/* Repeat occurrence button */}
                        <button
                          onClick={() => {
                            setTargetIssueId(iss.id);
                            setShowOccurrenceModal(true);
                          }}
                          className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1"
                          title="Record repeat occurrence"
                        >
                          <Repeat className="w-3 h-3" />
                          <span>Happened Again</span>
                        </button>

                        {/* If monitoring or open, allow intervention or resolution */}
                        {iss.status !== 'RESOLVED' && (
                          <button
                            onClick={() => {
                              setTargetIssueId(iss.id);
                              setShowInterventionModal(true);
                            }}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                          >
                            Intervene
                          </button>
                        )}

                        {iss.status === 'MONITORING' && (
                          <button
                            onClick={() => {
                              setTargetIssueId(iss.id);
                              setShowResolveModal(true);
                            }}
                            className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                          >
                            Resolve
                          </button>
                        )}

                        {iss.status === 'RESOLVED' && (
                          <button
                            onClick={() => {
                              setTargetIssueId(iss.id);
                              setShowRecurModal(true);
                            }}
                            className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                          >
                            Mark Recurred
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Detailed Enriched Issue View (6 cols on lg) */}
        {selectedIssue && (
          <div className="lg:col-span-6 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative sticky top-6">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {selectedIssue.category}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-slate-800 text-slate-300 border border-slate-700">
                      Status: {selectedIssue.status}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {selectedIssue.persistence_state}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white">{selectedIssue.title}</h3>
                </div>
                <button
                  onClick={() => setSelectedIssue(null)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Summary & Provenance */}
              <div className="py-3 text-xs text-slate-300 leading-relaxed border-b border-slate-800">
                <p>{selectedIssue.summary}</p>
                <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-4">
                  <span>Provenance: <strong>{selectedIssue.provenance_class}</strong></span>
                  <span>Reported by: <strong>{selectedIssue.reported_by_actor_type}</strong></span>
                </div>
              </div>

              {/* Active Follow-up Prompt if due */}
              {selectedIssue.active_followups && selectedIssue.active_followups.length > 0 && (
                <div className="my-3 p-4 bg-amber-950/40 border border-amber-500/50 rounded-xl space-y-2">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-amber-400" />
                    <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wide">
                      Pending Post-Intervention Verification
                    </h4>
                  </div>
                  {selectedIssue.active_followups.map((fol) => (
                    <div key={fol.id} className="space-y-2 text-xs">
                      <p className="text-amber-100 font-medium">{fol.prompt_text}</p>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleFollowupResponse(selectedIssue.id, fol.id, 'NO', 'Problem completely gone')}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                        >
                          No (Resolved)
                        </button>
                        <button
                          onClick={() => handleFollowupResponse(selectedIssue.id, fol.id, 'YES', 'Problem is still happening')}
                          className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                        >
                          Yes (Still Happening)
                        </button>
                        <button
                          onClick={() => handleFollowupResponse(selectedIssue.id, fol.id, 'NOT_SURE', 'Have not verified on highway yet')}
                          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                        >
                          Not Sure Yet
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Chronological Lifecycle Timeline */}
              <div className="mt-4">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                  Symptom & Intervention Chronology ({selectedIssue.occurrences.length + selectedIssue.diagnoses.length + selectedIssue.interventions.length} records)
                </h4>

                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {/* Occurrences */}
                  {selectedIssue.occurrences.map((occ) => (
                    <div
                      key={occ.id}
                      className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span className="font-bold text-amber-300">
                          Occurrence #{occ.occurrence_number} • {occ.symptom_category}
                        </span>
                        <span>{new Date(occ.occurred_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-slate-200">{occ.description}</p>
                      <div className="flex flex-wrap gap-2 text-[10px] text-slate-400 pt-1">
                        {occ.speed_range && (
                          <span className="bg-slate-800 px-2 py-0.5 rounded">Speed: {occ.speed_range}</span>
                        )}
                        {occ.driving_condition && (
                          <span className="bg-slate-800 px-2 py-0.5 rounded">Condition: {occ.driving_condition}</span>
                        )}
                        {occ.road_condition && (
                          <span className="bg-slate-800 px-2 py-0.5 rounded">Road: {occ.road_condition}</span>
                        )}
                        {occ.odometer_km && (
                          <span className="bg-slate-800 px-2 py-0.5 rounded">Odo: {occ.odometer_km.toLocaleString()} KM</span>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Diagnoses */}
                  {selectedIssue.diagnoses.map((diag) => (
                    <div
                      key={diag.id}
                      className="bg-indigo-950/40 border border-indigo-500/40 rounded-xl p-3 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px] text-indigo-300">
                        <span className="font-bold">
                          Provider Diagnosis • {diag.provider_name}
                        </span>
                        <span>{new Date(diag.diagnosed_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-indigo-100 font-semibold">{diag.diagnosis_summary}</p>
                      <p className="text-slate-300 text-[11px]">{diag.diagnosis_details}</p>
                      {diag.confirmed_component && (
                        <div className="text-[10px] text-indigo-300 pt-1 font-mono">
                          Confirmed Component: {diag.confirmed_component}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Interventions */}
                  {selectedIssue.interventions.map((intv) => (
                    <div
                      key={intv.id}
                      className="bg-cyan-950/40 border border-cyan-500/40 rounded-xl p-3 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px] text-cyan-300">
                        <span className="font-bold">
                          Intervention ({intv.intervention_type})
                        </span>
                        <span>{new Date(intv.performed_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-cyan-100">{intv.description}</p>
                      {intv.replaced_part_names && intv.replaced_part_names.length > 0 && (
                        <div className="text-[11px] text-slate-300">
                          <strong>Replaced: </strong>
                          {intv.replaced_part_names.join(', ')}
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                        <span>By: {intv.provider_name || 'Self/Owner'}</span>
                        {intv.cost_total ? (
                          <span className="font-bold text-cyan-300">
                            {intv.currency || 'KES'} {intv.cost_total.toLocaleString()}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons inside Drawer */}
              <div className="mt-5 pt-4 border-t border-slate-800 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setTargetIssueId(selectedIssue.id);
                    setShowOccurrenceModal(true);
                  }}
                  className="flex-1 py-2 px-3 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-bold transition-colors cursor-pointer text-center"
                >
                  Log Repeat
                </button>
                <button
                  onClick={() => {
                    setTargetIssueId(selectedIssue.id);
                    setShowDiagnosisModal(true);
                  }}
                  className="flex-1 py-2 px-3 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded-xl text-xs font-bold transition-colors cursor-pointer text-center"
                >
                  Add Diagnosis
                </button>
                <button
                  onClick={() => {
                    setTargetIssueId(selectedIssue.id);
                    setShowInterventionModal(true);
                  }}
                  className="flex-1 py-2 px-3 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 rounded-xl text-xs font-bold transition-colors cursor-pointer text-center"
                >
                  Add Repair
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: Report New Issue */}
      {showReportModal && (
        <ReportIssueModal
          vehicleId={selectedVehicleId}
          currentOdometer={selectedVehicle?.current_odometer_cache || 0}
          onClose={() => setShowReportModal(false)}
          onSuccess={async () => {
            setShowReportModal(false);
            onNotify?.('Issue registered and safety screening performed.');
            await fetchIssues();
          }}
        />
      )}

      {/* MODAL 2: Record Occurrence ("It Happened Again") */}
      {showOccurrenceModal && targetIssueId && (
        <RecordOccurrenceModal
          vehicleId={selectedVehicleId}
          issueId={targetIssueId}
          currentOdometer={selectedVehicle?.current_odometer_cache || 0}
          onClose={() => {
            setShowOccurrenceModal(false);
            setTargetIssueId(null);
          }}
          onSuccess={async () => {
            setShowOccurrenceModal(false);
            setTargetIssueId(null);
            onNotify?.('Repeat symptom occurrence recorded.');
            await fetchIssues();
            if (selectedIssue) await fetchIssueDetail(selectedIssue.id);
          }}
        />
      )}

      {/* MODAL 3: Record Diagnosis */}
      {showDiagnosisModal && targetIssueId && (
        <RecordDiagnosisModal
          vehicleId={selectedVehicleId}
          issueId={targetIssueId}
          onClose={() => {
            setShowDiagnosisModal(false);
            setTargetIssueId(null);
          }}
          onSuccess={async () => {
            setShowDiagnosisModal(false);
            setTargetIssueId(null);
            onNotify?.('Professional diagnosis recorded.');
            await fetchIssues();
            if (selectedIssue) await fetchIssueDetail(selectedIssue.id);
          }}
        />
      )}

      {/* MODAL 4: Record Intervention */}
      {showInterventionModal && targetIssueId && (
        <RecordInterventionModal
          vehicleId={selectedVehicleId}
          issueId={targetIssueId}
          currentOdometer={selectedVehicle?.current_odometer_cache || 0}
          onClose={() => {
            setShowInterventionModal(false);
            setTargetIssueId(null);
          }}
          onSuccess={async () => {
            setShowInterventionModal(false);
            setTargetIssueId(null);
            onNotify?.('Intervention recorded. Transitioned to post-repair MONITORING.');
            await fetchIssues();
            if (selectedIssue) await fetchIssueDetail(selectedIssue.id);
          }}
        />
      )}

      {/* MODAL 5: Resolve Issue */}
      {showResolveModal && targetIssueId && (
        <ResolveIssueModal
          vehicleId={selectedVehicleId}
          issueId={targetIssueId}
          currentOdometer={selectedVehicle?.current_odometer_cache || 0}
          onClose={() => {
            setShowResolveModal(false);
            setTargetIssueId(null);
          }}
          onSuccess={async () => {
            setShowResolveModal(false);
            setTargetIssueId(null);
            onNotify?.('Issue marked RESOLVED with verified verification record.');
            await fetchIssues();
            if (selectedIssue) await fetchIssueDetail(selectedIssue.id);
          }}
        />
      )}

      {/* MODAL 6: Recur Issue */}
      {showRecurModal && targetIssueId && (
        <RecurIssueModal
          vehicleId={selectedVehicleId}
          issueId={targetIssueId}
          currentOdometer={selectedVehicle?.current_odometer_cache || 0}
          onClose={() => {
            setShowRecurModal(false);
            setTargetIssueId(null);
          }}
          onSuccess={async () => {
            setShowRecurModal(false);
            setTargetIssueId(null);
            onNotify?.('Resolved issue transitioned to RECURRED with history preserved.');
            await fetchIssues();
            if (selectedIssue) await fetchIssueDetail(selectedIssue.id);
          }}
        />
      )}
    </div>
  );
};

/* =========================================================================
   SUBCOMPONENT MODALS
   ========================================================================= */

interface ReportModalProps {
  vehicleId: string;
  currentOdometer: number;
  onClose: () => void;
  onSuccess: () => void;
}

const ReportIssueModal: React.FC<ReportModalProps> = ({
  vehicleId,
  currentOdometer,
  onClose,
  onSuccess,
}) => {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('CHASSIS_STEERING');
  const [severity, setSeverity] = useState('MODERATE');
  const [summary, setSummary] = useState('');
  const [symptomCategory, setSymptomCategory] = useState('VIBRATION_SHAKE');
  const [description, setDescription] = useState('');
  const [odometer, setOdometer] = useState<number>(currentOdometer);
  const [speedRange, setSpeedRange] = useState('80-100 km/h');
  const [drivingCondition, setDrivingCondition] = useState('HIGHWAY_CRUISE');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dynamic safety warning check
  const textToCheck = `${title} ${description} ${summary}`.toLowerCase();
  const hasSafetyKeyword =
    textToCheck.includes('brake') ||
    textToCheck.includes('steering') ||
    textToCheck.includes('stall') ||
    textToCheck.includes('fuel leak') ||
    textToCheck.includes('smoke');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/vehicles/${vehicleId}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          category,
          severity,
          summary,
          symptom_category: symptomCategory,
          symptom_description: description,
          odometer_value: odometer,
          speed_range: speedRange,
          driving_condition: drivingCondition,
        }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const json = await res.json();
        setError(json.error || 'Failed to report issue');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-bold text-white">Log Vehicle Issue & Symptom</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl text-xs text-rose-300">
            {error}
          </div>
        )}

        {hasSafetyKeyword && (
          <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl text-xs text-amber-300 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Safety screening alert will be automatically enforced for this issue category.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Issue Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Front-end shimmy vibration at highway speeds (80-100 km/h)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 outline-none"
              >
                <option value="CHASSIS_STEERING">Chassis & Steering</option>
                <option value="BRAKES">Braking System</option>
                <option value="POWERTRAIN_ENGINE">Powertrain / Engine</option>
                <option value="POWERTRAIN_TRANSMISSION">Transmission / Drivetrain</option>
                <option value="ELECTRICAL">Electrical & Sensor</option>
                <option value="BODY_INTERIOR">Body / Interior</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Initial Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 outline-none"
              >
                <option value="LOW">Low</option>
                <option value="MODERATE">Moderate</option>
                <option value="SIGNIFICANT">Significant</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Summary of Issue</label>
            <textarea
              required
              rows={2}
              placeholder="Brief summary of how the symptom presents itself..."
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>

          <div className="border-t border-slate-800 pt-3 space-y-3">
            <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wide">
              Initial Occurrence Context (Symptom ≠ Diagnosis)
            </h4>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Symptom Type</label>
                <select
                  value={symptomCategory}
                  onChange={(e) => setSymptomCategory(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 outline-none"
                >
                  <option value="VIBRATION_SHAKE">Vibration / Shake / Wobble</option>
                  <option value="NOISE_SOUND">Abnormal Noise / Squeak / Knock</option>
                  <option value="POWER_LOSS">Hesitation / Loss of Power</option>
                  <option value="LEAK_FLUID">Fluid Leak / Puddle</option>
                  <option value="WARNING_LIGHT">Warning Lamp / Warning Indicator</option>
                  <option value="PULLING_DRIFTING">Pulling to one side</option>
                  <option value="ODOR_SMELL">Burning Odor / Fuel Smell</option>
                  <option value="STARTING_FAILURE">Starting Difficulties</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Odometer (KM)</label>
                <input
                  type="number"
                  value={odometer}
                  onChange={(e) => setOdometer(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Speed Range</label>
                <input
                  type="text"
                  placeholder="e.g. 80-100 km/h"
                  value={speedRange}
                  onChange={(e) => setSpeedRange(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Driving Condition</label>
                <input
                  type="text"
                  placeholder="e.g. Highway cruise, gentle braking"
                  value={drivingCondition}
                  onChange={(e) => setDrivingCondition(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Symptom Details</label>
              <textarea
                required
                rows={2}
                placeholder="What exactly happens? Under what road or temperature conditions?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold shadow-lg shadow-amber-600/30 flex items-center gap-2"
            >
              {isSubmitting ? 'Registering...' : 'Log Issue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* Occurrence Modal ("It Happened Again") */
const RecordOccurrenceModal: React.FC<{
  vehicleId: string;
  issueId: string;
  currentOdometer: number;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ vehicleId, issueId, currentOdometer, onClose, onSuccess }) => {
  const [description, setDescription] = useState('');
  const [symptomCategory, setSymptomCategory] = useState('VIBRATION_SHAKE');
  const [odometer, setOdometer] = useState(currentOdometer);
  const [speedRange, setSpeedRange] = useState('');
  const [drivingCondition, setDrivingCondition] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/vehicles/${vehicleId}/issues/${issueId}/occurrences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          symptom_category: symptomCategory,
          odometer_value: odometer,
          speed_range: speedRange,
          driving_condition: drivingCondition,
        }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const j = await res.json();
        setError(j.error || 'Failed to record occurrence');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Repeat className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-bold text-white">Record Repeat Occurrence ("Happened Again")</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl text-xs text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">What happened this time?</label>
            <textarea
              required
              rows={3}
              placeholder="Describe the recurrence context (e.g. vibration returned at 92 km/h on Southern Bypass)..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Odometer (KM)</label>
              <input
                type="number"
                value={odometer}
                onChange={(e) => setOdometer(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Speed / Conditions</label>
              <input
                type="text"
                placeholder="e.g. 90 km/h smooth tarmac"
                value={speedRange}
                onChange={(e) => setSpeedRange(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold shadow-lg shadow-amber-600/30 flex items-center gap-2"
            >
              {isSubmitting ? 'Recording...' : 'Record Occurrence'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* Diagnosis Modal */
const RecordDiagnosisModal: React.FC<{
  vehicleId: string;
  issueId: string;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ vehicleId, issueId, onClose, onSuccess }) => {
  const [providerName, setProviderName] = useState('Nairobi Premier Auto Clinic');
  const [technicianName, setTechnicianName] = useState('Kamau Kariuki (Master Tech)');
  const [diagnosisSummary, setDiagnosisSummary] = useState('');
  const [diagnosisDetails, setDiagnosisDetails] = useState('');
  const [confirmedComponent, setConfirmedComponent] = useState('');
  const [diagnosisCode, setDiagnosisCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/vehicles/${vehicleId}/issues/${issueId}/diagnoses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_name: providerName,
          technician_name: technicianName,
          diagnosis_summary: diagnosisSummary,
          diagnosis_details: diagnosisDetails,
          confirmed_component: confirmedComponent,
          diagnosis_code: diagnosisCode,
          outcome: 'ROOT_CAUSE_IDENTIFIED',
        }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const j = await res.json();
        setError(j.error || 'Failed to record diagnosis');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Building className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">Record Workshop Diagnostic Findings</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl text-xs text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Workshop / Provider</label>
              <input
                type="text"
                required
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Lead Technician</label>
              <input
                type="text"
                value={technicianName}
                onChange={(e) => setTechnicianName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Diagnosis Summary</label>
            <input
              type="text"
              required
              placeholder="e.g. Front lower control arm hydro-bushings degraded with radial tears"
              value={diagnosisSummary}
              onChange={(e) => setDiagnosisSummary(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Technical Findings & Test Data</label>
            <textarea
              required
              rows={3}
              placeholder="Detailed findings (e.g. dial indicator showed 3.2mm excessive deflection under lateral load)..."
              value={diagnosisDetails}
              onChange={(e) => setDiagnosisDetails(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Confirmed Fault Component</label>
              <input
                type="text"
                placeholder="e.g. Front Lower Control Arm Bushings"
                value={confirmedComponent}
                onChange={(e) => setConfirmedComponent(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Diagnostic Trouble Code</label>
              <input
                type="text"
                placeholder="e.g. CHAS-SUSP-77B or P0171"
                value={diagnosisCode}
                onChange={(e) => setDiagnosisCode(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-2"
            >
              {isSubmitting ? 'Recording...' : 'Record Diagnosis'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* Intervention Modal */
const RecordInterventionModal: React.FC<{
  vehicleId: string;
  issueId: string;
  currentOdometer: number;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ vehicleId, issueId, currentOdometer, onClose, onSuccess }) => {
  const [interventionType, setInterventionType] = useState('COMPONENT_REPLACEMENT');
  const [description, setDescription] = useState('');
  const [providerName, setProviderName] = useState('Nairobi Premier Auto Clinic');
  const [replacedParts, setReplacedParts] = useState('');
  const [cost, setCost] = useState<number>(0);
  const [odometer, setOdometer] = useState(currentOdometer);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const partsArray = replacedParts
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      const res = await fetch(`/api/v1/vehicles/${vehicleId}/issues/${issueId}/interventions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intervention_type: interventionType,
          description,
          provider_name: providerName,
          replaced_part_names: partsArray,
          cost_total: cost,
          currency: 'KES',
          odometer_value: odometer,
          schedule_followup_days: 14,
        }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const j = await res.json();
        setError(j.error || 'Failed to record intervention');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-bold text-white">Record Repair / Corrective Intervention</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-cyan-950/40 border border-cyan-500/40 rounded-xl text-xs text-cyan-200">
          <strong>Invariant:</strong> Repairs do not automatically resolve issues. This record will transition the issue to <strong>MONITORING</strong> and schedule a post-repair follow-up.
        </div>

        {error && (
          <div className="p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl text-xs text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Intervention Type</label>
              <select
                value={interventionType}
                onChange={(e) => setInterventionType(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 outline-none"
              >
                <option value="COMPONENT_REPLACEMENT">Component Replacement</option>
                <option value="COMPONENT_REPAIR">Component Repair / Overhaul</option>
                <option value="ADJUSTMENT_CALIBRATION">Adjustment & Calibration</option>
                <option value="CLEANING_SERVICING">Cleaning / Flush / Servicing</option>
                <option value="SOFTWARE_UPDATE">Software Update / Re-flash</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Workshop / Provider</label>
              <input
                type="text"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Intervention Description</label>
            <textarea
              required
              rows={2}
              placeholder="e.g. Pressed out worn bushings, pressed in OEM heavy-duty control arm bushing pair, laser alignment..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Replaced Parts (comma separated)</label>
            <input
              type="text"
              placeholder="e.g. Toyota Front Lower Control Arm Bushing LH 48654-60030, Bushing RH"
              value={replacedParts}
              onChange={(e) => setReplacedParts(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Total Cost (KES)</label>
              <input
                type="number"
                value={cost}
                onChange={(e) => setCost(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Odometer (KM)</label>
              <input
                type="number"
                value={odometer}
                onChange={(e) => setOdometer(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold shadow-lg shadow-cyan-600/30 flex items-center gap-2"
            >
              {isSubmitting ? 'Recording...' : 'Record Intervention'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* Resolve Modal */
const ResolveIssueModal: React.FC<{
  vehicleId: string;
  issueId: string;
  currentOdometer: number;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ vehicleId, issueId, currentOdometer, onClose, onSuccess }) => {
  const [resolutionType, setResolutionType] = useState('REPAIR_VERIFIED');
  const [summary, setSummary] = useState('Highway road check confirmed steering wheel vibration completely eliminated.');
  const [notes, setNotes] = useState('Tested up to 110 km/h on smooth highway tarmac. No oscillation detected.');
  const [odometer, setOdometer] = useState(currentOdometer);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/vehicles/${vehicleId}/issues/${issueId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution_type: resolutionType,
          resolution_summary: summary,
          notes,
          resolved_odometer_km: odometer,
        }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const j = await res.json();
        setError(j.error || 'Failed to resolve issue');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">Confirm Issue Resolution</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl text-xs text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Resolution Basis</label>
            <select
              value={resolutionType}
              onChange={(e) => setResolutionType(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 outline-none"
            >
              <option value="REPAIR_VERIFIED">Repair Verified (Post-Repair Monitoring Successful)</option>
              <option value="SYMPTOM_CEASED">Symptom Ceased Spontaneously</option>
              <option value="REPLACED_UNDER_WARRANTY">Replaced Under Warranty</option>
              <option value="CANNOT_REPLICATE">Cannot Replicate / Closed</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Resolution Summary</label>
            <input
              type="text"
              required
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Verification Details & Notes</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-lg shadow-emerald-600/30 flex items-center gap-2"
            >
              {isSubmitting ? 'Resolving...' : 'Confirm Resolution'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* Recur Modal */
const RecurIssueModal: React.FC<{
  vehicleId: string;
  issueId: string;
  currentOdometer: number;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ vehicleId, issueId, currentOdometer, onClose, onSuccess }) => {
  const [description, setDescription] = useState('');
  const [odometer, setOdometer] = useState(currentOdometer);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/vehicles/${vehicleId}/issues/${issueId}/recur`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          odometer_value: odometer,
        }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const j = await res.json();
        setError(j.error || 'Failed to mark recurred');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-rose-400" />
            <h3 className="text-base font-bold text-white">Reopen Resolved Issue (Symptom Recurred)</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-200">
          This preserves prior diagnostic and repair history, increments occurrence count, and sets persistence to <strong>RECURRENT_AFTER_RESOLUTION</strong>.
        </div>

        {error && (
          <div className="p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl text-xs text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Recurrence Description</label>
            <textarea
              required
              rows={3}
              placeholder="Describe how the symptom returned after resolution..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Odometer (KM)</label>
            <input
              type="number"
              value={odometer}
              onChange={(e) => setOdometer(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold shadow-lg shadow-rose-600/30 flex items-center gap-2"
            >
              {isSubmitting ? 'Updating...' : 'Mark as Recurred'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
