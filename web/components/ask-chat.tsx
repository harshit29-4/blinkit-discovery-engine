"use client";

/**
 * The Ask page's chat. Sends the question (and the last few turns) to /api/ask and renders the
 * answer card: text with citations, the cited entries, check results and the tool steps.
 * Text is rendered as React elements (no HTML injection): only paragraphs, bullets and **bold**.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Evidence = { id: string; source: string; source_id: string; url: string | null; rating: number | null;
  posted_at: string; text: string; translation: string | null };
type Step = { tool: string; args: Record<string, unknown>; summary: string };
type Answer = {
  answer: string; citations: Evidence[]; steps: Step[]; model: string; fallback?: string | null; cached: boolean;
  remaining: number | null;
  checks: {
    citations: { ok: boolean; cited: string[]; unknown: string[]; missing?: boolean };
    numbers: { ok: boolean; checked: number; unverified: string[] };
    faithfulness: { score: number | null; unsupported: string[]; note?: string };
    repaired: boolean;
  };
};
type Turn = { id: number; question: string; answer?: Answer; error?: string; limited?: boolean };

const SOURCE: Record<string, { label: string; color: string }> = {
  play_store: { label: "Play Store", color: "var(--src-play)" },
  app_store: { label: "App Store", color: "var(--src-app)" },
  reddit_post: { label: "Reddit post", color: "var(--src-rpost)" },
  reddit_comment: { label: "Reddit comment", color: "var(--src-rcomment)" },
  youtube_comment: { label: "YouTube comment", color: "var(--src-youtube)" },
};
const TOOL: Record<string, string> = {
  research_topic: "Researched the topic (a count, tagged quotes and a keyword search)",
  search_feedback: "Searched the feedback",
  count_feedback: "Counted tagged entries",
  get_themes: "Read the themes",
  get_reliability: "Read the reliability results",
};
const MODEL: Record<string, string> = {
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite", "qwen/qwen3.8-27b": "Qwen 3.8 27B", "openai/gpt-oss-20b": "GPT-OSS 20B", "openai/gpt-oss-120b": "GPT-OSS 120B",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** **bold** and [E3] citations inside one line of text. */
function inline(text: string, onCite: (id: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[(E\d{1,3}(?:\s*,\s*E\d{1,3})*)\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index}>{m[1]}</strong>);
    else {
      for (const id of m[2].split(",").map((s) => s.trim())) {
        out.push(
          <button key={`${m.index}-${id}`} type="button" onClick={() => onCite(id)}
            className="mx-0.5 rounded bg-accent-soft px-1 align-baseline text-xs font-semibold text-accent hover:underline"
            aria-label={`Show cited entry ${id}`}>
            {id}
          </button>,
        );
      }
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function AnswerText({ text: raw, onCite }: { text: string; onCite: (id: string) => void }) {
  // Models sometimes cite a tool by name ("[count_feedback]"); the numbers are checked anyway, so hide it.
  const text = raw.replace(/\s?\[(?:research_topic|count_feedback|search_feedback|get_themes|get_reliability)\]/g, "");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(<ul key={blocks.length} className="list-disc space-y-1.5 pl-5">{bullets.map((b, i) => <li key={i}>{inline(b, onCite)}</li>)}</ul>);
      bullets = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•]|\d{1,2}[.)])\s+(.*)$/);
    if (bullet) bullets.push(bullet[1]);
    else {
      flush();
      if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ""), onCite)}</p>);
    }
  }
  flush();
  // [overflow-wrap:anywhere]: a long URL or unbroken word in an answer must not push past the card on phones.
  return <div className="space-y-3 leading-relaxed [overflow-wrap:anywhere]">{blocks}</div>;
}

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  const tone = ok === null ? "bg-bg text-muted border-border" : ok ? "bg-accent-soft text-accent border-transparent" : "bg-warn-soft text-warn border-transparent";
  return (
    <li className={`rounded-md border px-2.5 py-1 text-sm ${tone}`} title={detail}>
      <span aria-hidden>{ok === null ? "○" : ok ? "✓" : "!"}</span> {label}
    </li>
  );
}

