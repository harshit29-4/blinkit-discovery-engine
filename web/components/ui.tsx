import type { ReactNode } from "react";
import { SOURCE_LABEL } from "@/lib/data";

export const SOURCE_COLOR: Record<string, string> = {
  play_store: "var(--src-play)",
  app_store: "var(--src-app)",
  reddit_post: "var(--src-rpost)",
  reddit_comment: "var(--src-rcomment)",
};

export function Card({ title, subtitle, children, className = "" }: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      {title && <h2 className="font-semibold tracking-tight">{title}</h2>}
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      <div className={title || subtitle ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function SourceBadge({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted">
      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: SOURCE_COLOR[source] }} />
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

export function Stars({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <span className="text-sm tabular-nums" aria-label={`${rating} out of 5 stars`} style={{ color: `var(--star-${rating})` }}>
      {"★".repeat(rating)}
      <span className="text-border">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const style: Record<string, string> = {
    ok: "bg-accent-soft text-accent",
    partial: "bg-warn-soft text-warn",
    failed: "bg-bad-soft text-bad",
    running: "bg-border text-text",
  };
  return <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${style[status] ?? style.running}`}>{status}</span>;
}

export function Skeleton({ h = "h-40" }: { h?: string }) {
  return <div className={`${h} animate-pulse rounded-xl border border-border bg-surface`} aria-label="Loading" />;
}
