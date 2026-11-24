# Walkthrough — Blinkit Discovery Engine

Your reference guide to how this project works and why it's built this way. It's updated as each piece is built, so sections marked _(not built yet)_ are placeholders.

## 0. The project in one minute

Blinkit wants more monthly active customers to buy from at least one **new category** each month. Before proposing anything, we built an engine that reads public user conversations (Play Store, App Store, Reddit). It tags them with an LLM (Groq), finds recurring themes, and has an **insight engine**: you ask a question (the 8 research questions are one click away) and an AI agent looks up the evidence and answers with checked numbers and cited quotes. It also measures how trustworthy those answers are, automatically, with no human in the loop.

- Architecture and decisions: [part1-architecture.md](part1-architecture.md)
- What we learned from other projects: [reference-review.md](reference-review.md)
- Repo: https://github.com/harshit29-4/blinkit-discovery-engine

## 1. Accounts and keys

| Service | Used for | Status |
|---|---|---|
| GitHub | Code, scheduled pipeline (Actions), secrets | ✅ repo created |
| Groq | All LLM calls | ✅ key in `.env`, tested |
| Supabase | Database, vector search, realtime | ✅ project `yauybsgfepcaakhcpugf` (Tokyo), migrations 0001–0002 applied, checks pass |
| Vercel | Hosting the website | ⏳ needed at deploy |

Keys go in `.env` at the project root (local, never committed) and later in GitHub/Vercel secrets. `.env.example` lists every variable.

### Setting up Supabase (~10 minutes, free)

1. **Create the project.** Sign in at https://supabase.com/dashboard (GitHub login is easiest) → **New project**.
   - Organization: your personal one, Free plan.
   - Name: `blinkit-discovery`.
   - Database password: click **Generate a password**, then **save it in your password manager** (you need it in step 4).
   - Region: **South Asia (Mumbai)**.
   - Leave the security options at their defaults (Data API on). → **Create new project**, then wait ~2 minutes.
2. **Project URL.** Click **Connect** at the top of the project (or **Project Settings → Data API**). Copy the URL that looks like `https://abcdefgh.supabase.co` into `.env` as `SUPABASE_URL=`.
3. **API keys.** **Project Settings → API Keys**.
   - Copy the **publishable** key (`sb_publishable_...`) into `SUPABASE_PUBLISHABLE_KEY=`. This one is safe in a browser.
   - Under **Secret keys**, reveal/copy the `default` secret key (`sb_secret_...`) into `SUPABASE_SECRET_KEY=`. It bypasses all security rules: never put it in the website or in chat.
   - If you only see "Legacy API keys" (anon / service_role), those work too: anon → publishable, service_role → secret.
4. **Database connection string** (only used to create tables from this computer). Click **Connect** → **Direct** tab → choose **Session pooler** (works on normal home internet, which is IPv4). Copy the URI. It looks like `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`. Replace `[YOUR-PASSWORD]` with the password from step 1 and paste it into `SUPABASE_DB_URL=`.
5. **Save `.env`** and tell Claude. It then runs (from `pipeline/`):
   ```powershell
   .venv\Scripts\python -m engine migrate           # creates the tables
   .venv\Scripts\python -m engine check-supabase    # verifies keys + security rules
   ```
   `check-supabase` confirms the secret key can write, the publishable key can read the public summary view, and the publishable key **cannot** read raw review rows. None of the checks print your keys.

If the password contains `@`, `:` or `/`, the connection string breaks. Reset it (**Project Settings → Database → Reset database password**) to one with only letters and numbers.

## 2. How data is collected

Code: `pipeline/engine/collectors/`. Every collector turns its source into the same `RawItem` shape (`pipeline/engine/models.py`): source, id, text, title, rating, date (always UTC), link, anonymised author, plus source-specific extras in `meta`.

| Source | File | How | Gotchas we hit |
|---|---|---|---|
| Play Store | `play_store.py` | `google-play-scraper`, newest first, for both the English and Hindi feeds | The library returns *local* time without a timezone, so we convert to UTC. See "Play Store: the 40-character rule" below |
| App Store | `app_store.py` | Apple's public RSS feed, 10 pages × 50 | Only the latest ~500 reviews exist, so frequent runs build up history. Times come with a US offset and are normalised to UTC |
| Reddit | `reddit.py` | Arctic Shift archive: search posts for "blinkit" in 16 Indian subreddits, then pull the comments of threads *about* Blinkit | See "Reddit: how we made it fast enough" below |

