# Phase C: answering the eight research questions (detailed plan)

2026-11-24 · Status: **plan for approval**. Builds on phases A (tagging) and B (themes, validation). Gaps it closes are listed in [gap-analysis-live-engines.md](gap-analysis-live-engines.md).

## Goal

Publish a **Research Questions** page that answers Q1–Q8 from the brief with findings that are:
- **evidenced:** every number is computed in code from tagged entries and shown with its sample size;
- **cited:** every claim links to at least 3 verbatim, verified quotes, from more than one source where possible;
- **checked:** a different model family confirms each claim is supported by its quotes;
- **honest:** confidence is computed by rules, not by the model; weak fields and missing sources are stated; a question without enough evidence says so instead of guessing.

This is "how insights are generated" from the brief, the one requirement we can't show yet.

## Design principles (carried over and made strict)

1. **The model never does arithmetic.** Code computes every count, share, interval and trend; the model only writes sentences around them.
2. **No number without a source.** Any number in a claim must match a value in that question's evidence pack, or the claim is rejected.
3. **No quote without verification.** Only grounded (verbatim) quotes can be cited, by id. The model can't introduce text.
4. **Publish gates over best effort.** A finding that fails a gate is hidden, not softened. The previous published version stays live.
5. **Fixed budget.** Phase C must fit inside the free tier next to tagging (§8).

## C0. Prerequisite: source-balanced tagging

**Problem:** only 2 of 344 tagged entries state a discovery channel and 2 state a user segment. App-store reviews are about single orders; *discussions* (Reddit now; YouTube and forums later) are where people describe how they shop. Random tagging gives Reddit ~5% of the budget.

**Change:**
- The tagging queue takes **per-source quotas**: each day reserve up to 40% of tagging slots for discussion sources (Reddit, later YouTube and forums) until their relevant backlog is exhausted; the rest goes to app-store reviews. Order within each source stays random, so each source's tagged set is still a random sample of that source.
- Findings report **per-source groups** (app-store reviews vs. discussions) instead of pooling them silently. Where a pooled figure is shown, it is weighted by each source's share of relevant feedback, and the weights are stated.
- **Target before the first publish:** ≥ 1,000 tagged entries, including ≥ 200 from discussions (~2–3 daily runs at ~500 tags/day).

## C1. Evidence packs (code only, no AI)

For each question, a function builds an **evidence pack**: the statistics plus a shortlist of candidate quotes. Every statistic carries `n`, the share, a **95% Wilson interval**, a per-source split and a monthly trend where meaningful.

| Q | Question | Evidence computed from tags | Main fields | Notes |
|---|---|---|---|---|
| Q1 | Why do users repeat the same categories? | Entries with `category_behavior = repeat` or `habit_signal`; what they buy (categories); what they praise or fear; linked themes of kind *habit* / *positive experience* | behaviour, habit, categories, sentiment, themes | Reasons for repeating often appear as praise (speed, reliability) |
| Q2 | What prevents exploring new categories? | Barrier distribution among entries about non-staple categories, or with behaviour *wants but hesitant* / *tried then abandoned*; barriers × category matrix; *exploration barrier* themes | barriers, categories, behaviour, themes | Core question; strongest evidence today |
| Q3 | How do users discover products today? | Discovery-channel distribution (stated only) | discovery_channels | **Thin today (n = 2)**: depends on C0; answered as "early signal" until n ≥ 30 |
| Q4 | What role do habits play? | Share with habit signals; repeaters vs. explorers compared on barriers and sentiment; reorder as a channel | habit, behaviour, barriers | Behaviour field currently lower reliability (κ check, §C3) |
| Q5 | What information do users need first? | Information-need distribution; by category | info_needs, categories | 88 entries today |
| Q6 | What frustrations recur? | Themes ranked by size and intensity (avg rating, % negative), with trends | themes, sentiment, rating | Strong today (6 themes) |
| Q7 | Which segments are likelier to experiment? | Experiment rate (`explored` / `tried` / `wants`) by segment: stated signals + **life-stage proxies** (mentions pet products → pet owner; baby products → parent; beauty/personal care → that shopper type), each proxy labelled as such | segment_signals, categories, behaviour | **Thin today (n = 2 stated)**: proxies plus C0 make it answerable; low confidence until n ≥ 30 per segment |
| Q8 | What unmet needs recur? | The 286+ `unmet_need` statements, embedded and clustered (same method as themes) and named by one model call; ranked by frequency, with examples | unmet_need | Grouping validated like themes |

**Quote shortlist per pack:** up to 25 grounded quotes, chosen in code as the entries most central to each statistic (embedding similarity), spread across sources and months, with ids.

## C2. Insight synthesis (AI)

- One call per question to **gpt-oss-120b** with the evidence pack (statistics as labelled values, quotes with ids).
- Output per question: 2–4 **claim cards**, each with:
  - `claim` (≤ 30 words)
  - `explanation` (≤ 80 words)
  - `stat_keys` (which pack statistics it relies on)
  - `citations` (≥ 3 quote ids from the pack)
  - `caveats` (known gaps, e.g. "based on app-store reviews only")