function Checks({ a }: { a: Answer }) {
  const f = a.checks.faithfulness;
  const fOk = f.score === null ? null : f.score >= 0.7;
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-2" aria-label="Automatic checks">
        <Check ok={a.checks.citations.ok}
          label={a.checks.citations.cited.length ? `Citations verified (${a.checks.citations.cited.length - a.checks.citations.unknown.length}/${a.checks.citations.cited.length})` : "No citations"} />
        <Check ok={a.checks.numbers.ok}
          label={a.checks.numbers.checked ? `Numbers traced to data (${a.checks.numbers.checked - a.checks.numbers.unverified.length}/${a.checks.numbers.checked})` : "No statistics stated"} />
        <Check ok={fOk}
          label={f.score === null ? `Support check: ${f.note ?? "not run"}` : `Supported by evidence: ${Math.round(f.score * 100)}%`} />
      </ul>
      {!a.checks.numbers.ok && (
        <p className="text-sm text-warn">These numbers could not be found in the data the engine read: {a.checks.numbers.unverified.join(", ")}. Treat them with caution.</p>
      )}
      {!a.checks.citations.ok && (
        <p className="text-sm text-warn">Some citations do not match an entry the engine read ({a.checks.citations.unknown.join(", ")}).</p>
      )}
      {a.checks.citations.missing && (
        <p className="text-sm text-warn">The answer cites no entries, although the engine retrieved some. Check the claims against the Evidence page.</p>
      )}
      {f.unsupported.length > 0 && (
        <div className="text-sm text-warn">
          <p>A second AI model judged these claims as not supported by the data the engine retrieved:</p>
          <ul className="list-disc pl-5">{f.unsupported.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function argText(args: Record<string, unknown>) {
  const parts = Object.entries(args).filter(([, v]) => v !== null && v !== "" && v !== undefined)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`);
  return parts.length ? parts.join(" · ") : "no filters";
}

function AnswerCard({ t }: { t: Turn & { answer: Answer } }) {
  const a = t.answer;
  const [active, setActive] = useState<string | null>(null);
  const cite = (id: string) => {
    setActive(id);
    const el = document.getElementById(`cite-${t.id}-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    el?.focus({ preventScroll: true }); // keyboard and screen-reader users land on the entry too
  };
  return (
    <article className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <AnswerText text={a.answer} onCite={cite} />
      <Checks a={a} />
      {a.citations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Cited entries</h3>
          <ol className="mt-2 space-y-2">
            {a.citations.map((e) => {
              const s = SOURCE[e.source] ?? { label: e.source, color: "var(--muted)" };
              return (
                <li key={e.id} id={`cite-${t.id}-${e.id}`} tabIndex={-1}
                  className={`rounded-lg border p-3 text-sm transition-colors ${active === e.id ? "border-accent" : "border-border"}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                    <span className="font-semibold text-text">{e.id}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}
                    </span>
                    {e.rating ? <span aria-label={`${e.rating} out of 5 stars`} style={{ color: `var(--star-${e.rating})` }}>{"★".repeat(e.rating)}<span className="text-border">{"★".repeat(5 - e.rating)}</span></span> : null}
                    <span>{fmtDate(e.posted_at)}</span>
                    {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">Original</a>}
                  </div>
                  <p className="mt-1.5 break-words">{e.text.length > 400 ? `${e.text.slice(0, 400)}…` : e.text}</p>
                  {e.translation && <p className="mt-1 text-muted">Translation (verified): {e.translation}</p>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">How this answer was built</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          {a.steps.map((s, i) => (
            <li key={i}><span className="text-text">{TOOL[s.tool] ?? s.tool}</span> ({argText(s.args)}) → {s.summary}</li>
          ))}
          <li>Answer written by {MODEL[a.model] ?? a.model}{a.fallback ? ` (main model unavailable: ${a.fallback.replace(/^[^:]+:\s*/, "")})` : ""}
            {a.checks.repaired ? "; rewritten once after failing an automatic check" : ""}.</li>
          <li>Checked: citations and numbers by code; support by a model from a different family (Qwen 3.8 27B).</li>
        </ol>
        {a.cached && <p className="mt-2 text-muted">This answer was reused from the last 24 hours (same question).</p>}
      </details>
    </article>
  );
}

export function AskChat({ suggestions }: { suggestions: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 500);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  // A question sent from the header's ask bar, the home page or a question tile (?q=...): ask it once,
  // then drop it from the address so going back or reloading does not ask again.
  const params = useSearchParams();
  const router = useRouter();
  const fromUrl = useRef(false);
  useEffect(() => {
    const q = params.get("q");
    if (!q || fromUrl.current) return;
    fromUrl.current = true;
    router.replace("/ask", { scroll: false });
    void ask(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function ask(question: string) {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    const history = turns.filter((t) => t.answer).slice(-2).flatMap((t) => [
      { role: "user", content: t.question }, { role: "assistant", content: t.answer!.answer },
    ]);
    const id = nextId.current++;
    setTurns((ts) => [...ts, { id, question: q }]);
    setInput("");
    setBusy(true);
    setElapsed(0);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, history }) });
      const data = await res.json().catch(() => ({ error: "The engine returned an unreadable response." }));
      setTurns((ts) => ts.map((t) => (t.id === id ? (res.ok ? { ...t, answer: data }
        : { ...t, error: data.error ?? `Request failed (${res.status}).`, limited: res.status === 429 }) : t)));
      if (res.ok && typeof data.remaining === "number") setRemaining(data.remaining);
    } catch {
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, error: "Could not reach the engine. Check your connection and try again." } : t)));
    } finally {
      setBusy(false);
    }
  }

  function retry(t: Turn) {
    setTurns((ts) => ts.filter((x) => x.id !== t.id));
    void ask(t.question);
  }

  return (
    <div className="space-y-6">
      {turns.length === 0 && (
        <section aria-labelledby="suggested">
          <h2 id="suggested" className="text-lg font-extrabold tracking-tight">Try a research question</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {suggestions.map((s, i) => (
              <li key={s}>
                <button type="button" onClick={() => ask(s)} disabled={busy}
                  className="flex h-full w-full flex-col gap-2 rounded-xl bg-tile p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60">
                  <span className="text-sm font-extrabold text-accent">Q{i + 1}</span>
                  <span className="font-semibold leading-snug">{s}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-6" aria-live="polite">
        {turns.map((t) => (
          <div key={t.id} className="space-y-3">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-yellow px-4 py-2 font-semibold text-brand-ink">{t.question}</p>
            {t.answer ? <AnswerCard t={t as Turn & { answer: Answer }} />
              : t.error ? (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-bad-soft px-4 py-3 text-bad">
                  <span>{t.error}</span>
                  {/* Retry without retyping; not offered for limits that won't clear in seconds. */}
                  {!t.limited && (
                    <button type="button" disabled={busy} onClick={() => retry(t)}
                      className="rounded-lg border border-bad px-3 py-1 text-sm font-semibold disabled:opacity-50">Try again</button>
                  )}
                </div>
              )
              : (
                <p className="rounded-xl border border-border bg-surface px-4 py-3 text-muted">
                  Reading the feedback and checking the answer… {elapsed > 1 ? `${elapsed} s` : ""}
                </p>
              )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void ask(input); }}
        className="sticky bottom-20 rounded-2xl border border-border bg-surface p-2 shadow-lg sm:bottom-3 sm:p-3">
        <div className="flex items-end gap-2">
          <label htmlFor="q" className="sr-only">Your question</label>
          <textarea id="q" value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={500}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
            placeholder={turns.length ? "Ask a follow-up…" : "Ask about Blinkit shoppers…"}
            className="max-h-32 min-h-11 w-full resize-y rounded-xl border border-border bg-bg px-3 py-2.5 text-base focus:border-accent focus:outline-none" />
          <button type="submit" disabled={busy || input.trim().length < 3}
            className="h-11 shrink-0 rounded-xl bg-accent px-5 font-bold text-accent-ink disabled:opacity-50">
            {busy ? "…" : "Ask"}
          </button>
        </div>
        <p className="mt-1.5 flex flex-wrap justify-between gap-x-3 px-1 text-sm text-muted">
          <span>{remaining !== null ? `${remaining} questions left today` : "Answers use only the collected feedback"}</span>
          {turns.length > 0 && (
            <button type="button" onClick={() => setTurns([])} className="font-semibold text-accent">New conversation</button>
          )}
        </p>
      </form>
    </div>
  );
}
