/**
 * HTTP-level QA against a running app (no AI calls): routes, 404s, bad API input, security headers, noindex,
 * secrets in client JavaScript, server time and JS weight. Tests F1-F5, F7, F8, F10, H1, H2 in TESTING.md.
 * Run: node scripts/qa-http.ts [base url]   (default https://will-it-suit-me.vercel.app)
 */
import "./env.ts";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { CATEGORIES, ITEMS } from "../lib/catalog.ts";

const base = process.argv[2] ?? "https://will-it-suit-me.vercel.app";
type R = { id: string; test: string; pass: boolean; detail: string };
const results: R[] = [];
const check = (id: string, test: string, pass: boolean, detail = "") => {
  results.push({ id, test, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${test}${detail ? ` (${detail})` : ""}`);
};
const get = async (path: string) => {
  const t0 = Date.now();
  const res = await fetch(base + path, { redirect: "manual" });
  const text = await res.text();
  return { res, text, ms: Date.now() - t0 };
};
const post = async (path: string, body: string, type = "application/json") => {
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": type }, body });
  return { status: res.status, body: await res.text() };
};

// F1 + H1: every route, timed
const routes = ["/", "/categories", "/cart", "/order-again", "/account", "/how-it-works", "/scan", "/search",
  ...Object.keys(CATEGORIES).map((c) => `/c/${c}`), ...ITEMS.map((x) => `/p/${x.id}`)];
const times: number[] = [];
const bad: string[] = [];
for (const r of routes) {
  const { res, ms } = await get(r);
  times.push(ms);
  if (res.status !== 200) bad.push(`${r} ${res.status}`);
}
times.sort((a, b) => a - b);
check("F1", `all ${routes.length} routes return 200`, bad.length === 0, bad.join(", "));
check("H1", "static pages: median server time < 1 s", times[Math.floor(times.length / 2)] < 1000,
  `median ${times[Math.floor(times.length / 2)]} ms, max ${times[times.length - 1]} ms`);
for (const [path, want] of [["/p/does-not-exist", 404], ["/c/nope", 404]] as const) {
  const { res } = await get(path);
  check("F1", `${path} → ${want}`, res.status === want, String(res.status));
}
{
  const { res, text } = await get("/b/zzzzzzzz");
  check("E9", "unknown shared-cart code renders (handled in the page)", res.status === 200 && text.includes("shared cart"), String(res.status));
}

// F2: /api/card bad input (validated before any model call, so no AI cost)
for (const [name, body, want] of [
  ["bad JSON", "{not json", 400],
  ["missing id", JSON.stringify({ shopper: "x" }), 400],
  ["unknown id", JSON.stringify({ id: "nope", shopper: "x" }), 400],
  ["empty shopper", JSON.stringify({ id: "kettle-1l", shopper: "   " }), 400],
] as const) {
  const r = await post("/api/card", body);
  check("F2", `/api/card ${name} → ${want}`, r.status === want, String(r.status));
}

// F3: /api/basket bad input
const line = (id: string, qty: number) => ({ id, qty, by: null });
for (const [name, path, body, want] of [
  ["GET bad code", "/api/basket?code=BAD", null, 400],
  ["unknown item", "/api/basket", { lines: [line("nope", 1)] }, 400],
  ["qty 0", "/api/basket", { lines: [line("kettle-1l", 0)] }, 400],
  ["qty 21", "/api/basket", { lines: [line("kettle-1l", 21)] }, 400],
  ["41 lines", "/api/basket", { lines: Array.from({ length: 41 }, () => line("kettle-1l", 1)) }, 400],
  ["lines not a list", "/api/basket", { lines: "x" }, 400],
] as const) {
  const status = body === null ? (await get(path)).res.status : (await post(path, JSON.stringify(body))).status;
  check("F3", `/api/basket ${name} → ${want}`, status === want, String(status));
}

// F4: /api/event
for (const [name, body, want] of [
  ["unknown kind", { session: "qa-session-01", kind: "hack" }, 400],
  ["bad session", { session: "x", kind: "view" }, 400],
  ["not JSON", "nope", 400],
] as const) {
  const r = await post("/api/event", typeof body === "string" ? body : JSON.stringify(body));
  check("F4", `/api/event ${name} → ${want}`, r.status === want, String(r.status));
}

// F5: /api/scan rejects non-images before any model call
for (const [name, image, want] of [
  ["text data URL", "data:text/plain;base64,aGVsbG8=", 400],
  ["gif type", "data:image/gif;base64,R0lGODlhAQABAAAAACw=", 400],
  ["not a data URL", "https://example.com/x.jpg", 400],
  ["too large", "data:image/jpeg;base64," + "A".repeat(2_200_000), 400],
] as const) {
  const r = await post("/api/scan", JSON.stringify({ image }));
  check("F5", `/api/scan ${name} → ${want}`, r.status === want, String(r.status));
}

// F7 + F10: headers and noindex
{
  const { res, text } = await get("/");
  const h = res.headers;
  check("F7", "Content-Security-Policy present", !!h.get("content-security-policy"));
  check("F7", "X-Frame-Options DENY", h.get("x-frame-options") === "DENY");
  check("F7", "X-Content-Type-Options nosniff", h.get("x-content-type-options") === "nosniff");
  check("F7", "Referrer-Policy present", !!h.get("referrer-policy"));
  check("F10", "robots noindex in HTML", /<meta name="robots" content="noindex/.test(text));

  // F8 + H2: download every script the home and a product page load; look for the real keys (never printed)
  const pages = [text, (await get("/p/kettle-1l")).text, (await get("/cart")).text];
  const srcs = [...new Set(pages.flatMap((p) => [...p.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1])))];
  const secrets = ["GEMINI_API_KEY", "MVP_GROQ_API_KEY", "SUPABASE_SECRET_KEY", "GROQ_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
    .map((k) => [k, process.env[k]] as const).filter(([, v]) => v && v.length > 12);
  let homeBytes = 0;
  const leaks: string[] = [];
  const homeSrcs = new Set([...text.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]));
  for (const s of srcs) {
    const js = await (await fetch(base + s)).text();
    if (homeSrcs.has(s)) homeBytes += gzipSync(js).length;
    for (const [name, value] of secrets) if (js.includes(value!)) leaks.push(`${name} in ${s}`);
  }
  check("F8", `no secret in ${srcs.length} client scripts (${secrets.length} keys compared)`, leaks.length === 0 && secrets.length > 0, leaks.join(", "));
  // Budget is on gzip (what a phone downloads). React + Next.js alone are ~490 KB raw / ~150 KB gzip.
  check("H2", "home JavaScript < 220 KB gzipped", homeBytes < 220_000, `${Math.round(homeBytes / 1024)} KB gzip`);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
writeFileSync(new URL("../eval/qa-http-results.json", import.meta.url),
  JSON.stringify({ base, run_at: new Date().toISOString(), passed, total: results.length, results }, null, 1) + "\n");
process.exitCode = passed === results.length ? 0 : 1;
