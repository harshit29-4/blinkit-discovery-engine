import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinCart } from "./join";

export const metadata: Metadata = { title: "Shared cart", robots: { index: false } };

async function Join({ params }: { params: PageProps<"/b/[code]">["params"] }) {
  const { code } = await params;
  return <JoinCart code={code} />;
}

/** Opening a shared-cart link joins that cart, then shows it. */
export default function SharedCartPage({ params }: PageProps<"/b/[code]">) {
  return (
    <Suspense fallback={<p className="p-6 text-center text-muted">Opening the shared cart…</p>}>
      <Join params={params} />
    </Suspense>
  );
}
