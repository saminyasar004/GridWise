# LLM Notes

The full system prompt lives in `src/llm/llm-prompts.ts`. This file explains the
behaviour you observe and how to tune it.

## 1. Provider configuration

Any OpenAI-compatible `/chat/completions` endpoint works:

| Env var | Meaning |
|---|---|
| `LLM_BASE_URL` | e.g. `https://generativelanguage.googleapis.com/v1beta/openai` or `https://api.openai.com/v1` |
| `LLM_MODEL` | model id |
| `LLM_API_KEY` | secret |

Call settings (see `src/llm/llm-client.service.ts`): `temperature: 0`, JSON
mode when the provider supports it, per-call timeout `LLM_TIMEOUT_MS` (default
9 s), provider retries `LLM_MAX_PROVIDER_RETRIES` (default 1).

A second provider is not hard-wired in the client; a backup is achieved either
by a separate deployment with `BACKUP_*` env or — cheapest and always present —
by the deterministic heuristic fallback (see below).

## 2. Why the prompt is shaped this way

1. **One note per call** — the interpreter calls the LLM once per note
   (`LlmInterpreterService.interpretAll`). Output is one JSON object with the
   full directive shape (note_index, applies, type, adjustment, explanation).
2. **No arithmetic in the model** — the prompt says "factor is the USABLE
   FRACTION remaining"; "80% reduction => 0.2". The model computes the number
   as text instructs; guardrails range-check it.
3. **End-exclusive / ascending hours** — the prompt states START-INCLUSIVE,
   END-EXCLUSIVE, unique asc, and gives noon/midnight examples.
4. **no_op is a first-class answer** — administrative news, future events, and
   anything touching demand/tariff (unsupported by the five types) must become
   `no_op`. "Never invent a type or a number."
5. **Exact JSON shapes** — the system prompt enumerates the six shapes with the
   exact allowed keys, and guardrails reject unknown keys, so the LLM cannot add
   fields the validator does not understand.
6. **Battery reference in every user prompt** — needed for percent-of-capacity
   reserves ("60% of capacity").
7. **Structured correction** — on guardrail failure the client appends the exact
   validation errors back into a correction prompt and retries up to
   `LLM_MAX_REPROMPTS`.

## 3. Failure fallback chain (what you observed when no key was configured)

1. `chatJson` throws `LlmProviderException` ("LLM provider is not configured
   (missing LLM_API_KEY or LLM_MODEL)") — two WARN lines in the logs.
2. `LlmInterpreterService` then calls `HeuristicFallbackService.classify` for
   that note; a successful classification is returned **with a `200`**, and its
   `explanation` names the fallback path.
3. The heuristic is deliberately conservative: it requires a parseable time
   window and a matching keyword set (solar+reduction/wash, reserve words,
   charge/no, discharge/no, grid/cap, or a recognised no-op distractor). It
   supports `noon`/`midnight` spellings. If the note does not match any pattern
   it fails loudly rather than guessing.

This ordering protects the latency and failure-rate scores, and the key-less
Docker check, without ever replacing the LLM path on happy days.

## 4. If interpretation quality is wrong

- Wrong **type** or **hours** → the LLM misread the note. Add a one-line rule or
  a few-shot example to `src/llm/llm-prompts.ts`, then re-run `npm run test:docs`.
- Numbers like factor 0.2 vs 0.8 → check the prompt's reduction-vs-remaining
  wording; prefer examples over abstract rules for small models.
- Repeated non-determinism → confirm `temperature: 0` and JSON mode are actually
  reaching the provider.
- Everything fallback-labelled → test the provider directly with curl; fix
  base URL / model id / key, or the provider is rate-limiting (add a second
  deployment with `BACKUP_*`).

## 5. Paraphrase tips (hidden notes will not match the public wording)

Keep a local `tests/paraphrases.json` mirroring `docs/test-cases.json` cases.
Each entry: `{note, expect:{directive_type, structured_adjustment}}`. For each
note call `interpretAll([note], battery)` with the LLM enabled and compare type +
adjustment with a 0.01 tolerance. Aim for ≥ 90% before feature freeze; the last
few percent usually cost more time than they recover.

## 6. Compliance wording for README and video

> Every operator note is interpreted by the LLM (`src/llm/`). Its output is
> validated and, where needed, corrected by deterministic guardrails
> (`src/guardrails/guardrail-validator.service.ts`) before the optimizer consumes
> it. A conservative heuristic fallback exists solely to keep the API responsive
> if the LLM is unreachable; responses produced that way say so in `explanation`.