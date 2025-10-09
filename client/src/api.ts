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

type RefreshHandler = () => Promise<boolean>;

let refreshHandler: RefreshHandler | null = null;

export function registerAuthRefresh(handler: RefreshHandler) {
  refreshHandler = handler;
}

export function clearAuthRefresh() {
  refreshHandler = null;
}

function isJsonRequest(init: RequestInit) {
  const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
  return headers.get('Content-Type')?.includes('application/json');
}

async function parseError(res: Response) {
  let msg = 'Request failed';
  try {
    const data = await res.json();
    if (data && typeof data === 'object' && typeof data.error === 'string') {
      msg = data.error;
    }
  } catch {
    // ignore parse errors
  }
  return msg;
}

async function request<T>(path: string, init: RequestInit, retry = true): Promise<T> {
  const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    if (response.status === 401 && retry && refreshHandler) {
      const refreshed = await refreshHandler();
      if (refreshed) {
        return request<T>(path, init, false);
      }
    }
    const message = await parseError(response);
    throw new ApiError(response.status, message);
  }

  if (isJsonRequest({ headers }) || response.headers.get('Content-Type')?.includes('application/json')) {
    return (await response.json()) as T;
  }

  // @ts-expect-error - caller should handle other response types manually
  return response;
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  return request<T>(path, opts);
}
