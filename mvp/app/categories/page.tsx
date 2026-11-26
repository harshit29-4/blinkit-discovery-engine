import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORIES, itemsIn, type CategoryId } from "@/lib/catalog.ts";
import { PageHeader } from "@/components/shell";
import { NewBadge } from "@/components/shopper";

export const metadata: Metadata = { title: "Categories" };

export default function Categories() {
  return (
    <>
      <PageHeader title="All categories" />
      <ul className="space-y-2 p-3">
        {(Object.keys(CATEGORIES) as CategoryId[]).map((id) => {
          const c = CATEGORIES[id];
          return (
            <li key={id}>
              <Link href={`/c/${id}`} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 hover:border-accent">
                <span aria-hidden className={`grid h-14 w-14 shrink-0 place-items-center rounded-lg text-3xl ${c.tile === "tile" ? "bg-tile" : "bg-tile-2"}`}>{c.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold">{c.name}</span>
                  <span className="block text-sm text-muted">{itemsIn(id).length} products</span>
                </span>
                <NewBadge category={id} small />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
