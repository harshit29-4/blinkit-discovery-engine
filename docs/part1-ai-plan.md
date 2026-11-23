# Part 1: making the engine AI-powered (gap audit + build plan)

2026-11-23. Status: **phase A built and deployed** (see WALKTHROUGH §3); phases B–E planned. It refines §5–§9 of [part1-architecture.md](part1-architecture.md) using what we now know: real data volumes, Groq limits, the live site.

## 1. Honest audit: where we are

What exists today is the **data layer**: collectors, database, scheduler, and a website that displays collected feedback. **No AI is used anywhere yet.** The Groq key is tested but unused. Against the brief, that's the plumbing, not the engine.

| Brief requirement | Today | Gap |
|---|---|---|
| AI-powered system analysing feedback at scale | ❌ No AI in the pipeline or site | The core of this plan |
| App Store reviews | ✅ ~500 latest (Apple's feed limit), hourly | — |
| Play Store reviews | ✅ 36,913 with text + 1,00,000+ rating-only, backfill running | — |
| Reddit discussions | ⏳ Code works; queued behind the Play Store backfill | Lands automatically |
| Community forums | ❌ Planned (consumercomplaints.in), not built | Build collector, **decision D3** |
| Social media conversations | ❌ X dropped (no free API); YouTube skipped | **Decision D1** |
| Product reviews | ❌ Not covered | **Decision D3** |
| Quick-commerce discussions | ⚠️ Only Reddit posts that say "blinkit" | **Decision D2**: broaden Reddit terms |
| Answer the 8 research questions | ❌ | AI insight synthesis per question |
| Show how data is gathered and analysed | ⚠️ Health page shows collection only | "How it works" page with live counts per AI stage |
| Show how themes are identified | ❌ | AI theme discovery + Themes page |
| Show how insights are generated | ❌ | Insight cards with citations + method notes |
| Show how quality was validated | ❌ | Automatic validation suite + Validation page |
| Use of agents / RAG (suggested stack) | ❌ | Tool-using research agent ("Ask the engine") over the tagged data |

## 2. The AI pipeline to build

Each stage writes its outputs and run stats to Supabase, so the website can show the funnel live. Every LLM call is batched, rate-limit aware, resumable and cached by `(item, model, prompt_version)`.

```
collected feedback (36.9k and growing)
  │
  ├─ S1 Pre-filter (deterministic, no AI)   language detect · dedupe · keyword screen
  │        → ~13% "candidates" (4,961 today)  + a 5% random sample of the rest (to measure what keywords miss)
  │
  ├─ S2 AI relevance gate    gpt-oss-20b     "is this about what/why people buy, categories, discovery, trust, habit?"
  │
  ├─ S3 AI tagging + translation   qwen3.8-27b   strict JSON per entry:
  │        categories · category_behavior · barriers · funnel_stage (aware→consider→trust→try→repeat)
  │        · discovery_channel · habit_signal · info_needs · segment_signals · unmet_need
  │        · sentiment · evidence_span (verbatim quote) · English translation for Hindi/Hinglish
  │
  ├─ S4 Embeddings           gte-small (free, runs in GitHub Actions) → pgvector
  │
  ├─ S5 AI theme discovery   clustering (UMAP + HDBSCAN) → gpt-oss-120b names each cluster from its
  │        most representative quotes → themes with size, rating intensity, monthly trend, source spread
  │
  ├─ S6 AI insight synthesis  per research question: code computes the statistics (the LLM never does
  │        arithmetic) → gpt-oss-120b writes 2–4 claim cards, each citing ≥3 entries
  │        → publish gates (§3) → versioned snapshot
  │
  └─ S7 AI research agent ("Ask the engine")  Groq tool-calling agent with tools:
           search_feedback (vector + keyword) · count_by_tags (SQL aggregates) · get_themes · get_insights
           → answers with numbers + cited quotes; says "not enough evidence" instead of guessing
```

**Why this counts as AI-powered rather than "a chatbot on top":** the AI reads every relevant entry and turns it into structured data. It discovers themes nobody pre-defined, writes the findings, checks its own work with a second model family, and answers new questions as an agent that queries the data. Code handles counting and arithmetic; AI handles meaning.

## 3. Validation (all automatic; approved earlier, now with concrete gates)

| Check | Method | Gate |
|---|---|---|
| V1 Cross-model agreement | 10% of tagged entries re-tagged by gpt-oss-120b; per-field agreement and Cohen's κ | Fields with κ < 0.6 shown as "low reliability" |
| V2 Star-rating check | AI sentiment vs the reviewer's own stars | Reported as accuracy against non-AI ground truth |
| V3 Grounding | Every evidence span and cited quote string-matched to the source text | Ungrounded tags re-tried; ungrounded citations block publishing |
| V4 Schema conformance | Strict JSON schema + taxonomy enums | Invalid output repaired or re-tried |
| V5 Faithfulness judge | The other model family scores each insight against its cited quotes | Below threshold → insight hidden |
| V6 Keyword-recall check | The relevance gate also runs on a random 5% of non-candidates | Shows how much the keyword screen misses |
| V7 Stability | Fixed 100-entry panel re-tagged weekly; theme bootstrap | Week-over-week agreement shown |
| V8 Translation QA | Second model checks meaning on every translated entry | Failures kept for counts, never quoted |
| V9 Human research | Part 2 interviews mark each insight validated / challenged | Shown once interviews exist |

## 4. Website additions

| Page | Shows |
|---|---|
| **Research Questions** | The 8 questions from the brief, each with claim cards: claim · evidence count · source spread · confidence · quotes · caveats |
| **Themes** | AI-discovered themes: size, intensity, trend, quotes; filterable |
| **Segments** | Who experiments vs. who stays habitual (from stated segment signals) |
| **Ask** | The research agent, with visible tool steps ("searched 412 entries, counted barriers…") and citations |
| **Validation** | V1–V9 results, live |
| **How it works** | The pipeline with live counts per stage (source for the deck's 1-slider) |
| Evidence (existing) | Gains filters by AI tags: barrier, category, funnel stage, theme |

## 5. Budget (Groq free tier)

Measured limits: 1,000 requests/day and 8,000 tokens/minute **per model**. The daily token cap is not exposed in headers (**[OPEN] please read it from console.groq.com/settings/limits**).

- Tagging cost measured 2026-11-22: qwen ≈ 175 output tokens per entry. Batches of 10 ≈ 2.6k tokens per call ≈ 3 calls/min ≈ **~1,800 entries/hour** at the TPM ceiling.
- Scope: candidates from a full year ≈ 13% of ~100k+ long reviews ≈ **10–15k entries**, plus a 5% control sample. At the free limits that's roughly **1–3 days of unattended hourly runs**, then only new entries.
- The work is split across model families (qwen tags, gpt-oss-20b gates, gpt-oss-120b judges and synthesises), so each stays within its own per-model limits.
- If the daily token cap turns out to be low, the plan degrades gracefully: tag the candidates newest-first and a fixed stratified sample per month, and report coverage honestly on the How-it-works page.

## 6. Build order (each phase ships to the live site)

| Phase | Delivers | Visible result |
|---|---|---|
| **A** | S1 pre-filter · S2 relevance gate · S3 tagging + translation · V3/V4/V6/V8 | Evidence gains AI tag filters; How-it-works funnel page |
| **B** | S4 embeddings · S5 themes · V1/V2/V7 | Themes page; Validation page (first metrics) |
| **C** | S6 insights + publish gates + snapshots · V5 | **Research Questions page answering all 8 questions** |
| **D** | S7 research agent (RAG + tools) | Ask page |
| **E** | Segments page · Part 2 bridge (hypotheses, screener, interview guide) · source expansion per decisions | Segments page; research kit |

New secrets: `GROQ_API_KEY` goes to **GitHub Actions** (pipeline) and to **Vercel** (the Ask agent only, server-side, with a per-visitor rate limit so visitors can't drain the free quota).

## 7. Decisions (2026-11-23)

- **D1 Social media → YouTube: YES.** Comments on Blinkit haul/review videos via the free YouTube Data API key (reverses the earlier skip). Built in phase E; key setup in WALKTHROUGH §1.
- **D2 Quick-commerce discussions → NO broadening.** Reddit stays "Blinkit mentions only". Quick-commerce discussion is covered to the extent Blinkit threads discuss it; the deck states this scope choice.
- **D3 Forums & product reviews → YES.** Polite, low-volume collector for consumer-complaint forums (consumercomplaints.in; MouthShut to be checked), public pages only, robots.txt respected. Built in phase E.
- **D4 Groq daily token limit: [OPEN]** please read it from console.groq.com/settings/limits.
- **Phase A approved and built (2026-11-23).** Tagging model switched to gpt-oss-120b after discovering qwen's 1,000 output-tokens/minute cap; qwen now does checks.
