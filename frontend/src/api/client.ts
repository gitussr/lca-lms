/**
 * Central API client for the LCA LMS backend.
 *
 * Responsibilities (F-007):
 * - one place that knows the API base URL and that every request is
 *   credentialed (session cookie — architecture decision D2);
 * - parse the backend's standard error envelope
 *   (`shared/error-handler.ts`) into a typed {@link ApiError};
 * - distinguish "the server answered with an error" ({@link ApiError})
 *   from "the request never completed" ({@link NetworkError}).
 *
 * This client carries no authorization logic of its own. The backend is the
 * sole authority on what a caller may do (core invariant 7); the frontend
 * only reacts to the 401/403 it returns.
 */

const DEFAULT_BASE_URL = '/api/v1';

/** Trailing slash trimmed so path joining is predictable. */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

/** Shape of the backend's error responses. Mirrors `shared/error-handler.ts`. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

/** The server responded, but with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.requestId = options.requestId;
  }

  /** Missing/expired session — the caller should be sent to the login screen. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Authenticated but not allowed — showing a "no access" state is appropriate. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** The request never produced a response (offline, DNS, CORS, aborted). */
export class NetworkError extends Error {
  constructor(message = 'Could not reach the server', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

export interface RequestOptions {
  /** JSON-serialisable request body. Omit for GET/DELETE without a payload. */
  body?: unknown;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Forwarded to `fetch` — e.g. an `AbortController` signal. */
  signal?: AbortSignal;
}

function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${BASE_URL}/${path.replace(/^\/+/, '')}`;
}

function isJson(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}

function looksLikeErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as { error?: unknown }).error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  );
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = isJson(response) ? await response.json() : await response.text();
  } catch {
    payload = undefined;
  }

  if (looksLikeErrorBody(payload)) {
    return new ApiError(response.status, payload.error.code, payload.error.message, {
      details: payload.error.details,
      requestId: payload.requestId ?? response.headers.get('x-request-id') ?? undefined,
    });
  }

  // Non-standard error body (proxy error page, gateway timeout, etc.).
  return new ApiError(
    response.status,
    'HTTP_ERROR',
    typeof payload === 'string' && payload.trim().length > 0
      ? payload.trim().slice(0, 500)
      : `Request failed with status ${response.status}`,
    { requestId: response.headers.get('x-request-id') ?? undefined },
  );
}

/**
 * Perform an API request. Resolves with the parsed JSON body (typed as `T`),
 * or `undefined` for `204 No Content`. Throws {@link ApiError} for a non-2xx
 * response and {@link NetworkError} if the request never completed.
 */
export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] ??= 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      method,
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new NetworkError(undefined, { cause });
  }

  if (!response.ok) throw await toApiError(response);

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new NetworkError('The server returned a malformed response', { cause });
  }
}

export const api = {
  get: <T = unknown>(path: string, options?: RequestOptions) => apiRequest<T>('GET', path, options),
  post: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('POST', path, { ...options, body }),
  patch: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('PATCH', path, { ...options, body }),
  put: <T = unknown>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('PUT', path, { ...options, body }),
  delete: <T = unknown>(path: string, options?: RequestOptions) =>
    apiRequest<T>('DELETE', path, options),
};
