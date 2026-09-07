import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiRequest, ApiError, NetworkError } from './client.js';

/** Await a promise expected to reject and return the thrown value. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    throw new Error('expected the promise to reject');
  } catch (error) {
    return error;
  }
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends credentialed requests against the /api/v1 base URL', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await api.get('/health');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/health');
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
  });

  it('serialises a JSON body and sets the content-type', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    await api.post('/auth/login', { email: 'a@b.co', password: 'pw' });

    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.body).toBe('{"email":"a@b.co","password":"pw"}');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('returns the parsed JSON body on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { user: { id: 'u1', role: 'admin' } }),
    );

    const result = await api.get<{ user: { id: string; role: string } }>('/me');

    expect(result.user).toEqual({ id: 'u1', role: 'admin' });
  });

  it('returns undefined for 204 No Content', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.post('/auth/logout')).resolves.toBeUndefined();
  });

  it('parses the standard error envelope into an ApiError (validation failure)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        400,
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ path: '/email', message: 'must be a valid email' }],
          },
          requestId: 'req-123',
        },
        { 'x-request-id': 'req-123' },
      ),
    );

    const err = await rejection(api.post('/auth/login', { email: 'nope' }));

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.code).toBe('VALIDATION_ERROR');
    expect(apiErr.requestId).toBe('req-123');
    expect(apiErr.details).toEqual([{ path: '/email', message: 'must be a valid email' }]);
  });

  it('flags 401 responses as unauthorized', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }),
    );

    const err = await rejection(api.get('/me'));

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isUnauthorized).toBe(true);
  });

  it('wraps a non-standard error body in a generic ApiError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('502 Bad Gateway', { status: 502, headers: { 'content-type': 'text/plain' } }),
    );

    const err = await rejection(api.get('/health'));

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).code).toBe('HTTP_ERROR');
  });

  it('throws NetworkError when the request never completes', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const err = await rejection(api.get('/health'));

    expect(err).toBeInstanceOf(NetworkError);
  });

  it('propagates AbortError instead of masking it as a NetworkError', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));

    const err = await rejection(apiRequest('GET', '/health'));

    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
  });
});
