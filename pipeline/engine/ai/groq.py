"""Groq chat client built for the free tier: JSON output, per-model rate limiting from the
response headers, clean stop on daily limits, and a token log for every call."""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

log = logging.getLogger("engine.ai.groq")

URL = "https://api.groq.com/openai/v1/chat/completions"
MAX_WAIT_S = 65.0
MAX_RATE_WAITS = 6  # per call; beyond this the stage pauses until the next run


class BudgetExhausted(Exception):
    """The model's daily allowance is used up; stop this stage until the next run."""


class ModelOutputError(Exception):
    """The model answered, but not with usable JSON."""


class RateLimited(Exception):
    """Still rate-limited after waiting. Not the items' fault: pause the stage, retry next run."""


class RequestTooLarge(RateLimited):
    """A single request exceeds a per-minute cap outright (e.g. qwen's 1,000 output tokens/minute).
    Waiting can't help, so this is raised at once; the stage pauses and the stats say why."""


def parse_duration(value: str | None) -> float:
    """Groq reset headers look like '6.705s', '1m26.4s', '2h3m', '120ms'."""
    if not value:
        return 0.0
    total = 0.0
    for num, unit in re.findall(r"(\d+(?:\.\d+)?)(ms|h|m|s)", value):
        total += float(num) * {"h": 3600, "m": 60, "s": 1, "ms": 0.001}[unit]
    return total


@dataclass
class ModelState:
    remaining_tokens: int | None = None
    tokens_reset_at: float = 0.0
    remaining_requests: int | None = None
    exhausted: bool = False


@dataclass
class CallResult:
    data: dict[str, Any]
    tokens_in: int
    tokens_out: int


# Daily soft caps for the pipeline, per model, counted over the last 24 hours (Groq's own limit is
# 200K tokens/day per model). They leave room for theme naming and for the Ask page's chat, which
# logs its use to the same ai_calls table. Theme stages are exempt: they are small and run last.
DAILY_CAPS = {
    "openai/gpt-oss-120b": 150_000,
    "openai/gpt-oss-20b": 150_000,
    "qwen/qwen3.8-27b": 60_000,
}
CAP_EXEMPT_STAGES = frozenset({"theme_naming", "theme_consolidation"})


