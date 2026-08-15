const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8787/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, payload?.error ?? `${response.status} ${response.statusText}`)
  return payload as T
}
