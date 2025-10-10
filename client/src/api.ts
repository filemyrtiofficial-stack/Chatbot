const DEPLOYED_BASE = 'https://chat.filemyrti.com/api';
const LOCAL_BASE = 'http://localhost:5000';

const envBase = import.meta.env.VITE_API_BASE?.trim();
const initialBase = envBase && envBase.length > 0 ? envBase : DEPLOYED_BASE;

export let API_BASE = initialBase;
let activeBase = initialBase;

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

function normalizeBase(base: string) {
  return base.replace(/\/+$/, '');
}

function normalizePath(path: string) {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function buildUrl(base: string, path: string) {
  const trimmedBase = normalizeBase(base);
  let normalizedPath = normalizePath(path);
  if (trimmedBase.endsWith('/api') && normalizedPath.startsWith('/api')) {
    normalizedPath = normalizedPath.slice(4) || '/';
  }
  return `${trimmedBase}${normalizedPath}`;
}

export function resolveApiUrl(path: string, baseOverride?: string) {
  const base = baseOverride ?? API_BASE;
  return buildUrl(base, path);
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

  const requestInit: RequestInit = {
    ...init,
    headers,
    credentials: 'include',
  };

  const basesToTry =
    activeBase === LOCAL_BASE ? [LOCAL_BASE] : Array.from(new Set([activeBase, LOCAL_BASE]));

  let response: Response | null = null;
  let usedBase = activeBase;
  let lastError: unknown;

  for (const base of basesToTry) {
    try {
      response = await fetch(buildUrl(base, path), requestInit);
      usedBase = base;
      break;
    } catch (err) {
      lastError = err;
      if (base === LOCAL_BASE) {
        throw err;
      }
    }
  }

  if (!response) {
    throw lastError instanceof Error
      ? lastError
      : new Error('Network request failed. Please try again later.');
  }

  activeBase = usedBase;
  API_BASE = usedBase;

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
