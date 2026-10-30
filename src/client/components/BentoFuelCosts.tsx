import React, { useState, useEffect, useCallback } from 'react';
import {
  Fuel,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Gauge,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  ShieldAlert,
  Clock,
  Car,
  Filter,
  RefreshCw,
  X,
  FileText,
  Building,
  Check,
  Zap,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  VehicleSummary,
  ClientFuelEntry,
  ClientFuelInterval,
  ClientFuelSummary,
  ClientVehicleExpense,
  ClientRecurringExpense,
  ClientTcoSummary,
} from '../types';

interface BentoFuelCostsProps {
  vehicles: VehicleSummary[];
  selectedVehicleId: string;
  onSelectVehicle: (id: string) => void;
  onNotify?: (msg: string) => void;
}

export const BentoFuelCosts: React.FC<BentoFuelCostsProps> = ({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<'fuel' | 'expenses' | 'recurring' | 'tco'>('fuel');
  const [period, setPeriod] = useState<string>('ALL_TIME');
  const [loading, setLoading] = useState<boolean>(true);

  // Domain data
  const [fuelEntries, setFuelEntries] = useState<ClientFuelEntry[]>([]);
  const [intervals, setIntervals] = useState<ClientFuelInterval[]>([]);
  const [fuelSummary, setFuelSummary] = useState<ClientFuelSummary | null>(null);
  const [expenses, setExpenses] = useState<ClientVehicleExpense[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<ClientRecurringExpense[]>([]);
  const [tcoSummary, setTcoSummary] = useState<ClientTcoSummary | null>(null);

  // Filters
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<string>('ALL');

  // Modals
  const [showLogFuelModal, setShowLogFuelModal] = useState<boolean>(false);
  const [showRecordExpenseModal, setShowRecordExpenseModal] = useState<boolean>(false);
  const [showAddRecurringModal, setShowAddRecurringModal] = useState<boolean>(false);
  const [correctFuelEntry, setCorrectFuelEntry] = useState<ClientFuelEntry | null>(null);

  // Form states for Log Fuel
  const [fuelForm, setFuelForm] = useState({
    fueled_at: new Date().toISOString().slice(0, 16),
    odometer_value: '',
    odometer_unit: 'KM',
    fuel_type: 'DIESEL',
    quantity: '',
    quantity_unit: 'LITRE',
    total_cost: '',
    currency: 'KES',
    fill_type: 'FULL',
    tank_level_before: '0.15',
    tank_level_after: '1.0',
    station_name: '',
    location_reference: '',
    notes: '',
  });

  // Form states for Record Expense
  const [expenseForm, setExpenseForm] = useState({
    expense_category: 'MAINTENANCE',
    expense_subcategory: '',
    occurred_at: new Date().toISOString().slice(0, 16),
    amount: '',
    currency: 'KES',
    cost_type: 'ACTUAL',
    status: 'CONFIRMED',
    description: '',
    merchant_provider_id: '',
    odometer_km: '',
    notes: '',
  });

  // Form states for Recurring Expense
  const [recurringForm, setRecurringForm] = useState({
    category: 'INSURANCE',
    description: '',
    amount: '',
    currency: 'KES',
    frequency: 'MONTHLY',
    start_date: new Date().toISOString().slice(0, 10),
    auto_create_expense: true,
  });

  // Correction form
  const [correctionReason, setCorrectionReason] = useState<string>('');
  const [correctionOdo, setCorrectionOdo] = useState<string>('');
  const [correctionCost, setCorrectionCost] = useState<string>('');
  const [correctionQty, setCorrectionQty] = useState<string>('');

  const currentVehicle = vehicles.find((v) => v.id === selectedVehicleId) || vehicles[0];

  const fetchData = useCallback(async () => {
    if (!selectedVehicleId) return;
    setLoading(true);
    try {
      const [fuelRes, summaryRes, intervalsRes, expRes, recRes, tcoRes] = await Promise.all([
        fetch(`/api/v1/vehicles/${selectedVehicleId}/fuel`),
        fetch(`/api/v1/vehicles/${selectedVehicleId}/fuel/summary?period=${period}`),
        fetch(`/api/v1/vehicles/${selectedVehicleId}/fuel/intervals`),
        fetch(`/api/v1/vehicles/${selectedVehicleId}/expenses`),
        fetch(`/api/v1/vehicles/${selectedVehicleId}/expenses/recurring`),
        fetch(`/api/v1/vehicles/${selectedVehicleId}/tco?period=${period}`),
      ]);

      if (fuelRes.ok) {
        const j = await fuelRes.json();
        setFuelEntries(j.data || []);
      }
      if (summaryRes.ok) {
        const j = await summaryRes.json();
        setFuelSummary(j.data || null);
      }
      if (intervalsRes.ok) {
        const j = await intervalsRes.json();
        setIntervals(j.data || []);
      }
      if (expRes.ok) {
        const j = await expRes.json();
        setExpenses(j.data || []);
      }
      if (recRes.ok) {
        const j = await recRes.json();
        setRecurringExpenses(j.data || []);
      }
      if (tcoRes.ok) {
        const j = await tcoRes.json();
        setTcoSummary(j.data || null);
      }
    } catch (e) {
      console.error('Failed to load fuel & expense intelligence data', e);
    } finally {
      setLoading(false);
    }
  }, [selectedVehicleId, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Submit Fuel Purchase
  const handleRecordFuel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/fuel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...fuelForm,
          fueled_at: new Date(fuelForm.fueled_at).toISOString(),
          odometer_value: fuelForm.odometer_value ? Number(fuelForm.odometer_value) : undefined,
          quantity: Number(fuelForm.quantity),
          total_cost: Number(fuelForm.total_cost),
          tank_level_before: fuelForm.tank_level_before ? Number(fuelForm.tank_level_before) : undefined,
          tank_level_after: fuelForm.tank_level_after ? Number(fuelForm.tank_level_after) : undefined,
        }),
      });
      if (res.ok) {
        setShowLogFuelModal(false);
        onNotify?.('Fuel purchase recorded and economy recalculated successfully');
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error?.message || 'Failed to record fuel purchase');
      }
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // Submit Expense
  const handleRecordExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...expenseForm,
          occurred_at: new Date(expenseForm.occurred_at).toISOString(),
          amount: Number(expenseForm.amount),
          odometer_km: expenseForm.odometer_km ? Number(expenseForm.odometer_km) : undefined,
        }),
      });
      if (res.ok) {
        setShowRecordExpenseModal(false);
        onNotify?.('Vehicle expense recorded successfully');
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error?.message || 'Failed to record expense');
      }
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // Submit Recurring Expense
  const handleAddRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/v1/vehicles/${selectedVehicleId}/expenses/recurring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...recurringForm,
          start_date: new Date(recurringForm.start_date).toISOString(),
          amount: Number(recurringForm.amount),
        }),
      });
      if (res.ok) {
        setShowAddRecurringModal(false);
        onNotify?.('Recurring expense schedule created');
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error?.message || 'Failed to create recurring schedule');
      }
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // Submit Fuel Correction
  const handleCorrectFuel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctFuelEntry) return;
    try {
      const res = await fetch(`/api/v1/fuel/${correctFuelEntry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correction_reason: correctionReason,
          odometer_value: correctionOdo ? Number(correctionOdo) : undefined,
          total_cost: correctionCost ? Number(correctionCost) : undefined,
          quantity: correctionQty ? Number(correctionQty) : undefined,
        }),
      });
      if (res.ok) {
        setCorrectFuelEntry(null);
        onNotify?.('Fuel entry corrected and audit trail logged');
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error?.message || 'Correction failed');
      }
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // Trigger Recurring Expense Job
  const handleTriggerRecurringJob = async () => {
    try {
      const res = await fetch('/api/v1/test/enqueue-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_name: 'recurring_expense.processor',
          payload: { as_of_utc: new Date().toISOString() },
        }),
      });
      if (res.ok) {
        onNotify?.('Recurring expense processor job enqueued');
        setTimeout(fetchData, 1500);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredExpenses = expenses.filter((e) => {
    if (expenseCategoryFilter !== 'ALL' && e.expense_category !== expenseCategoryFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* 1. Header & Vehicle Ribbon */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 md:p-6 shadow-xl backdrop-blur flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shadow-lg shadow-amber-500/10">
              <Fuel className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-white">
                  Fuel, Expenses & Total Cost of Ownership
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full">
                  GAR-009 Standard
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-currency cost intelligence, full-to-full consumption telemetry, and efficiency anomaly detection.
              </p>
            </div>
          </div>
        </div>

        {/* Vehicle Selection & Actions */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Vehicle Dropdown */}
          <div className="relative flex-1 md:w-64">
            <select
              value={selectedVehicleId}
              onChange={(e) => onSelectVehicle(e.target.value)}
              className="w-full appearance-none bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {vehicles.map((v, idx) => (
                <option key={v.id || idx} value={v.id}>
                  {v.display_name} {v.registration_number ? `(${v.registration_number})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Quick Action Buttons */}
          <button
            onClick={() => {
              setFuelForm((f) => ({
                ...f,
                odometer_value: currentVehicle?.current_odometer_cache ? String(currentVehicle.current_odometer_cache) : '',
              }));
              setShowLogFuelModal(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 rounded-xl transition shadow-lg shadow-amber-600/20 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Log Fuel</span>
          </button>

          <button
            onClick={() => setShowRecordExpenseModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition shadow-lg shadow-indigo-600/20 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Record Expense</span>
          </button>
        </div>
      </div>

      {/* Anomaly Alert Banner (if observed) */}
      {fuelSummary?.anomaly_detected && (
        <div className="bg-rose-950/40 border border-rose-500/50 rounded-2xl p-4 flex items-start gap-3.5 text-rose-200 shadow-xl">
          <ShieldAlert className="w-5 h-5 text-rose-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-400">
                Efficiency Anomaly Observed
              </span>
              <span className="px-1.5 py-0.2 text-[9px] bg-rose-500/20 text-rose-300 rounded font-semibold border border-rose-500/30">
                &gt;15% Degradation
              </span>
            </div>
            <p className="text-xs text-rose-200 mt-1 leading-relaxed">
              {fuelSummary.anomaly_message ||
                'Vehicle rolling fuel economy has dropped noticeably below its historical baseline. Inspect tyre pressures, fuel injectors, air filtration, or dragging brake calipers.'}
            </p>
          </div>
        </div>
      )}

      {/* 2. Primary KPI Bento Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Rolling Fuel Economy */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Fuel Economy</span>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Gauge className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {fuelSummary?.rolling_economy_km_l ? (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-white tracking-tight">
                  {fuelSummary.rolling_economy_km_l.toFixed(2)}
                </span>
                <span className="text-xs font-semibold text-slate-400">km / L</span>
              </div>
            ) : (
              <div className="text-sm font-semibold text-slate-400 py-1">
                Awaiting 2+ full tank fills
              </div>
            )}
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
            {fuelSummary?.rolling_economy_l_100km ? (
              <span>{fuelSummary.rolling_economy_l_100km.toFixed(1)} L/100km</span>
            ) : (
              <span>Full-to-full telemetry</span>
            )}
            {fuelSummary?.rolling_economy_mpg_us && (
              <span className="text-slate-500">{fuelSummary.rolling_economy_mpg_us.toFixed(1)} MPG (US)</span>
            )}
          </div>
        </div>

        {/* Metric 2: Fuel Cost Per KM */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Fuel Cost Per KM</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {fuelSummary?.cost_per_km_by_currency && Object.keys(fuelSummary.cost_per_km_by_currency).length > 0 ? (
              <div>
                {Object.entries(fuelSummary.cost_per_km_by_currency).map(([curr, val]) => (
                  <div key={curr} className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-white tracking-tight">
                      {Number(val).toFixed(2)}
                    </span>
                    <span className="text-xs font-semibold text-emerald-400">{curr} / km</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm font-semibold text-slate-400 py-1">
                Awaiting odometer baseline
              </div>
            )}
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
            <span>Volume: {fuelSummary?.total_litres_consumed ? `${fuelSummary.total_litres_consumed.toFixed(1)} L` : '0 L'}</span>
            <span>{fuelSummary?.total_fuel_entries ?? 0} fills</span>
          </div>
        </div>

        {/* Metric 3: Total Fuel Spend */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Fuel Expenditure</span>
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {fuelSummary?.total_spend_by_currency && Object.keys(fuelSummary.total_spend_by_currency).length > 0 ? (
              <div>
                {Object.entries(fuelSummary.total_spend_by_currency).map(([curr, val]) => (
                  <div key={curr} className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-white tracking-tight">
                      {curr} {Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-2xl font-extrabold text-white tracking-tight">KES 0</div>
            )}
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
            {fuelSummary?.average_price_per_litre_by_currency && Object.keys(fuelSummary.average_price_per_litre_by_currency).length > 0 ? (
              <span>
                Avg:{' '}
                {Object.entries(fuelSummary.average_price_per_litre_by_currency)
                  .map(([c, p]) => `${c} ${Number(p).toFixed(1)}/L`)
                  .join(', ')}
              </span>
            ) : (
              <span>Avg unit price</span>
            )}
          </div>
        </div>

        {/* Metric 4: Total Cost of Ownership (TCO) */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Vehicle TCO</span>
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            {tcoSummary?.total_by_currency && Object.keys(tcoSummary.total_by_currency).length > 0 ? (
              <div>
                {Object.entries(tcoSummary.total_by_currency).map(([curr, val]) => (
                  <div key={curr} className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-purple-300 tracking-tight">
                      {curr} {Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-2xl font-extrabold text-white tracking-tight">KES 0</div>
            )}
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
            {tcoSummary?.cost_per_km_by_currency && Object.keys(tcoSummary.cost_per_km_by_currency).length > 0 ? (
              <span>
                Overall:{' '}
                {Object.entries(tcoSummary.cost_per_km_by_currency)
                  .map(([c, v]) => `${c} ${Number(v).toFixed(2)}/km`)
                  .join(', ')}
              </span>
            ) : (
              <span>Complete lifecycle ledger</span>
            )}
            <span className="text-purple-400 font-semibold">{expenses.length} entries</span>
          </div>
        </div>
      </div>

      {/* 3. TCO Category Breakdown Progress Visualizer */}
      {tcoSummary?.category_breakdown && tcoSummary.category_breakdown.length > 0 && (
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Expenditure Distribution & TCO Breakdown
              </span>
              <span className="text-[10px] text-slate-500">
                ({tcoSummary.period === 'ALL_TIME' ? 'All Time' : tcoSummary.period})
              </span>
            </div>
            <div className="flex gap-2">
              {['ALL_TIME', 'THIS_YEAR', 'LAST_30_DAYS'].map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition ${
                    period === p
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {p === 'ALL_TIME' ? 'All Time' : p === 'THIS_YEAR' ? 'This Year' : '30 Days'}
                </button>
              ))}
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden flex shadow-inner">
            {tcoSummary.category_breakdown.map((item, idx) => {
              const colors = [
                'bg-amber-500',
                'bg-blue-500',
                'bg-rose-500',
                'bg-purple-500',
                'bg-emerald-500',
                'bg-cyan-500',
                'bg-orange-500',
              ];
              const color = colors[idx % colors.length];
              return (
                <div
                  key={`${item.category}-${idx}`}
                  title={`${item.category}: ${item.currency} ${item.amount.toLocaleString()} (${item.percentage}%)`}
                  style={{ width: `${item.percentage}%` }}
                  className={`${color} transition-all duration-500 hover:opacity-80`}
                />
              );
            })}
          </div>

          {/* Legend chips */}
          <div className="flex flex-wrap gap-4 mt-3 pt-2 text-xs">
            {tcoSummary.category_breakdown.map((item, idx) => {
              const colors = [
                'bg-amber-500',
                'bg-blue-500',
                'bg-rose-500',
                'bg-purple-500',
                'bg-emerald-500',
                'bg-cyan-500',
                'bg-orange-500',
              ];
              const color = colors[idx % colors.length];
              return (
                <div key={`${item.category}-${idx}`} className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
                  <span className="text-slate-400 capitalize">{item.category.toLowerCase().replace('_', ' ')}:</span>
                  <span className="font-semibold text-slate-200">
                    {item.currency} {item.amount.toLocaleString()}
                  </span>
                  <span className="text-slate-500 text-[10px]">({item.percentage}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Tab Navigation for Section Details */}
      <div className="flex border-b border-slate-800 gap-6 text-xs font-bold uppercase tracking-wider text-slate-400">
        <button
          onClick={() => setSubTab('fuel')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition ${
            subTab === 'fuel' ? 'text-amber-400 border-amber-400' : 'border-transparent hover:text-slate-200'
          }`}
        >
          <Fuel className="w-4 h-4" />
          <span>Fuel Intelligence & Logs ({fuelEntries.length})</span>
        </button>

        <button
          onClick={() => setSubTab('expenses')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition ${
            subTab === 'expenses' ? 'text-indigo-400 border-indigo-400' : 'border-transparent hover:text-slate-200'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          <span>Expense Ledger ({expenses.length})</span>
        </button>

        <button
          onClick={() => setSubTab('recurring')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition ${
            subTab === 'recurring' ? 'text-purple-400 border-purple-400' : 'border-transparent hover:text-slate-200'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Recurring Schedules ({recurringExpenses.length})</span>
        </button>
      </div>

      {/* 5. Sub-Tab 1: Fuel Intelligence & Intervals */}
      {subTab === 'fuel' && (
        <div className="space-y-6">
          {/* Economy Intervals Ribbon (Full-to-Full) */}
          {intervals.length > 0 && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    Calculated Full-to-Full Intervals
                  </span>
                  <span className="text-[10px] text-slate-400">
                    (Deterministic distance ÷ fuel consumed between consecutive full fills)
                  </span>
                </div>
                <span className="text-xs font-semibold text-slate-400">{intervals.length} intervals</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {intervals.map((inv, idx) => (
                  <div
                    key={inv.id || idx}
                    className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3.5 flex flex-col justify-between"
                  >
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Interval #{intervals.length - idx}
                      </span>
                      <span
                        className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase border ${
                          inv.confidence === 'HIGH'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {inv.confidence} Confidence
                      </span>
                    </div>

                    <div className="my-2">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-black text-white">{inv.km_per_litre.toFixed(2)}</span>
                        <span className="text-xs text-amber-400 font-semibold">km/L</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {inv.litres_per_100_km.toFixed(1)} L/100km • {inv.mpg_us.toFixed(1)} MPG (US)
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/60 flex justify-between text-[10px] text-slate-500">
                      <span>Distance: {inv.distance_km} km</span>
                      <span>Consumed: {inv.fuel_consumed_litres.toFixed(1)} L</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fuel Purchases Table */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800/80 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span>Fuel Purchase History</span>
                <span className="text-xs text-slate-400">({fuelEntries.length})</span>
              </h3>
              <button
                onClick={fetchData}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {fuelEntries.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs">
                No fuel entries recorded yet for this vehicle. Click "Log Fuel" above to add the first fill.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/60 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Date & Time</th>
                      <th className="py-3 px-4">Odometer</th>
                      <th className="py-3 px-4">Type & Fill</th>
                      <th className="py-3 px-4">Quantity</th>
                      <th className="py-3 px-4">Total Cost</th>
                      <th className="py-3 px-4">Unit Price</th>
                      <th className="py-3 px-4">Station</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {fuelEntries.map((fe, idx) => (
                      <tr key={fe.id || idx} className="hover:bg-slate-800/30 transition">
                        <td className="py-3.5 px-4 font-medium text-slate-200">
                          {new Date(fe.fueled_at).toLocaleDateString()} {new Date(fe.fueled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {fe.is_corrected && (
                            <span className="ml-2 text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/30">
                              CORRECTED
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-300">
                          {fe.odometer_value !== null ? `${fe.odometer_value.toLocaleString()} ${fe.odometer_unit || 'KM'}` : '—'}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-white">{fe.fuel_type}</span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                                fe.fill_type === 'FULL'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {fe.fill_type}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-200">
                          {fe.quantity} {fe.quantity_unit}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-emerald-400">
                          {fe.currency} {fe.total_cost.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-slate-400">
                          {fe.currency} {fe.price_per_unit.toFixed(2)} / {fe.quantity_unit.toLowerCase()}
                        </td>
                        <td className="py-3.5 px-4 text-slate-300">
                          {fe.station_name || fe.location_reference || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => {
                              setCorrectFuelEntry(fe);
                              setCorrectionOdo(fe.odometer_value ? String(fe.odometer_value) : '');
                              setCorrectionCost(String(fe.total_cost));
                              setCorrectionQty(String(fe.quantity));
                              setCorrectionReason('');
                            }}
                            className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 hover:underline"
                          >
                            Correct
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. Sub-Tab 2: Expense Ledger */}
      {subTab === 'expenses' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 p-3 rounded-xl flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-semibold text-slate-400">Filter Category:</span>
              <select
                value={expenseCategoryFilter}
                onChange={(e) => setExpenseCategoryFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none"
              >
                <option value="ALL">All Categories</option>
                <option value="FUEL">Fuel</option>
                <option value="MAINTENANCE">Maintenance</option>
                <option value="REPAIR">Repair</option>
                <option value="INSURANCE">Insurance</option>
                <option value="PARKING">Parking</option>
                <option value="WASH_DETAILING">Wash & Detailing</option>
                <option value="TOLL">Toll</option>
                <option value="INSPECTION">Inspection</option>
                <option value="TAX_REGISTRATION">Tax & Registration</option>
              </select>
            </div>
            <div className="text-xs text-slate-400">
              Showing {filteredExpenses.length} of {expenses.length} expenses
            </div>
          </div>

          {/* Expense Ledger Table */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/60 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Description</th>
                    <th className="py-3 px-4">Cost Type</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4">Source</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredExpenses.map((exp, idx) => (
                    <tr key={exp.id || idx} className="hover:bg-slate-800/30 transition">
                      <td className="py-3.5 px-4 font-medium text-slate-200">
                        {new Date(exp.occurred_at).toLocaleDateString()}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-semibold text-white px-2 py-0.5 rounded bg-slate-800 text-[11px]">
                          {exp.expense_category}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-200 max-w-xs truncate">
                        {exp.description}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        <span className="text-[10px] uppercase font-bold text-slate-400">{exp.cost_type}</span>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-purple-300">
                        {exp.currency} {exp.amount.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-[11px] text-slate-400">
                        {exp.source_type}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase border ${
                            exp.status === 'CONFIRMED'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          }`}
                        >
                          {exp.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 7. Sub-Tab 3: Recurring Expense Schedules */}
      {subTab === 'recurring' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
            <div>
              <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                Active Recurring Expense Subscriptions
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Automatically tracks periodic insurance premiums, parking permits, tracking fees, and municipal licenses.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleTriggerRecurringJob}
                className="px-3 py-1.5 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition"
              >
                Run Processor Job
              </button>
              <button
                onClick={() => setShowAddRecurringModal(true)}
                className="px-3 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition shadow flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                <span>Add Recurring Schedule</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recurringExpenses.map((rec, idx) => (
              <div
                key={rec.id || idx}
                className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5 shadow-lg flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {rec.frequency} Subscription
                    </span>
                    <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {rec.status}
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-white mt-1">{rec.description}</h4>
                  <div className="mt-3 text-2xl font-black text-purple-300">
                    {rec.currency} {rec.amount.toLocaleString()}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/60 flex justify-between items-center text-xs text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    <span>Next Due: {new Date(rec.next_due_date).toLocaleDateString()}</span>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {rec.auto_create_expense ? 'Auto-records expense' : 'Notification only'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= MODAL 1: LOG FUEL PURCHASE ================= */}
      {showLogFuelModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-amber-400">
                <Fuel className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Log Fuel Purchase</h3>
              </div>
              <button
                onClick={() => setShowLogFuelModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRecordFuel} className="space-y-4 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Date & Time</label>
                  <input
                    type="datetime-local"
                    value={fuelForm.fueled_at}
                    onChange={(e) => setFuelForm({ ...fuelForm, fueled_at: e.target.value })}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Odometer Reading (KM)</label>
                  <input
                    type="number"
                    step="1"
                    placeholder="e.g. 54500"
                    value={fuelForm.odometer_value}
                    onChange={(e) => setFuelForm({ ...fuelForm, odometer_value: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Fuel Quantity (Litres)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 65.5"
                    value={fuelForm.quantity}
                    onChange={(e) => setFuelForm({ ...fuelForm, quantity: e.target.value })}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Total Cost (KES)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 11800"
                    value={fuelForm.total_cost}
                    onChange={(e) => setFuelForm({ ...fuelForm, total_cost: e.target.value })}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Fill Type</label>
                  <select
                    value={fuelForm.fill_type}
                    onChange={(e) => setFuelForm({ ...fuelForm, fill_type: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  >
                    <option value="FULL">Full Tank (Enables Economy Calc)</option>
                    <option value="PARTIAL">Partial Tank</option>
                    <option value="MISSED_RESET">Missed Fill / Reset</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Fuel Grade</label>
                  <select
                    value={fuelForm.fuel_type}
                    onChange={(e) => setFuelForm({ ...fuelForm, fuel_type: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  >
                    <option value="DIESEL">Diesel</option>
                    <option value="PETROL">Petrol Regular</option>
                    <option value="PETROL_PREMIUM">Petrol Premium / V-Power</option>
                    <option value="CNG">CNG</option>
                    <option value="ELECTRICITY">Electricity (kWh)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Station Name & Location</label>
                <input
                  type="text"
                  placeholder="e.g. TotalEnergies Hurlingham, Nairobi"
                  value={fuelForm.station_name}
                  onChange={(e) => setFuelForm({ ...fuelForm, station_name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Notes (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Highway trip to Naivasha"
                  value={fuelForm.notes}
                  onChange={(e) => setFuelForm({ ...fuelForm, notes: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowLogFuelModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-amber-600 hover:bg-amber-500 rounded-xl shadow cursor-pointer"
                >
                  Save Fuel Purchase
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL 2: RECORD EXPENSE ================= */}
      {showRecordExpenseModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-indigo-400">
                <DollarSign className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Record Vehicle Expense</h3>
              </div>
              <button
                onClick={() => setShowRecordExpenseModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRecordExpense} className="space-y-4 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Expense Category</label>
                  <select
                    value={expenseForm.expense_category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, expense_category: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  >
                    <option value="MAINTENANCE">Maintenance (Service)</option>
                    <option value="REPAIR">Repair</option>
                    <option value="INSURANCE">Insurance</option>
                    <option value="PARKING">Parking</option>
                    <option value="WASH_DETAILING">Wash & Detailing</option>
                    <option value="TOLL">Toll</option>
                    <option value="INSPECTION">Inspection / Inspection Fee</option>
                    <option value="TAX_REGISTRATION">Tax & Registration</option>
                    <option value="ACCESSORY">Accessory / Enhancement</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Amount (KES)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 8500"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Full synthetic engine oil & filter replacement"
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Date</label>
                  <input
                    type="datetime-local"
                    value={expenseForm.occurred_at}
                    onChange={(e) => setExpenseForm({ ...expenseForm, occurred_at: e.target.value })}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Odometer (KM)</label>
                  <input
                    type="number"
                    step="1"
                    placeholder="e.g. 54200"
                    value={expenseForm.odometer_km}
                    onChange={(e) => setExpenseForm({ ...expenseForm, odometer_km: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowRecordExpenseModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow cursor-pointer"
                >
                  Record Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL 3: ADD RECURRING SCHEDULE ================= */}
      {showAddRecurringModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-purple-400">
                <Clock className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Create Recurring Expense Schedule</h3>
              </div>
              <button
                onClick={() => setShowAddRecurringModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddRecurring} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Comprehensive Motor Insurance Annual Policy"
                  value={recurringForm.description}
                  onChange={(e) => setRecurringForm({ ...recurringForm, description: e.target.value })}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Category</label>
                  <select
                    value={recurringForm.category}
                    onChange={(e) => setRecurringForm({ ...recurringForm, category: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  >
                    <option value="INSURANCE">Insurance</option>
                    <option value="PARKING">Parking Permit</option>
                    <option value="SUBSCRIPTION">Vehicle Tracking / GPS</option>
                    <option value="INSPECTION">Inspection Certificate</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Frequency</label>
                  <select
                    value={recurringForm.frequency}
                    onChange={(e) => setRecurringForm({ ...recurringForm, frequency: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="BIANNUAL">Biannual (Every 6 mos)</option>
                    <option value="ANNUAL">Annual</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Amount (KES)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 85000"
                    value={recurringForm.amount}
                    onChange={(e) => setRecurringForm({ ...recurringForm, amount: e.target.value })}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Start Date</label>
                  <input
                    type="date"
                    value={recurringForm.start_date}
                    onChange={(e) => setRecurringForm({ ...recurringForm, start_date: e.target.value })}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddRecurringModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-purple-600 hover:bg-purple-500 rounded-xl shadow cursor-pointer"
                >
                  Create Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL 4: CORRECT FUEL ENTRY ================= */}
      {correctFuelEntry && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Correct Fuel Entry</h3>
              <button onClick={() => setCorrectFuelEntry(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCorrectFuel} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">
                  Reason for Correction (Audit Logged)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Corrected typo in odometer reading"
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Odometer Value (KM)</label>
                <input
                  type="number"
                  value={correctionOdo}
                  onChange={(e) => setCorrectionOdo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Total Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    value={correctionCost}
                    onChange={(e) => setCorrectionCost(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Quantity (Litres)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={correctionQty}
                    onChange={(e) => setCorrectionQty(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCorrectFuelEntry(null)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow cursor-pointer"
                >
                  Save Correction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
