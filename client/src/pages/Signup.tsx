import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Signup() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      login(data.user);
      nav('/');
    } catch (err: any) {
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-slate-100 via-white to-slate-200 px-4 py-10">
      <div className="absolute right-4 top-4 flex items-center gap-3">
        <Link
          to="/login"
          className="hidden rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white md:inline-flex"
        >
          Sign in
        </Link>
      </div>
      <div className="mx-auto flex min-h-[calc(100vh-80px)] w-full max-w-5xl flex-col items-center justify-center">
        <form
          className="w-full max-w-md space-y-6 rounded-3xl bg-white/80 p-10 shadow-xl ring-1 ring-slate-200 backdrop-blur"
          onSubmit={onSubmit}
        >
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">
              FileMyRTI
            </p>
            <h1 className="text-2xl font-semibold">Create your account</h1>
            <p className="text-sm text-slate-500">
              Get started with personalised RTI guidance.
            </p>
          </div>
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-600" htmlFor="name">
              Full name
            </label>
            <input
              id="name"
              className="input-field"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Priya Sharma"
              autoComplete="name"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-600" htmlFor="signup-email">
              Email
            </label>
            <input
              id="signup-email"
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
            <label className="text-sm font-medium text-slate-600" htmlFor="signup-password">
              Password
            </label>
            <input
              id="signup-password"
              className="input-field"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Create a secure password"
              autoComplete="new-password"
              required
            />
          </div>
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? 'Creating...' : 'Create account'}
          </button>
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
            <span>Already have an account?</span>
            <Link to="/login" className="font-semibold text-sky-600 transition hover:text-sky-500">
              Sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
