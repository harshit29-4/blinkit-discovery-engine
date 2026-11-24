"use client";

/** "Run the pipeline now": shows the latest daily run and, with the passcode, starts a new one. */
import { useEffect, useState } from "react";

type RunState = {
  configured: boolean;
  latest: { status: string; conclusion: string | null; started: string; updated: string; trigger: string; url: string } | null;
  active: boolean;
  next_allowed: string | null;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";

function describe(s: RunState): string {
  const l = s.latest;
  if (!l) return "No runs yet.";
  const how = l.trigger === "schedule" ? "scheduled" : "started on request";
  if (s.active) return `A run (${how}) is in progress since ${fmt(l.started)}.`;
  const result = l.conclusion === "success" ? "completed" : l.conclusion === "cancelled" ? "was cancelled" : `ended (${l.conclusion ?? l.status})`;
  return `Last run (${how}) started ${fmt(l.started)} and ${result}.`;
}

export function RunButton() {
  const [state, setState] = useState<RunState | null>(null);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [tick, setTick] = useState(0); // bump to re-read the status
  useEffect(() => {
    let alive = true;
    fetch("/api/run", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RunState | null) => { if (alive && data) setState(data); })
      .catch(() => { /* status is optional */ });
    return () => { alive = false; };
  }, [tick]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode }) });
      const data = await res.json().catch(() => ({}));
      setMessage({ ok: res.ok, text: res.ok ? data.message : data.error ?? `Request failed (${res.status}).` });
      if (res.ok) setPasscode("");
      setTimeout(() => setTick((t) => t + 1), 4000);
    } catch {
      setMessage({ ok: false, text: "Could not reach the site. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const blocked = !state?.configured || state.active || !!state.next_allowed;
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold tracking-tight">Run the pipeline now</h2>
      <p className="mt-1 text-sm text-muted">
        The pipeline runs automatically once a day (02:23 IST). It can also be started here: collection, then the AI
        stages, about two hours in total. Starting a run requires the project passcode, and a new run is accepted at
        most once every three hours.
      </p>
      <p className="mt-3 text-sm" aria-live="polite">
        {state ? describe(state) : "Reading the run status…"}
        {state?.latest && <> <a href={state.latest.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">Details on GitHub</a></>}
        {state?.next_allowed && <> The next run can start after {fmt(state.next_allowed)}.</>}
      </p>
      {state && !state.configured ? (
        <p className="mt-3 text-sm text-muted">Starting runs from the site is not configured on this deployment.</p>
      ) : (
        <form onSubmit={start} className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="passcode" className="sr-only">Passcode</label>
          <input id="passcode" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode" maxLength={128} disabled={blocked}
            className="rounded-md border border-border bg-bg px-3 py-2 text-base disabled:opacity-60" />
          <button type="submit" disabled={busy || blocked || passcode.length < 8}
            className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50">
            {busy ? "Starting…" : "Start run"}
          </button>
        </form>
      )}
      {message && <p role="status" className={`mt-2 text-sm ${message.ok ? "text-accent" : "text-bad"}`}>{message.text}</p>}
    </section>
  );
}
