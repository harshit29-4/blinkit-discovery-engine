"use client";

/**
 * Household switcher in the home header: a chip that opens a bottom sheet of demo households (each with its own
 * made-up order history, which drives the "New for you" tags). A one-time hint points at it on first visit.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { SHOPPERS } from "@/lib/shoppers.ts";
import { IconChevron, IconUsers } from "./icons";
import { setShopper, useShopper } from "./shopper";

const TIP = "demo-tip-household";
const noop = () => () => {};

export function HouseholdChip() {
  const s = useShopper();
  const [open, setOpen] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(false);
  // Read browser-only state without a hydration mismatch: false on the server, real value after load.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const tipSeen = useSyncExternalStore(noop, () => { try { return localStorage.getItem(TIP) === "1"; } catch { return true; } }, () => true);
  const tip = mounted && !tipSeen && !tipDismissed;

  function hideTip() {
    try { localStorage.setItem(TIP, "1"); } catch { /* fine */ }
    setTipDismissed(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const root = mounted ? document.getElementById("sheet-root") : null;
  return (
    <div className="relative">
      <button type="button" onClick={() => { setOpen(true); hideTip(); }} aria-haspopup="dialog"
        className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-1.5 text-sm font-bold text-brand-ink shadow-sm">
        <IconUsers className="h-4 w-4" />{s.short}<IconChevron className="h-4 w-4" />
      </button>
      {tip && (
        <div role="note" className="absolute right-0 top-full z-40 mt-2 w-52 rounded-xl bg-brand-ink p-3 text-sm text-surface shadow-lg">
          <span className="absolute -top-1.5 right-6 h-3 w-3 rotate-45 bg-brand-ink" aria-hidden />
          Tap to switch household. Each has its own order history, so different categories are new.
          <button type="button" onClick={hideTip} className="mt-2 block font-extrabold text-brand-yellow">Got it</button>
        </div>
      )}
      {open && root && createPortal(
        <div className="absolute inset-0 z-50 flex items-end bg-brand-ink/50" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Switch household" onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-3xl bg-surface p-4 pb-6">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" aria-hidden />
            <h2 className="text-lg font-extrabold">Who&rsquo;s shopping?</h2>
            <p className="text-sm text-muted">Demo households with different order histories.</p>
            <div className="mt-3 space-y-2">
              {SHOPPERS.map((x) => (
                <button key={x.id} type="button" onClick={() => { setShopper(x.id); setOpen(false); }}
                  aria-pressed={x.id === s.id}
                  className={`block w-full rounded-xl border p-3 text-left ${x.id === s.id ? "border-accent bg-accent-soft" : "border-border"}`}>
                  <span className="block font-bold">{x.name}</span>
                  <span className="block text-sm text-muted">{x.about}</span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        root,
      )}
    </div>
  );
}
