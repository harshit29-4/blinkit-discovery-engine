/**
 * POST /api/ask  { question, history? } -> answer card (see lib/agent/run.ts).
 *
 * Order: validate -> answer cache (single-turn questions, 24 h) -> rate guard (per visitor per hour,
 * whole site per day) -> agent -> record the check results. Question and answer text are not logged;
 * only cached answers are stored, keyed by the normalised question.
 */
import { createHash } from "node:crypto";
import { getSourceCounts } from "@/lib/data";
import { answerQuestion, JUDGE_MODEL, ModelUnavailable, type Answer } from "@/lib/agent/run";
import { questionKey } from "@/lib/agent/checks";
import { rpc } from "@/lib/supabase";

export const maxDuration = 60;

const PER_VISITOR_HOUR = 8;
const PER_DAY = 40; // ~8–10K tokens per answer against the free daily allowance; cached repeats are free

type Body = { question?: unknown; history?: unknown };
type Turn = { role: "user" | "assistant"; content: string };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function visitorId(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const salt = process.env.SUPABASE_SECRET_KEY ?? "";
  return createHash("sha256").update(`${salt.slice(-16)}:${ip}`).digest("hex").slice(0, 32);
}

let overviewCache: { at: number; text: string } | null = null;
async function overview(): Promise<string> {
  if (overviewCache && Date.now() - overviewCache.at < 10 * 60_000) return overviewCache.text;
  const [counts, tagged] = await Promise.all([
    getSourceCounts(),
    rpc<{ value: string; entries: number }[]>("count_feedback", { group_by: "source" }),
  ]);
  const name: Record<string, string> = { play_store: "Google Play reviews", app_store: "App Store reviews",
    reddit_post: "Reddit posts", reddit_comment: "Reddit comments", reddit: "Reddit" };
  const collected = counts.map((c) => `${c.items} ${name[c.source] ?? c.source}`).join(", ");
  const taggedText = tagged.map((t) => `${t.entries} ${name[t.value] ?? t.value}`).join(", ") || "none yet";
  const text = `collected entries: ${collected}. Of these, a random sample of relevant entries has been ` +
    `tagged by AI (barriers, categories, sentiment, funnel stage, etc.): ${taggedText}. Keyword search covers ` +
    `all collected entries; counts cover the tagged sample only.`;
  overviewCache = { at: Date.now(), text };
  return text;
}

function parseHistory(h: unknown): Turn[] {
  if (!Array.isArray(h)) return [];
  return h.slice(-6).filter((t): t is Turn =>
    !!t && typeof t === "object" && (t.role === "user" || t.role === "assistant") && typeof t.content === "string",
  ).map((t) => ({ role: t.role, content: t.content.slice(0, 1500) }));
}

async function record(a: Answer) {
  await rpc("chat_record", {
    p_model: a.model, p_tool_calls: a.steps.length, p_tokens_in: a.tokens.input, p_tokens_out: a.tokens.output,
    p_citations_valid: a.checks.citations.ok, p_numbers_verified: a.checks.numbers.ok,
    p_faithfulness: a.checks.faithfulness.score, p_cached: a.cached,
    p_judge_model: a.tokens.judge ? JUDGE_MODEL : null, p_judge_tokens: a.tokens.judge,
  }, { secret: true }).catch(() => undefined); // logging must never break an answer
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send JSON: { \"question\": \"…\" }" }, 400);
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 3 || question.length > 500) {
    return json({ error: "Ask a question between 3 and 500 characters." }, 400);
  }
  const history = parseHistory(body.history);

  const key = questionKey(question);
  if (!history.length) {
    const hit = await rpc<Answer | null>("chat_cache_get", { p_key: key }, { secret: true }).catch(() => null);
    if (hit) {
      const a = { ...hit, cached: true };
      await record(a);
      return json({ ...a, remaining: null });
    }
  }

  type Guard = { allowed: boolean; reason: string | null; used_today: number; limit_today: number };
  let guard: Guard;
  try {
    [guard] = await rpc<Guard[]>("chat_guard", { p_visitor: visitorId(req), per_visitor: PER_VISITOR_HOUR, per_day: PER_DAY }, { secret: true });
  } catch {
    return json({ error: "The engine is not available right now. Please try again shortly." }, 503);
  }
  if (!guard.allowed) {
    return json({
      error: guard.reason === "visitor_limit"
        ? `You can ask ${PER_VISITOR_HOUR} questions per hour. Please try again later.`
        : `The engine has answered its ${PER_DAY} questions for today (free AI allowance). It resets within 24 hours.`,
    }, 429);
  }

  let answer: Answer;
  try {
    answer = await answerQuestion(question, history, await overview());
  } catch (e) {
    if (e instanceof ModelUnavailable) {
      return json({ error: "The AI models are at their free-tier limit right now. Please try again in a few minutes." }, 503);
    }
    console.error("ask failed", e);
    return json({ error: "The engine could not answer this question. Please try again." }, 500);
  }

  const checksPassed = answer.checks.citations.ok && answer.checks.numbers.ok &&
    (answer.checks.faithfulness.score === null || answer.checks.faithfulness.score >= 0.7);
  if (!history.length && checksPassed) {
    await rpc("chat_cache_put", { p_key: key, p_answer: answer }, { secret: true }).catch(() => undefined);
  }
  await record(answer);
  return json({ ...answer, remaining: Math.max(guard.limit_today - guard.used_today, 0) });
}
