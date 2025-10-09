import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { ThemeToggle } from '../components/ThemeToggle';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      login(data.user, data.token);
      nav('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-slate-100 via-white to-slate-200 px-4 py-10 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="absolute right-4 top-4 flex items-center gap-3">
        <ThemeToggle />
        <Link
          to="/signup"
          className="hidden rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 md:inline-flex"
        >
          Sign up
        </Link>
      </div>
      <div className="mx-auto flex min-h-[calc(100vh-80px)] w-full max-w-5xl flex-col items-center justify-center">
        <form
          className="w-full max-w-md space-y-6 rounded-3xl bg-white/80 p-10 shadow-xl ring-1 ring-slate-200 backdrop-blur dark:bg-slate-900/80 dark:ring-slate-800"
          onSubmit={onSubmit}
        >
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">
              FileMyRTI
            </p>
            <h1 className="text-2xl font-semibold">Welcome back</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Sign in to continue your RTI conversations.
            </p>
          </div>
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input-field"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input-field"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="********"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn-primary w-full" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <span>New to FileMyRTI?</span>
            <Link to="/signup" className="font-semibold text-sky-600 transition hover:text-sky-500 dark:text-sky-400">
              Create account
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
