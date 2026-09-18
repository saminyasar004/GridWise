# Workflows

## 1. Request lifecycle (happy path)

```
POST /optimize-energy
  → GlobalPipe validates DTO (whitelist, forbid non-whitelisted, transform)
  → GridwiseService.doOptimize
      → cache lookup (SHA-256 of payload)
      → [miss] LlmInterpreterService.interpretAll(note by note)
           → LlmClientService.chatJson(system, user)        # temperature 0, JSON mode
           → GuardrailValidatorService.validateRaw          # deterministic check
           → reprompt with failure reasons if invalid (LLM_MAX_REPROMPTS times)
      → OptimizerService.buildEffects(hours, battery, interpretations)
      → OptimizerService.optimize(request, effects)          # LP solve
      → FinalValidatorService.replay(plan, interpretations, request, effects)
      → response builder (totals + plan_summary)
```

## 2. Decision / failure flow

| Situation | Code | Outcome |
|---|---|---|
| Malformed JSON, or non-object body | `400` | `{"statusCode":400,"message":"Malformed JSON request body",...}` |
| Wrong/missing fields, 1–3 notes violated, < 24 hours, NaN/negative, bad battery semantics | `400` | array of per-field messages |
| LP infeasible under the interpreted directives | `500` | `OptimizerInfeasibleException` → controlled error |
| LLM up, output valid | `200` | LLM-backed interpretations |
| LLM call fails (timeout / config / 429) | `200` | heuristic fallback; `explanation` names the fallback |
| Heuristic also fails to classify | `500` | `LlmClassificationException` (should not happen on public cases) |
| Replay finds violations | `500` | `FinalReplayException` — indicates a real bug; caught during development |
| Request exceeds `REQUEST_TIMEOUT_MS` | `500` | `RequestTimeoutException` |

The global `AllExceptionsFilter` (`src/common/filters/all-exceptions.filter.ts`)
guarantees: errors ≥ 500 are logged with constructor name + stack (never request
bodies or keys), and every JSON body keeps the stable
`{statusCode, message, error}` shape.

## 3. Development workflow

```bash
npm run start:dev            # watch mode
npm run test                 # unit suites (fast, no network)
npm run test:docs            # 10 public sample cases against the real pipeline
npm run test:e2e             # full HTTP lifecycle incl. validation failures
```

Inner loop while tuning the LLM prompt (`src/llm/llm-prompts.ts`):
1. Change the prompt.
2. `npm run test:docs` — interpretation + totals across all 10 reference cases.
3. Verify a manual note with the fallback path: point `LLM_BASE_URL` at a dead
   host (or unset `LLM_API_KEY`) and confirm `/optimize-energy` still returns
   `200` with a fallback-labelled interpretation.

## 4. Test layers

| Layer | Command | Pass condition |
|---|---|---|
| Math / optimizer | `npm test` | LP feasible, totals equal reference, replay clean |
| Guardrails | `npm test` (`src/guardrails/...spec.ts`) | invalid LLM shapes → reprompt/fallback, never fabricated |
| Interpretation | `npm run test:docs` | 10/10 cases: semantics + totals + all constraints |
| Contract | `npm run test:e2e` | /health 200; valid request 200; bad body 400 |
| Resilience | manual / e2e | unset key or dead host → 200 via fallback < 30 s |
| Concurrency | `hey` / `xargs -P` | no 5xx, p95 < 5 s |

## 5. Release workflow

```bash
npm run build
docker build -t ghcr.io/<user>/gridwise:<tag> .
docker run --rm -p 3000:3000 ghcr.io/<user>/gridwise:<tag>   # no env vars
curl -s localhost:3000/health                                # {"status":"ok"}
docker push ghcr.io/<user>/gridwise:<tag>
ssh vps 'cd /opt/gridwise && docker compose pull && docker compose up -d'
curl -s https://gridwise.<domain>/health                          # external check
```

If you rebuild after a fix, bump the tag and update the README so the submitted
reference points at an image that actually contains the final code.