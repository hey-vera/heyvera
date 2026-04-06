export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(
  path: string,
  opts?: RequestInit & { apiKey?: string },
): Promise<T> {
  const { apiKey, ...fetchOpts } = opts ?? {};
  const headers = new Headers(fetchOpts.headers);
  if (!headers.has('Content-Type') && fetchOpts.method !== 'DELETE') {
    headers.set('Content-Type', 'application/json');
  }
  if (apiKey) headers.set('X-API-Key', apiKey);

  const res = await fetch(path, { ...fetchOpts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body.error ?? `Request failed (${res.status})`,
      body.code,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
