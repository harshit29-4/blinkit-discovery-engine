/**
 * Text model chain for cards and search: Gemini 3.5 Flash-Lite first (free tier), then Groq's gpt-oss-120b when
 * Gemini is overloaded (its free tier often answers HTTP 503 "high demand") or slow. Groq uses the MVP's own key
 * (MVP_GROQ_API_KEY), separate from the engine's, so the two never share a daily budget.
 * The packet scan needs image input and stays on Gemini only (lib/gemini.ts).
 */
import { GEMINI_MODEL, ModelError, geminiJsonRetry } from "./gemini.ts";

export const GROQ_MODEL = "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export type LlmResult = { data: unknown; tokens: number; model: string };

async function groqJson(system: string, user: string, maxTokens: number, timeoutMs: number): Promise<LlmResult> {
  const key = process.env.MVP_GROQ_API_KEY;
  if (!key) throw new ModelError("MVP_GROQ_API_KEY is not set");
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        reasoning_effort: "medium", // "low" broke rules in the stress test (other shops, outside facts); medium holds them
        max_completion_tokens: maxTokens + 1500, // room for the reasoning pass
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new ModelError(`groq network: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ModelError(`groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  const body = await res.json();
  const content: string = body?.choices?.[0]?.message?.content ?? "";
  const tokens = (body?.usage?.prompt_tokens ?? 0) + (body?.usage?.completion_tokens ?? 0);
  try {
    return { data: JSON.parse(content), tokens, model: GROQ_MODEL };
  } catch {
    throw new ModelError("groq returned invalid JSON");
  }
}

export type LlmOpts = {
  maxTokens?: number;
  only?: "groq";            // scripts: test the backup on its own
  geminiTries?: number;     // live: 1; scripts: more
  geminiTimeoutMs?: number;
  groqTries?: number;
  groqTimeoutMs?: number;
};

/** Gemini first; on any Gemini failure, Groq (retrying its own rate limits). Throws only if both fail. */
export async function llmJson(system: string, user: string, o: LlmOpts = {}): Promise<LlmResult> {
  const maxTokens = o.maxTokens ?? 900;
  let geminiError: unknown = new Error("skipped");
  if (o.only !== "groq") try {
    const r = await geminiJsonRetry(system, user, { tries: o.geminiTries ?? 1, waitMs: 4000, timeoutMs: o.geminiTimeoutMs ?? 7000, maxTokens });
    return { ...r, model: GEMINI_MODEL };
  } catch (e) {
    geminiError = e;
  }
  if (!process.env.MVP_GROQ_API_KEY) throw geminiError;
  let wait = 5000;
  for (let n = 1; ; n++) {
    try {
      return await groqJson(system, user, maxTokens, o.groqTimeoutMs ?? 20_000);
    } catch (e) {
      const status = (e as ModelError).status;
      if (n >= (o.groqTries ?? 1) || (status !== 429 && status !== 503 && status !== 500)) {
        throw new ModelError(`both models failed: gemini (${(geminiError as Error).message.slice(0, 60)}); ${(e as Error).message.slice(0, 80)}`);
      }
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
}
