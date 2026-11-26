"use client";

/**
 * Anonymous usage events for the usability round: a random per-browser session id and the demo persona,
 * nothing about the person. Sent with sendBeacon so it never slows the page.
 */
import { useEffect } from "react";

const SESSION_KEY = "demo-session";

export function sessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "no-storage-session";
  }
}

const shopper = () => {
  try { return localStorage.getItem("demo-shopper"); } catch { return null; }
};

export function track(kind: "view" | "search" | "share" | "reply" | "cart_add" | "order", item?: string | null, detail?: object) {
  try {
    const body = JSON.stringify({ session: sessionId(), shopper: shopper(), kind, item: item ?? null, detail: detail ?? {} });
    if (!navigator.sendBeacon?.("/api/event", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/event", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    }
  } catch { /* logging is best-effort */ }
}

export function Track({ kind, item, detail }: { kind: "view" | "search"; item?: string; detail?: object }) {
  const key = JSON.stringify([kind, item, detail]);
  useEffect(() => { track(kind, item, detail); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export const withSession = () => ({ session: sessionId(), shopper: shopper() });
