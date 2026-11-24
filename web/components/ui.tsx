import Link from "next/link";
import type { ReactNode } from "react";
import { SOURCE_LABEL } from "@/lib/data";

export const SOURCE_COLOR: Record<string, string> = {
  play_store: "var(--src-play)",
  app_store: "var(--src-app)",
  reddit_post: "var(--src-rpost)",
  reddit_comment: "var(--src-rcomment)",
  youtube_comment: "var(--src-youtube)",
};

export function Card({ title, subtitle, children, className = "" }: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-5 ${className}`}>
      {title && <h2 className="font-extrabold tracking-tight">{title}</h2>}
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      <div className={title || subtitle ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
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
  const label: Record<string, string> = {
    ok: "Completed",
    partial: "Partially completed",
    failed: "Failed",
    running: "In progress",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${style[status] ?? style.running}`}>
      {label[status] ?? status}
    </span>
  );
}

export function Skeleton({ h = "h-40" }: { h?: string }) {
  return <div className={`${h} animate-pulse rounded-xl border border-border bg-surface`} aria-label="Loading" />;
}

/** Page title with one line of context; the detail lives on How it works (`learn` anchor). */
export function PageHeader({ title, subtitle, learn }: { title: string; subtitle?: ReactNode; learn?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {learn && (
        <Link href={`/how-it-works#${learn}`} className="text-sm font-semibold text-accent hover:underline">
          How this works →
        </Link>
      )}
    </div>
  );
}

/** Section heading with an optional "see all" link, as on Blinkit's home page. */
export function SectionTitle({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
      {href && <Link href={href} className="shrink-0 text-sm font-semibold text-accent hover:underline">{link ?? "See all"}</Link>}
    </div>
  );
}
