/**
 * Gemini 3.5 Flash-Lite through its OpenAI-compatible endpoint (Google AI Studio free tier).
 * Same quirks as the engine's Ask page: the endpoint rejects reasoning_effort and max_completion_tokens,
 * so this sends max_tokens; the free tier can take 10+ s to report it is overloaded, so calls time out.
 */
export const GEMINI_MODEL = "gemini-3.5-flash-lite";
const URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export class ModelError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** Retries the free tier's "high demand" (503) and rate (429) replies a few times, waiting longer each time. */
export async function geminiJsonRetry(system: string, user: string | Part[], opts: Parameters<typeof geminiJson>[2] & { tries?: number; waitMs?: number } = {}) {
  const tries = opts.tries ?? 4;
  let wait = opts.waitMs ?? 8_000;
  for (let n = 1; ; n++) {
    try {
      return await geminiJson(system, user, opts);
    } catch (e) {
      const status = (e as ModelError).status;
      if (n >= tries || (status !== 503 && status !== 429 && status !== 500)) throw e;
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
}

export async function geminiJson(system: string, user: string | Part[], opts: { maxTokens?: number; timeoutMs?: number; key?: string } = {}): Promise<{ data: unknown; tokens: number }> {
  const key = opts.key ?? process.env.GEMINI_API_KEY;
  if (!key) throw new ModelError("GEMINI_API_KEY is not set");
  let res: Response;
  try {
    res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 900,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    throw new ModelError(`network: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ModelError(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  const body = await res.json();
  const content: string = body?.choices?.[0]?.message?.content ?? "";
  const tokens = (body?.usage?.prompt_tokens ?? 0) + (body?.usage?.completion_tokens ?? 0);
  try {
    // Occasionally wrapped in a ```json fence despite response_format.
    return { data: JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")), tokens };
  } catch {
    throw new ModelError("model returned invalid JSON");
  }
}
