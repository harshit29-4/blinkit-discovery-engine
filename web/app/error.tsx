"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

/**
 * Shown when a page fails at request time, most likely because the database (Supabase)
 * is unreachable or paused. Without this, visitors would see Next.js's bare default error.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl rounded-xl border border-border bg-surface p-6">
      <h1 className="text-xl font-semibold tracking-tight">Data temporarily unavailable</h1>
      <p className="mt-2 text-muted">
        The database could not be reached. This is usually temporary; please try again shortly. If the problem
        persists, the Health page records the status of each collection run.
      </p>
      <button onClick={() => retry()} className="mt-4 rounded-md bg-accent px-4 py-2 font-medium text-accent-ink">
        Try again
      </button>
    </div>
  );
}
