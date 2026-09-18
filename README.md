# GridWise LLM — Smart Campus Energy Optimizer

BUP CSE Fest 2026 · Online Preliminary · Grid Energy Optimization Challenge

An LLM-in-the-loop 24-hour campus energy optimizer. It reads 1–3 natural-language
operator notes, turns each into a structured directive, and returns a minimum-cost
hourly grid-import schedule that obeys every directive and battery constraint.

**Live endpoint:** https://gridwise.<your-domain>
**Docker image:** `ghcr.io/<your-user>/gridwise:latest`
**Swagger UI:** `/docs` (served by the app itself)

## What it does

The service accepts a single `POST /optimize-energy` request describing:

- 24 hourly rows of demand, solar forecast and tariff,
- a battery specification (capacity, starting energy, minimum reserve, charge/discharge rates),
- 1–3 free-text operator notes (e.g. *"solar panels washed from noon until 2 PM; treat solar as 25%"*).

An LLM interprets every note into a structured directive. Deterministic guardrails
validate it, a linear program computes the least-cost feasible schedule, and a replay
validator re-checks every constraint against the plan before the response is returned.

Everything is served over two endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Readiness check — returns `{"status":"ok"}`, no LLM/database dependency. |
| `POST /optimize-energy` | Interpret notes + return the optimal 24-hour plan. |

## Architecture

```
POST /optimize-energy
  → DTO validation (class-validator)          src/dto/
  → cache lookup                               src/common/cache.service.ts
  → LLM interpreter (1 call per note)          src/llm/
  → deterministic guardrails                   src/guardrails/
  → LP optimizer                                src/optimizer/optimizer.service.ts
  → replay validator                            src/validator/final-validator.service.ts
  → response builder                            src/gridwise/gridwise.service.ts
```

| Stage | Source | Role |
|---|---|---|
| Request validation | `src/dto/optimize-energy-request.dto.ts` | 24 unique hours 0–23, 1–3 non-empty notes, finite non-negative numbers, `minimum ≤ initial ≤ capacity`. |
| LLM interpreter | `src/llm/llm-interpreter.service.ts` | Interprets **every** operator note (directive type, window, value). Required path. |
| LLM client | `src/llm/llm-client.service.ts` | OpenAI-compatible `/chat/completions` call, temperature 0, JSON mode, timeout + provider retries. |
| Guardrails | `src/guardrails/guardrail-validator.service.ts` | Allowed types, note mapping, hours 0–23 unique ascending, `factor ∈ [0,1]`, reserve ≤ capacity, cap ≥ 0. Invalid LLM output → rejected (reprompt), or `no_op` never fabricated. |
| Fallback | `src/guardrails/heuristic-fallback.service.ts` | Used only if the LLM fails; classified output is labelled in `explanation`. |
| Optimizer | `src/optimizer/optimizer.service.ts` | Linear program (`javascript-lp-solver`), 120 variables (grid, solar, charge, discharge, battery state × 24 h), solved per request. |
| Replay validator | `src/validator/final-validator.service.ts` | Judge-style hour-by-hour replay of balance, solar caps, battery bounds, directive windows, neutrality and totals. |

**LLM provider / model:** any OpenAI-compatible endpoint. Configure via
`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` (temperature 0, JSON mode).

## Quickstart (local)

Requires Node.js ≥ 22 and npm.

```bash
git clone <your-repo-url> && cd gridwise
npm ci
cp .env.example .env          # then fill in LLM_BASE_URL / LLM_MODEL / LLM_API_KEY
npm run build
npm run start:prod            # production mode (serves dist/main.js)
```

Or in development watch mode:

```bash
npm run start:dev
```

Service listens on `0.0.0.0:3000` by default. Open `http://localhost:3000/docs`
for interactive Swagger documentation.

## Configuration

All configuration is read from environment variables (never from the codebase).
Copy `.env.example` → `.env` to get started.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `HOST` | no | `0.0.0.0` | Listen address. |
| `PORT` | no | `3000` | Listen port. |
| `LLM_BASE_URL` | yes* | Gemini OpenAI-compat endpoint | OpenAI-compatible base URL of the primary provider. |
| `LLM_MODEL` | yes* | `gemini-2.0-flash` | Model ID. |
| `LLM_API_KEY` | yes* | — | Secret; never commit it. |
| `LLM_CHAT_COMPLETIONS_PATH` | no | `/chat/completions` | Path appended to `LLM_BASE_URL`. |
| `LLM_TIMEOUT_MS` | no | `9000` | Per-provider-call timeout. |
| `LLM_MAX_REPROMPTS` | no | `1` | Guardrail-feedback retries per note. |
| `LLM_MAX_PROVIDER_RETRIES` | no | `1` | Transient provider retries. |
| `LLM_TEMPERATURE` | no | `0` | Sampling temperature. |
| `ENABLE_HEURISTIC_FALLBACK` | no | `true` | Deterministic parse when the LLM is unreachable. |
| `CACHE_ENABLED` | no | `true` | In-memory response cache. |
| `CACHE_TTL_MS` | no | `300000` | Cache TTL. |
| `CACHE_MAX_ENTRIES` | no | `128` | Cache size before eviction. |
| `REQUEST_TIMEOUT_MS` | no | `25000` | Overall request budget (judge bound is 30 s). |
| `BODY_LIMIT_MB` | no | `1` | Max request body size. |
| `SWAGGER_ENABLED` | no | `true` | Serve `/docs`. |

