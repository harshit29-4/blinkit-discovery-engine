"use client";

import Link from "next/link";
import { useState } from "react";
import { ITEM_BY_ID, rupees } from "@/lib/catalog.ts";
import type { ScanResult } from "@/lib/scan.ts";
import { withSession } from "@/components/track";

/** Shrinks the photo in the browser (long side 1024 px, JPEG) so uploads stay small and fast. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function ItemLink({ id }: { id: string }) {
  const x = ITEM_BY_ID.get(id);
  if (!x) return null;
  return (
    <Link href={`/p/${x.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 hover:border-accent">
      <span aria-hidden className="text-3xl">{x.emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{x.name}</span>
        <span className="block text-sm text-muted">{x.brand} · {x.unit} · {rupees(x.price)}</span>
      </span>
    </Link>
  );
}

export function ScanForm() {
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setResult(null);
    setError(null);
    setBusy(true);
    try {
      const image = await shrink(file);
      setPreview(image);
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, ...withSession() }) });
      const body = await res.json();
      if (body.result) setResult(body.result);
      else setError(body.error ?? "Something went wrong.");
    } catch {
      setError("Couldn't read that file. Try a JPEG or PNG photo.");
    } finally {
      setBusy(false);
    }
  }

  const read = result?.read;
  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface p-6 text-center hover:border-accent">
        <span aria-hidden className="text-4xl">📷</span>
        <span className="font-bold">{busy ? "Reading the pack…" : "Take or choose a photo of the pack"}</span>
        <span className="text-sm text-muted">Front of the pack, label readable</span>
        <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy}
          onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
      {preview && <img src={preview} alt="Your photo" className="mx-auto max-h-56 rounded-xl" />}
      {error && <p role="alert" className="text-bad">{error}</p>}
      {result && (
        <div aria-live="polite" className="space-y-3 rounded-2xl border-2 border-brand-yellow bg-surface p-4">
          <p className="text-sm text-muted">
            Read from your photo: {[read?.brand, read?.product, read?.variant, read?.size].filter(Boolean).join(" · ") || "nothing legible"}
          </p>
          {result.match === "exact" && result.id ? (
            <>
              <p className="font-extrabold"><span aria-hidden>✓ </span>Same one in stock</p>
              <ItemLink id={result.id} />
            </>
          ) : (
            <>
              <p className="font-extrabold">
                {result.match === "similar" ? "Not the exact one. Closest we have:" : "We don't stock this one."}
              </p>
              {result.note && <p>{result.note}</p>}
              <div className="space-y-2">{result.alternatives.map((id) => <ItemLink key={id} id={id} />)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
