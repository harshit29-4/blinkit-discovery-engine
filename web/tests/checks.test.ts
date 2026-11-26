// Unit tests for the answer checks. Run: npm test  (Node's built-in runner; Node strips the types).
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerNumbers, checkCitations, checkFraming, checkNumbers, citedIds, collectNumbers, normaliseCitations, questionKey } from "../lib/agent/checks.ts";

test("citations: ids in order, grouped form, unknown ids flagged", () => {
  assert.deepEqual(citedIds("Quality [E3]. Refunds [E1][E3] and [E2, E4]."), ["E3", "E1", "E2", "E4"]);
  const c = checkCitations("A [E1] B [E9]", new Set(["E1", "E2"]));
  assert.equal(c.ok, false);
  assert.deepEqual(c.unknown, ["E9"]);
  assert.equal(checkCitations("No citations here.", new Set()).ok, true);
  // Entries were retrieved but none is cited: fails, so the agent is asked to rewrite with citations.
  const none = checkCitations("Users want refunds.", new Set(["E1"]));
  assert.equal(none.ok, false);
  assert.equal(none.missing, true);
});

test("numbers are collected from nested tool output, including inside strings", () => {
  const n = collectNumbers({ base: 344, rows: [{ entries: 197, percent: 57.3 }], date: "2026-03-01" });
  for (const v of [344, 197, 57.3, 2026, 3, 1]) assert.ok(n.includes(v), String(v));
});

test("answer numbers skip citation ids and list markers, read percents and thousands", () => {
  const found = answerNumbers("1. Quality: 57.3 % of 1,234 entries [E12]\n2. Fees 12%");
  assert.deepEqual(found.map((f) => [f.value, f.percent]), [[57.3, true], [1234, false], [12, true]]);
});

test("rounding: 57% and 57.3% match a share of 0.5727; 197 matches only 197", () => {
  const src = [0.5727, 197, 344];
  assert.equal(checkNumbers("57% of 344", src).ok, true);
  assert.equal(checkNumbers("57.3% of 344", src).ok, true);
  assert.equal(checkNumbers("197 entries", src).ok, true);
  const bad = checkNumbers("198 entries, 60%", src);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unverified, ["198", "60%"]);
});

test("small whole numbers are ordinary language, small percents are still checked", () => {
  assert.equal(checkNumbers("the top 3 barriers", []).ok, true);
  assert.equal(checkNumbers("3% of entries", []).ok, false);
  assert.equal(checkNumbers("kappa 0.21", [0.2134]).ok, true);
  assert.equal(checkNumbers("kappa 0.25", [0.2134]).ok, false);
});

test("a fabricated statistic is caught even when other numbers are right", () => {
  const r = checkNumbers("57.3% of 344 tagged entries mention quality; 72% of users never explore.", [0.573, 344]);
  assert.deepEqual(r.unverified, ["72%"]);
});

test("question key normalises case, punctuation and spaces", () => {
  assert.equal(questionKey("  What prevents users — from exploring?? "), "what prevents users from exploring");
});

test("citations written as (E1), (E1, E2) or a bare id become [E#], but only for ids a tool returned", () => {
  const k = new Set(["E1", "E2", "E3", "E12"]);
  assert.equal(normaliseCitations("One review (E1) says.", k), "One review [E1] says.");
  assert.equal(normaliseCitations("Two (E1, E2) and (E2 and E3).", k), "Two [E1, E2] and [E2, E3].");
  assert.equal(normaliseCitations("Review E2 notes x; see E12.", k), "Review [E2] notes x; see [E12].");
  assert.equal(normaliseCitations("Already [E1, E2] and [E3][E12].", k), "Already [E1, E2] and [E3][E12].");
  assert.equal(normaliseCitations("Unknown (E9) and E99 stay; E3E too.", k), "Unknown (E9) and E99 stay; E3E too.");
  assert.deepEqual(checkCitations(normaliseCitations("Fake items (E1).", k), k).cited, ["E1"]);
});

test("citation ranges are expanded and tool names written as citations are dropped", () => {
  const k = new Set(["E1", "E2", "E3", "E4", "E5"]);
  assert.equal(normaliseCitations("Doubts [E1–E3].", k), "Doubts [E1, E2, E3].");
  assert.equal(normaliseCitations("Doubts (E2-E4).", k), "Doubts [E2, E3, E4].");
  assert.equal(normaliseCitations("Too far [E1–E40] stays.", k), "Too far [E1–E40] stays.");
  assert.equal(normaliseCitations("36 entries (57.1%) [count_feedback].", k), "36 entries (57.1%).");
});

test("framing: buyer complaints must not be turned into reasons people stay away", () => {
  assert.ok(checkFraming("Customers who choose not to buy fruits point to freshness."));
  assert.ok(checkFraming("People avoid buying vegetables because of quality."));
  assert.ok(checkFraming("Users rarely buy electronics here."));
  assert.equal(checkFraming("Buyers report poor freshness in 36 of 63 entries."), null);
  assert.equal(checkFraming("One reviewer says they will never order fruit again [E2]."), null);
});

test("framing: a disclaimer about why people avoid something is not flagged", () => {
  assert.equal(checkFraming("These are complaints from buyers rather than direct reasons why people avoid the category."), null);
  assert.equal(checkFraming("The feedback can't show the reasons people stay away."), null);
  assert.equal(checkFraming("rather than why potential users avoid the category."), null);
});
