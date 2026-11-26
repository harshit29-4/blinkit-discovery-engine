import Link from "next/link";
import { CATEGORIES, mrpOf, rupees, type Item } from "@/lib/catalog.ts";
import { cardTeaser } from "@/lib/cards.ts";
import { AddButton } from "./cart";
import { IconClock } from "./icons";
import { NewBadge, NewOnly } from "./shopper";

// The list line is the card headline (led by what suits); the mark says how firm it is.
const MARK = { yes: "✓", no: "✕", partly: "◐", not_stated: "•", ask: "•" } as const;
const TONE = { yes: "text-accent", no: "text-bad", partly: "text-warn", not_stated: "text-muted", ask: "text-muted" } as const;

/**
 * Blinkit-style product card: image, delivery time, name, pack, price, ADD.
 * In categories new for this household it also shows the deciding answer, because shoppers can add straight from
 * a list without opening the product page (see mvp/README.md, "Where the feature sits").
 */
export function ProductCard({ item, note, wide = false, showNew = true, answer = "new" }: {
  item: Item; note?: string; wide?: boolean; showNew?: boolean; answer?: "new" | "always";
}) {
  const tile = CATEGORIES[item.category].tile === "tile" ? "bg-tile" : "bg-tile-2";
  const t = cardTeaser(item);
  const d = mrpOf(item);
  return (
    <div className={`relative flex flex-col rounded-xl border border-border bg-surface p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${wide ? "" : "w-[8.5rem] shrink-0"}`}>
      {d && (
        <span className="absolute left-2 top-0 z-10 rounded-b-md bg-info px-1.5 pb-1 pt-0.5 text-center text-sm font-extrabold leading-none text-surface">
          {d.off}%<span className="block text-[0.875rem]">OFF</span>
        </span>
      )}
      <Link href={`/p/${item.id}`} className="group flex flex-1 flex-col">
        <span aria-hidden className={`relative grid h-24 place-items-center rounded-lg text-5xl ${tile}`}>
          {item.emoji}
          {showNew && <span className="absolute right-1 top-1"><NewBadge category={item.category} small short /></span>}
        </span>
        <span className="mt-1.5 inline-flex w-fit items-center gap-1 rounded bg-bg px-1.5 text-sm font-extrabold uppercase text-muted">
          <IconClock className="h-3.5 w-3.5" />12 mins
        </span>
        <span className="mt-1 line-clamp-2 min-h-[2.6em] font-bold leading-tight group-hover:underline">{item.name}</span>
        <span className="text-sm text-muted">{item.unit}</span>
        {note && <span className="mt-1 line-clamp-3 text-sm text-muted">{note}</span>}
        {t && (answer === "always" ? <Answer t={t} /> : <NewOnly category={item.category}><Answer t={t} /></NewOnly>)}
      </Link>
      <div className="mt-2 flex items-end justify-between gap-1">
        <span className="leading-tight">
          <span className="block font-extrabold">{rupees(item.price)}</span>
          {d && <span className="block text-sm text-muted line-through">{rupees(d.mrp)}</span>}
        </span>
        <AddButton id={item.id} />
      </div>
    </div>
  );
}

function Answer({ t }: { t: NonNullable<ReturnType<typeof cardTeaser>> }) {
  return (
    <span className={`mt-1 line-clamp-2 text-sm font-semibold leading-snug ${TONE[t.verdict]}`}>
      <span aria-hidden>{MARK[t.verdict]} </span>{t.text}
    </span>
  );
}

/** Horizontal rail of cards, like Blinkit's home sections. */
export function Rail({ title, subtitle, href, items }: { title: string; subtitle?: string; href?: string; items: Item[] }) {
  return (
    <section className="py-3" aria-label={title}>
      <div className="flex items-end justify-between gap-2 px-3">
        <div>
          <h2 className="text-lg font-extrabold leading-tight">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {href && <Link href={href} className="shrink-0 font-bold text-accent">see all</Link>}
      </div>
      <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto px-3 pb-1">
        {items.map((x) => <ProductCard key={x.id} item={x} />)}
      </div>
    </section>
  );
}
