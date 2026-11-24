// Unit tests for the answer checks. Run: npm test  (Node's built-in runner; Node strips the types).
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerNumbers, checkCitations, checkNumbers, citedIds, collectNumbers, questionKey } from "../lib/agent/checks.ts";

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
