"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { joinShared } from "@/components/cart";

export function JoinCart({ code }: { code: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(!/^[a-z0-9]{8}$/.test(code));
  useEffect(() => {
    if (failed) return;
    joinShared(code).then((ok) => (ok ? router.replace("/cart") : setFailed(true)));
  }, [code, failed, router]);
  return (
    <div className="p-6 text-center">
      {failed ? (
        <>
          <h1 className="text-xl font-extrabold">Couldn&rsquo;t open that shared cart</h1>
          <p className="mt-1 text-muted">The link may be wrong. Ask for it again.</p>
          <Link href="/" className="mt-4 inline-block font-bold text-accent">Go to home</Link>
        </>
      ) : <p className="text-muted">Opening the shared cart…</p>}
    </div>
  );
}
