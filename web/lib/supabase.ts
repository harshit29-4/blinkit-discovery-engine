/**
 * Minimal read-only client for Supabase's REST API (PostgREST).
 *
 * Uses the *publishable* key, which only maps to the `anon` role: it can read the public
 * views (v_*) and the run log, and nothing else (enforced by Row Level Security).
 * Runs on the server only; nothing here is shipped to the browser.
 */

function projectUrl(): string {
  const raw = process.env.SUPABASE_URL;
  if (!raw) throw new Error("SUPABASE_URL is not set (web/.env.local or Vercel env)");
  // The dashboard sometimes shows the URL with "/rest/v1/" appended.
  return raw.trim().replace(/\/+$/, "").replace(/\/rest(\/v1)?$/, "");
}

function key(): string {
  const k = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!k) throw new Error("SUPABASE_PUBLISHABLE_KEY is not set (web/.env.local or Vercel env)");
  return k;
}

export type Query = Record<string, string | number | undefined>;

/** A non-OK answer from Supabase, kept typed so callers can handle known cases calmly. */
export class UpstreamError extends Error {
  constructor(public status: number, public view: string, detail: string) {
    super(`Supabase ${view}: HTTP ${status} ${detail}`);
  }
}

function totalFrom(range: string | null): number | null {
  // Content-Range is "0-24/1234", or "*/1234" when the requested range is past the end.
  const n = range ? Number(range.split("/")[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** GET /rest/v1/<view>?<query>. With `count`, also returns the exact total row count. */
export async function select<T>(
  view: string,
  query: Query = {},
  opts: { count?: boolean } = {},
): Promise<{ rows: T[]; total: number | null }> {
  const url = new URL(`${projectUrl()}/rest/v1/${view}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { apikey: key() };
  if (key().startsWith("eyJ")) headers.Authorization = `Bearer ${key()}`; // legacy anon JWT
  if (opts.count) headers.Prefer = "count=exact";

  const res = await fetch(url, { headers });
  // 416 = asked for a page past the last row (e.g. ?page=999999): not an error, just empty.
  if (res.status === 416) {
    return { rows: [], total: totalFrom(res.headers.get("content-range")) };
  }
  if (!res.ok) {
    const body = await res.text();
    // Supabase's web firewall answers SQL-injection-looking queries with an HTML 403 page.
    const detail = body.trimStart().startsWith("<") ? "(blocked by upstream firewall)" : body.slice(0, 200);
    throw new UpstreamError(res.status, view, detail);
  }
  const rows = (await res.json()) as T[];
  return { rows, total: opts.count ? totalFrom(res.headers.get("content-range")) : null };
}
