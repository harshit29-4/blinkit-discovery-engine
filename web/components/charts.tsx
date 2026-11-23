import type { DailyVolume, RatingMix } from "@/lib/data";
import { SOURCE_LABEL } from "@/lib/data";
import { fmtInt, pct } from "@/lib/format";
import { SOURCE_COLOR } from "./ui";

/** One horizontal 100% bar per source showing the 1★–5★ split, with the % written on each segment. */
export function RatingBars({ mix }: { mix: RatingMix[] }) {
  const sources = [...new Set(mix.map((m) => m.source))];
  if (!sources.length) return <p className="text-sm text-muted">No ratings yet.</p>;
  return (
    <div className="space-y-4">
      {sources.map((s) => {
        const rows = mix.filter((m) => m.source === s);
        const total = rows.reduce((a, r) => a + r.reviews, 0);
        return (
          <div key={s}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{SOURCE_LABEL[s] ?? s}</span>
              <span className="tabular-nums text-muted">{fmtInt(total)} ratings</span>
            </div>
            <div className="flex h-7 overflow-hidden rounded-md" role="img"
                 aria-label={rows.map((r) => `${r.rating} stars ${pct(r.reviews, total)}%`).join(", ")}>
              {[1, 2, 3, 4, 5].map((star) => {
                const n = rows.find((r) => r.rating === star)?.reviews ?? 0;
                const w = pct(n, total);
                if (!n) return null;
                return (
                  <div key={star} className="flex items-center justify-center overflow-hidden whitespace-nowrap text-sm font-medium"
                       style={{ width: `${Math.max(w, 0.5)}%`, background: `var(--star-${star})`, color: `var(--star-ink-${star})` }}
                       title={`${star}★: ${fmtInt(n)} (${w}%)`}>
                    {w >= 12 ? `${star}★ ${w}%` : w >= 6 ? `${w}%` : ""}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" aria-hidden>
        {[1, 2, 3, 4, 5].map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(--star-${s})` }} />{s}★
          </span>
        ))}
      </p>
    </div>
  );
}

/** Daily item counts, one small bar chart per source (small multiples read better than stacking). */
export function VolumeChart({ data, dayList }: { data: DailyVolume[]; dayList: string[] }) {
  const sources = [...new Set(data.map((d) => d.source))];
  if (!sources.length) return <p className="text-sm text-muted">Nothing collected in this period yet.</p>;
  const days = dayList.length;
  const W = 600;
  const H = 70;
  const bw = W / days;
  return (
    <div className="space-y-5">
      {sources.map((s) => {
        const byDay = new Map(data.filter((d) => d.source === s).map((d) => [d.day, d.items]));
        const max = Math.max(1, ...byDay.values());
        const total = [...byDay.values()].reduce((a, b) => a + b, 0);
        return (
          <figure key={s}>
            <figcaption className="mb-1 flex justify-between text-sm">
              <span>{SOURCE_LABEL[s] ?? s}</span>
              <span className="tabular-nums text-muted">{fmtInt(total)} items · peak {fmtInt(max)}/day</span>
            </figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" preserveAspectRatio="none" role="img"
                 aria-label={`${SOURCE_LABEL[s] ?? s}: ${fmtInt(total)} items over ${days} days`}>
              <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--border)" />
              {dayList.map((day, i) => {
                const n = byDay.get(day) ?? 0;
                if (!n) return null;
                const h = Math.max(2, (n / max) * (H - 4));
                return (
                  <rect key={day} x={i * bw + 0.5} y={H - h} width={Math.max(1, bw - 1)} height={h}
                        fill={SOURCE_COLOR[s]} rx={1}>
                    <title>{`${day}: ${n}`}</title>
                  </rect>
                );
              })}
            </svg>
          </figure>
        );
      })}
      <p className="text-sm text-muted">Last {days} days, by posting date (IST). Hover a bar for the exact count.</p>
    </div>
  );
}
