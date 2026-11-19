/** Talks to the DTS sign-in service. Every request has a timeout, and a failure to connect is told apart from an answer. */

export class DtsNetworkError extends Error {}

export interface DtsResponse {
  status: number;
  headers: Headers;
  text: string;
}

export const DTS_API = '/dts-api/sessions';
export const DTS_ADMIN_API = '/dts-api/admin/sessions';

/** A read of one list through the admin API; the proxy in front adds the admin credentials. */
export async function dtsAdminRequest(path: string, timeoutMs = TIMEOUT_MS): Promise<DtsResponse> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${DTS_ADMIN_API}${path}`, { signal: ctl.signal, cache: 'no-store', referrerPolicy: 'no-referrer' });
    return { status: res.status, headers: res.headers, text: await res.text() };
  } catch {
    throw new DtsNetworkError('network');
  } finally {
    clearTimeout(timer);
  }
}
const TIMEOUT_MS = 12000;

export async function dtsRequest(
  path: string,
  options: { method?: string; key?: string; body?: BodyInit; json?: unknown; timeoutMs?: number } = {},
): Promise<DtsResponse> {
  const headers: Record<string, string> = {};
  if (options.key) headers['Authorization'] = `Bearer ${options.key}`;
  let body = options.body;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), options.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(`${DTS_API}${path}`, { method: options.method ?? 'GET', headers, body, signal: ctl.signal, cache: 'no-store', referrerPolicy: 'no-referrer' });
    return { status: res.status, headers: res.headers, text: await res.text() };
  } catch {
    throw new DtsNetworkError('network');
  } finally {
    clearTimeout(timer);
  }
}

export function parseJson<T>(res: DtsResponse): T {
  return JSON.parse(res.text) as T;
}

/** The link fragment is "<session id>.<key>". */
export function parseFragment(fragment: string): { id: string; key: string } | null {
  const m = /^#?([0-9a-f]{8,64})\.([A-Za-z0-9_-]{16,128})$/.exec(fragment);
  return m ? { id: m[1], key: m[2] } : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Downloads text (or bytes) as a file. */
export function saveBlob(name: string, data: BlobPart, type = 'application/xml'): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Shows bytes in a tab that was opened (empty) while the user's click was still fresh; false when the browser refused the tab. */
export function previewBlob(tab: Window | null, data: BlobPart, type: string): boolean {
  if (!tab) return false;
  const url = URL.createObjectURL(new Blob([data], { type }));
  tab.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

export function fileNameOf(res: DtsResponse, fallback: string): string {
  return /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallback;
}
