export interface ApiFetchOptions extends RequestInit {
  /** Allow a successful non-GET response without a body when its contract permits it. */
  allowEmptyResponse?: boolean;
  /** Disable browser navigation on 401 for auth bootstrap and login requests. */
  redirectOnUnauthorized?: boolean;
}

export class ApiResponseError extends Error {
  readonly status?: number;
  readonly path: string;
  readonly contentType?: string;
  readonly bodyExcerpt?: string;

  constructor(message: string, details: { path: string; status?: number; contentType?: string; bodyExcerpt?: string }) {
    super(message);
    this.name = 'ApiResponseError';
    this.path = details.path;
    this.status = details.status;
    this.contentType = details.contentType;
    this.bodyExcerpt = details.bodyExcerpt;
  }
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
type ParsedResponseBody =
  | { kind: 'empty' }
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string };

function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('coldchain_csrf='))
    ?.split('=')[1];
}

function safeExcerpt(body: string): string | undefined {
  const excerpt = body.trim().slice(0, 240);
  if (!excerpt) return undefined;
  return excerpt
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[redacted database URL]')
    .replace(/(password|secret|token)\s*[=:]\s*[^\s,"'}]+/gi, '$1=[redacted]');
}

function messageFromErrorBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (Array.isArray(record.message)) return record.message.filter((item) => typeof item === 'string').join(', ') || fallback;
    if (typeof record.error === 'string' && record.error.trim()) return record.error;
  }
  if (typeof body === 'string' && body.trim()) return safeExcerpt(body) || fallback;
  return fallback;
}

async function parseResponseBody(response: Response): Promise<ParsedResponseBody> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ApiResponseError(
      `Could not read the response from the API (HTTP ${response.status}).`,
      { path: response.url || 'API response', status: response.status, contentType: response.headers.get('content-type') || undefined },
    );
  }

  if (!text.trim()) return { kind: 'empty' };
  try {
    return { kind: 'json', value: JSON.parse(text) };
  } catch {
    return { kind: 'text', value: text };
  }
}

/** Fetch JSON API data while preserving HTTP, backend, and response-format errors. */
export async function apiFetch<T = any>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const redirectOnUnauthorized = options.redirectOnUnauthorized !== false;
  const allowEmptyResponse = options.allowEmptyResponse === true;
  const requestOptions: RequestInit = { ...options };
  delete (requestOptions as ApiFetchOptions).allowEmptyResponse;
  delete (requestOptions as ApiFetchOptions).redirectOnUnauthorized;

  const headers = new Headers(requestOptions.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (!headers.has('Content-Type') && requestOptions.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const token = csrfToken();
  if (token && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...requestOptions,
      method,
      headers,
      credentials: 'include',
    });
  } catch (error: any) {
    const reason = error?.name === 'AbortError'
      ? 'The request timed out or was cancelled.'
      : `Network request failed${error?.message ? `: ${error.message}` : '.'}`;
    throw new ApiResponseError(`${method} ${path}: ${reason}`, { path });
  }

  const contentType = response.headers.get('content-type') || undefined;
  const parsed = await parseResponseBody(response);
  const isEmpty = parsed.kind === 'empty';
  const bodyExcerpt = parsed.kind === 'text' ? safeExcerpt(parsed.value) : undefined;
  const fallback = isEmpty
    ? 'The server returned an empty response.'
    : `Request failed with HTTP ${response.status}.`;
  const backendMessage = parsed.kind === 'empty'
    ? fallback
    : messageFromErrorBody(parsed.value, fallback);

  if (response.status === 401) {
    if (redirectOnUnauthorized && typeof window !== 'undefined') {
      window.location.href = '/login?reason=unauthorized';
    }
    throw new ApiResponseError(
      `Authentication required for ${method} ${path} (HTTP 401): ${backendMessage}`,
      { path, status: response.status, contentType, bodyExcerpt },
    );
  }

  if (!response.ok) {
    throw new ApiResponseError(
      `${method} ${path} failed with HTTP ${response.status}: ${backendMessage}`,
      { path, status: response.status, contentType, bodyExcerpt },
    );
  }

  if (response.status === 204) return null as T;
  if (isEmpty) {
    if (allowEmptyResponse || method !== 'GET') return null as T;
    throw new ApiResponseError(
      `${method} ${path} returned an empty response (HTTP ${response.status}${contentType ? `, ${contentType}` : ''}).`,
      { path, status: response.status, contentType },
    );
  }

  if (parsed.kind === 'text') {
    const responseFormat = contentType?.toLowerCase().includes('json') ? 'invalid JSON' : 'non-JSON';
    throw new ApiResponseError(
      `${method} ${path} returned ${responseFormat} (HTTP ${response.status}${contentType ? `, ${contentType}` : ''}). ${bodyExcerpt || ''}`.trim(),
      { path, status: response.status, contentType, bodyExcerpt },
    );
  }
  return parsed.value as T;
}