### Play Store: the 40-character rule

Blinkit gets about **2,000 English Play Store reviews a day**, roughly 745,000 a year, and about 80% are one-liners like "good" or "nice". Storing all of that text would use a big share of Supabase's free 500 MB and add nothing to the analysis. So (decision 2026-11-23):

- Reviews of **40+ characters** are stored in full (`raw_items`) and analysed.
- Shorter ones become **rating-only rows** (`short_reviews`): a 63-bit hash of the review ID, the day and the star rating. No text. Rating statistics stay complete, and re-runs never double-count because the hashed ID is the primary key.
- If a review is later edited across the 40-character line, it moves tables, so it's never counted twice.

First live pull: 200 kept reviews against 1,025 short ones, and **76% of the short ones are 5★**. The written reviews we analyse lean much more negative than the overall user base. That's a bias the dashboard's bias panel must show ("reviews shout, they don't vote").

### Reddit: how we made it fast enough

The first full backfill was on track to take 3+ hours: after 32 minutes it had reached only the 3rd of 16 subreddits. The causes were measured from the run log:

| Problem (measured) | Fix |
|---|---|
| Every subreddit was searched in 13 fixed monthly windows, even small ones | **Adaptive windows**: search the whole 12 months in one request; only if the server says it's overloaded, split the window in half and try again (recursively, down to ~a week). Small subreddits now take 1 request |
| 72 overload retries, each waiting 5–75 s | A long window gets only one try before splitting (splitting is cheaper than waiting). Only short windows get the full retry-with-backoff budget |
| 60 of 162 threads only mentioned Blinkit in passing (title not about Blinkit). Fetching their comments cost 60 requests for 29 useful comments | Comments are fetched only for threads whose **title** mentions Blinkit. Passing-mention posts are still stored |
| Comment searches scanned from 2005 | They start at the thread's own creation time |
| A re-run re-fetched comments for threads it already had | Threads already stored and older than 7 days are skipped. A post is saved *after* its comments, so "post is stored" reliably means "its comments are stored" |

Every run reports `skipped_threads`, `reused_threads`, `failed_threads` and `failed_windows`. The cursor doesn't advance if anything failed, so gaps get retried.

**Second debugging round (2026-11-23): it's a per-IP rate limit.** Even with the fixes, searches started failing in under a second, even for tiny windows and even after waiting. Reading the response headers showed `x-ratelimit-reset` (seconds until the limit window resets). Cheap ID lookups still worked while searches didn't, so our IP had used up its search budget after the earlier heavy runs. You can't out-wait that inside one run, so the collector now works *across* runs:

- **Per-subreddit frontier**: each subreddit remembers how far back-to-front it has been fully searched (`reddit_sub:<name>` in `source_cursors`). The next run resumes there.
- **Saved as you go**: after each subreddit, the collector emits a `CursorAdvance` marker. The runner stores all buffered items *first*, then saves the frontier, so even a killed run keeps its progress.
- **Honours the server's reset time** (`x-ratelimit-reset`, capped at 65 s) instead of guessing with exponential backoff.
- **Stops early**: if 3 subreddits in a row make no progress, the run ends (`stopped_early`) instead of grinding for hours. The next hourly run, ideally from GitHub's IP, continues.
- A thread whose comments fail caps that subreddit's frontier before the thread, so it's found again next time.

**Two run modes** (`pipeline/engine/collect.py`):
- `backfill`: walk back to the start of the 12-month window. Done once.
- `incremental`: start from where the last run stopped (the per-source **cursor**, minus a 2-day overlap) and fetch only newer items. Runs hourly.

**Safety rules built in:**
- Re-running never duplicates anything: items are upserted on `(source, source_id)`.
- Progress is saved every 100 items, so an interrupted run keeps what it fetched.
- The cursor only moves forward after items are stored, and *not at all* if any search window failed. The next run retries that gap instead of skipping it.
- Each run is logged (`pipeline_runs`), including failed windows, which the Health page will show.
- Usernames are never stored, only a salted hash (`AUTHOR_HASH_SALT`).

**Storage** (`pipeline/engine/store/`): `local` is a SQLite file in `data/` for development, with no accounts needed. `supabase` writes the same tables to Supabase through its REST API. The schema is in `supabase/migrations/` (`0001_collection.sql`: raw items, cursors, run log; `0002_short_reviews.sql`: rating-only rows).

