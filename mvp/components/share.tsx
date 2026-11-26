"use client";

/**
 * Send an item to whoever will judge it (P6's father, P4's flatmates). The link opens the same product page with
 * its decision card and a banner saying what they're asked to check; they reply in one tap.
 * Nothing is stored: the link carries the question, and replies go through the phone's own share sheet.
 */
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { track } from "./track";

async function shareOrCopy(text: string, url: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
      return "shared";
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    return "copied";
  } catch {
    return "failed"; // cancelled, or no clipboard permission
  }
}

export function ShareButton({ itemId, question }: { itemId: string; question: string }) {
  const [done, setDone] = useState<string | null>(null);
  async function send() {
    const url = `${location.origin}/p/${itemId}?check=${encodeURIComponent(question)}`;
    const r = await shareOrCopy(`Can you check this one for us? ${question}`, url);
    if (r !== "failed") track("share", itemId);
    setDone(r === "copied" ? "Link copied. Paste it in your chat." : r === "shared" ? "Sent." : null);
  }
  return (
    <div>
      <button type="button" onClick={send}
        className="w-full rounded-xl border-2 border-accent px-4 py-2.5 font-bold text-accent hover:bg-accent-soft">
        Send to someone to check
      </button>
      {done && <p role="status" className="mt-1 text-sm text-muted">{done}</p>}
    </div>
  );
}

export function CheckBanner({ itemName, itemId }: { itemName: string; itemId: string }) {
  const params = useSearchParams();
  const q = params.get("check");
  const [done, setDone] = useState<string | null>(null);
  if (!q) return null;
  async function reply(ok: boolean) {
    const url = location.href.split("?")[0];
    const text = ok ? `👍 This one's right: ${itemName}.` : `✋ Not this one: ${itemName}.`;
    const r = await shareOrCopy(text, url);
    if (r !== "failed") track("reply", itemId, { ok });
    setDone(r === "copied" ? "Reply copied. Paste it in your chat." : r === "shared" ? "Reply sent." : null);
  }
  return (
    <section aria-label="Sent to you to check" className="mb-5 rounded-2xl bg-brand-yellow p-4 text-brand-ink">
      <p className="text-sm font-bold uppercase tracking-wide">Sent to you to check</p>
      <p className="mt-1 text-lg font-extrabold">{q.slice(0, 160)}</p>
      <p className="mt-1 text-brand-ink-muted">The card below answers it from the listing. Look, then reply:</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => reply(true)} className="rounded-xl bg-surface px-4 py-2 font-bold text-text">👍 This one&rsquo;s right</button>
        <button type="button" onClick={() => reply(false)} className="rounded-xl bg-surface px-4 py-2 font-bold text-text">✋ Not this one</button>
      </div>
      {done && <p role="status" className="mt-2 text-sm">{done}</p>}
    </section>
  );
}
