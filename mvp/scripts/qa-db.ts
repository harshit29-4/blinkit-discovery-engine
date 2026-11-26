/**
 * Database QA (tests F9, G1): the public key can't touch the MVP tables, and the usage log never holds what a
 * shopper typed into the card. Reads keys from the project's .env; never prints them.
 * Run: node scripts/qa-db.ts
 */
import "./env.ts";
import { writeFileSync } from "node:fs";

const url = process.env.SUPABASE_URL!.trim().replace(/\/+$/, "").replace(/\/rest\/v1$|\/rest$/, "") + "/rest/v1";
const pub = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SECRET_KEY!;
const results: { id: string; test: string; pass: boolean; detail: string }[] = [];
const check = (id: string, test: string, pass: boolean, detail = "") => {
  results.push({ id, test, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${test}${detail ? ` (${detail})` : ""}`);
};
const h = (k: string) => ({ apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" });

if (!pub) check("F9", "public key available to test with", false, "no SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY in .env");
else {
  for (const t of ["mvp_events", "mvp_baskets"]) {
    const read = await fetch(`${url}/${t}?select=*&limit=1`, { headers: h(pub) });
    check("F9", `public key cannot read ${t}`, read.status === 401 || read.status === 403, String(read.status));
  }
  const write = await fetch(`${url}/mvp_events`, { method: "POST", headers: h(pub), body: JSON.stringify({ session: "qa-public-key", kind: "view" }) });
  check("F9", "public key cannot write mvp_events", write.status === 401 || write.status === 403, String(write.status));
  const rpc = await fetch(`${url}/rpc/mvp_basket_set`, { method: "POST", headers: h(pub), body: JSON.stringify({ p_code: "qaqaqaqa", p_items: [] }) });
  check("F9", "public key cannot call mvp_basket_set", rpc.status === 401 || rpc.status === 403 || rpc.status === 404, String(rpc.status));
}

// G1: card_check events carry only the verdict (and model / cached / failed flags), never free text
const rows = (await (await fetch(`${url}/mvp_events?select=kind,detail&kind=eq.card_check&order=at.desc&limit=200`, { headers: h(secret) })).json()) as { detail: Record<string, unknown> }[];
const ALLOWED = new Set(["verdict", "model", "cached", "failed"]);
const leaks = rows.filter((r) => Object.keys(r.detail ?? {}).some((k) => !ALLOWED.has(k)));
check("G1", `card_check events hold no typed text (${rows.length} checked)`, leaks.length === 0, leaks.slice(0, 3).map((r) => JSON.stringify(r.detail)).join("; "));

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
writeFileSync(new URL("../eval/qa-db-results.json", import.meta.url),
  JSON.stringify({ run_at: new Date().toISOString(), passed, total: results.length, results }, null, 1) + "\n");
