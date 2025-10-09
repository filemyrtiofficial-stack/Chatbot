const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
export const API_BASE = BASE;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers = new Headers(opts.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });

  if (!res.ok) {
    let msg = 'Request failed';
    try {
      const j = await res.json();
      if (j && typeof j === 'object' && 'error' in j && typeof j.error === 'string') {
        msg = j.error;
      }
    } catch {
      // ignore JSON parse errors; fall back to default message
    }
    throw new ApiError(res.status, msg);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}
