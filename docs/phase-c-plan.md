# Phase C: the insight engine (ask the AI, get checked answers)

2026-11-24 · Status: **approved and in progress** (v2; replaces the earlier plan for pre-written answers to all eight questions).

## What changed and why

The first plan pre-generated answers to all eight research questions. Decision (2026-11-24): **no blanket pre-written insights.** Instead, an **insight engine**: you ask a question in a chat, and an AI agent looks up the evidence itself and answers with checked numbers and verified quotes. The eight research questions from the brief are one-click suggestions. This also delivers the "agents / RAG" part of the brief.

Decisions taken (self-approved 2026-11-24):
- Discussion-source quota for tagging: **yes**, up to 40% of daily tagging.
- Segment stand-ins (pet products → pet owner, baby products → parent): **yes**, always labelled as stand-ins.
- Quick-commerce discussions: **unchanged**, Reddit stays Blinkit-only (decision D2).
- An in-app **Run pipeline now** button, protected by a passcode and a cooldown.

## How an answer is produced

```
question ──► agent (Gemini 3.5 Flash-Lite; Groq gpt-oss-20b/120b as fallback; tool calling, ≤ 4 rounds)
               │  tools (read-only database functions; numbers computed in SQL):
               │   • search_feedback   full-text search + filters (source, barrier, category, theme, rating…)
               │   • count_feedback    counts and shares of tagged entries by a field, with filters
               │   • get_themes        current themes with their statistics
               │   • get_reliability   validation results (which fields are reliable)
               ▼
           draft answer with citations [E1], [E2] … to entries the tools returned
               │
               ├─ C1 citation check (code): every cited entry was returned by a tool in this turn
               ├─ C2 number check   (code): every number in the answer appears in a tool result
               ├─ C3 faithfulness   (qwen3.8-27b on Groq, a different company's model): do the cited quotes support the answer? 0–1
               ▼
           answer card: text · key numbers with sample sizes · cited quotes (with links) ·
                        "how this answer was built" (tool steps) · check results
```

If a check fails, the agent gets one repair attempt; if it still fails, the answer is shown with the failure stated, never silently. Questions outside the data's scope get "the collected feedback doesn't cover this".

## Building blocks

| # | Piece | Where |
|---|---|---|
| C0 | Source quotas: discussion sources get up to 40% of daily tagging | `ai_queue_tagging` (SQL) |
| C0b | Daily budget caps per model, so the pipeline always leaves room for the chat and themes. The chat logs its usage to the same table | `engine/ai/groq.py`, `chat_log` |
| C1 | Full-text search column + index (English text, or the verified translation); also replaces the slow regex search on Evidence (1.4 s) | migration 0010 |
| C2 | Agent tools as read-only database functions callable with the public key: `search_feedback`, `count_feedback` (numbers computed in SQL), plus existing theme and validation views | migration 0010 |
| C3 | Abuse protection: per-visitor and global daily question limits, and an answer cache for repeated questions | `chat_guard`, `chat_cache` |
| C4 | Agent API (`/api/ask`): tool loop, citation and number checks, faithfulness judge, fallback model when the main model's daily allowance is spent | `web/app/api/ask/route.ts`, `web/lib/agent/*` |
| C5 | Ask page: chat, one-click research questions, answer cards with citations and check badges, remaining daily capacity | `web/app/ask/page.tsx` |
| C6 | Run-pipeline button: passcode + cooldown, triggers the `daily` workflow through GitHub's API | `web/app/api/run/route.ts`, Health page |
| C7 | Validation page: answer-check results (citations valid %, numbers verified %, mean faithfulness) | `chat_log` aggregates |

## Budget (Groq free tier, 200K tokens/day per model)

| Model | Pipeline cap | Left for |
|---|---|---|
| gemini-3.5-flash-lite (Google, free) | not used by the pipeline | **the chat, first** (~500 requests/day reported ≈ 60–80 answers) |
| gpt-oss-120b | tagging stops at 150K | themes (~30K), chat fallback |
| gpt-oss-20b | relevance stops at 90K | **the chat** (~110K) |
| qwen3.8-27b | checks stop at 60K; 4K tokens/min kept free | the answer judge (8K tokens/min is too little for multi-round answers) |

## Not in phase C (later)

- Pre-written answers for every question (dropped by decision)
- Embedding-based semantic search for the chat (keyword search + AI tags first; semantic search later if answers miss relevant entries)
- New sources: YouTube, forums (phase E)
