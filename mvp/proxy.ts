/**
 * Unknown product and category ids get a real 404 status. With cacheComponents, pages stream inside Suspense, so a
 * notFound() there can no longer change the status (it would be a 200 page saying "not found"); and the
 * dynamicParams route option isn't allowed. Every id is known from the catalogue, so check it here first.
 */
import type { NextRequest } from "next/server";
import { CATEGORIES, ITEM_BY_ID } from "./lib/catalog.ts";

export const config = { matcher: ["/p/:id", "/c/:cat"] };

const page = (what: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Not found · blinkit concept</title></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#f4f6fb;color:#1f1f1f;display:grid;place-items:center;min-height:100vh">
<main style="text-align:center;padding:24px"><p style="font-size:56px;margin:0">🔍</p>
<h1 style="font-size:22px">This ${what} isn't in the demo catalogue</h1>
<p style="color:#666">The link may be old or mistyped.</p>
<a href="/" style="display:inline-block;margin-top:12px;background:#0c831f;color:#fff;padding:12px 20px;border-radius:12px;font-weight:800;text-decoration:none">Go to home</a>
</main></body></html>`;

export function proxy(request: NextRequest) {
  const [, kind, id] = request.nextUrl.pathname.split("/");
  const known = kind === "p" ? ITEM_BY_ID.has(id) : id in CATEGORIES;
  if (!known) return new Response(page(kind === "p" ? "product" : "category"), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
