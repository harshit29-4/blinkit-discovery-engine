"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { Card, Check, Verdict } from "@/lib/card.ts";
import type { BetterPick } from "@/lib/cards.ts";
import { withSession } from "./track";

/** Verdicts carry a word and a symbol, never colour alone. */
const VERDICT: Record<Verdict, { label: string; mark: string; cls: string }> = {
  yes: { label: "Yes", mark: "✓", cls: "bg-accent-soft text-accent" },
  no: { label: "No", mark: "✕", cls: "bg-bad-soft text-bad" },
  partly: { label: "Partly", mark: "◐", cls: "bg-warn-soft text-warn" },
  not_stated: { label: "Seller hasn't said", mark: "?", cls: "bg-warn-soft text-warn" },
  ask: { label: "Depends on you", mark: "…", cls: "bg-tile text-text" },
};

export function VerdictChip({ v }: { v: Verdict }) {
  const s = VERDICT[v];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-bold ${s.cls}`}>
      <span aria-hidden>{s.mark}</span>{s.label}
    </span>
  );
}

function Basis({ c, labels }: { c: Check; labels: Record<string, string> }) {
  const used = c.verdict === "not_stated" ? c.missing : c.cites;
  if (!used.length) return null;
  return (
    <p className="mt-2 text-sm text-muted">
      {c.verdict === "not_stated" ? "Missing from the listing: " : "Based on the listing's "}
      {used.map((k) => labels[k] ?? k).join(", ")}
    </p>
  );
}

export function DecisionCard({ itemId, initial, labels, placeholder, pick }: {
  itemId: string; initial: Card | null; labels: Record<string, string>; placeholder: string; pick: BetterPick | null;
}) {
  const uid = useId(); // ids stay unique while Next keeps earlier product pages mounted but hidden
  const [card, setCard] = useState<Card | null>(initial);
  const [shopper, setShopper] = useState("");
  const [forWhom, setForWhom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!shopper.trim()) return;
    setBusy(true);
    setError(null);
    // "shopper" is what they typed; the demo persona travels separately as "persona".
    const { session, shopper: persona } = withSession();
    try {
      const res = await fetch("/api/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId, shopper, session, persona }),
      });
      const body = await res.json();
      if (body.card) {
        setCard(body.card);
        setNote(body.note ?? null);
        setForWhom(body.note ? null : shopper.trim());
      } else setError(body.error ?? "Something went wrong.");
    } catch {
      setError("Couldn't reach the checker. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${uid}-title`} className="rounded-2xl border-2 border-brand-yellow bg-surface p-4 sm:p-5">
      <p className="text-sm font-bold uppercase tracking-wide text-muted">Will it suit you?</p>
      {card ? (
        <div aria-live="polite">
          {/* Answer first: a statement led by what suits the shopper, never their question repeated back. */}
          <h2 id={`${uid}-title`} className="mt-1 text-lg font-extrabold leading-snug">{card.headline}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <VerdictChip v={card.verdict} />
            {forWhom && <span className="text-sm text-muted">for &ldquo;{forWhom}&rdquo;</span>}
          </div>
          {card.good.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {card.good.map((g) => (
                <li key={g.text} className="flex gap-2">
                  <span aria-hidden className="font-extrabold text-accent">✓</span>
                  <span>{g.text}</span>
                </li>
              ))}
            </ul>
          )}
          {card.tip && (
            <p className="mt-3 rounded-xl bg-brand-yellow-soft px-3 py-2 text-sm">
              <b>Tip:</b> {card.tip}
            </p>
          )}
          {pick && card.verdict !== "yes" && (
            <Link href={`/p/${pick.id}`} className="mt-3 block rounded-xl border-2 border-accent bg-accent-soft p-3 hover:underline">
              <span className="block text-sm font-extrabold text-accent">{pick.want}</span>
              <span className="mt-0.5 block font-bold">{pick.name} · {pick.price} ›</span>
              <span className="block text-sm"><span aria-hidden className="font-extrabold text-accent">✓ </span>{pick.why}</span>
            </Link>
          )}
          <details className="mt-3 rounded-xl border border-border px-3 py-2">
            <summary className="cursor-pointer py-1 text-sm font-bold">Why we say this</summary>
            <p className="mt-2 text-sm">{card.answer}</p>
            <Basis c={card} labels={labels} />
            {card.also.length > 0 && (
              <ul className="mt-3 space-y-3 border-t border-border pt-3">
                {card.also.map((x) => (
                  <li key={x.question}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="text-sm font-semibold">{x.question}</span>
                      <VerdictChip v={x.verdict} />
                    </div>
                    <p className="mt-1 text-sm">{x.answer}</p>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      ) : (
        <p id={`${uid}-title`} className="mt-1">We couldn&rsquo;t prepare a check for this item. The details below are what the seller states.</p>
      )}

      <form onSubmit={check} className="mt-4 border-t border-border pt-3">
        <label htmlFor={`${uid}-shopper`} className="block font-semibold">
          {card?.verdict === "ask" && card.ask ? card.ask : "Check it for your situation"}
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input id={`${uid}-shopper`} value={shopper} onChange={(e) => setShopper(e.target.value)} maxLength={160}
            placeholder={placeholder} autoComplete="off"
            className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 focus:border-accent focus:outline-none" />
          <button type="submit" disabled={busy || !shopper.trim()}
            className="shrink-0 rounded-xl bg-accent px-4 py-2.5 font-bold text-accent-ink disabled:opacity-50">
            {busy ? "Checking…" : "Check"}
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
        {note && <p role="status" className="mt-2 text-sm text-muted">{note}</p>}
        <p className="mt-2 text-sm text-muted">Answers come only from the listing below, never guessed.</p>
      </form>
    </section>
  );
}
