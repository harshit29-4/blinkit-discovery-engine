# Gap analysis: our engine vs. 7 live reference engines, against the brief

Reviewed live on 2026-11-24. References are for learning only; nothing is copied.

## 1. What the reference engines do

| # | Engine | Data | Strong points | Weak points (observed live) |
|---|---|---|---|---|
| 1 | nl-blinkit-project.vercel.app | 6,384 comments (App Store 2,065, Play 4,276, Reddit 43) | **Answers Q1–Q8** with support levels (strong / fair / early signal); **segments most open to trying** (new parents, pet owners vs. everyday grocery shoppers); "check for new comments" button | Pattern-based (keyword) analysis; Reddit tiny |
| 2 | ai-powered-discovery-engine.vercel.app | Play, App Store, YouTube, Reddit | Pipeline control panel with live run log; **RAG chat**; architecture page explaining each stage as *engineering how* + *product why* | **Dashboard shows all zeros / "Loading…"** (backend down); "94% confidence across 12 validation agents" has nothing behind it on the page |
| 3 | blinkit-review-analyser.vercel.app | User-run scrapes | Interactive scrape → pre-flight → process; source picker lists **every source type in the brief** incl. forums, X, product-page reviews, q-commerce feeds; region + rating filters | On-demand tool, no standing dataset; some sources may be simulated |
| 4 | blinkit-reviews-engine.vercel.app | 1,411 (91% Play) | Separates *general friction* from *exploration barriers*; "absence problem" note | Frozen snapshot; chat answers with **no citations**; chat contradicts dashboard (reviewed earlier) |
| 5 | blinkitreviewanalyzer…streamlit.app | 41,176 scraped → 4,110 classified; Play 3,662, **YouTube 252**, **q-comm threads 121**, App Store 57, **product reviews 18** | **RAG chat with Q1–Q8 one-click prompts, numbered citations and counts**; **research-question coverage** (each Q covered by N themes); most-mentioned / most-negative / most-positive highlights; "fetch new reviews" | ~30 s per answer |
| 6 | blinkit-discovery-engine…streamlit.app | 217 reviews, 6 themes | **Global filters** (date, sentiment, source); pages for **segment breakdown, unmet needs, research synthesis**, AI chatbot | Very small dataset |
| 7 | blinkit-graduation-project-review-d.vercel.app | — | Q1–Q8 cards with **confidence and known gaps**, failed answers hidden, **"Limits of this analysis"** section | **Nothing loads** ("not run" everywhere) |

## 2. Our engine against the brief

| Brief item | Ours today | Gap | vs. references |
|---|---|---|---|
| AI-powered, at scale | ✅ 109k collected; AI relevance, tagging, translation, themes, cross-checks | Tagged only 344 so far (Groq free daily caps) | #5 classified 4,110 |
| App Store reviews | ✅ 528 | Apple's feed shows only recent ~500 | On par |
| Play Store reviews | ✅ 102,939 (+368k rating-only) | — | **Far larger** than any reference |
| Reddit discussions | ✅ 5,835 posts + comments | Under-tagged (~5% of tagging budget) | Larger than #1, #4 |
| Community forums | ❌ | Planned (D3 yes) | #3 lists, #7 claims |
| Social media | ❌ | YouTube planned (D1 yes) | #2, #5 have YouTube |
| Product reviews | ❌ | Not covered | #5 (18), #3 lists |
| Quick-commerce discussions | ⚠️ Blinkit threads only (D2) | General q-comm threads excluded by choice | #5 has 121 q-comm threads |
| Q1 why same categories | ⚠️ tags + themes, **no written answer** | Phase C | #1, #5, #7 answer all 8 |
| Q2 what prevents exploring | ⚠️ barriers + themes, no answer | Phase C | |
| Q3 how users discover | ❌ **2 of 344** tagged entries state a channel | App reviews rarely say it → needs Reddit/YouTube/forums | |
| Q4 role of habits | ⚠️ habit signal tagged, no answer | Phase C | |
| Q5 info needed before trying | ⚠️ 88 entries with info needs, no aggregate | Phase C | |
| Q6 recurring frustrations | ✅ themes (6) | Written answer missing | |
| Q7 segments more likely to experiment | ❌ **2 of 344** state a segment | Needs discussion sources + behavioural/life-stage proxies (pet / baby categories) | #1, #6 have segment views |
| Q8 unmet needs | ⚠️ 286 unmet-need statements, not aggregated | Group + rank | #6 has an unmet-needs page |
| Demonstrate data gathering + analysis | ✅ How it works (live counts), Health | Add *why it matters* framing (idea from #2) | Ahead: live, honest numbers |
| Demonstrate theme identification | ✅ Themes (embeddings + clustering + AI naming + consolidation) | Research-question coverage view (idea from #5) | Ahead |
| Demonstrate insight generation | ❌ | **Phase C** | Behind #1, #5 |
| Demonstrate validation | ✅ V1–V8 live, κ, stars, grounding, stability, translation | Limitations section (idea from #7) | **Clearly ahead**: others assert confidence, we measure it |
| Ask / RAG agent | ❌ | Phase D | #2, #4, #5, #6 have chat |

**Where we're ahead:** the largest real dataset; Hindi and Hinglish handled with checked translations; measured validation (no other engine shows κ, star agreement, verbatim-quote checks or stability); versioned, consolidated themes; a hardened, formal live site (44/44 production checks). Three of the seven references are partly or fully broken right now.

**Where we're behind:** no written answers to the eight questions, no segments or unmet-needs views, no chat or agent, missing source types, and slow tagging (free-tier caps).

## 3. Plan to close the gaps (in order)

1. **Stratified tagging by source** (quick, high impact): reserve a share of each day's tagging budget for Reddit, and later YouTube and forums, so the discussion sources that answer Q3 and Q7 are covered. Report the sample per source.
2. **Phase C: Research Questions page**: one card per question (Q1–Q8): the answer, evidence counts computed in code, confidence, cited verified quotes, known gaps; publish gate (grounding + faithfulness judge); a **coverage matrix** (questions × themes); and a **Limitations** section (sources, sampling, bias, the absence problem).
3. **Aggregates feeding the answers** (code, no AI): discovery channels (Q3), habit signals (Q4), information needs (Q5), unmet needs grouped and ranked (Q8, one AI grouping call), segments (Q7) from stated signals plus documented life-stage proxies (pet / baby / personal-care categories), each with its sample size.
4. **Phase D: Ask agent**: RAG + tools with numbered citations, Q1–Q8 one-click prompts, refuses without evidence, rate-limited.
5. **Sources (phase E)**: YouTube comments (social media), consumer-complaint forums, product reviews (forum and complaint sites that review products), and a revisit of q-commerce discussions (decision D2).
6. **Reliability**: an hourly trigger that doesn't depend on GitHub's delayed scheduler (pending your decision); a refresh button on Health.