\* The service starts and answers `/health` without any LLM variable set;
`/optimize-energy` then uses the labelled heuristic fallback parser.

## Test it

```bash
curl -s http://localhost:3000/health
# {"status":"ok"}
```

A full sample request is included in `docs/test-cases.json`. Posting case
`SAMPLE-01` straight from that file:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
const doc = JSON.parse(readFileSync("docs/test-cases.json","utf8"));
console.log(JSON.stringify(doc.cases[0].input));' > /tmp/case1.json

curl -s -X POST http://localhost:3000/optimize-energy \
  -H "Content-Type: application/json" -d @/tmp/case1.json | head -c 600
```

### Run all 10 public samples

```bash
npm run test:docs
```

This drives the **real pipeline** (request → LLM stub with reference
interpretations → guardrails → LP → replay validator) for every case in
`docs/test-cases.json`.

Expected result:

```
Test Files  1 passed (1)
     Tests  30 passed (30)
```

The same reference cases are also exercised end-to-end over HTTP in `npm run test:e2e`,
and the plain unit/contract suites with:

```bash
npm test            # unit suites (optimizer, fallback, …)
npm run test:e2e    # full HTTP lifecycle
npm run test:samples # standalone sample runner
```

## Docker

### Image (build or pull)

```bash
docker build -t ghcr.io/<your-user>/gridwise:latest .
# or
docker pull ghcr.io/<your-user>/gridwise:latest
```

### Run locally

```bash
docker run --rm -p 3000:3000 \
  -e LLM_BASE_URL=<url> -e LLM_MODEL=<model> -e LLM_API_KEY=<key> \
  ghcr.io/<your-user>/gridwise:latest
curl -s http://localhost:3000/health
```

### Compose

```bash
cp .env.example .env   # fill in credentials (never commit .env)
docker compose up -d --build
docker compose ps      # health check must show healthy
```

The container binds `0.0.0.0:3000`, runs as a non-root user, exposes no secrets,
and includes a `HEALTHCHECK` against `/health`. `/health` works with **zero**
environment variables set — the LLM key is used only for note interpretation.

## API

### `GET /health`

```json
{"status":"ok"}
```

### `POST /optimize-energy`

**Request** (`OptimizeEnergyRequestDto`):

| Field | Type | Constraint |
|---|---|---|
| `scenario_id` | string | non-empty; echoed back |
| `operator_notes` | string[] | 1–3 non-empty strings |
| `hours` | object[24] | exactly hours 0–23 once each |
| `battery` | object | `minimum ≤ initial ≤ capacity`, rates ≥ 0 |

Each hour: `{ "hour": 0..23, "demand_kwh", "solar_kwh", "tariff_bdt_per_kwh" }` (all ≥ 0, finite).

**Response** (`OptimizeEnergyResponseDto`): `scenario_id`, `directive_interpretation[]`
(one per note, in order), `hourly_plan[24]`, `total_grid_kwh`, `total_cost_bdt`,
`peak_grid_kwh`, `plan_summary`.

**Status codes:**

| Code | Meaning |
|---|---|
| `200` | Valid result (also returned with fallback interpretations when the LLM is down). |
| `400` | Malformed JSON or invalid request body. |
| `500` | Controlled internal error (includes replay failure and request timeout). |

Example 400 body:

```json
{
  "statusCode": 400,
  "message": [
    "operator_notes must be an array",
    "hours must contain exactly 24 entries covering every hour 0 through 23 exactly once",
    "battery values are semantically invalid (0 <= minimum <= capacity, 0 <= initial <= capacity, rates >= 0)"
  ],
  "error": "Bad Request"
}
```

## Dependencies and credits

Runtime: NestJS 12, class-validator / class-transformer, `javascript-lp-solver`,
`@nestjs/config`, Swagger UI. Dev: Vitest, Oxlint, TypeScript, tsx.

LLM: any OpenAI-compatible provider (see Configuration).

AI coding assistants were used during development; architecture and logic were
reviewed, tested and owned by the team.

## Known limitations

- Interpretation quality depends on the external LLM. If all provider attempts
  fail, a deterministic heuristic fallback is used and flagged in `explanation`.
- Windows written as words without digits (e.g. "noon", "midnight") are supported
  by the fallback parser; more exotic phrasings are best handled by the LLM path.
- The battery model has no efficiency loss and no grid export (a single signed
  hourly battery flow); this matches the problem statement.
- The in-memory cache is per-process and cleared on restart; repeat requests within
  the TTL return the cached plan for the same payload.
- A note that implies two directive types at once is mapped to a single type.

## Secret handling

Secrets are read from environment variables only.

- `.env` is in `.gitignore` **and** `.dockerignore`; `.env.example` is committed.
- Logs contain scenario id, latency and directive types — never keys, prompts or request bodies.
- The Docker image contains no credentials; `/health` needs none.

Verify quickly that nothing leaked after cloning:

```bash
git grep -iE "sk-|api_key=.+" || echo "clean"
```