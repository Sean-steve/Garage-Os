import React from 'react';
import { ShieldCheck, Layers, Sliders, ListTree, Activity, Car, Clock, FileCheck, Wrench, AlertTriangle, Fuel, CalendarDays, Navigation, LogOut } from 'lucide-react';
import { ActiveTab } from '../types';

interface HeaderProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  systemHealth: string;
  userName?: string;
  userRole?: string;
  showAdminTools?: boolean;
  onLogout?: () => void;
  uptimePercent?: string;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  systemHealth,
  userName = 'Garage OS User',
  userRole = 'Authenticated',
  showAdminTools = false,
  onLogout,
}) => {
  const navItems: Array<{ id: ActiveTab; label: string; icon: React.ComponentType<{ className?: string }>; admin?: boolean }> = [
    { id: 'overview', label: 'Overview', icon: Layers },
    { id: 'fuel', label: 'Fuel & TCO', icon: Fuel },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench },
    { id: 'issues', label: 'Issues', icon: AlertTriangle },
    { id: 'bookings', label: 'Service', icon: CalendarDays },
    { id: 'mobility', label: 'Mobility', icon: Navigation },
    { id: 'timeline', label: 'Timeline', icon: Clock },
    { id: 'passport', label: 'Passport', icon: FileCheck },
    { id: 'queues', label: 'Queues', icon: Activity, admin: true },
    { id: 'flags', label: 'Flags', icon: Sliders, admin: true },
    { id: 'audit', label: 'Audit', icon: ShieldCheck, admin: true },
    { id: 'traceability', label: 'Traceability', icon: ListTree, admin: true },
  ].filter((item) => !item.admin || showAdminTools);

  return (
    <header className="flex justify-between items-center mb-8 flex-wrap gap-4">
      {/* Brand Identity */}
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 bg-indigo-600 rounded-xl flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/25 ring-1 ring-indigo-400/30">
          <Car className="w-6 h-6 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">GARAGE_OS</h1>
            <span className="px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full">
              Kernel v1.0
            </span>
          </div>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-0.5">
            Vehicle Intelligence & Safety OS • GAR-000
          </p>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex items-center gap-4 md:gap-7 text-xs font-semibold uppercase tracking-widest text-slate-400">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex items-center gap-2 pb-1.5 transition-all duration-200 cursor-pointer border-b-2 ${
                isActive
                  ? 'text-indigo-400 border-indigo-400 font-bold drop-shadow-[0_0_8px_rgba(129,140,248,0.3)]'
                  : 'border-transparent hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}

        {/* User / Session Avatar */}
        <div className="flex items-center gap-3 pl-4 border-l border-slate-800">
          <div className="text-right hidden sm:block">
            <p className="text-white text-xs font-semibold leading-none">{userName}</p>
            <p className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider mt-1 flex items-center justify-end gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              {userRole}
            </p>
          </div>
          <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-700/80 p-1 flex-shrink-0 shadow-inner">
            <div className="w-full h-full bg-gradient-to-tr from-indigo-500 via-indigo-600 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
              {userName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'GO'}
            </div>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-900 hover:text-white"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </nav>
    </header>
  );
};
