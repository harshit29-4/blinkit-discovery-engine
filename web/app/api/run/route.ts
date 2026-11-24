/**
 * The "Run the pipeline now" button.
 *
 *   GET  /api/run              -> state of the latest daily run (public information, no passcode)
 *   POST /api/run { passcode } -> starts the daily workflow on GitHub Actions
 *
 * Safeguards: a passcode (REFRESH_PASSCODE, compared in constant time, with a delay after a wrong
 * one); refused while a run is queued or in progress; refused within COOLDOWN_H hours of the last
 * run's start (a run uses most of a day's free AI allowance, so more runs add little).
 * Starting a run needs GITHUB_DISPATCH_TOKEN: a fine-grained token for this repository only, with
 * "Actions: read and write". Both are server-only variables.
 */
import { timingSafeEqual } from "node:crypto";

const REPO = "harshit29-4/blinkit-discovery-engine";
const WORKFLOW = "daily.yml";
const COOLDOWN_H = 3;
const API = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`;

type Run = { id: number; status: string; conclusion: string | null; created_at: string; updated_at: string; event: string; html_url: string };
export type RunState = {
  configured: boolean;
  latest: { status: string; conclusion: string | null; started: string; updated: string; trigger: string; url: string } | null;
  active: boolean;
  next_allowed: string | null; // when the button can be used again, if in cooldown
};

function headers(withToken: boolean): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "discovery-engine" };
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (withToken && token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function state(): Promise<RunState> {
  const res = await fetch(`${API}/runs?per_page=5`, { headers: headers(true), cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
  const runs = ((await res.json()).workflow_runs ?? []) as Run[];
  const latest = runs[0] ?? null;
  const active = runs.some((r) => ["queued", "in_progress", "waiting", "requested", "pending"].includes(r.status));
  const until = latest ? new Date(latest.created_at).getTime() + COOLDOWN_H * 3600_000 : 0;
  return {
    configured: !!(process.env.REFRESH_PASSCODE && process.env.GITHUB_DISPATCH_TOKEN),
    latest: latest && { status: latest.status, conclusion: latest.conclusion, started: latest.created_at,
      updated: latest.updated_at, trigger: latest.event, url: latest.html_url },
    active,
    next_allowed: !active && until > Date.now() ? new Date(until).toISOString() : null,
  };
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function passcodeMatches(given: string): boolean {
  const expected = process.env.REFRESH_PASSCODE ?? "";
  const a = Buffer.from(given.padEnd(64).slice(0, 64));
  const b = Buffer.from(expected.padEnd(64).slice(0, 64));
  return expected.length >= 8 && given.length === expected.length && timingSafeEqual(a, b);
}

export async function GET() {
  try {
    return json(await state());
  } catch {
    return json({ error: "Could not read the run status from GitHub." }, 502);
  }
}

export async function POST(req: Request) {
  let passcode = "";
  try {
    const body = await req.json();
    passcode = typeof body.passcode === "string" ? body.passcode.slice(0, 128) : "";
  } catch {
    return json({ error: "Send JSON: { \"passcode\": \"…\" }" }, 400);
  }
  if (!process.env.REFRESH_PASSCODE || !process.env.GITHUB_DISPATCH_TOKEN) {
    return json({ error: "Starting runs from the site is not configured." }, 503);
  }
  if (!passcodeMatches(passcode)) {
    await new Promise((r) => setTimeout(r, 1500)); // slows down guessing
    return json({ error: "Incorrect passcode." }, 403);
  }
  let s: RunState;
  try {
    s = await state();
  } catch {
    return json({ error: "Could not read the run status from GitHub." }, 502);
  }
  if (s.active) return json({ error: "A run is already in progress.", state: s }, 409);
  if (s.next_allowed) {
    return json({ error: `The last run started less than ${COOLDOWN_H} hours ago. The next run can start after the time shown.`, state: s }, 429);
  }
  const res = await fetch(`${API}/dispatches`, {
    method: "POST", headers: { ...headers(true), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main" }), cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  if (res.status !== 204) {
    return json({ error: `GitHub refused to start the run (HTTP ${res.status}). The token may have expired.` }, 502);
  }
  return json({ ok: true, message: "Run started. It takes about two hours; progress appears on this page." });
}
