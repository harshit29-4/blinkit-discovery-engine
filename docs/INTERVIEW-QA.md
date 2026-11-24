# Interview guide: the Category Discovery Engine

Everything you may be asked about this project, with short answers you can say out loud and the detail behind them. Figures are from 24 Nov 2026; the live numbers are on the site.

- Live site: https://blinkit-discovery-engine-six.vercel.app
- Code: https://github.com/harshit29-4/blinkit-discovery-engine
- Deeper reference: [WALKTHROUGH.md](WALKTHROUGH.md) (how each part works) · [phase-c-plan.md](phase-c-plan.md) (the Ask engine design)

---

## 1. The pitch

**In 30 seconds.** Blinkit wants more monthly customers to try at least one new product category. Before proposing features, I needed to know *why* people stick to the same categories. So I built an AI discovery engine that collects public feedback about Blinkit every day (Play Store, App Store, Reddit, YouTube; about 133,000 entries), filters it, tags it with AI, groups it into themes, and lets you ask questions in plain English. Every answer cites real customer quotes, and every number is checked against the database automatically, so the AI can't make things up unnoticed.

**In 2 minutes, add:** it runs entirely on free tiers (Groq and Gemini for AI, Supabase for the database, Vercel for the site, GitHub Actions for scheduling). The hard parts were (1) making the AI trustworthy: two models check each other, quotes must be verbatim, numbers must trace to SQL, and (2) fitting a real pipeline into free AI quotas (200K tokens per model per day). The first findings: trust (quality, expiry, freshness) and return/refund friction dominate the barriers, which points to a "trial with guaranteed easy returns" type of intervention for new categories.

---

## 2. Problem framing

| Question | Answer |
|---|---|
| What is the goal metric? | % of monthly active customers who buy from at least one *new* category in the month. |
| Why research first? | Quick commerce users are habitual (same milk, bread, snacks). Without knowing the barrier (awareness? trust? price? habit?), any feature is a guess. |
| Why public feedback rather than interviews? | Scale and honesty: 133K unprompted opinions over 12 months. Interviews (Part 2) then confirm or challenge what the data suggests; they are the planned check V9. |
| Why these 8 research questions? | They come from the brief: repeat behaviour, barriers, discovery, habits, information needs, frustrations, segments, unmet needs. Each is a one-click question on the Ask page. |

---

## 3. Architecture in one picture

```
 Sources (daily)                  Supabase (Postgres)                     Website (Vercel, Tokyo)
 ───────────────                  ───────────────────                     ───────────────────────
 Play Store  ─┐                   raw_items (133K)  ── public views ──►   Home, Themes, Evidence,
 App Store   ─┤  Python           item_screen       ── RPC tools  ──►     Validation, Pipeline,
 Reddit      ─┼─ collectors ───►  item_tags (AI)                          How it works
 YouTube     ─┘  (GitHub Actions) item_embeddings                         Ask  ──► /api/ask (agent)
                                  themes, validation_metrics, chat_*            │
                                           ▲                                    ▼
                                           │                         Gemini Flash-Lite (answers)
                       AI stages (GitHub Actions, daily) ◄──────────  Groq: gpt-oss-20b/120b, qwen
                       Groq: relevance, tagging, checks
                       local: embeddings, clustering
```

Daily at 02:23 IST (or from the Run button): **collect → pre-filter → AI relevance gate → AI tagging + translation → checks → embeddings → themes → validation metrics**. The Ask engine runs on demand when someone asks a question.

---

## 4. Data sources and APIs

