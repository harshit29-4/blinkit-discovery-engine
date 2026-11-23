# Reference review: what to learn from existing projects

2026-11-22. Sources: the 9 reference decks in `../Blinkit project NL/` (not in git) and the live engine at https://blinkit-reviews-engine.vercel.app/. These are for learning only; nothing here is copied into the build.

## 1. Live engine: what it gets wrong

Checked in the browser on 2026-11-22. It matches the engine in reference deck 4.

| # | Observation | Why it's a problem | What we do instead |
|---|---|---|---|
| L1 | Frozen snapshot of 1,411 reviews. No "last updated", no date range, no history | You can't tell how old or current the findings are | Last-updated stamp, date range, run history, hourly refresh |
| L2 | 1,283 of 1,411 items (91%) are Play Store; App Store has 15 | One channel's voice is presented as "users" | Show source mix on every view; flag single-source themes; per-source breakdown |
| L3 | Asked "What prevents users from exploring new categories?": the answer was three sentences with **no quotes, no citations, no counts** | Claims to be "grounded" but can't be checked | Every answer cites reviews with links, states how many items it rests on, and refuses when evidence is thin |
| L4 | The chat said fees discourage trial; the dashboard says "trust — not price — is the dealbreaker" | The two surfaces contradict each other | Chat and dashboard read the same evidence and insight tables, so they can't disagree silently |
| L5 | "Key insights" and "user needs" are static prose with no counts or quotes | Reads like opinion | Insight cards: claim · evidence count · source spread · confidence · quotes · caveats |
| L6 | No validation shown anywhere | The brief explicitly asks how quality was validated | A Validation page with live metrics |
| L7 | Theme sizes shown as % without any significance or minimum size | Small clusters (18–23 items) are presented next to 357-item ones as equal findings | Minimum-evidence thresholds; small themes labelled "signal", not "finding" |

What it does well, and we keep the idea:
- Separating **general friction** (delivery, price) from **exploration barriers**. The loudest complaints aren't the goal-relevant ones.
- The **"absence problem" note**: users who don't know a category exists never write about it, so silence isn't satisfaction.

## 2. Lessons from the 9 reference decks

| Deck | Lesson | Adopt? |
|---|---|---|
| 3 | "Reviews shout, they don't vote": angry 1-star reviewers dominate review text, so **severity ≠ prevalence** | ✅ Report prevalence and intensity separately, plus a bias panel |
| 3 | Statistics computed by code, not by the LLM | ✅ The LLM never does arithmetic |
| 6 | Relevance tiers (discovery-relevant / general / excluded) and **publish gates**: insights publish only if evals pass | ✅ |
| 6 | Versioned published briefs (snapshot IDs) | ✅ Each daily synthesis is a versioned snapshot you can compare |
| 6 | Barrier **failure chain**: awareness → trust → trial → habit-lock | ✅ Add a `funnel_stage` tag |
| 8 | Each answer has claim, rationale, confidence, scope, caveats; validation covers grounding, diversity, specificity, caveats | ✅ Use as the insight card format |
| 1 | States limitations up front (public feedback only, silent users, language) | ✅ Limitations panel |
| 1, 3, 4 | Engine output feeds the hypotheses tested in user research | ✅ The engine generates the Part 2 hypotheses and an interview guide |
| 5 | Funnel numbers (collected → relevant → themes) and a segment table with % negative | ✅ |
| 2 | Themes built on 4–10 mentions presented as findings | ❌ Avoid: minimum-evidence thresholds |
| 9 | Generic sentiment dashboard not tied to the goal | ❌ Avoid: everything maps to the 8 questions and the north-star metric |
| 3 | Downloadable PDF report | ✅ Optional: a downloadable research brief per snapshot |

## 3. Changes to our plan (all approved 2026-11-22)

1. **Insight cards** with claim, evidence count, source spread, confidence, quotes and caveats, used on every page and in chat.
2. **Publish gates**: a daily snapshot only publishes if grounding, faithfulness and minimum-evidence checks pass; otherwise the previous snapshot stays live.
3. **Versioned snapshots** with a "what changed since last week" view: new or emerging themes, rising or falling barriers.
4. **`funnel_stage` tag** (awareness / consideration / trust / trial / repeat) so barriers line up with problem framing.
5. **Prevalence vs. intensity** reported separately, with a **bias & limitations panel** (source mix, rating skew, absence problem).
6. **Single evidence store** shared by chat and dashboard, so they can't contradict each other.
7. **Evidence explorer**: filter by category, barrier, source, rating and month, with a link to each original post.
8. **Research bridge**: the engine auto-generates hypotheses to test, a screener and an interview guide for Part 2, and later shows each one as validated or challenged.
9. **Health page**: pipeline runs, failures, Groq quota use and backfill progress.
10. **Chat safety**: review text is treated as untrusted (prompt-injection guard), plus per-visitor rate limits.
11. **Downloadable research brief** (Markdown/PDF) per snapshot. Useful for the deck.
