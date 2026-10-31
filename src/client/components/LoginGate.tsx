import React, { useState } from 'react';
import { Car, LockKeyhole, ShieldCheck } from 'lucide-react';

interface LoginGateProps {
  onAuthenticated: (token: string) => void;
}

export const LoginGate: React.FC<LoginGateProps> = ({ onAuthenticated }) => {
  const [email, setEmail] = useState('owner.demo@garageos.test');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, deviceInfo: 'Garage OS Web' }),
      });
      const json = await res.json();
      const payload = json.data || json;
      if (!res.ok || !payload.session_token) {
        throw new Error(payload.message || json.message || 'Authentication failed');
      }
      sessionStorage.setItem('garage_os_session_token', payload.session_token);
      onAuthenticated(payload.session_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <form onSubmit={login} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-7">
          <div className="h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center"><Car /></div>
          <div>
            <h1 className="text-xl font-bold">Garage OS</h1>
            <p className="text-xs text-slate-400">Authenticated Sprint 1–14 workspace</p>
          </div>
        </div>
        <label className="block text-xs font-semibold text-slate-300 mb-2">Email</label>
        <input className="w-full mb-4 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" value={email} onChange={e => setEmail(e.target.value)} />
        <label className="block text-xs font-semibold text-slate-300 mb-2">Password</label>
        <input type="password" className="w-full mb-5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <div className="mb-4 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}
        <button disabled={busy} className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
          <LockKeyhole className="h-4 w-4" /> {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="mt-5 text-xs text-slate-500 space-y-2">
          <p className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0" /> Actor headers are disabled by default; the UI now uses the canonical session token.</p>
          <p>Development seed: owner.demo@garageos.test / Password123!</p>
          <button type="button" onClick={() => setEmail('admin@garageos.test')} className="text-indigo-400 hover:text-indigo-300">Use platform-admin demo account</button>
        </div>
      </form>
    </div>
  );
};
