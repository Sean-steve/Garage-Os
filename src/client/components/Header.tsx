import React from 'react';
import {
  Activity, AlertTriangle, BookOpenCheck, Building2, Car, Clock, FileCheck,
  Fuel, Layers, LifeBuoy, ListTree, LogOut, Radio, ShieldCheck, Sliders,
  Truck, Wrench, ShieldAlert, Navigation, Store
} from 'lucide-react';
import { ActiveTab } from '../types';

interface HeaderProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  systemHealth: string;
  displayName?: string;
  isPlatformAdmin?: boolean;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  systemHealth,
  displayName = 'Garage OS User',
  isPlatformAdmin = false,
  onLogout,
}) => {
  const primary: Array<{ id: ActiveTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Overview', icon: Layers },
    { id: 'fuel', label: 'Fuel & TCO', icon: Fuel },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench },
    { id: 'issues', label: 'Issues', icon: AlertTriangle },
    { id: 'timeline', label: 'Timeline', icon: Clock },
    { id: 'passport', label: 'Passport', icon: FileCheck },
    { id: 'bookings', label: 'Bookings', icon: BookOpenCheck },
    { id: 'providers', label: 'Providers', icon: Building2 },
    { id: 'workshop', label: 'Workshop', icon: Wrench },
    { id: 'roadside', label: 'Roadside', icon: LifeBuoy },
    { id: 'towing', label: 'Towing', icon: Truck },
    { id: 'dispatch', label: 'Dispatch', icon: Radio },
    { id: 'safety', label: 'Safety', icon: ShieldAlert },
    { id: 'accidents', label: 'Accidents', icon: AlertTriangle },
    { id: 'care', label: 'Car Care', icon: FileCheck },
    { id: 'trips', label: 'Trip Guardian', icon: Navigation },
    { id: 'marketplace', label: 'Marketplace', icon: Store },
  ];

  const admin: Array<{ id: ActiveTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'queues', label: 'Queues', icon: Activity },
    { id: 'flags', label: 'Flags', icon: Sliders },
    { id: 'audit', label: 'Audit', icon: ShieldCheck },
    { id: 'traceability', label: 'Traceability', icon: ListTree },
  ];

  const navItems = isPlatformAdmin ? [...primary, ...admin] : primary;

  return (
    <header className="mb-8 space-y-5">
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 bg-indigo-600 rounded-xl flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/25 ring-1 ring-indigo-400/30">
            <Car className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">GARAGE_OS</h1>
              <span className="px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-full">
                S22 • MARKETPLACE FOUNDATION
              </span>
            </div>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-0.5">
              Vehicle Ownership, Service & Mobility Safety OS
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-white text-xs font-semibold">{displayName}</p>
            <p className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider mt-1">
              {systemHealth === 'UP' || systemHealth === 'HEALTHY' || systemHealth === 'ACTIVE'
                ? 'Authenticated Session'
                : 'Degraded'}
            </p>
          </div>
          {onLogout && (
            <button onClick={onLogout} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white hover:bg-slate-800" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex flex-wrap gap-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors ${
                active
                  ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                  : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
