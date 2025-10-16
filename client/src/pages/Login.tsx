import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, resolveApiUrl } from '../api';

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
      login(data.user);
      nav('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = resolveApiUrl('/api/auth/google');
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-slate-100 via-white to-slate-200 px-4 py-6 sm:py-10">
      <div className="absolute right-2 top-2 sm:right-4 sm:top-4 flex items-center gap-3">
        <Link
          to="/signup"
          className="rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white"
        >
          Sign up
        </Link>
      </div>
      <div className="mx-auto flex min-h-[calc(100vh-60px)] sm:min-h-[calc(100vh-80px)] w-full max-w-5xl flex-col items-center justify-center">
        <form
          className="w-full max-w-md space-y-4 sm:space-y-6 rounded-2xl sm:rounded-3xl bg-white/80 p-6 sm:p-8 md:p-10 shadow-xl ring-1 ring-slate-200 backdrop-blur"
          onSubmit={onSubmit}
        >
          <div className="space-y-2">
            <p className="text-xs sm:text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">
              FileMyRTI
            </p>
            <h1 className="text-xl sm:text-2xl font-semibold">Welcome back</h1>
            <p className="text-xs sm:text-sm text-slate-500">
              Sign in to continue your RTI conversations.
            </p>
          </div>
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs sm:text-sm font-medium text-slate-600" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input-field text-sm sm:text-base"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs sm:text-sm font-medium text-slate-600" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input-field text-sm sm:text-base"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="********"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn-primary w-full text-sm sm:text-base py-2.5 sm:py-2" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <div className="relative">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200" />
            <span className="relative mx-auto block w-max bg-white px-3 text-xs font-semibold uppercase tracking-[0.28em] text-slate-300">
              or
            </span>
          </div>
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl sm:rounded-2xl border border-slate-200 bg-white px-3 sm:px-4 py-2.5 sm:py-2 text-xs sm:text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.21-2.25H12v4.26h5.92a5.06 5.06 0 01-2.21 3.32v2.77h3.58c2.1-1.94 3.27-4.8 3.27-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.58-2.77c-.99.66-2.26 1.05-3.7 1.05-2.84 0-5.24-1.92-6.1-4.51H2.18v2.84A11 11 0 0012 23z"
                fill="#34A853"
              />
              <path
                d="M5.9 14.12A6.58 6.58 0 015.56 12c0-.74.13-1.46.34-2.12V7.04H2.18A11 11 0 001 12a11 11 0 001.18 4.96l3.72-2.84z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.27c1.62 0 3.05.56 4.19 1.66l3.14-3.14C17.45 1.72 15 1 12 1A11 11 0 002.18 7.04l3.72 2.84C6.76 7.2 9.16 5.27 12 5.27z"
                fill="#EA4335"
              />
              <path d="M1 1h22v22H1z" fill="none" />
            </svg>
            Continue with Google
          </button>
          <div className="flex items-center justify-center gap-2 text-xs sm:text-sm text-slate-500">
            <span>New to FileMyRTI?</span>
            <Link to="/signup" className="font-semibold text-sky-600 transition hover:text-sky-500">
              Create account
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