| Source | API / method | How it works | Limits and choices |
|---|---|---|---|
| **Google Play** | `google-play-scraper` (Python library) | Calls the same endpoints the Play web page uses; returns reviews newest first with rating, text, date. No key. | Unofficial, so it can break if Google changes the page. English and Hindi feeds. Reviews under 40 characters ("good", "nice") are kept only as rating counts: ~80% of reviews, so storage dropped ~5×. |
| **App Store** | Apple's public RSS JSON feed (`itunes.apple.com/in/rss/customerreviews/...`) | 10 pages × 50 most recent reviews. No key. | Only the latest ~500 exist, so daily runs accumulate history. |
| **Reddit** | **Arctic Shift** API (a free archive of Reddit) | Search posts mentioning "blinkit" in 16 Indian subreddits, then fetch the comments of threads *about* Blinkit. No key. | Chosen because Reddit's official API now needs approval and has strict limits. Arctic Shift is volunteer-run and rate-limited, so the collector is polite (pauses, honours reset headers), splits long date windows when overloaded, and saves a per-subreddit "frontier" so a long backfill completes over several runs. |
| **YouTube** | **YouTube Data API v3** (free key, 10,000 quota units/day) | 8 searches ("blinkit", "blinkit review", "… haul", "… vs zepto"…); comments and replies only on videos whose *title* names Blinkit. | A search page costs 100 units, a page of 100 comments costs 1, so each run is capped at 4,000 units. First run per search sorts by relevance (to reach back 12 months), later runs by date from a cursor. Titles come HTML-escaped and are unescaped. |

**Common shape:** every collector produces the same `RawItem` (source, id, text, title, rating, date in UTC, link, hashed author, `meta`). Authors are stored only as a salted SHA-256 hash, never the name.

**Idempotency:** writes are upserts on `(source, source_id)`, so re-running never duplicates. Cursors only move forward *after* the items they cover are stored, and never past a gap (a failed window or thread is retried next run).

---

## 5. Database (Supabase)

| Topic | What we did and why |
|---|---|
| **Why Supabase** | Free hosted Postgres with an auto-generated REST API (PostgREST), row-level security and extensions (pgvector, pg_trgm). One service for storage, API and vectors. |
| **Access model** | The website uses the **publishable key** (maps to the `anon` role), which can only read public **views** and call a few read-only **RPC functions**. Raw tables are locked by RLS. The **secret key** is used only server-side: the pipeline, and the Ask API for its rate guard and cache. |
| **Views** | `v_source_counts`, `v_rating_mix`, `v_evidence`, `v_themes`, `v_validation`… The site never touches tables directly; views expose only safe columns (no author hashes). |
| **Migrations** | Numbered SQL files (`supabase/migrations/0001…0015`), applied by `python -m engine migrate`, tracked in a table. Every schema change is reviewable in git. |
| **Indexes** | Covering indexes for the stats views (3.4 s → 72 ms); a GIN full-text index (`fts` column) for search; a stored random key for fair sampling queues; pgvector HNSW for embeddings. |
| **Lessons** | (1) Adding a stored column rewrites the table and resets the visibility map, so index-only scans stop working until `VACUUM`. (2) Postgres only auto-vacuums after inserts of 20% of a table; after 23K YouTube rows the stats views timed out, so `raw_items` now auto-vacuums after 2% (migration 0015). |
| **Time limits** | Public queries are cut off at 3 s; a slow view breaks the site build. Every new view or function is timed as the `anon` role before shipping. |

---

## 6. The AI pipeline, stage by stage

| # | Stage | Tool / model | What it does | Why this way |
|---|---|---|---|---|
| 1 | Pre-filter | Code (no AI) | Detects English / Hindi / Hinglish; keyword screen for categories, discovery, trust, habits, info needs; keeps a reproducible **5% control sample** of skipped entries. | AI quota is scarce, so cheap keywords go first, and the control sample *measures* what keywords miss. |
| 1b | **Learned screen** | Logistic regression on gte-small embeddings (local CPU) | Trained on the relevance gate's own past decisions; scores everything the keywords skipped and promotes likely relevant entries (score ≥ 0.5) to the gate. | Keywords reached only 28% of relevant feedback; with the learned screen it's 78%. No AI tokens. |
| 2 | Relevance gate | **gpt-oss-20b** (Groq) | Yes/no: is this about what or why people buy (vs only delivery/payment/support)? Batches of 30. | Small fast model for a simple decision. |
| 3 | Tagging + translation | **gpt-oss-120b** (Groq) | Fixed taxonomy: sentiment, categories, category behaviour, barriers, funnel stage, discovery channels, info needs, segment signals, unmet need; a **verbatim supporting quote**; English translation for Hindi/Hinglish. | Biggest model for the hardest task. A fixed taxonomy makes tags countable. |
| 4 | Translation check | **qwen3.8-27b** (Groq) | Scores each translation; failures are never shown. | A different model family catches the translator's blind spots. |
| 5 | Cross-check & stability | qwen3.8-27b, gpt-oss-120b | 10% re-tagged by another family (agreement); a fixed panel re-tagged weekly (drift). | Measures reliability instead of assuming it. |
| 6 | Embeddings | **gte-small** (ONNX, runs locally on the GitHub runner) | 384-number vector per tagged entry. | Free and fast; no API needed. |
| 7 | Themes | **UMAP + HDBSCAN**, then gpt-oss-120b | Groups similar entries; entries that fit no group stay unassigned (not forced). The LLM names each group from its most representative quotes and merges duplicates. | Themes are discovered, not predefined. Statistics are computed in code. |
| 8 | Metrics | Code | Validation numbers (section 7) recomputed every run and stored with history. | |

