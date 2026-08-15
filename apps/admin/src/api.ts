const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8787/api').replace(/\/$/, '')

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error ?? `${response.status} ${response.statusText}`)
  return payload as T
}
