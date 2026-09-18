# Architecture

## 1. Principle

> The LLM understands language. Deterministic code validates and does arithmetic.
> The solver does the scheduling. A replay validator proves the result before it leaves the service.

## 2. Component view

```
                    ┌──────────────────────────────────────────────┐
                    │              GridWise App (NestJS)            │
                    │                                              │
  client ─► HTTP ─► │  Controller            DTO validation ─────► 400
                    │  GridwiseService (.doOptimize)               │
                    │    │      │                                   │
                    │    │  cache (InMemoryCacheService)           │
                    │    ▼                                        │
                    │  LlmInterpreterService ──► LlmClientService         │
                    │    │  (per-note LLM call, reprompt loop)           │
                    │    ▼                                        │
                    │  GuardrailValidatorService ──► HeuristicFallbackService  │
                    │    │                              (only if LLM fails)    │
                    │    ▼                                        │
                    │  OptimizerService (.buildEffects → .optimize → LP)     │
                    │    ▼                                        │
                    │  FinalValidatorService (.replay)  ──► 500 on violations │
                    │    ▼                                        │
                    │  response builder                            │
                    └──────────────────────────────────────────────┘
                                    │ 200 JSON
```

## 3. Modules and responsibilities

| Module | Files | Responsibility |
|---|---|---|
| API layer | `src/gridwise/gridwise.controller.ts`, `src/main.ts` | Routing, global `ValidationPipe` (whitelist, forbid non-whitelisted), Swagger `/docs`. |
| Request validation | `src/dto/*.ts`, `src/common/filters/all-exceptions.filter.ts` | 24 unique hours 0–23, 1–3 non-empty notes, finite non-negative numbers, `minimum ≤ initial ≤ capacity`, controlled error bodies. |
| LLM interpreter | `src/llm/llm-interpreter.service.ts`, `src/llm/llm-client.service.ts`, `src/llm/llm-prompts.ts` | One JSON call per note; temperature 0; JSON mode; provider retries; guardrail-feedback reprompt up to `LLM_MAX_REPROMPTS`. |
| Guardrails | `src/guardrails/guardrail-validator.service.ts` | Validates LLM output structurally (type, `applies`, hours, factor, kWh, key sets). Invalid → reprompt, and if still failing → heuristic fallback. |
| Fallback parser | `src/guardrails/heuristic-fallback.service.ts` | Last-resort deterministic classification, used only when LLM attempts fail; a positive classification is labelled in `explanation`. |
| Optimizer | `src/optimizer/optimizer.service.ts` | Directives → per-hour bounds → LP → rounded plan + totals. |
| Replay validator | `src/validator/final-validator.service.ts` | Independent hour-by-hour re-check of every rule before responding. |
| Cache | `src/common/cache.service.ts` | In-memory SHA-256 keyed response cache (configurable TTL / size, optional). |
| Config | `src/config/app-config.service.ts` | All env-var reads, one place. |

## 4. Data contracts

### 4.1 Request (`POST /optimize-energy`)

```json
{
  "scenario_id": "SAMPLE-01",
  "operator_notes": ["Facilities will wash the rooftop solar panels from noon until 2 PM. During cleaning, usable solar should be treated as roughly 25% of the forecast.", "The sports office moved next month's registration deadline."],
  "hours": [
    {"hour": 0, "demand_kwh": 90, "solar_kwh": 0, "tariff_bdt_per_kwh": 6}
  ],
  "battery": {
    "capacity_kwh": 220,
    "initial_energy_kwh": 110,
    "minimum_energy_kwh": 40,
    "max_charge_kwh_per_hour": 50,
    "max_discharge_kwh_per_hour": 50
  }
}
```

`hours` must contain every hour 0..23 exactly once (order flexible; sorted internally).

### 4.2 Interpretation (per note)

```json
{
  "note_index": 0,
  "applies": true,
  "directive_type": "solar_reduction",
  "structured_adjustment": {"hours": [12, 13], "factor": 0.25},
  "explanation": "Solar availability is reduced during the stated window."
}
```

`no_op ⇔ applies:false ⇔ structured_adjustment:null`. No other combination is ever returned.

### 4.3 Response

`scenario_id`, `directive_interpretation[]` (one per note, `note_index` order),
`hourly_plan[24]`, `total_grid_kwh`, `total_cost_bdt`, `peak_grid_kwh`,
`plan_summary` (template-built, no second LLM call).

## 5. Optimization model

For each hour *h* = 0..23: grid `g_h`, solar used `s_h`, battery charge `c_h`,
battery discharge `d_h`, battery energy `E_h`.

```
minimize    Σ g_h · tariff_h

subject to  g_h + s_h + d_h − c_h = demand_h            (energy balance)
            0 ≤ s_h ≤ effectiveSolar_h                  (directive-adjusted solar cap)
            0 ≤ g_h ≤ maxGrid_h           (only in capped hours)
            c_h ≤ maxCharge,   c_h = 0 in no-charge hours
            d_h ≤ maxDischarge, d_h = 0 in no-discharge hours
            activeMinReserve_h ≤ E_h ≤ capacity
            E_0 = initial; E_{h+1} = E_h + c_h − d_h ; E_24 = initial (neutrality)
```

120 decision variables (grid, solar, charge, discharge and battery-energy for
each of 24 hours), solved with the simplex engine in `javascript-lp-solver`.
Constants in `src/common/constants.ts`:
`NUMBER_ROUNDING = 4`, `JUDGE_TOLERANCE_KWH = 0.01`, `JUDGE_TOLERANCE_BDT = 0.01`,
`LP_EPSILON = 1e-6`, `NEAR_ZERO = 1e-6`.

**Post-processing:** charge/discharge below `NEAR_ZERO` → `idle`; totals and the
peak are recomputed from the rounded plan that is actually returned.

## 6. Key design decisions

| Decision | Why |
|---|---|
| LLM returns a final validated directive; code validates it | Removes hallucination paths; invalid output is reprompted, then downgraded — never silently guessed. |
| One LLM call per note | Keeps latency within the 30 s judge bound; parallel-capable notes stay independent and order-stable. |
| Temperature 0 + JSON mode + cache | Same note → same interpretation across repeated hidden requests. |
| Separate charge/discharge LP variables | Exact, tiny, fast; no action-exclusivity binaries needed; makes no-charge/no-discharge windows a plain bound. |
| `DirectiveEffects` shared by optimizer and validator | One definition of what each directive means. |
| Replay before responding | Converts any solver/rounding bug into a controlled 500 during our testing, not a silent invalid case during judging. |
| Fallback only after LLM failure | Protects latency/failure scores and the key-less Docker check without replacing the LLM path. |
| OpenAI-compatible HTTP client | Provider swap is an env-var change; no SDK lock-in. |