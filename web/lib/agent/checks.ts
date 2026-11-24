/**
 * Code checks on an agent answer. No model involved: these are exact and cheap.
 *
 *   C1 citations: every [E12] the answer cites is an entry a tool returned in this turn.
 *   C2 numbers:   every number in the answer appears in a tool result (or in the question),
 *                 allowing for rounding and for shares written as percentages.
 *
 * Kept free of framework imports so `node --test` can run the tests directly.
 */

export type NumberCheck = { ok: boolean; checked: number; unverified: string[] };
export type CitationCheck = { ok: boolean; cited: string[]; unknown: string[] };

/** Citation ids in order of first appearance, e.g. ["E3", "E1"]. Also accepts [E1, E2]. */
export function citedIds(answer: string): string[] {
  const seen = new Set<string>();
  for (const group of answer.matchAll(/\[(E\d{1,3}(?:\s*,\s*E\d{1,3})*)\]/g)) {
    for (const id of group[1].split(",")) seen.add(id.trim());
  }
  return [...seen];
}

export function checkCitations(answer: string, known: Set<string>): CitationCheck {
  const cited = citedIds(answer);
  const unknown = cited.filter((id) => !known.has(id));
  return { ok: unknown.length === 0, cited, unknown };
}

/** Every number found anywhere in a value (numbers, and digits inside strings such as dates or quotes). */
export function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (typeof value === "string") {
    for (const m of value.matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  } else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectNumbers(v, out));
  return out;
}

type Found = { text: string; value: number; decimals: number; percent: boolean };

/** Numbers stated in the answer, ignoring citation ids ([E12]) and list markers ("1." at a line start). */
export function answerNumbers(answer: string): Found[] {
  const cleaned = answer
    .replace(/\[E\d{1,3}(?:\s*,\s*E\d{1,3})*\]/g, " ")
    .replace(/^\s*\d{1,2}[.)]\s/gm, " ")
    .replace(/(\d),(\d{3})/g, "$1$2"); // 1,234 -> 1234
  const found: Found[] = [];
  for (const m of cleaned.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(\s?%| per ?cent)?/g)) {
    const text = m[1];
    found.push({ text: m[0].trim(), value: Number(text), decimals: text.split(".")[1]?.length ?? 0, percent: !!m[2] });
  }
  return found;
}

/**
 * A stated number is verified if some source number matches it within the rounding its written form
 * implies (57% matches 0.5727 and 57.27; 0.21 matches 0.2134; 197 matches only 197). Small whole
 * numbers (≤ 10, not percentages) are allowed as ordinary language ("the top 3 barriers").
 */
export function checkNumbers(answer: string, sources: number[]): NumberCheck {
  const unverified: string[] = [];
  const nums = answerNumbers(answer);
  let checked = 0;
  for (const n of nums) {
    if (!n.percent && n.decimals === 0 && n.value <= 10) continue;
    checked++;
    const tol = 0.5 * 10 ** -n.decimals + 1e-9;
    const ok = sources.some((s) => {
      if (Math.abs(s - n.value) <= tol) return true;
      return s > 0 && s <= 1 && Math.abs(s * 100 - n.value) <= tol; // a share written as a percentage
    });
    if (!ok) unverified.push(n.text);
  }
  return { ok: unverified.length === 0, checked, unverified: [...new Set(unverified)] };
}

/** Lower-case, collapse spaces, drop punctuation: the cache key for a single-turn question. */
export function questionKey(q: string): string {
  return q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}