**Prompt versioning:** every tag records its prompt version (`tag-v3`). When the prompt changes, outdated tags are re-done first, and agreement is only computed between outputs of the same version (comparing different prompts was unfair to the models).

**Sampling:** queues walk entries in a fixed random order, so the tagged set is a **random sample** at every point. With 442 tagged entries, a percentage has a worst-case margin of error of ±4.7 points (95% confidence: 1.96 × √(0.25/n)).

**Discussion-source quota:** Reddit and YouTube get up to 40% of every relevance and tagging batch; otherwise ~100K Play Store reviews would drown them (Reddit had zero tagged entries before this).

---

## 7. How we know the AI is right (validation)

| Check | Method | Latest result | How to read it |
|---|---|---|---|
| V1 Cross-model agreement | Different model family re-tags a 10% sample; **Cohen's κ** per field | barriers 0.83, categories 0.81, sentiment 0.63, category behaviour 0.32, funnel stage 0.20 (19 pairs on the current prompt) | Concrete fields are reliable; interpretive fields (funnel stage, behaviour) are weak, so the site and the Ask agent flag them. |
| V2 Stars vs sentiment | AI sentiment vs the reviewer's own 1–2 / 4–5 stars | 96% agree (304) | The AI reads tone correctly. |
| V3 Grounding | The supporting quote must appear verbatim in the text | 98% (442) | Tags are backed by real words; failed quotes are never shown. |
| V4 Schema | Raw output valid against the taxonomy | 97% | |
| V6 / V6b Recall | Relevance rate in the control sample (never filtered) vs the screened-in pools | keywords alone ~28%; **with the learned screen ~78%** | Found a real gap (28%) and fixed it with a classifier trained on the AI's own decisions; the control sample keeps measuring it. |
| V7 Stability | Same panel re-tagged a week later | 90% | Little drift. |
| V8 Translation | Second model scores translations | 81% pass (26) | Failed translations are hidden. |
| V10 Ask answers | Citations valid, numbers traced, support score | 12 answers: 100% citations, 100% numbers, mean support 0.76 | |
| V9 Human | Interviews (Part 2) | Planned | |

**Cohen's kappa in one line:** agreement between two raters after removing the agreement you'd expect by chance (1 = perfect, 0 = chance). Landis & Koch: 0.41–0.60 moderate, 0.61–0.80 substantial, above 0.80 almost perfect.

---

## 8. The Ask engine (AI agent)

**What it is:** a chat where you ask a question; an AI agent looks up the evidence itself and answers with citations.

**How one answer is made:**
1. The question goes to **Gemini 3.5 Flash-Lite** (Google, free tier) with 4 **tools** (tool/function calling):
   - `search_feedback`: full-text search over all 133K entries plus AI-tag filters; returns entries with ids E1, E2…
   - `count_feedback`: counts and percentages of tagged entries grouped by a field. **All arithmetic is done in SQL**, never by the model.
   - `get_themes`, `get_reliability`: themes with statistics; the validation results.
