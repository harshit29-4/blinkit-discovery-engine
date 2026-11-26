import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CATEGORIES, itemsIn, type CategoryId } from "@/lib/catalog.ts";
import { ProductCard } from "@/components/product-card";
import { PageHeader } from "@/components/shell";
import { NewBadge } from "@/components/shopper";

export function generateStaticParams() {
  return Object.keys(CATEGORIES).map((cat) => ({ cat }));
}

export async function generateMetadata({ params }: PageProps<"/c/[cat]">): Promise<Metadata> {
  const { cat } = await params;
  return { title: CATEGORIES[cat as CategoryId]?.name ?? "Category" };
}

/** Blinkit-style category screen: category tabs down the left, products in two columns on the right. */
async function Category({ params }: { params: PageProps<"/c/[cat]">["params"] }) {
  const { cat } = await params;
  const c = CATEGORIES[cat as CategoryId];
  if (!c) notFound();
  return (
    <>
      <PageHeader title={c.name} />
      <div className="flex">
        <nav aria-label="Categories" className="sticky top-[3.6rem] h-[calc(100dvh-12rem)] w-[5.5rem] shrink-0 overflow-y-auto border-r border-border bg-surface sm:h-[600px]">
          {(Object.keys(CATEGORIES) as CategoryId[]).map((id) => {
            const x = CATEGORIES[id];
            const on = id === cat;
            return (
              <Link key={id} href={`/c/${id}`} aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center gap-1 break-words border-r-4 px-1 py-2 text-center text-sm leading-tight ${on ? "border-accent bg-accent-soft font-extrabold" : "border-transparent text-muted"}`}>
                <span aria-hidden className={`grid h-11 w-11 place-items-center rounded-full text-2xl ${x.tile === "tile" ? "bg-tile" : "bg-tile-2"}`}>{x.emoji}</span>
                {x.name}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1 p-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <NewBadge category={cat as CategoryId} />
            <span className="text-sm text-muted">{itemsIn(cat as CategoryId).length} products</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {itemsIn(cat as CategoryId).map((x) => <ProductCard key={x.id} item={x} wide showNew={false} />)}
          </div>
        </div>
      </div>
    </>
  );
}

export default function CategoryPage({ params }: PageProps<"/c/[cat]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse bg-surface" />}>
      <Category params={params} />
    </Suspense>
  );
}