## 3. How the AI stages work (phase A)

Code: `pipeline/engine/ai/`. Run: `python -m engine analyse --stages screen,relevance,tag,translation --minutes 45`.
On GitHub, `.github/workflows/analyse.yml` runs this hourly at minute 40, time-boxed so runs never overlap.

| Stage | What | How | File |
|---|---|---|---|
| S1 Pre-filter | Language (en/hi/hinglish) + keyword screen; 5% control sample | Deterministic, free | `prefilter.py` |
| S2 Relevance gate | Is the entry about what/why people buy, categories, discovery, trust, habit, info needs, returns? | gpt-oss-20b, batches of 20 | `stages.py`, `prompts.py` |
| S3 Tagging + translation | Fixed-taxonomy tags, verbatim supporting quote, English translation | gpt-oss-120b, batches of 8 | `stages.py`, `prompts.py` |
| V8 Translation check | Does the English keep the meaning? | qwen3.8-27b (different family) | `stages.py` |

**Taxonomy:** `web/lib/taxonomy.json` is the single source of truth, read by both the pipeline and the website. Change a key → bump `PROMPT_VERSION`.

**Work queues:** Postgres functions (`ai_queue_*` in `supabase/migrations/0004_ai_tagging.sql`) hand out unfinished work in md5 order, which spreads it across months and sources, so a partial run is still representative. A failing item is retired after 3 attempts.

**Checks built in:**
- **V3 grounding:** the supporting quote must appear verbatim in the original (case, whitespace and curly quotes ignored). Ungrounded answers get one retry; quotes that still fail are never shown.
- **V4 schema:** values outside the taxonomy are discarded and counted (`schema_drops`).
- **V6 keyword recall:** the 5% control sample goes through the relevance gate too, so the How-it-works page can estimate how much relevant feedback the keyword screen misses.
- **V8 translation:** translations that fail the second model's check are kept for counts but never shown or quoted. In testing it correctly failed "fat bhi gaya" → "the fat is gone"; it actually means the packet tore.

**Groq free-tier lessons (all handled in `engine/ai/groq.py`):**

| Limit | How we found it | Handling |
|---|---|---|
| 8,000 tokens/minute per model | Response headers | Waits for the announced reset before a call that wouldn't fit |
| 1,000 requests/day per model | Response headers | Stops the stage cleanly near the end; next run continues |
| **qwen: 1,000 *output* tokens/minute** (not in headers) | A 429 saying "Request too large … OTPM" | Raised immediately (`RequestTooLarge`), no pointless waiting. Tagging moved to gpt-oss-120b (~1,400 entries/hour vs ~300); qwen does the low-output checks |
| Daily token cap | Shows up as a 429 "per day" | `BudgetExhausted`: the stage stops; others continue |

**Confirmed Groq free-tier limits (from the Groq console, 2026-11-24):**

| Model | Requests/min | Requests/day | Tokens/min | Tokens/day | Our use |
|---|---|---|---|---|---|
| openai/gpt-oss-120b | 30 | 1K | 8K | **200K** | tagging, theme naming, stability |
| openai/gpt-oss-20b | 30 | 1K | 8K | **200K** | relevance gate |
| qwen/qwen3.8-27b | 30 | 1K | 8K | **200K** (+ 1K *output* tokens/min, not shown in the console) | translation check, cross-check |
| openai/gpt-oss-safeguard-20b | 3 | 1K | 2K | 200K | not used (too slow) |
| allam-2-7b | 30 | 7K | 6K | 500K | not used (small, Arabic-focused; would need a quality test) |

