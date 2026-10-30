import React, { useState, useEffect, useCallback } from 'react';
import {
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Calendar,
  Gauge,
  Plus,
  ArrowRight,
  ShieldCheck,
  Check,
  ChevronRight,
  RefreshCw,
  Sparkles,
  DollarSign,
  FileText,
  Building,
  Sliders,
  X,
  History,
  Info,
  PauseCircle,
  Car
} from 'lucide-react';
import {
  VehicleSummary,
  ClientVehicleMaintenanceStatus,
  ClientEnrichedMaintenanceCycle,
  ClientMaintenanceRequirement,
  ClientMaintenanceCompletion,
} from '../types';

interface BentoMaintenanceProps {
  vehicles: VehicleSummary[];
  selectedVehicleId: string;
  onSelectVehicle: (id: string) => void;
  onNotify?: (msg: string) => void;
}

export const BentoMaintenance: React.FC<BentoMaintenanceProps> = ({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  onNotify,
}) => {
  const [status, setStatus] = useState<ClientVehicleMaintenanceStatus | null>(null);
  const [completions, setCompletions] = useState<ClientMaintenanceCompletion[]>([]);
  const [catalog, setCatalog] = useState<ClientMaintenanceRequirement[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // Modals state
  const [completeModalCycle, setCompleteModalCycle] = useState<ClientEnrichedMaintenanceCycle | null>(null);
  const [deferModalCycle, setDeferModalCycle] = useState<ClientEnrichedMaintenanceCycle | null>(null);
  const [customizeModalCycle, setCustomizeModalCycle] = useState<ClientEnrichedMaintenanceCycle | null>(null);
  const [showAddRequirementModal, setShowAddRequirementModal] = useState<boolean>(false);

  // Form states for completion modal
  const [compCompletedAt, setCompCompletedAt] = useState<string>(
    new Date().toISOString().slice(0, 16)
  );
  const [compOdometer, setCompOdometer] = useState<number>(0);
  const [compOdometerUnit, setCompOdometerUnit] = useState<string>('KM');
  const [compProvider, setCompProvider] = useState<string>('Apex Motors & Service Centre');
  const [compCost, setCompCost] = useState<number>(12500);
  const [compCurrency, setCompCurrency] = useState<string>('KES');
  const [compNotes, setCompNotes] = useState<string>('');
  const [compVerification, setCompVerification] = useState<string>('PROVIDER_CONFIRMED');
  const [compActions, setCompActions] = useState<string[]>(['Service action performed']);
  const [compNewAction, setCompNewAction] = useState<string>('');
  const [compParts, setCompParts] = useState<Array<{ name: string; quantity: number; unit_price: number }>>([]);
  const [compPartName, setCompPartName] = useState<string>('');
  const [compPartQty, setCompPartQty] = useState<number>(1);
  const [compPartPrice, setCompPartPrice] = useState<number>(0);

  // Form states for deferral modal
  const [deferReason, setDeferReason] = useState<string>('');
  const [deferDate, setDeferDate] = useState<string>('');
  const [deferDistance, setDeferDistance] = useState<string>('');

  // Form states for customize modal
  const [customDistance, setCustomDistance] = useState<number>(10000);
  const [customTimeVal, setCustomTimeVal] = useState<number>(6);
  const [customTimeUnit, setCustomTimeUnit] = useState<string>('MONTHS');
  const [customPriority, setCustomPriority] = useState<number>(80);

  // Fetch maintenance data for selected vehicle
  const fetchMaintenanceData = useCallback(async () => {
    if (!selectedVehicleId) return;
    setLoading(true);
    try {
      const [statusRes, compRes, catRes] = await Promise.all([
        fetch(`/api/v1/vehicles/${selectedVehicleId}/maintenance/status`),
        fetch(`/api/v1/vehicles/${selectedVehicleId}/maintenance/completions`),
        fetch(`/api/v1/maintenance/catalog`),
      ]);

      if (statusRes.ok) {
        const json = await statusRes.json();
        setStatus(json.data);
      }
      if (compRes.ok) {
        const json = await compRes.json();
        setCompletions(json.data || []);
      }
      if (catRes.ok) {
        const json = await catRes.json();
        setCatalog(json.data?.requirements || []);
      }
    } catch (e) {
      console.error('Failed to load maintenance data', e);
    } finally {
      setLoading(false);
    }
  }, [selectedVehicleId]);

  useEffect(() => {
    fetchMaintenanceData();
  }, [fetchMaintenanceData]);

  // Sync odometer default when vehicle changes
  useEffect(() => {
    if (status) {
      setCompOdometer(status.current_odometer_km || 50000);
    }
  }, [status]);

  const activeVehicle = vehicles.find((v) => v.id === selectedVehicleId) || vehicles[0];

  // Handle Record Completion Submit
  const handleRecordCompletion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completeModalCycle) return;

    try {
      const payload = {
        requirement_id: completeModalCycle.requirement.id,
        completed_at: new Date(compCompletedAt).toISOString(),
        odometer_value: Number(compOdometer),
        odometer_unit: compOdometerUnit,
        service_provider_name: compProvider,
        cost_total: Number(compCost) || null,
        currency: compCurrency,
        notes: compNotes || null,
        performed_actions: compActions.filter(Boolean),
        replaced_parts: compParts,
        verification_status: compVerification,
      };

      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/maintenance/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onNotify?.(`Maintenance verified and logged! Next service cycle initiated.`);
        setCompleteModalCycle(null);
        await fetchMaintenanceData();
      } else {
        const err = await res.json();
        onNotify?.(`Completion error: ${err.error || 'Failed to record completion'}`);
      }
    } catch (err) {
      onNotify?.(`Network error: ${(err as Error).message}`);
    }
  };

  // Handle Deferral Submit
  const handleRecordDeferral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deferModalCycle) return;

    try {
      const payload = {
        cycle_id: deferModalCycle.cycle.id,
        reason: deferReason,
        deferred_until_date: deferDate ? new Date(deferDate).toISOString() : null,
        deferred_until_distance_km: deferDistance ? Number(deferDistance) : null,
      };

      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/maintenance/defer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onNotify?.(`Maintenance cycle deferred successfully.`);
        setDeferModalCycle(null);
        setDeferReason('');
        await fetchMaintenanceData();
      } else {
        const err = await res.json();
        onNotify?.(`Deferral error: ${err.error || 'Failed to record deferral'}`);
      }
    } catch (err) {
      onNotify?.(`Network error: ${(err as Error).message}`);
    }
  };

  // Handle Custom Interval Submit
  const handleSaveCustomInterval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customizeModalCycle) return;

    try {
      const payload = {
        custom_distance_interval: Number(customDistance) || null,
        custom_time_interval_value: Number(customTimeVal) || null,
        custom_time_interval_unit: customTimeUnit || null,
        priority_override: Number(customPriority) || null,
        enabled: true,
      };

      const res = await fetch(
        `/api/v1/vehicles/${selectedVehicleId}/maintenance/entries/${customizeModalCycle.plan_entry.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (res.ok) {
        onNotify?.(`Plan entry intervals updated and cycles re-evaluated.`);
        setCustomizeModalCycle(null);
        await fetchMaintenanceData();
      } else {
        const err = await res.json();
        onNotify?.(`Update error: ${err.error || 'Failed to update plan entry'}`);
      }
    } catch (err) {
      onNotify?.(`Network error: ${(err as Error).message}`);
    }
  };

  // Toggle Entry Enabled
  const handleToggleEntry = async (entry: ClientEnrichedMaintenanceCycle) => {
    try {
      const res = await fetch(
        `/api/v1/vehicles/${selectedVehicleId}/maintenance/entries/${entry.plan_entry.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !entry.plan_entry.enabled }),
        }
      );
      if (res.ok) {
        onNotify?.(`Requirement ${entry.plan_entry.enabled ? 'disabled' : 'enabled'}.`);
        await fetchMaintenanceData();
      }
    } catch (err) {
      onNotify?.(`Failed to toggle requirement: ${(err as Error).message}`);
    }
  };

  // Add Requirement from Catalog to Plan
  const handleAddRequirement = async (requirementId: string) => {
    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/maintenance/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requirement_id: requirementId,
        }),
      });

      if (res.ok) {
        onNotify?.(`Requirement added to vehicle plan.`);
        setShowAddRequirementModal(false);
        await fetchMaintenanceData();
      } else {
        const err = await res.json();
        onNotify?.(`Error: ${err.error || 'Could not add requirement'}`);
      }
    } catch (err) {
      onNotify?.(`Error: ${(err as Error).message}`);
    }
  };

  // Helper for status badge styling
  const getStatusBadge = (st: string) => {
    switch (st) {
      case 'OVERDUE':
        return (
          <span className="px-2.5 py-1 text-[11px] font-bold tracking-wider uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-full flex items-center gap-1.5 shadow-sm shadow-rose-900/40">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            Overdue
          </span>
        );
      case 'DUE':
        return (
          <span className="px-2.5 py-1 text-[11px] font-bold tracking-wider uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full flex items-center gap-1.5 shadow-sm shadow-amber-900/40">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            Due Now
          </span>
        );
      case 'APPROACHING':
        return (
          <span className="px-2.5 py-1 text-[11px] font-bold tracking-wider uppercase bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-full flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            Approaching
          </span>
        );
      case 'DEFERRED':
        return (
          <span className="px-2.5 py-1 text-[11px] font-bold tracking-wider uppercase bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-full flex items-center gap-1.5">
            <PauseCircle className="w-3.5 h-3.5 text-purple-400" />
            Deferred
          </span>
        );
      case 'OK':
      default:
        return (
          <span className="px-2.5 py-1 text-[11px] font-bold tracking-wider uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            Healthy / OK
          </span>
        );
    }
  };

  // Filter cycles
  const filteredCycles = (status?.cycles || []).filter((item) => {
    if (filterCategory !== 'ALL' && item.requirement.category !== filterCategory) {
      return false;
    }
    if (filterStatus !== 'ALL') {
      if (filterStatus === 'ACTIVE_ALERT') {
        return item.cycle.status === 'OVERDUE' || item.cycle.status === 'DUE' || item.cycle.status === 'APPROACHING';
      }
      if (item.cycle.status !== filterStatus) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Top Banner & Vehicle Selector */}
      <div className="bg-slate-900/80 backdrop-blur border border-slate-800/80 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-widest bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full">
                GAR-006 Primary Specification
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Evaluated at: {status ? new Date(status.evaluated_at).toLocaleTimeString() : '...'}
              </span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
              <Wrench className="w-6 h-6 text-indigo-400" />
              Service Scheduling & Due-State Engine
            </h2>
            <p className="text-sm text-slate-300 mt-1 max-w-2xl">
              Deterministic multi-constraint scheduling engine evaluating dual-metric intervals (distance and time: whichever comes first) to answer <strong className="text-indigo-300">what this vehicle needs next, and when.</strong>
            </p>
          </div>

          {/* Vehicle Switcher Pill */}
          <div className="flex items-center gap-3 bg-slate-950/80 p-2 rounded-xl border border-slate-800">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 pl-2">Vehicle:</span>
            <div className="flex gap-2">
              {vehicles.map((v) => {
                const isSelected = v.id === selectedVehicleId;
                return (
                  <button
                    key={v.id}
                    onClick={() => onSelectVehicle(v.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-1 ring-indigo-400'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <Car className="w-3.5 h-3.5" />
                    <span>{v.display_name}</span>
                    <span className="text-[10px] font-mono opacity-80">({v.model_year})</span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => fetchMaintenanceData()}
              className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Recalculate Due State"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Current Vehicle Metrics Strip */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1">
              Current Odometer
            </span>
            <div className="text-lg font-mono font-bold text-white flex items-baseline gap-1">
              {status?.current_odometer_km?.toLocaleString() ?? activeVehicle?.current_odometer_cache?.toLocaleString() ?? '—'}
              <span className="text-xs text-indigo-400 font-sans">KM</span>
            </div>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1">
              Overall Health
            </span>
            <div>{getStatusBadge(status?.overall_status || 'OK')}</div>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
            <span className="text-[10px] uppercase tracking-wider text-rose-400 font-bold block mb-1">
              Overdue
            </span>
            <div className="text-lg font-mono font-bold text-rose-400">
              {status?.summary_counts.overdue ?? 0}
            </div>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
            <span className="text-[10px] uppercase tracking-wider text-amber-400 font-bold block mb-1">
              Due Now
            </span>
            <div className="text-lg font-mono font-bold text-amber-400">
              {status?.summary_counts.due ?? 0}
            </div>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
            <span className="text-[10px] uppercase tracking-wider text-blue-400 font-bold block mb-1">
              Approaching
            </span>
            <div className="text-lg font-mono font-bold text-blue-400">
              {status?.summary_counts.approaching ?? 0}
            </div>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
            <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold block mb-1">
              Active Monitored
            </span>
            <div className="text-lg font-mono font-bold text-slate-200">
              {status?.summary_counts.total ?? 0}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Action Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Status filters */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'ALL', label: 'All Items' },
            { id: 'ACTIVE_ALERT', label: 'Needs Attention (Due/Overdue)' },
            { id: 'OVERDUE', label: 'Overdue' },
            { id: 'DUE', label: 'Due' },
            { id: 'APPROACHING', label: 'Approaching' },
            { id: 'OK', label: 'Healthy' },
            { id: 'DEFERRED', label: 'Deferred' },
          ].map((btn) => (
            <button
              key={btn.id}
              onClick={() => setFilterStatus(btn.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                filterStatus === btn.id
                  ? 'bg-slate-100 text-slate-950 shadow-md font-extrabold'
                  : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => setShowAddRequirementModal(true)}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-bold border border-slate-700 transition flex items-center gap-2 cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4 text-indigo-400" />
            Add From Catalog
          </button>

          <button
            onClick={() => {
              if (status?.cycles && status.cycles.length > 0) {
                // Preselect first overdue, due, or top requirement
                const target =
                  status.cycles.find((c) => c.cycle.status === 'OVERDUE' || c.cycle.status === 'DUE') ||
                  status.cycles[0];
                setCompleteModalCycle(target);
              }
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/30 ring-1 ring-indigo-400/40"
          >
            <CheckCircle2 className="w-4 h-4" />
            Record Service Completion
          </button>
        </div>
      </div>

      {/* Requirements & Cycles Grid */}
      {loading ? (
        <div className="p-16 text-center text-slate-500 font-mono text-sm bg-slate-900/40 rounded-2xl border border-slate-800/80">
          Loading vehicle maintenance schedule and calculating due state...
        </div>
      ) : filteredCycles.length === 0 ? (
        <div className="p-16 text-center text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800/80">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3 opacity-60" />
          <p className="text-base font-semibold text-white">No maintenance cycles match this filter</p>
          <p className="text-xs text-slate-500 mt-1">All monitored requirements are in acceptable condition.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredCycles.map((item) => {
            const { cycle, requirement, rule, plan_entry, last_completion } = item;
            const isAlert = cycle.status === 'OVERDUE' || cycle.status === 'DUE';
            const distProg = Math.min(item.distance_progress_percent ?? 0, 100);
            const timeProg = Math.min(item.time_progress_percent ?? 0, 100);

            return (
              <div
                key={cycle.id}
                className={`rounded-2xl p-6 transition-all duration-200 border relative overflow-hidden flex flex-col justify-between ${
                  cycle.status === 'OVERDUE'
                    ? 'bg-rose-950/20 border-rose-500/40 shadow-lg shadow-rose-950/20'
                    : cycle.status === 'DUE'
                    ? 'bg-amber-950/20 border-amber-500/40 shadow-lg shadow-amber-950/20'
                    : cycle.status === 'APPROACHING'
                    ? 'bg-blue-950/20 border-blue-500/40 shadow-lg shadow-blue-950/20'
                    : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Header block */}
                <div>
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider bg-slate-800 text-slate-300 rounded border border-slate-700">
                          {requirement.category}
                        </span>
                        <span className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider bg-indigo-950 text-indigo-300 rounded border border-indigo-800">
                          Cycle #{cycle.cycle_number}
                        </span>
                        {requirement.default_severity === 'CRITICAL' && (
                          <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-rose-900/60 text-rose-300 rounded">
                            Critical
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-bold text-white tracking-tight">{requirement.name}</h3>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed line-clamp-2">
                        {requirement.description}
                      </p>
                    </div>

                    <div>{getStatusBadge(cycle.status)}</div>
                  </div>

                  {/* Trigger policy and Reason */}
                  <div className="mt-4 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs">
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                      <span className="font-semibold text-slate-300">Trigger Policy:</span>
                      <span className="font-mono text-indigo-300">
                        {rule.distance_interval?.toLocaleString()} KM or {rule.time_interval_value} {rule.time_interval_unit} (Whichever First)
                      </span>
                    </div>

                    <div className="text-slate-200 mt-1 font-medium flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                      <span>{cycle.trigger_reason || 'Nominal cycle'}</span>
                    </div>
                  </div>

                  {/* Progress Dual Bars */}
                  <div className="mt-4 space-y-2.5">
                    {/* Distance Bar */}
                    <div>
                      <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
                        <span className="flex items-center gap-1">
                          <Gauge className="w-3 h-3 text-slate-400" />
                          Distance Progress
                        </span>
                        <span>
                          {cycle.distance_remaining_km !== null
                            ? cycle.distance_remaining_km > 0
                              ? `${cycle.distance_remaining_km.toLocaleString()} km remaining`
                              : `${Math.abs(cycle.distance_remaining_km).toLocaleString()} km overdue`
                            : 'N/A'}{' '}
                          ({item.distance_progress_percent}%)
                        </span>
                      </div>
                      <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            distProg >= 100 ? 'bg-rose-500' : distProg >= 85 ? 'bg-amber-500' : 'bg-indigo-500'
                          }`}
                          style={{ width: `${distProg}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Time Bar */}
                    <div>
                      <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          Time Progress
                        </span>
                        <span>
                          {cycle.days_remaining !== null
                            ? cycle.days_remaining > 0
                              ? `${cycle.days_remaining} days remaining`
                              : `${Math.abs(cycle.days_remaining)} days overdue`
                            : 'N/A'}{' '}
                          ({item.time_progress_percent}%)
                        </span>
                      </div>
                      <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            timeProg >= 100 ? 'bg-rose-500' : timeProg >= 85 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${timeProg}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>

                  {/* Deferral notice if deferred */}
                  {cycle.status === 'DEFERRED' && (
                    <div className="mt-3 p-3 bg-purple-950/40 border border-purple-800/60 rounded-xl text-xs text-purple-200">
                      <div className="font-bold flex items-center gap-1.5 mb-1">
                        <PauseCircle className="w-3.5 h-3.5 text-purple-400" />
                        Service Deferred:
                      </div>
                      <p className="italic">{cycle.deferral_reason}</p>
                      {cycle.deferred_until_date && (
                        <p className="text-[11px] text-purple-300 mt-1">
                          Until Date: {new Date(cycle.deferred_until_date).toLocaleDateString()}
                        </p>
                      )}
                      {cycle.deferred_until_distance_km && (
                        <p className="text-[11px] text-purple-300">
                          Until Odometer: {cycle.deferred_until_distance_km.toLocaleString()} KM
                        </p>
                      )}
                    </div>
                  )}

                  {/* Last Service Recorded */}
                  {last_completion && (
                    <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
                      <div>
                        <span className="text-slate-500">Last Serviced:</span>{' '}
                        <strong className="text-slate-300 font-mono">
                          {new Date(last_completion.completed_at).toLocaleDateString()}
                        </strong>{' '}
                        @ {last_completion.odometer_value.toLocaleString()} {last_completion.odometer_unit}
                      </div>
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-950 text-emerald-400 border border-emerald-800">
                        {last_completion.verification_status}
                      </span>
                    </div>
                  )}
                </div>

                {/* Footer action buttons */}
                <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCustomizeModalCycle(item)}
                      className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg text-xs transition"
                      title="Customize Intervals"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleToggleEntry(item)}
                      className={`px-2 py-1 text-[11px] font-semibold rounded-lg transition ${
                        plan_entry.enabled
                          ? 'text-slate-400 hover:text-rose-400'
                          : 'text-rose-400 bg-rose-950/40'
                      }`}
                    >
                      {plan_entry.enabled ? 'Pause' : 'Resume'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {cycle.status !== 'DEFERRED' && (
                      <button
                        onClick={() => setDeferModalCycle(item)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition cursor-pointer"
                      >
                        Defer
                      </button>
                    )}
                    <button
                      onClick={() => setCompleteModalCycle(item)}
                      className="px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition cursor-pointer shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Mark Completed
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Completed Services History Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-400" />
            <h3 className="text-lg font-bold text-white">Verified Maintenance History</h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {completions.length} verified records
          </span>
        </div>

        {completions.length === 0 ? (
          <p className="text-xs text-slate-500 py-6 text-center">
            No maintenance records verified for this vehicle yet. Mark a service cycle as completed above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-mono">
                  <th className="pb-3 font-semibold">Date</th>
                  <th className="pb-3 font-semibold">Service Requirement</th>
                  <th className="pb-3 font-semibold">Odometer</th>
                  <th className="pb-3 font-semibold">Provider</th>
                  <th className="pb-3 font-semibold">Replaced Parts</th>
                  <th className="pb-3 font-semibold">Cost</th>
                  <th className="pb-3 font-semibold text-right">Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {completions.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-3 font-mono text-slate-300">
                      {new Date(c.completed_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 font-semibold text-white">
                      {catalog.find((req) => req.id === c.requirement_id)?.name || c.requirement_id}
                    </td>
                    <td className="py-3 font-mono text-slate-300">
                      {c.odometer_value?.toLocaleString()} {c.odometer_unit}
                    </td>
                    <td className="py-3 text-slate-300">{c.service_provider_name || 'Owner / Self'}</td>
                    <td className="py-3 text-slate-400">
                      {c.replaced_parts && c.replaced_parts.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {c.replaced_parts.map((p, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px]"
                            >
                              {p.name} (x{p.quantity})
                            </span>
                          ))}
                        </div>
                      ) : (
                        'None logged'
                      )}
                    </td>
                    <td className="py-3 font-mono text-slate-300 font-bold">
                      {c.cost_total ? `${c.currency || 'KES'} ${c.cost_total.toLocaleString()}` : '—'}
                    </td>
                    <td className="py-3 text-right">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
                        {c.verification_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* RECORD COMPLETION MODAL */}
      {/* ========================================================================= */}
      {completeModalCycle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setCompleteModalCycle(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800 hover:bg-slate-700"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-indigo-500/20 text-indigo-300 rounded">
                Cycle #{completeModalCycle.cycle.cycle_number}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {completeModalCycle.requirement.category}
              </span>
            </div>
            <h3 className="text-xl font-bold text-white">Record Service Completion</h3>
            <p className="text-xs text-slate-400 mb-6">
              {completeModalCycle.requirement.name} — Will recalculate next cycle baseline and trigger canonical event projection.
            </p>

            <form onSubmit={handleRecordCompletion} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Completion Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={compCompletedAt}
                    onChange={(e) => setCompCompletedAt(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Odometer Reading
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={compOdometer}
                      onChange={(e) => setCompOdometer(Number(e.target.value))}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                    <select
                      value={compOdometerUnit}
                      onChange={(e) => setCompOdometerUnit(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white"
                    >
                      <option value="KM">KM</option>
                      <option value="MILES">MILES</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Service Provider / Workshop
                </label>
                <input
                  type="text"
                  value={compProvider}
                  onChange={(e) => setCompProvider(e.target.value)}
                  placeholder="e.g. Apex Motors, Brembo Centre, Owner"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Total Invoiced Cost
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={compCost}
                      onChange={(e) => setCompCost(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                    <select
                      value={compCurrency}
                      onChange={(e) => setCompCurrency(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white"
                    >
                      <option value="KES">KES</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Verification Standard
                  </label>
                  <select
                    value={compVerification}
                    onChange={(e) => setCompVerification(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="PROVIDER_CONFIRMED">Provider Confirmed (Highest Trust)</option>
                    <option value="DOCUMENT_VERIFIED">Document Verified (Receipt Uploaded)</option>
                    <option value="OWNER_ASSERTED">Owner Asserted (Self-Reported)</option>
                  </select>
                </div>
              </div>

              {/* Replaced Parts Section */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Replaced Parts & Consumables
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Part Name (e.g. Synthetic 5W-30 Oil, Filter)"
                    value={compPartName}
                    onChange={(e) => setCompPartName(e.target.value)}
                    className="flex-grow bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
                  />
                  <input
                    type="number"
                    placeholder="Qty"
                    value={compPartQty}
                    onChange={(e) => setCompPartQty(Number(e.target.value))}
                    className="w-16 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-xs text-white font-mono"
                  />
                  <input
                    type="number"
                    placeholder="Price"
                    value={compPartPrice}
                    onChange={(e) => setCompPartPrice(Number(e.target.value))}
                    className="w-24 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-xs text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (compPartName) {
                        setCompParts([
                          ...compParts,
                          { name: compPartName, quantity: compPartQty, unit_price: compPartPrice },
                        ]);
                        setCompPartName('');
                        setCompPartQty(1);
                        setCompPartPrice(0);
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
                  >
                    Add
                  </button>
                </div>

                {compParts.length > 0 && (
                  <div className="space-y-1 mt-1">
                    {compParts.map((p, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs bg-slate-950/70 px-2.5 py-1 rounded border border-slate-800"
                      >
                        <span className="text-slate-300">
                          {p.name} (x{p.quantity}) — {compCurrency} {p.unit_price}
                        </span>
                        <button
                          type="button"
                          onClick={() => setCompParts(compParts.filter((_, i) => i !== idx))}
                          className="text-rose-400 hover:text-rose-300"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Service Notes / Inspection Findings
                </label>
                <textarea
                  rows={2}
                  value={compNotes}
                  onChange={(e) => setCompNotes(e.target.value)}
                  placeholder="Additional technician observations, torque checks, fluid brand..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                ></textarea>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCompleteModalCycle(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  Save & Roll Cycle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DEFER CYCLE MODAL */}
      {/* ========================================================================= */}
      {deferModalCycle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setDeferModalCycle(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800 hover:bg-slate-700"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-bold text-white mb-1">Defer Service Cycle</h3>
            <p className="text-xs text-slate-400 mb-5">
              Temporarily postpone {deferModalCycle.requirement.name}. Deferral reasons are recorded in the audit trail.
            </p>

            <form onSubmit={handleRecordDeferral} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Reason for Deferral *
                </label>
                <textarea
                  rows={2}
                  value={deferReason}
                  onChange={(e) => setDeferReason(e.target.value)}
                  placeholder="e.g. Parts on backorder, vehicle traveling abroad, scheduled with specialist..."
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                ></textarea>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Deferred Until Date (Optional)
                </label>
                <input
                  type="date"
                  value={deferDate}
                  onChange={(e) => setDeferDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Deferred Until Odometer KM (Optional)
                </label>
                <input
                  type="number"
                  value={deferDistance}
                  onChange={(e) => setDeferDistance(e.target.value)}
                  placeholder="e.g. 92000"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setDeferModalCycle(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-purple-600/30"
                >
                  Record Deferral
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CUSTOMIZE INTERVAL MODAL */}
      {/* ========================================================================= */}
      {customizeModalCycle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setCustomizeModalCycle(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800 hover:bg-slate-700"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-bold text-white mb-1">Customize Service Interval</h3>
            <p className="text-xs text-slate-400 mb-5">
              Set custom distance or time parameters for {customizeModalCycle.requirement.name}.
            </p>

            <form onSubmit={handleSaveCustomInterval} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Custom Distance Interval (KM)
                </label>
                <input
                  type="number"
                  value={customDistance}
                  onChange={(e) => setCustomDistance(Number(e.target.value))}
                  placeholder="e.g. 8000"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  Default catalog rule: {customizeModalCycle.rule.distance_interval?.toLocaleString()} KM
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Time Value
                  </label>
                  <input
                    type="number"
                    value={customTimeVal}
                    onChange={(e) => setCustomTimeVal(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Unit
                  </label>
                  <select
                    value={customTimeUnit}
                    onChange={(e) => setCustomTimeUnit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="MONTHS">MONTHS</option>
                    <option value="DAYS">DAYS</option>
                    <option value="YEARS">YEARS</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Priority Override (0-100)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={customPriority}
                  onChange={(e) => setCustomPriority(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCustomizeModalCycle(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30"
                >
                  Save Interval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD REQUIREMENT FROM CATALOG MODAL */}
      {/* ========================================================================= */}
      {showAddRequirementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative max-h-[85vh] overflow-y-auto">
            <button
              onClick={() => setShowAddRequirementModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800 hover:bg-slate-700"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-bold text-white mb-1">Add Maintenance Requirement</h3>
            <p className="text-xs text-slate-400 mb-5">
              Select an item from the standard passenger / fleet maintenance catalog.
            </p>

            <div className="space-y-3">
              {catalog.map((req) => {
                const isAlreadyInPlan = status?.cycles.some(
                  (c) => c.requirement.id === req.id
                );

                return (
                  <div
                    key={req.id}
                    className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between gap-4 hover:border-slate-700 transition"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 text-[9px] font-mono uppercase bg-slate-800 text-slate-300 rounded">
                          {req.category}
                        </span>
                        <span className="text-xs font-bold text-white">{req.name}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-1">{req.description}</p>
                    </div>

                    <button
                      disabled={isAlreadyInPlan}
                      onClick={() => handleAddRequirement(req.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                        isAlreadyInPlan
                          ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer shadow-md shadow-indigo-600/30'
                      }`}
                    >
                      {isAlreadyInPlan ? 'Already In Plan' : <><Plus className="w-3.5 h-3.5" /> Add</>}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