@dataclass
class GroqClient:
    api_key: str
    log_call: Callable[..., None] | None = None
    http: httpx.Client | None = None
    sleep: Callable[[float], None] = time.sleep
    states: dict[str, ModelState] = field(default_factory=dict)
    caps: dict[str, int] = field(default_factory=dict)       # model -> daily token cap (empty = none)
    used: dict[str, int] = field(default_factory=dict)       # model -> tokens used in the last 24 h

    def __post_init__(self) -> None:
        self.http = self.http or httpx.Client(timeout=120)

    def _state(self, model: str) -> ModelState:
        return self.states.setdefault(model, ModelState())

    def _respect_tpm(self, model: str, est_tokens: int) -> None:
        s = self._state(model)
        if s.remaining_tokens is not None and s.remaining_tokens < est_tokens:
            wait = min(max(0.0, s.tokens_reset_at - time.time()), MAX_WAIT_S)
            if wait > 0:
                log.info("%s: %d tokens left this minute, waiting %.1fs", model, s.remaining_tokens, wait)
                self.sleep(wait)

    def _update(self, model: str, h: httpx.Headers) -> None:
        s = self._state(model)
        if h.get("x-ratelimit-remaining-tokens", "").isdigit():
            s.remaining_tokens = int(h["x-ratelimit-remaining-tokens"])
            s.tokens_reset_at = time.time() + parse_duration(h.get("x-ratelimit-reset-tokens"))
        if h.get("x-ratelimit-remaining-requests", "").isdigit():
            s.remaining_requests = int(h["x-ratelimit-remaining-requests"])
            if s.remaining_requests <= 2:  # keep a tiny reserve; the daily window is per model
                s.exhausted = True

    def chat_json(self, *, model: str, system: str, user: str, stage: str, items: int,
                  max_tokens: int = 2048, retries: int = 4) -> CallResult:
        s = self._state(model)
        if s.exhausted:
            raise BudgetExhausted(model)
        cap = self.caps.get(model)
        if cap is not None and stage not in CAP_EXEMPT_STAGES and self.used.get(model, 0) >= cap:
            raise BudgetExhausted(f"{model}: pipeline cap of {cap:,} tokens/24h reached")
        body: dict[str, Any] = {
            "model": model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "max_completion_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        if model.startswith("openai/gpt-oss"):
            body["reasoning_effort"] = "low"  # these models think before answering; keep it short
        est = (len(system) + len(user)) // 3 + max_tokens // 2
        delay = 5.0
        rate_waits = 0
        attempt = 0
        while attempt < retries:
            attempt += 1
            self._respect_tpm(model, est)
            try:
                r = self.http.post(URL, json=body, headers={"Authorization": f"Bearer {self.api_key}"})
            except httpx.HTTPError as exc:
                if attempt == retries:
                    self._log(stage, model, items, 0, 0, False, f"network: {exc}")
                    raise
                self.sleep(delay)
                delay *= 2
                continue
            self._update(model, r.headers)
            if r.status_code == 429:
                retry_after = float(r.headers.get("retry-after") or parse_duration(r.headers.get("x-ratelimit-reset-tokens")) or 10)
                msg = r.text[:300]
                if "request too large" in msg.lower():
                    self._log(stage, model, items, 0, 0, False, "request too large for per-minute cap")
                    raise RequestTooLarge(model)
                if "per day" in msg.lower() or retry_after > 300:
                    s.exhausted = True
                    # Keep Groq's own wording (e.g. "tokens per day (TPD): Limit 200000, Used ..."), minus ids.
                    detail = re.sub(r"org_\w+", "org", msg)
                    detail = detail[detail.find("on "):][:160] if "on " in detail else detail[:160]
                    self._log(stage, model, items, 0, 0, False, f"daily limit reached: {detail}")
                    raise BudgetExhausted(model)
                rate_waits += 1
                if rate_waits > MAX_RATE_WAITS:
                    self._log(stage, model, items, 0, 0, False, "rate limited")
                    raise RateLimited(model)
                log.info("%s: rate limited, waiting %.0fs", model, retry_after)
                self.sleep(min(retry_after + 0.5, MAX_WAIT_S))
                attempt -= 1  # waiting out a per-minute limit isn't a failed attempt
                continue
            if r.status_code >= 500 and attempt < retries:
                self.sleep(delay)
                delay *= 2
                continue
            if r.status_code != 200:
                self._log(stage, model, items, 0, 0, False, f"HTTP {r.status_code}: {r.text[:200]}")
                raise ModelOutputError(f"HTTP {r.status_code}: {r.text[:200]}")
            payload = r.json()
            usage = payload.get("usage") or {}
            tin, tout = usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)
            content = (payload["choices"][0]["message"].get("content") or "").strip()
            try:
                data = json.loads(content)
            except json.JSONDecodeError:
                self._log(stage, model, items, tin, tout, False, "invalid JSON")
                raise ModelOutputError("invalid JSON") from None
            self.used[model] = self.used.get(model, 0) + tin + tout
            self._log(stage, model, items, tin, tout, True, None)
            return CallResult(data, tin, tout)
        self._log(stage, model, items, 0, 0, False, "server errors after retries")
        raise ModelOutputError("server errors after retries")

    def _log(self, stage, model, items, tin, tout, ok, error) -> None:
        if self.log_call:
            try:
                self.log_call(stage=stage, model=model, items=items, tokens_in=tin, tokens_out=tout, ok=ok, error=error)
            except Exception as exc:  # logging must never break the pipeline
                log.warning("could not log AI call: %s", exc)
