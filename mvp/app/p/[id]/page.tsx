import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ATTR_LABEL, CATEGORIES, ITEMS, ITEM_BY_ID, itemsIn, listingRows, mrpOf, rupees, type CategoryId } from "@/lib/catalog.ts";
import { betterPick, defaultCard } from "@/lib/cards.ts";
import { ProductBar } from "@/components/product-bar";
import { DecisionCard, VerdictChip } from "@/components/decision-card";
import { IconClock } from "@/components/icons";
import { Rail } from "@/components/product-card";
import { CheckBanner, ShareButton } from "@/components/share";
import { PageHeader } from "@/components/shell";
import { NewBadge } from "@/components/shopper";
import { Track } from "@/components/track";

const PLACEHOLDER: Record<CategoryId, string> = {
  produce: "When do you need it? e.g. dinner tonight",
  phone: "Your phone, e.g. Samsung Galaxy A35",
  footwear: "Your size, e.g. UK 8",
  pet: "Your pet, e.g. adult cat, eats chicken",
  stationery: "What it's for, e.g. A4 papers, unfolded",
  games: "Who's playing, e.g. me and my 8-year-old",
  appliances: "What matters, e.g. easy to clean inside",
};

export function generateStaticParams() {
  return ITEMS.map((x) => ({ id: x.id }));
}

export async function generateMetadata({ params }: PageProps<"/p/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: ITEM_BY_ID.get(id)?.name ?? "Product" };
}

async function Product({ params }: { params: PageProps<"/p/[id]">["params"] }) {
  const { id } = await params;
  const item = ITEM_BY_ID.get(id);
  if (!item) notFound();
  const c = CATEGORIES[item.category];
  const card = defaultCard(item.id);
  const pick = betterPick(item);
  const d = mrpOf(item);
  const similar = itemsIn(item.category).filter((x) => x.id !== item.id).slice(0, 6);
  return (
    <>
      <PageHeader title={item.name} />
      <Track kind="view" item={item.id} />
      <Suspense fallback={null}><CheckBanner itemName={item.name} itemId={item.id} /></Suspense>

      <div className="bg-surface px-3 pb-4 pt-3">
        <div aria-hidden className={`grid h-56 place-items-center rounded-2xl text-8xl ${c.tile === "tile" ? "bg-tile" : "bg-tile-2"}`}>{item.emoji}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-bg px-1.5 text-sm font-bold text-muted"><IconClock className="h-3.5 w-3.5" />12 MINS</span>
          <NewBadge category={item.category} />
        </div>
        <h2 className="mt-2 text-xl font-extrabold leading-snug">{item.name}</h2>
        <Link href={`/c/${item.category}`} className="inline-block py-1 text-sm font-semibold text-accent">{item.brand} · View all in {c.name}</Link>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm text-muted">{item.unit}</span>
          <span className="text-xl font-extrabold">{rupees(item.price)}</span>
          {d && <span className="text-sm text-muted line-through">MRP {rupees(d.mrp)}</span>}
          {d && <span className="rounded bg-info-soft px-1 text-sm font-extrabold text-info">{d.off}% OFF</span>}
        </p>
        {card && (
          <a href={`#suit-${item.id}`} className="mt-3 block rounded-xl border-2 border-brand-yellow bg-brand-yellow-soft px-3 py-2">
            <span className="block text-sm font-bold uppercase tracking-wide text-brand-ink-muted">Will it suit you?</span>
            <span className="mt-0.5 block font-bold leading-snug">{card.headline}</span>
            <span className="mt-1.5 flex items-center justify-between gap-2">
              <VerdictChip v={card.verdict} />
              <span className="text-sm font-bold text-brand-ink-muted">{pick ? "Tip + better pick ›" : "See why ›"}</span>
            </span>
          </a>
        )}
      </div>

      <div id={`suit-${item.id}`} className="scroll-mt-16 space-y-3 p-3">
        <DecisionCard itemId={item.id} initial={card} labels={ATTR_LABEL} placeholder={PLACEHOLDER[item.category]} pick={pick} />
        <ShareButton itemId={item.id} question={card?.question ?? `Is this the right ${item.name.toLowerCase()}?`} />
        {item.category === "pet" && (
          <Link href="/scan" className="block rounded-xl bg-info-soft p-3 text-center font-bold text-info">
            Have the pack at home? Scan it to find the exact one
          </Link>
        )}

        <section aria-labelledby={`details-${item.id}`} className="rounded-2xl border border-border bg-surface">
          <h2 id={`details-${item.id}`} className="px-3 pt-3 font-extrabold">Product details</h2>
          <dl className="mt-1 divide-y divide-border">
            {listingRows(item).map((r) => (
              <div key={r.key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2">
                <dt className="text-muted">{r.label}</dt>
                <dd className={r.value ? "" : "font-semibold text-warn"}>{r.value ?? "Not stated by the seller"}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <Rail title="Similar products" href={`/c/${item.category}`} items={similar} />
      <ProductBar id={item.id} unit={item.unit} price={item.price} mrp={d?.mrp ?? null} off={d?.off ?? null} />
    </>
  );
}

export default function ProductPage({ params }: PageProps<"/p/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse bg-surface" />}>
      <Product params={params} />
    </Suspense>
  );
}
