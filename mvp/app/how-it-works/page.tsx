import type { Metadata } from "next";
import results from "@/eval/results.json" with { type: "json" };
import { CARDS_META } from "@/lib/cards.ts";
import { VerdictChip } from "@/components/decision-card";
import { PageHeader } from "@/components/shell";
import type { Verdict } from "@/lib/card.ts";

export const metadata: Metadata = { title: "How it works" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-3">
      <h2 className="text-lg font-extrabold">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

type Summary = {
  models: Record<string, number>; run_at: string; cases: number; passed: number; checks_pass: number; repaired: number;
  not_stated_cases: number; invented_answers: number; answer_cases: number; answer_correct: number; gate_passed: boolean;
};
type Row = { id: string; shopper: string | null; verdict: string | null; pass: boolean };

export default function HowItWorks() {
  const s = results.summary as unknown as Summary | null;
  const rows = results.rows as Row[];
  return (
    <>
    <PageHeader title="About this prototype" search={false} />
    <div className="space-y-3 p-3">

      <Section title="Why this exists">
        <p>
          Six interviews with shoppers who mostly reorder the same things found the same pattern: people skip a new
          category not because they fear a bad buy, but because the listing doesn&rsquo;t answer the one question that
          decides it. Is it ripe for tonight? Will it fast-charge my phone? Can I exchange it if the strap hurts? Can I
          get a hand inside the kettle to clean it? When the answer is missing, they walk to a shop.
        </p>
        <p>The question changes with the category, so a fixed template can&rsquo;t hold it. A language model can work it out.</p>
      </Section>

      <Section title="What it does">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Decision card</b> on every product page: names the deciding question for that product and answers it from the listing. Tell it about you (your phone, your size, when you need it) and it re-checks.</li>
          <li><b>Search by need</b>: type what it&rsquo;s for (&ldquo;something to play on a train with my 8-year-old&rdquo;) and get products from any category, with the reason each fits.</li>
          <li><b>Scan the packet</b> (camera in the search bar): photograph the pack at home to find the exact brand and variant, or learn it isn&rsquo;t stocked.</li>
          <li><b>Send to check</b>: send a product, with its deciding question, to whoever will judge it; they reply in one tap.</li>
          <li><b>Order together</b>: turn the cart into a shared one, so flatmates or family add to one order by link.</li>
          <li><b>New for you</b> tags mark categories this demo household has never bought; the order confirmation counts them.</li>
        </ul>
      </Section>

      <Section title="How it stays honest">
        <ul className="list-disc space-y-1 pl-5">
          <li>The model sees only the listing&rsquo;s stated details, plus a list of details the seller left out. It is told never to use outside knowledge or guess.</li>
          <li>Code checks every answer before it&rsquo;s shown: each cited detail must exist in the listing, a yes/no must cite something, a &ldquo;not stated&rdquo; must name what&rsquo;s missing, and every number in the answer must appear in the listing or in your own words.</li>
          <li>An answer that fails gets one repair attempt with the problems listed. If it still fails, you see the plain listing and a &ldquo;couldn&rsquo;t check&rdquo; note instead.</li>
          <li>Models: Gemini 3.5 Flash-Lite answers first; when its free tier is overloaded, Groq&rsquo;s gpt-oss-120b answers instead, under the same checks. The packet scan reads photos, so it uses Gemini only.</li>
          <li>The default cards were generated and checked once, on {fmtDate(CARDS_META.generated_at)} ({CARDS_META.models}). Live checks happen only when you add something about yourself.</li>
        </ul>
      </Section>

      <Section title="Test results">
        {!s ? <p>The test set hasn&rsquo;t been run on this version yet.</p> : <>
        <p>
          A fixed set of {s.cases} cases, run through the same path the app uses ({Object.entries(s.models ?? {}).map(([m, n]) => `${m}: ${n}`).join(", ")}; {fmtDate(s.run_at)}).
          {" "}{s.not_stated_cases} of them are listings where the deciding detail is missing, so the only right answer is
          &ldquo;not stated by the seller&rdquo;.
        </p>
        <dl className="grid grid-cols-1 gap-2">
          <div className="rounded-xl bg-bg p-3"><dt className="text-sm text-muted">Passed every check</dt><dd className="text-2xl font-extrabold">{pct(s.checks_pass, s.cases)}</dd></div>
          <div className="rounded-xl bg-bg p-3"><dt className="text-sm text-muted">Invented answers on missing details</dt><dd className="text-2xl font-extrabold">{s.invented_answers} of {s.not_stated_cases}</dd></div>
          <div className="rounded-xl bg-bg p-3"><dt className="text-sm text-muted">Right answer and right detail cited</dt><dd className="text-2xl font-extrabold">{s.answer_correct} of {s.answer_cases}</dd></div>
        </dl>
        <p className="text-sm text-muted">
          Release rule: every case passes the checks and none invents an answer. {s.gate_passed ? "Met on this run." : "Not met on this run."}
          {s.repaired > 0 && ` ${s.repaired} answers needed the repair step.`}
        </p>
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer font-semibold">All {s.cases} cases</summary>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="text-left text-muted"><th className="py-1 pr-2">Product · shopper</th><th className="py-1 text-right">Answer</th></tr></thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n} className="border-t border-border align-top">
                  <td className="py-2 pr-2">
                    <span className="font-semibold">{r.id}</span>
                    <span className="block text-muted">{r.shopper ?? "no details given"}</span>
                    {!r.pass && <span className="block text-bad">Did not pass</span>}
                  </td>
                  <td className="py-2 text-right">{r.verdict ? <VerdictChip v={r.verdict as Verdict} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        </>}
      </Section>

      <Section title="What's real and what's demo">
        <p>
          The products, brands, prices and order histories are invented for this prototype; nothing is copied from
          Blinkit. The AI, the checks and the test results are real. In production the same card would read Blinkit&rsquo;s
          own product data, and an A/B test would measure the share of monthly customers who buy from a new category.
        </p>
      </Section>
    </div>
    </>
  );
}