**Daily budget at these limits** (tokens per entry measured on real runs): relevance ≈ 2,300 entries/day, tagging ≈ 500 entries/day (≈ 4.7k tokens per 12-entry call, including the model's reasoning). Tagging is the bottleneck. One daily run of ~100 minutes uses each model's full allowance (8k tokens/minute → ~25 minutes per 200k tokens, plus waits).

**Scheduling (decision 2026-11-24):** one daily pipeline run (`.github/workflows/daily.yml`, 02:23 IST): collect, then all AI stages, plus runs on request (Actions → daily → Run workflow, or `gh workflow run daily.yml`). Hourly runs were dropped. GitHub's scheduler delayed or skipped most of them, and because AI output is capped per day they added moving parts without adding output. `collect.yml` and `analyse.yml` remain for manual runs of individual parts.

**Prompt iterations (documented because they changed results):**
- `rel-v2`: v1 rejected product return/exchange complaints as "support only". Return policy is part of the risk of trying a new category, so it now counts as relevant (14 of 15 such entries flipped).
- `tag-v2`: v1 guessed a funnel stage from generic praise ("good products" → repeat). Now "none" unless the text describes the stage.
- `tag-v3` + `cross-v2`: the first cross-model scores for funnel stage and behaviour were weak (κ ≈ 0.2), partly because the cross-checker got shorter definitions than the tagger. Both prompts now share `core_field_rules()` verbatim, with explicit definitions for every behaviour and funnel-stage value. Migration 0009 makes the queues re-tag and re-check outdated entries first, and validation scores **only pairs on the current versions** (recorded in the metric's details), so the score measures the models, not the wording.

## 4. How tagging is used on the website

- **Evidence:** filter by AI-assigned barrier, category or funnel stage, or tagged entries only. Each tagged entry shows its AI analysis: sentiment, funnel stage, behaviour, barriers, categories, information needs, unmet need, the verified supporting quote, and a verified English translation for Hindi/Hinglish entries.
- **How it works:** the pipeline with live counts per stage, quality-check results and model usage (calls, entries, tokens; no prompt or response text is stored).
- **Health:** AI runs appear as "AI analysis" with per-stage results (e.g. "stopped: daily model limit reached").

## 5. How themes are found (phase B)

Code: `pipeline/engine/ai/embed.py`, `themes.py`. Daily workflow: `.github/workflows/themes.yml` (02:35 IST).

1. **Embeddings.** Every tagged entry is turned into a 384-number vector with **gte-small**, run locally with ONNX Runtime (free, CPU, ~1 ms per entry). Hindi/Hinglish entries use their verified English translation. Stored in pgvector (`item_embeddings`). `Supabase/gte-small` is the same model Supabase's edge runtime serves, so the phase D agent can embed questions identically.
2. **Clustering.** UMAP (8 dimensions, cosine, fixed seed) then HDBSCAN (min cluster ≈1% of entries). HDBSCAN leaves entries that fit no group as *unassigned* instead of forcing them into a theme; the Themes page reports how many.
3. **Statistics in code:** size, share, average rating, % negative, top barriers and categories, sources, monthly counts.
4. **AI naming:** gpt-oss-120b gets the statistics plus the 12 most central *verified* quotes and returns a name, a description, a kind (exploration barrier, habit, discovery, information need, general friction, positive experience) and which research questions the theme informs. The output is validated (kind and question ids must be valid).
5. **Consolidation:** clustering can split one problem into near-duplicates (e.g. three separate "can't return or refund" groups). One call shows gpt-oss-120b every theme's name, description and top tags and asks which describe the *same problem with the same cause and product scope*; merged groups get their statistics, quotes and name recomputed. It's told to keep themes apart when category or cause differs. On 2026-11-24 it turned 9 clusters into 6 themes: the refund and expired-food duplicates merged, while produce freshness stayed separate from dairy/meat. Centre-to-centre similarity couldn't do this: duplicates scored 0.96, but so did unrelated themes.
6. **Snapshot + publish gate:** each run writes a new snapshot and publishes it only after every theme is named and every row is written, so the site never shows a half-built set. Old snapshots are kept, with the merges recorded in `params.consolidation`.

### Scale fixes (2026-11-24)

| Symptom | Cause | Fix |
|---|---|---|
| Stats views timed out right after migration 0010 | Adding the generated `fts` column rewrote `raw_items`, which reset the visibility map, so the covering indexes could no longer answer from the index alone | `VACUUM (ANALYZE) raw_items`: back to index-only scans. Do this after any migration that rewrites a big table |
| Site build failed on `v_ai_funnel` (7 s) | The view scanned `item_screen` six times and `item_tags` five times | Migration 0014: one pass per table with `FILTER` (0.2 s) |
| Evidence "AI-tagged only" + keyword timed out | `ai_tagged` is computed from a left join, so the planner walked every keyword match looking for the few tagged rows | `v_evidence_tagged` starts from the 344 tagged entries (0.2 s); used whenever a tag filter is set |
| Vercel build failed: "statement timeout" | Dashboard views read every full review row (109k reviews + 368k ratings); public queries are limited to 3 s | Covering indexes (migration 0007): 3.4 s → 72 ms |
| Hourly AI run did no work (HTTP 500 on queues) | Queue functions sorted the whole backlog (1.3–4.6 s idle), over the 8 s API limit under load | Migration 0008: pre-filter reads from a bookmark; relevance/tagging walk an index on a stored random key (all queues < 0.5 s) |
| Whole tagging batch lost on "Failed to generate JSON" | gpt-oss-120b occasionally can't produce valid JSON for a batch | The batch is split in half and retried; only a half that fails again is penalised |
| ~370 entries tagged per day | Groq free tier caps each model at ~200k tokens/day | Batches of 12 (tagging) / 30 (relevance) and shorter outputs; the tagged set is a random sample at every point, with its margin of error shown on How it works |

## 6. How insights are generated: the insight engine (phase C)

Decision (2026-11-24): **no pre-written answers to every question.** The site has an **Ask** page instead: a chat where an AI agent answers questions about the feedback. Plan and decisions: [phase-c-plan.md](phase-c-plan.md).

**How one answer is made** (`web/lib/agent/`, `web/app/api/ask/route.ts`):

1. The question goes to **qwen3.8-27b** on Groq with four **tools** it may call (tool calling). If qwen is busy or its daily allowance is spent, **gpt-oss-20b** takes over; the answer says which model wrote it.
2. The tools are read-only database functions (migration 0010), callable with the public key:

   | Tool | What it returns |
   |---|---|
   | `search_feedback` | Entries matching keywords (full-text index over all 109k entries) and/or AI-tag filters; tagged ones first. Each gets an id (E1, E2…) |
   | `count_feedback` | Counts and shares of tagged entries grouped by a field (barrier, category, segment, month…), with filters. **All arithmetic happens in SQL** |
   | `get_themes` | The current themes with statistics and one quote each |
   | `get_reliability` | The validation results, so the agent can warn when a field is weak (e.g. funnel stage) |

3. At most 4 rounds of tool calls (several tools per round), then the agent writes the answer, citing entries as `[E3]`.
4. **Checks before it's shown** (`web/lib/agent/checks.ts`, unit-tested in `web/tests/`, run with `npm test` in `web/`):
   - **Citations (code):** every cited id must be an entry a tool returned in this answer.
   - **Numbers (code):** every number must appear in the retrieved data, allowing only for rounding (57% matches 0.5727; 197 matches only 197). Small whole numbers like "the top 3" are allowed as ordinary language.
   - **Support (AI judge):** gpt-oss-20b, a different model family, scores 0–1 how far the cited quotes and counts support the claims, and lists unsupported claims.
   - If a code check fails, the agent gets **one rewrite**; anything still failing is shown with the answer, never hidden.
5. Results of every answer's checks (not the question or answer text) go to `chat_log`; the Validation page shows them as **V10**.

**Protection of the free allowance:** each visitor can ask 8 questions per hour and the whole site 40 per day (`chat_guard`); identical single questions are answered from a 24-hour cache (`chat_cache`, only answers that passed the checks). The guard, cache and log functions accept only the **secret key**, which lives on Vercel as a server-only variable, so nobody can fill the cache with made-up answers. Visitors are identified by a salted hash of their IP; the IP itself is never stored.

**Token budget per day (Groq free tier: 200K tokens per model):** the pipeline stops each model at a cap, counted over the last 24 hours from `ai_calls` (which the chat also writes to): gpt-oss-120b 150K (tagging), gpt-oss-20b 110K (relevance), qwen3.8-27b 60K (checks). That leaves ~140K tokens of qwen for the chat (an answer costs about 8–14K) and ~90K of gpt-oss-20b for the fallback and the judge. Only these three chat models exist on the account (checked via Groq's model list), so capacity comes from using fewer tokens, not more models.

**Tested on research questions 2, 3 and 6 (2026-11-24):** answers in 6–7 s. Q6 passed all checks (7/7 citations, 9/9 numbers, 100% support). Q3 ("how do users discover products") showed why the rules matter: only 2 of 344 tagged entries name a discovery channel, and the first version of the prompt let the model say "mainly re-ordering" from those 2. The prompt now requires it to call such evidence thin and to describe searched entries as examples, not as shares. The judge's first version saw no counts (the themes output filled its input), which scored a correct answer 0; counts now go first.

**Discussion-source quota:** Reddit entries were stuck behind 88,000 Play Store reviews in the AI queues (none tagged). Up to 40% of every relevance and tagging batch now comes from discussion sources (migrations 0010–0011), so questions about segments and discovery get Reddit evidence.

## 7. How quality is validated (phases A + B)

Code: `pipeline/engine/ai/validation.py`. Metrics are computed **in code** from stored data and appended to `validation_metrics` (history kept); the Validation page shows the latest of each.

| Check | Method | Shown as |
|---|---|---|
| V1 Cross-model agreement | qwen3.8-27b independently re-tags a deterministic 10% sample (sentiment, behaviour, funnel stage, categories, barriers) | Cohen's κ per field with the Landis–Koch reading; κ < 0.6 flagged "lower reliability"; raw agreement / Jaccard |
| V2 Stars | AI sentiment vs the reviewer's own stars (1–2 = negative, 4–5 = positive; 3-star, Reddit, neutral/mixed excluded) | % agreement + confusion counts |
| V3 Grounding | Supporting quote must be verbatim | % verified |
| V4 Schema | Raw model output re-validated against the taxonomy | % needing no correction |
| V6 Keyword recall | Control-sample relevance rate vs candidate relevance rate | Estimated % of relevant feedback the keyword screen captures |
| V7 Stability | Weekly: production tagger re-tags a fixed 100-entry panel | Exact agreement (sentiment, funnel stage), barrier overlap |
| V8 Translation | Second model family scores each translation | % passed |
| V9 Human | Part 2 interviews | Planned |
| V10 Answer checks | Every Ask answer: citations valid, numbers traced to the data, support score from a second model | % of answers passing, mean support score |

**Cohen's κ in one line:** how much two raters agree beyond what they'd agree by chance (1 = perfect, 0 = chance). For list fields it's computed per label (present/absent) and averaged over labels with enough examples.

### How the hourly run is organised (and why)

The first hourly run spent all 45 minutes on the relevance gate and never reached tagging, because stages ran one after another and the relevance queue was long. Groq's limits are **per model**, so stages now run in **parallel lanes, one per model**:

| Lane | Stages (in order) |
|---|---|
| gpt-oss-20b | relevance |
| gpt-oss-120b | tagging → stability |
| qwen3.8-27b | translation check → cross-check |

The pre-filter runs first. Embeddings, themes and metrics run last in reserved time. A downstream stage whose queue is empty waits (polling every 20 s) while its upstream stage is still producing work, instead of giving up.

## 8. The website

Code: `web/` (Next.js 16.4.6, App Router, TypeScript, Tailwind). Run locally: `npm --prefix web run dev` → http://localhost:3000. It needs `web/.env.local` with `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; Vercel will get the same two.

| Page | What it shows | Data (public views, `supabase/migrations/0003_public_views.sql`) |
|---|---|---|
| Overview `/` | Totals, source table, star-rating mix (incl. short reviews), the **written-reviews-skew-negative bias note**, daily volume (last 90 days) | `v_source_counts`, `v_rating_mix`, `v_daily_volume`, `pipeline_runs` |
| Ask `/ask` | The insight engine: chat with the eight research questions as one-click prompts; each answer shows cited entries, check results and the steps taken | `/api/ask` → agent tools (`search_feedback`, `count_feedback`, `v_themes`, `v_validation`) |
| Evidence `/evidence` | Every analysable item: full-text search (word forms, "phrases"), source/rating/AI-tag filters, link to the original, 25 per page | `v_evidence`, or `v_evidence_tagged` when an AI-tag filter is set (no author info) |
| Health `/health` | **Run the pipeline now** button (passcode + 3-hour cooldown), every run with per-source results and recorded gaps; how far each source / subreddit has collected | `/api/run` (GitHub API), `pipeline_runs`, `v_cursors` |

**How it reads data:** server-side only, via Supabase's REST API with the *publishable* key (`web/lib/supabase.ts`). That key maps to the `anon` role, which can read only the public views and the run log. Raw rows and author hashes stay locked by Row Level Security.

**Caching (this Next.js version is different):** with `cacheComponents` on, every data read must either be cached (`'use cache'` + `cacheLife`) or sit inside `<Suspense>`. All reads in `web/lib/data.ts` use `cacheLife('minutes')`: fresh within ~1 minute, which suits a pipeline that writes hourly. Even "today's date" for the 90-day chart is computed inside the cached function, because reading the clock during rendering is flagged by the framework. The production build prerenders Overview and Health (revalidated every minute) and streams Evidence results per search.

**Brand colours:** the frame (yellow header, black/yellow active tab, green buttons and links) uses Blinkit's widely cited colours: yellow `#F8CB46`, green `#0C831F`, near-black `#1C1C1C`. These are third-party values; Blinkit publishes no official codes. Every pairing was chosen by measured contrast: black on yellow 11:1, green on white 4.9:1, a lightened green `#4CC962` in dark mode. Green text never goes on yellow (only 3.2:1). There's no Blinkit logo, and the header itself says the project isn't affiliated with Blinkit, because brand colours make a site look official.

**Design choices:** chart colours stay on the Okabe–Ito palette (colour-blind safe, unlike yellow/green) and every chart also states its numbers in text; light and dark mode; no text under 14px; tested with no sideways scrolling at 375px phone width (the runs list is stacked rather than a wide table for that reason). The site says it's an independent project, not affiliated with Blinkit.

**Production hardening (2026-11-23), tested against `next build` + `next start`, 42/42 checks passing:**

| Area | What's in place | How it was verified |
|---|---|---|
| Security headers | CSP (static-friendly, no nonces), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS; `x-powered-by` removed (`web/next.config.ts`) | Response headers checked; no CSP errors in the browser console; client navigation still works |
| Secrets | Only `SUPABASE_URL` + publishable key on the web side, read server-side only | Scanned built JS + HTML for every `.env` secret and the publishable key: none present |
| Hostile input | Search capped at 100 chars, regex-escaped, page clamped; firewall-blocked queries show a calm message; pages past the end offer "Go to the last page" | 14 edge cases (SQL-ish, `<script>`, regex chars, 5k chars, Hindi, emoji, bad page/source/rating…) render normally, never the error page |
| Database down | `app/error.tsx` shows "couldn't load its data" + Try again (HTTP 500); prerendered pages keep serving their last good copy | Ran a second production server pointed at a non-existent database |
| 404 | `app/not-found.tsx` with links back | `/definitely-not-a-page` → 404 |
| Accessibility | WCAG contrast fixed (dark-mode button was 2.2:1, now 7:1; chart colours ≥ 3:1), skip-to-content link, labelled charts, landmarks | Contrast computed for 22 colour pairs × 2 themes; accessibility tree inspected |
| Sharing / SEO | Title/description, Open Graph + generated preview card (`app/opengraph-image.tsx`), `robots.txt` (search-result URLs not crawled), absolute `metadataBase` from Vercel's production URL | Checked in HTML |
| Performance | Warm pages 2–30 ms; first-load JS 174 KB gzipped (React/Next runtime; our own client code is just the nav); DB queries 0.3–30 ms at ~14k rows | Timed 5× per page; `EXPLAIN ANALYZE` on Supabase |
| Freshness | Pages are cached and refresh in the background: new pipeline data appears within a few minutes | Watched run #3 appear on Health without a redeploy |

**Search detail (since 2026-11-24):** search uses Postgres full-text search on an indexed `fts` column: English word forms (`refund` finds refunds/refunded), whole words only (`pet` doesn't match "petty"), `"quoted phrases"`, `OR` and `-exclusions`. It replaced a regex search that took 1.4 s for common words. An exact count of a common word (30,000+ matches) takes seconds, so large result totals are the planner's estimate, shown as "About 30,851 results".

## 8b. Deployment (Vercel)

- Project `blinkit-discovery-engine` on the Hobby (free) plan, connected to the GitHub repo. **Every push to `main` deploys automatically**; nothing to run by hand.
- **Live URL: https://blinkit-discovery-engine-six.vercel.app**. The plain `blinkit-discovery-engine.vercel.app` belongs to someone else's project, so Vercel added `-six`.
- Settings (set with the Vercel CLI): Root Directory `web`, framework Next.js, Node `24.x`.
- **Function region `hnd1` (Tokyo)**, set in `web/vercel.json`. Vercel's default is Washington DC (`iad1`), but the database is in Tokyo, so every search crossed the Pacific twice. The search page took ~1.1 s live versus 30 ms locally. Running functions next to the database is Vercel's own recommendation; static parts are still served from the Mumbai edge.
- Environment variables (Production + Preview), piped from `.env` by the CLI and stored as hidden secrets: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (pages); since phase C also `GROQ_API_KEY` and `SUPABASE_SECRET_KEY` (the Ask API: model calls, rate guard, cache), and `REFRESH_PASSCODE` + `GITHUB_DISPATCH_TOKEN` (the run button). All are read on the server only; none reach the browser.
- **Run button setup (one-time):** the passcode is generated into `.env` as `REFRESH_PASSCODE` (look it up there; it isn't in git). The GitHub token: github.com → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token. Repository access: **Only select repositories** → `blinkit-discovery-engine`. Permissions → Repository permissions → **Actions: Read and write** (Metadata: read-only is added automatically). Expiration: up to a year. Paste it into `.env` as `GITHUB_DISPATCH_TOKEN=…`; it is then piped to Vercel. When it expires, the button says "GitHub refused to start the run"; make a new token the same way.
- Data freshness doesn't need redeploys: pages re-read Supabase in the background (about every minute, visible within a few minutes).
- Useful commands (from `web/`, after `npx vercel login`):
  ```powershell
  npx vercel@66.6.0 ls                       # recent deployments
  npx vercel@66.6.0 env ls                   # configured variables (values hidden)
  npx vercel@66.6.0 project inspect blinkit-discovery-engine
  ```

## 9. Running it yourself

From the `pipeline/` folder (one-time setup: `python -m venv .venv` then `.venv\Scripts\python -m pip install -r requirements-dev.txt`):

```powershell
.venv\Scripts\python -m pytest                                              # unit tests (no network)
.venv\Scripts\python -m engine collect --source all --mode backfill --max 200   # small test pull
.venv\Scripts\python -m engine collect --source all --mode incremental          # only new items
.venv\Scripts\python -m engine summary                                      # counts per source
```

`--store supabase` writes to Supabase instead of the local SQLite file (needs the Supabase keys in `.env`).

**On GitHub (automatic):** `.github/workflows/collect.yml` runs hourly (minute 17) with `--store supabase`, using the repo secrets `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `AUTHOR_HASH_SALT`. Start a one-off run (e.g. a backfill) from the repo's **Actions → collect → Run workflow**, or:

```powershell
gh workflow run collect.yml -f mode=backfill -f source=all
```

`tests.yml` runs the unit tests on every push that touches `pipeline/`.

## 10. Common problems and fixes

| Symptom | Cause | Fix |
|---|---|---|
| Reddit `Timeout. Maybe slow down a bit` (HTTP 422) | Arctic Shift is a free, volunteer-run service under load | Long windows are split; short ones retried with backoff. Persistent gaps show as `failed_windows` and are retried next run |
| Reddit backfill very slow | Server load varies a lot by time of day | Check `skipped_threads`/`reused_threads` in the run stats; re-running is cheap because stored threads are reused |
| Reddit `'after' must be a valid date` | ISO dates with fractional seconds are rejected | We send epoch seconds |
| Supabase `PGRST125 Invalid path` | `SUPABASE_URL` was pasted with `/rest/v1/` on the end, doubling the path | The code now strips that suffix automatically |
| `password authentication failed` although the password is right | The password contains `%`. Inside a connection *URL*, `%xx` is decoded as an escaped character, so a different password was sent | `migrate` splits the URL and passes the password exactly as written. Write passwords in `.env` as-is, never URL-encoded |
| `(ECIRCUITBREAKER) too many authentication failures` | Supabase's pooler locks out logins for a while after repeated failures, even correct ones | Don't retry logins in a loop (`migrate` tries once). Wait ~10 minutes |
| Login works on one try and fails on the next, right after a password reset | The new password reaches the pooler's servers one by one | Wait a few minutes; try once |

## Glossary

- **RAG**: retrieval-augmented generation. The model answers only from retrieved reviews and cites them.
- **Embedding**: a list of numbers that captures a text's meaning, so similar reviews end up close together.
- **Cursor**: the newest timestamp a source has been collected up to; incremental runs start from it.
- **Upsert**: insert a row, or update it if it already exists, so re-runs never create duplicates.
- **Cross-model agreement**: two different AI models tag the same review without seeing each other's answer. Where they agree, the tag is more trustworthy; where they don't, it gets flagged.
- **Cohen's κ (kappa)**: agreement between two taggers, corrected for chance. 0.6+ counts as substantial.
- **Grounding**: checking that every quote the AI cites really exists in the source text.
