// One request to an access-administration route; the message is the first thing worth telling the person when it fails.
export interface Sent<T = unknown> { ok: boolean; data: T | null; message: string }

export async function send<T = unknown>(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<Sent<T>> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { data?: T; message?: string; errors?: Record<string, string[]> };
    if (res.ok) return { ok: true, data: json.data ?? null, message: '' };
    return { ok: false, data: null, message: (json.errors ? Object.values(json.errors).flat()[0] : undefined) ?? json.message ?? 'Something went wrong. Try again.' };
  } catch {
    return { ok: false, data: null, message: 'Could not reach the server. Check your connection.' };
  }
}
