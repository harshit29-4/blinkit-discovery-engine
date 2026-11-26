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

/**
 * A read that hits a passing slowdown is retried: twice, after 1.5 s and 4 s. A Vercel build pre-renders
 * every page, and one statement timeout (Postgres 57014, e.g. while the daily pipeline writes) failed a
 * whole deploy on 2026-11-26 although the same view answered in under a second a minute later. Only
 * GETs are retried, so nothing is written twice.
 */
async function getWithRetry(url: URL, headers: Record<string, string>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    const transient = res.status === 502 || res.status === 503 || res.status === 504 ||
      (res.status === 500 && (await res.clone().text()).includes("57014"));
    if (!transient || attempt === 2) return res;
    await new Promise((r) => setTimeout(r, attempt === 0 ? 1500 : 4000));
  }
}

/**
 * GET /rest/v1/<view>?<query>. With `count`, also returns the total row count: exact, or with
 * "estimated" the planner's estimate when the result is large (exact when it is small).
 */
export async function select<T>(
  view: string,
  query: Query = {},
  opts: { count?: boolean | "estimated" } = {},
): Promise<{ rows: T[]; total: number | null }> {
  const url = new URL(`${projectUrl()}/rest/v1/${view}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { apikey: key() };
  if (key().startsWith("eyJ")) headers.Authorization = `Bearer ${key()}`; // legacy anon JWT
  if (opts.count) headers.Prefer = opts.count === "estimated" ? "count=estimated" : "count=exact";

  const res = await getWithRetry(url, headers);
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

/**
 * POST /rest/v1/rpc/<fn>. Read-only agent tools use the publishable key. The chat's guard, cache and
 * log functions need `secret: true`: they run only in /api/ask on the server, with SUPABASE_SECRET_KEY
 * (a server-only variable, never sent to the browser).
 */
export async function rpc<T>(fn: string, params: Record<string, unknown>, opts: { secret?: boolean } = {}): Promise<T> {
  const k = opts.secret ? process.env.SUPABASE_SECRET_KEY : key();
  if (!k) throw new Error("SUPABASE_SECRET_KEY is not set (web/.env.local or Vercel env)");
  const headers: Record<string, string> = { apikey: k, "Content-Type": "application/json" };
  if (k.startsWith("eyJ")) headers.Authorization = `Bearer ${k}`;
  const res = await fetch(`${projectUrl()}/rest/v1/rpc/${fn}`, {
    method: "POST", headers, body: JSON.stringify(params), cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text();
    const detail = body.trimStart().startsWith("<") ? "(blocked by upstream firewall)" : body.slice(0, 200);
    throw new UpstreamError(res.status, `rpc/${fn}`, detail);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
