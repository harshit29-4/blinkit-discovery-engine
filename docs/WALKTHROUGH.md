# Walkthrough — Blinkit Discovery Engine

Your reference guide to how this project works and why it's built this way. It's updated as each piece is built, so sections marked _(not built yet)_ are placeholders.

## 0. The project in one minute

Blinkit wants more monthly active customers to buy from at least one **new category** each month. Before proposing anything, we built an engine that reads thousands of public user conversations (Play Store, App Store, Reddit, YouTube, forums). It tags them with an LLM (Groq), finds recurring themes, and answers 8 research questions with cited evidence. It also measures how trustworthy those answers are.

- Architecture and decisions: [part1-architecture.md](part1-architecture.md)
- Repo: https://github.com/harshit29-4/blinkit-discovery-engine

## 1. Accounts and keys _(partly set up)_

| Service | Used for | Status |
|---|---|---|
| GitHub | Code, scheduled pipeline (Actions), secrets | ✅ repo created |
| Groq | All LLM calls | ⏳ key pending |
| Supabase | Database, vector search, realtime | ⏳ login reminder at build step 1 |
| Vercel | Hosting the website | ⏳ login reminder at build step 6 |
| YouTube Data API | YouTube comments | ⏳ key pending |

Keys go in `.env` (local, never committed) and in GitHub/Vercel secrets. `.env.example` lists every variable.

## 2. How data is collected _(not built yet)_

## 3. How data is cleaned and translated _(not built yet)_

## 4. How tagging works _(not built yet)_

## 5. How themes are found _(not built yet)_

## 6. How insights are generated _(not built yet)_

## 7. How quality is validated _(not built yet)_

## 8. The website _(not built yet)_

## 9. Running it yourself _(not built yet)_

## 10. Common problems and fixes _(not built yet)_

## Glossary

- **RAG**: retrieval-augmented generation. The model answers only from retrieved reviews and cites them.
- **Embedding**: a list of numbers that captures a text's meaning, so similar reviews end up close together.
- **Gold set**: reviews you labelled by hand. They're the answer key used to grade the AI's tags.
- **Cohen's κ (kappa)**: agreement between you and the AI, corrected for chance. 0.6+ counts as substantial.
- **Grounding**: checking that every quote the AI cites really exists in the source text.
