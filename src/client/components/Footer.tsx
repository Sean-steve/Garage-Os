import React from 'react';

interface FooterProps {
  statusText?: string;
  latencyMs?: number;
}

export const Footer: React.FC<FooterProps> = ({
  statusText = 'Nominal',
  latencyMs = 1.2,
}) => {
  return (
    <footer className="mt-8 pt-4 border-t border-slate-900 flex justify-between items-center text-[10px] text-slate-500 uppercase font-bold tracking-[0.2em] flex-wrap gap-4">
      <div className="flex items-center gap-6 md:gap-8 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          Status: {statusText}
        </span>
        <span>Storage: SQLite WAL (ACID)</span>
        <span>Security: AES-256 + Idempotent</span>
        <span>Outbox Ping: {latencyMs.toFixed(1)}ms</span>
        <span>Standard: GAR-000 Constitution</span>
      </div>
      <div>&copy; 2026 GARAGE_OS KERNEL INC.</div>
    </footer>
  );
};