- Plus one **question summary** (≤ 60 words) written only from the cards that pass the gates.
- Prompt rules: use only the given statistics and quotes; no causal claims beyond what users say; say "insufficient evidence" when a pack is thin.

## C3. Validation gates (publish only if all pass)

| Gate | Check | Type | On failure |
|---|---|---|---|
| G1 Citations | Every cited id is in the pack; ≥ 3 distinct; from ≥ 2 sources where the pack has them | Code | Claim rejected; or confidence capped at Medium if only one source exists |
| G2 Numbers | Every number in claim and explanation matches a pack value (after normalising formats such as 41%, 41.2%, 1,463) | Code | Claim rejected |
| G3 Faithfulness (V5) | **qwen3.8-27b** (different family) scores 0–1 whether the cited quotes support the claim | AI | < 0.7 → claim rejected; score shown on the card |
| G4 Field reliability | Claims relying on a field with V1 κ < 0.6 (today: funnel stage, behaviour) are flagged "lower reliability" | Code | Can't be rated High |
| G5 Evidence size | Confidence by rule: **High** n ≥ 30, interval width ≤ 20 pts, ≥ 2 source groups, faithfulness ≥ 0.85; **Medium** n ≥ 10; **Early signal** otherwise | Code | — |

A question publishes when at least one claim passes; otherwise its card says "Not enough evidence yet" with the current n, and the previous published version (if any) stays.

New validation metrics on the Validation page: **V5 faithfulness** (mean score, % passed), **gate pass rates** (G1/G2 rejections), and claims per confidence level.

## C4. Storage (migration 0010)

- `insight_snapshots` (id, created_at, published, tagged_n, params)
- `insights` (snapshot, question, ord, claim, explanation, confidence, reliability_flag, faithfulness, stats jsonb, caveats, sources)
- `insight_citations` (insight, source, source_id)
- `evidence_packs` (snapshot, question, pack jsonb), kept for audit, so any claim can be traced to the exact numbers it was written from
- Public views: `v_insights`, `v_insight_quotes` (verified quotes only), `v_question_status`

## C5. Website

- **Research Questions** (`/questions`, new nav item):
  - top: the 8 questions as a status grid (confidence, number of findings, evidence n);
  - per question: summary, claim cards (claim, explanation, key numbers with n and interval, per-source split, 3–5 quotes with links, caveats, confidence and faithfulness badges);
  - **coverage matrix**: questions × themes;
  - **Limitations** section: missing sources, sampling, the review-negativity bias, the absence problem (people who never heard of a category don't write about it), model limits, low-reliability fields.
- **Overview:** a short "Key findings" block linking to the questions.
- **Themes:** each theme lists the questions it informs (exists) plus links to the claims that cite it.
- **Validation:** adds V5 and the gate metrics.

## C6. Pipeline integration and budget

- New stage `insights` after `themes` in the daily run.
- **Budget reservation:** today tagging can exhaust gpt-oss-120b's 200K daily tokens before themes and insights run. The Groq client will track each model's last-24-hour use (from `ai_calls`) and stop tagging at **~130K**, leaving ~70K for themes (~10 calls) and insights (8 synthesis calls at ~5K tokens, plus unmet-needs grouping). Qwen's judge calls are small.
- Insights are rebuilt daily; publishing happens only when the gates pass, and only if the evidence changed materially (new tags ≥ 10% since the last snapshot), to avoid churn.

## C7. Tests

- Wilson intervals, shares and per-source weighting on fixtures with known answers
- Each evidence-pack builder (Q1–Q8) on a fixture dataset
- G1 citation and G2 number validators, including tricky formats (1,463 vs 1463; 41% vs 41.2%)
- Confidence rules for every boundary
- End-to-end with a fake model: a passing claim publishes; a claim with an invented number, or invented or too few citations, is rejected; a low faithfulness score hides the claim
- Budget reservation stops tagging at the soft cap

## C8. Quality review before the first publish

- Run on real data once ≥ 1,000 tagged entries exist. Read every card against its evidence pack; tune prompts if needed; record each prompt change and its effect in the walkthrough, as in phases A and B.
- Check that the answers don't simply restate themes, and that Q3 and Q7 honestly show "early signal" if discussion sources are still thin.

## Order and effort

| Step | Work | Depends on |
|---|---|---|
| 1 | C0 source quotas + budget reservation (C6) | — |
| 2 | C4 migration + C1 evidence packs + tests | 1 (needs tags) |
| 3 | Q8 unmet-needs grouping | 2 |
| 4 | C2 synthesis + C3 gates + tests | 2 |
| 5 | C5 Research Questions page, Overview block, Validation additions | 4 |
| 6 | C8 quality review on real data, then publish | 5 + ≥ 1,000 tags |

## Decisions needed

1. **Source quota:** reserve up to 40% of daily tagging for discussion sources (recommended)?
2. **Segment proxies:** OK to infer life-stage segments from categories mentioned (pet → pet owner, baby → parent), clearly labelled as proxies (recommended)?
3. **Quick-commerce discussions (D2, revisited):** keep Reddit to Blinkit threads, or also collect general quick-commerce threads? The brief lists them and Q3/Q7 would benefit; the earlier choice was "Blinkit only".
