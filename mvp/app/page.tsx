import Link from "next/link";
import { CATEGORIES, itemsIn, type CategoryId } from "@/lib/catalog.ts";
import { Rail } from "@/components/product-card";
import { SearchBar } from "@/components/shell";
import { ForShopper, NewBadge } from "@/components/shopper";
import { SHOPPERS, isNewFor } from "@/lib/shoppers.ts";
import { cardTeaser } from "@/lib/cards.ts";
import { NEEDS } from "@/lib/needs.ts";
import { IconChevron, IconSpark } from "@/components/icons";
import { HouseholdChip } from "@/components/household";
import { CartIcon } from "@/components/cart";


const ORDER: CategoryId[] = ["produce", "phone", "stationery", "pet", "games", "appliances", "footwear"];
const SHORT: Record<CategoryId, string> = {
  produce: "Fresh", phone: "Mobiles", stationery: "Stationery", pet: "Pets", games: "Games", appliances: "Appliances", footwear: "Footwear",
};

export default function Home() {
  return (
    <>
      <header className="bg-gradient-to-b from-brand-yellow to-brand-yellow-soft px-3 pb-2 pt-2 text-brand-ink">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[2rem] font-extrabold leading-none tracking-tight">blinkit<span className="sr-only"> concept: home</span></h1>
          <div className="flex items-center gap-2">
            <HouseholdChip />
            <CartIcon />
          </div>
        </div>
        <p className="mt-2 text-sm font-extrabold uppercase tracking-wide">Delivery in</p>
        <p className="text-3xl font-extrabold leading-tight">12 minutes <span aria-hidden>⚡</span></p>
        <p className="flex items-center gap-1 text-sm font-semibold">
          <span className="font-extrabold">HOME</span> · Demo address, Bengaluru <IconChevron className="h-4 w-4" />
        </p>
        <div className="mt-3"><SearchBar /></div>
        <nav aria-label="Shop categories" className="no-scrollbar -mx-3 mt-2 flex gap-1 overflow-x-auto px-3">
          <span className="flex shrink-0 flex-col items-center border-b-[3px] border-brand-ink px-2 pb-1 text-sm font-extrabold">
            <span aria-hidden className="text-xl">🛍️</span>All
          </span>
          {ORDER.map((id) => (
            <Link key={id} href={`/c/${id}`} className="flex shrink-0 flex-col items-center border-b-[3px] border-transparent px-2 pb-1 text-sm font-semibold text-brand-ink-muted hover:text-brand-ink">
              <span aria-hidden className="text-xl">{CATEGORIES[id].emoji}</span>{SHORT[id]}
            </Link>
          ))}
        </nav>
      </header>

      {/* The feature's home entry: say the need, not the product (new categories are found by need, not by name). */}
      <section aria-labelledby="feature" className="mx-3 mt-3 rounded-2xl bg-accent p-3 text-accent-ink">
        <h2 id="feature" className="flex items-center gap-1.5 font-extrabold"><IconSpark className="h-5 w-5" /> Will it suit you? <span className="rounded bg-surface px-1.5 text-sm text-accent">NEW</span></h2>
        <p className="mt-0.5 text-sm">Say what you need it for. Every product answers the question that decides it.</p>
        <div className="no-scrollbar -mx-3 mt-2 flex gap-2 overflow-x-auto px-3">
          {NEEDS.map((q) => (
            <Link key={q} href={`/search?q=${encodeURIComponent(q)}`}
              className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-sm font-bold text-text">{q}</Link>
          ))}
        </div>
      </section>

      {/* Like the peer prototypes' "new for your household" rail, but every card carries its deciding answer. */}
      {SHOPPERS.map((s) => (
        <ForShopper key={s.id} id={s.id}>
          <Rail title="New for your household" subtitle="Categories you haven't tried, with the answer that decides each"
            items={ORDER.filter((c) => isNewFor(s, c)).flatMap((c) => itemsIn(c).filter((x) => cardTeaser(x)?.verdict === "yes").slice(0, 2)).slice(0, 8)} />
        </ForShopper>
      ))}

      <section aria-labelledby="cats" className="px-3 pt-4">
        <h2 id="cats" className="text-lg font-extrabold">Shop by category</h2>
        <div className="mt-2 grid grid-cols-4 gap-x-2 gap-y-3">
          {ORDER.map((id) => {
            const c = CATEGORIES[id];
            return (
              <Link key={id} href={`/c/${id}`} className="group flex flex-col items-center text-center">
                <span aria-hidden className={`relative grid aspect-square w-full place-items-center rounded-xl text-3xl ${c.tile === "tile" ? "bg-tile" : "bg-tile-2"}`}>
                  {c.emoji}
                  <span className="absolute left-1 top-1"><NewBadge category={id} small short /></span>
                </span>
                <span className="mt-1 text-sm font-semibold leading-tight group-hover:underline">{c.name}</span>
              </Link>
            );
          })}
          <Link href="/categories" className="group flex flex-col items-center text-center">
            <span aria-hidden className="grid aspect-square w-full place-items-center rounded-xl bg-surface text-2xl font-extrabold text-accent">→</span>
            <span className="mt-1 text-sm font-semibold leading-tight group-hover:underline">All categories</span>
          </Link>
        </div>
      </section>

      {ORDER.map((id) => (
        <Rail key={id} title={CATEGORIES[id].name} href={`/c/${id}`} items={itemsIn(id).slice(0, 6)} />
      ))}
      <div className="h-4" />
    </>
  );
}