2. Up to 4 rounds of tool calls (several per round), then the answer with citations like [E3].
3. **Checks before showing it:**
   - Code: every cited id was really returned by a tool; every number in the answer appears in the tool results (allowing only rounding: 57% matches 0.5727, 197 matches only 197); an answer that cites nothing despite retrieved entries fails.
   - AI judge: **qwen3.8-27b** on Groq (a different company's model) scores how far the evidence supports the claims and lists unsupported ones.
   - A failing answer gets one rewrite; anything still failing is **shown with the answer, never hidden**.
4. Only fully clean answers are cached for 24 hours.

**Why an agent instead of pre-written answers?** Pre-written answers go stale and can't handle follow-ups. The agent answers anything the data covers, and the checks make it trustworthy.

**Fallbacks:** if Gemini is overloaded (it often returned "high demand" on day one), out of quota or slow (15 s timeout), the answer moves to Groq gpt-oss-20b, then gpt-oss-120b. The answer says which model wrote it.

**Why not qwen as the answering model?** It allows only 8,000 tokens per minute, and each agent round costs ~4,000 (prompt, tool definitions, reserved reply). An answer needs 3–5 rounds in seconds. One judge call (~3K) fits, so qwen judges.

**Abuse protection:** 8 questions per visitor per hour, 60 per day site-wide; visitors identified by a salted hash of their IP (never stored raw); the guard, cache and log functions only accept the secret key, so nobody can poison the cache.

---

## 9. Free-tier engineering (a favourite interview topic)

| Limit | Problem it caused | Solution |
|---|---|---|
| Groq: 200K tokens/day **per model**, 8K tokens/minute | Sequential stages starved tagging; one model's quota sat idle while another waited | **Parallel lanes, one per model**, cycling through their stages in 5-minute slices |
| Same 200K/day shared by pipeline and chat | On day one the pipeline spent everything and chat questions failed | **Daily caps** per model for the pipeline (20b 90K, 120b 150K, qwen 60K, from a 24-hour usage log) + qwen keeps 4K tokens/min free for the judge + Gemini (separate quota) answers first |
| qwen's hidden 1,000 output tokens/minute | Tagging batches failed with "request too large" | Moved tagging to gpt-oss-120b; qwen only does short checks; that error fails fast instead of retrying |
| YouTube 10,000 units/day | Searches cost 100 each | 4,000-unit budget per run, cursors per search |
| Arctic Shift rate limits | Long backfills stalled | Adaptive date windows, per-subreddit frontiers, stop after 3 stalled subreddits and resume next run |
| Supabase 3 s query limit for the public | Site builds failed | Covering indexes, single-pass views, a tagged-only evidence view, estimated counts for huge searches, browsing capped at page 200 |
| Vercel 60 s per request | Slow model waits | After 30 s the agent stops calling tools and writes its answer |

**Cost: ₹0.** Every service is on its free tier.

---

## 10. Scheduling and operations

- **GitHub Actions** runs `daily.yml` at 02:23 IST: collect (all sources), then the AI stages (up to 100 minutes). Hourly runs were tried and dropped: the AI work is capped per day anyway, so more runs only added moving parts (GitHub's scheduler also delays or skips busy hours).
- **Run button** (Pipeline page): starts the same workflow through GitHub's API. Needs a passcode (constant-time comparison, delay after a wrong one), refuses if a run is active or started within 3 hours, and uses a **fine-grained token** limited to this one repository with only "Actions: read and write".
- **Health page:** every run with per-source counts, failures and gaps; cursors show how far each source has collected.
- **Tests:** 75 pipeline tests (pytest; collectors with fake HTTP, AI stages with a fake model, validation maths) and the answer-check unit tests (Node's built-in runner); both run in CI on every push. A production check script (`scripts/prodcheck.py`, 53 checks: status codes, latency, security headers, secrets not leaked, hostile inputs) is run against the live site.

---

## 11. Website

| Choice | Why |
|---|---|
| **Next.js 16** (App Router, cache components / partial prerendering) | Pages are prerendered and refreshed in the background every minute; dynamic parts (search results) stream in. Server-only data access: no keys reach the browser. |
| **Vercel, region Tokyo (hnd1)** | The database is in Tokyo; the default US region made each search cross the Pacific twice (1.1 s → ~0.3 s). |
| **Design** | Follows blinkit.com's own palette (read from its live CSS): yellow #F8CB46, green #0C831F, grey panels #F8F8F8, pale blue category tiles; Plus Jakarta Sans as the closest free match to Blinkit's "Okra" font. Header ask bar like Blinkit's search; bottom tab bar on phones like the app. No Blinkit logo, and the header says "independent project". |
| **Accessibility** | Measured WCAG contrast for every colour pair, light and dark mode, no text under 14 px, charts in the colour-blind-safe Okabe–Ito palette with numbers in text, no sideways scrolling at 375 px. |
| **Simplicity** | Each page has one line of context; all explanations live on How it works, linked from every page. |
| **Security** | CSP and security headers, input caps, a firewall-blocked search shows a calm message instead of an error page, secrets scanned out of the built JavaScript. |

---

## 12. Findings so far (be careful how you phrase these)

From 442 AI-tagged entries (a random sample; ±4.7 points):
- **Quality and trust doubts: 49%**, **return/refund friction: 29%**, **expiry/freshness: 26%**, **price and fees: 12%** of tagged entries.
- Biggest theme: "No clear return or refund process" (122 entries); then expiry fears for food (45) and produce freshness (35).
- **Discovery channels and segments are rarely mentioned** in reviews (under 2% of entries). That's a finding in itself: reviews describe problems, not how people discover products, so Part 2 interviews must cover discovery.
- Implication worth testing: for a *new* category the perceived risk is "what if it's bad and I can't return it?", so an easy-return guarantee for first purchases in a category could lower the barrier.

Say "suggests" and "in the tagged sample", not "proves" or "all users". Written reviews skew negative (5-star share is much higher in short reviews than in the long ones the AI reads).

---

## 13. Problems I hit and how I solved them (pick 3 for "tell me about a challenge")

0. **Low recall, found by measuring.** A 5% control sample of entries the keyword filter skipped showed the filter reached only 28% of relevant feedback. I trained a classifier on the AI gate's own past decisions (embeddings + logistic regression, AUC 0.88, cross-validated), scored the 85,000 skipped entries in 19 minutes on CPU, and raised recall to 78% without spending AI tokens.
1. **"It's not really AI-powered."** The first version was a dashboard. I rebuilt it around AI stages with measurable checks, and later replaced pre-written answers with an agent.
2. **AI agreement looked terrible (κ ≈ 0.2).** Part of it was unfair: tags and cross-checks used different prompt wordings. I versioned prompts, re-tagged, and compared like with like. Concrete fields rose to 0.8; interpretive fields stayed weak, and I report that openly.
3. **The chat and the pipeline fought over the same free quota.** Live questions failed on launch day. Fix: per-model daily caps, a per-minute reserve, a second provider (Gemini) for answers, waiting out short rate limits, and a fallback chain.
4. **A wrong answer got cached.** The judge flagged a misread count but the overall score (0.9) still passed. I changed the rule: only answers with zero flagged claims are cached, and flagged claims are always shown.
5. **The site broke after big data loads** (statement timeouts). Root cause: Postgres visibility map and autovacuum thresholds. Fixed with VACUUM plus a table setting, and documented as a rule.
6. **Reddit and YouTube were invisible to the AI** because random sampling from 100K Play reviews almost never picked them. Fixed with a 40% discussion-source quota.
7. **Duplicate themes** ("refund issues" and "return problems"): centroid similarity couldn't separate true duplicates, so an LLM consolidation step merges groups that describe the same problem.

---

## 14. Trade-offs and limitations (say these before they're asked)

- **Small tagged sample** (442 of an estimated ~10K+ relevant entries), limited by free AI quotas; margins of error are shown.
- **The AI relevance gate is the bottleneck**: after the learned screen raised recall to ~78%, ~39,000 entries wait at ~900 checks a day. The tagged set stays a random sample, so findings are unbiased but grow slowly.
- **Funnel stage and category behaviour tags are unreliable** (κ 0.2–0.3); answers are told to treat them with care.
- **Review data is biased:** negative, Play Store-heavy, and self-selected. It says little about discovery or segments.
- **Unofficial sources** (Play scraper, Arctic Shift) can break without notice; the run log and Health page make that visible.
- **Free-tier AI** availability varies (Gemini overload, Groq daily caps); the fallback chain keeps answers coming but not always from the same model.

---

## 15. Likely interview questions, with answers

**Product**
- *Why does this matter to Blinkit?* More categories per customer raises basket size and retention; habits are the main obstacle, so understanding the barrier is step one.
- *What would you build first, based on this?* A low-risk trial for a new category: easy, visible returns and freshness guarantees on first purchase, tested as an A/B experiment on the new-category-per-month metric.
- *How would you measure success?* Primary: % of MAU buying from ≥1 new category per month. Guardrails: return rate, refund cost, NPS. Secondary: repeat purchase in the new category within 30 days.
- *What did the data not tell you?* How people discover products and which segments experiment: reviews rarely mention it. That's what interviews are for.

**AI and data science**
- *How do you stop the LLM from hallucinating?* Grounding (verbatim quotes), fixed taxonomy, numbers only from SQL, citation and number checks in code, a second model as judge, and showing failures instead of hiding them.
- *Why several models?* Different families make different mistakes; using one to check another measures reliability. And each model has its own free quota.
- *What is Cohen's kappa and why not plain accuracy?* There's no ground truth, only two raters. Kappa removes chance agreement, which matters when one label (e.g. "negative") dominates.
- *Why UMAP + HDBSCAN?* UMAP reduces 384-dim embeddings to a space where density clustering works; HDBSCAN finds clusters of any shape, doesn't need the number of clusters upfront, and leaves outliers unassigned.
- *Why not let the LLM create themes directly?* It would invent and drift; clustering is reproducible and the LLM only names and merges groups, with statistics computed in code.
- *How did you choose the sample size?* Budget-bound; I report the margin of error (±4.7 points at 442) rather than overstate precision.
- *What is RAG here?* The Ask agent retrieves evidence through tools (full-text search, SQL counts) before answering: retrieval-augmented generation with tool calling, plus verification.
- *How did you improve recall without more AI calls?* Section 13, story 0: a learned screen (logistic regression on embeddings) trained on the expensive model's own labels: a cheap model learns from the expensive one (a form of distillation / weak supervision).
- *How do you know the learned screen works?* 5-fold cross-validation (AUC 0.88), and the control sample it never touches: 69% of relevant non-keyword entries caught at 74% precision.
- *Why keyword search and not vector search for the agent?* Keyword + tag filters were enough, faster and free; semantic search is a planned upgrade.

**Engineering**
- *Walk me through the architecture.* Section 3.
- *How does the daily schedule work?* GitHub Actions cron; collect then analyse; idempotent upserts; cursors resume from where the last run stopped.
- *How do you keep secrets safe?* `.env` locally (gitignored), GitHub secrets for Actions, Vercel environment variables (server-only); a build-time scan confirms none reach the browser; the public key can only read views.
- *What happens if a source breaks?* That source's error is recorded in the run log, others continue, the run is marked "partial", and the Health page shows it. Cursors don't move past gaps.
- *How did you make search fast?* A generated full-text column with a GIN index, planner-estimated counts for huge result sets, a tagged-only view that starts from the small table, and functions planned with the actual search words.
- *Why Supabase/Vercel/Groq?* Free, managed, fast to build on; Groq is very fast inference for open models; Gemini added for a separate answer quota.

**Process**
- *How did you work?* Small phases (A: AI stages, B: themes and validation, C: the Ask engine, then sources and UI), each planned in `docs/`, tested, deployed and verified live; decisions recorded in the walkthrough.
- *What would you do differently?* Measure keyword recall on day one (it turned out low), and design for shared AI quotas from the start.

---

## 16. What's next

See the end of [WALKTHROUGH.md](WALKTHROUGH.md) for the current roadmap. In short: increase relevance-gate throughput (recall itself is now ~78%), grow the tagged sample, add semantic search to the agent, run the Part 2 interviews to validate findings (V9), and turn the findings into the Part 3 problem statement and Part 4 MVP.
