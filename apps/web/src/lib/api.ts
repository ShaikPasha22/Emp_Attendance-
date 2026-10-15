import type { ApiErrorBody, LoginResponse } from '@app/shared';
import { getDeviceId } from './device';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

const BASE = '/api/v1';
let accessToken: string | null = null;
let refreshing: Promise<LoginResponse | null> | null = null;
let onSessionEnded: (() => void) | null = null;
let onSlowServer: ((slow: boolean) => void) | null = null;

export const session = {
  setToken: (t: string | null) => (accessToken = t),
  onEnded: (fn: () => void) => (onSessionEnded = fn),
  onSlow: (fn: (slow: boolean) => void) => (onSlowServer = fn),
};

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  } catch {
    if (res.status === 503 || res.status === 502) {
      return new ApiError(res.status, 'UNAVAILABLE', 'The server is waking up. Please try again in a few seconds.');
    }
    return new ApiError(res.status, 'UNKNOWN', 'Something went wrong. Please try again.');
  }
}

/** Exchanges the httpOnly refresh cookie for a new access token. Single-flight across callers. */
export function refreshSession(): Promise<LoginResponse | null> {
  refreshing ??= (async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' });
        if (res.ok) {
          const data = (await res.json()) as LoginResponse;
          accessToken = data.accessToken;
          return data;
        }
        const err = await parseError(res);
        // Another tab rotated the token a moment ago: the browser already has the new cookie.
        if (err.code === 'REFRESH_RACE' && attempt === 0) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        if (res.status >= 500) throw err;
        accessToken = null;
        return null;
      }
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { 'x-device-id': getDeviceId() };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  // If the free-tier server is cold-starting, tell the UI after 4 s so it can explain the wait.
  const slowTimer = setTimeout(() => onSlowServer?.(true), 4000);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'You appear to be offline. Check your connection and try again.');
  } finally {
    clearTimeout(slowTimer);
    onSlowServer?.(false);
  }

  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, opts, true);
    onSessionEnded?.();
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Downloads a file (e.g. Excel export) using the current access token. */
export async function downloadFile(path: string, fallbackName: string) {
  const doFetch = () =>
    fetch(`${BASE}${path}`, { headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {}, credentials: 'same-origin' });
  let res = await doFetch();
  if (res.status === 401 && (await refreshSession())) res = await doFetch();
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const name = res.headers.get('content-disposition')?.match(/filename="(.+?)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong';

/**
 * Reads a Server-Sent Events stream with the access token (EventSource cannot send headers).
 * Resolves when the server closes the stream; rejects on network / auth errors.
 */
export async function streamEvents(path: string, onEvent: (event: string, data: string) => void, signal: AbortSignal): Promise<void> {
  const open = () =>
    fetch(`${BASE}${path}`, {
      headers: { accept: 'text/event-stream', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
  let res = await open();
  if (res.status === 401 && (await refreshSession())) res = await open();
  if (!res.ok || !res.body) throw await parseError(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value.replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data || event !== 'message') onEvent(event, data);
    }
  }
}
