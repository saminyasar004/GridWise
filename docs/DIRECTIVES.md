# Directives

The six directive types mirror the problem statement exactly
(`src/common/constants.ts` → `DIRECTIVE_TYPES`).

| `directive_type` | `structured_adjustment` | Effect on the LP |
|---|---|---|
| `solar_reduction` | `{ hours, factor }` | `effectiveSolar[h] = solar_kwh[h] × factor` |
| `minimum_battery_reserve` | `{ hours, minimum_energy_kwh }` | `activeMinReserve[h] = max(base, required)` |
| `no_charge_window` | `{ hours }` | charge variable pinned to 0 in those hours |
| `no_discharge_window` | `{ hours }` | discharge variable pinned to 0 in those hours |
| `max_grid_window` | `{ hours, max_grid_kwh }` | `maxGridPerHour[h] = min(▸cap)` |
| `no_op` | `null` | no effect |

`DirectiveEffects` (`src/common/types.ts`) is produced once in
`OptimizerService.buildEffects` and consumed by **both** the optimizer and the
replay validator, so the meaning of each directive can never diverge between the
solver and the checker.

## Guardrail rules (deterministic)

Applied per note in `GuardrailValidatorService.validateRaw`. The LLM's JSON is
**untrusted** until it passes:

| Rule | Acceptance |
|---|---|
| `note_index` | integer, in `0..noteCount-1`, must equal the index of the note being interpreted |
| `applies` | boolean; `true` for all non-`no_op`, `false` exactly for `no_op` |
| `directive_type` | one of the six |
| `structured_adjustment.hours` | array, non-empty, integers 0..23, unique, ascending |
| `factor` (solar) | finite, in `[0,1]` |
| `minimum_energy_kwh` (reserve) | finite, non-negative, ≤ capacity |
| `max_grid_kwh` (grid cap) | finite, non-negative |
| key sets | only `hours` (+ the type-specific number); unexpected keys are rejected |

Failure → one guardrail-feedback reprompt (see `LLM_NOTES.md`), then the
heuristic fallback, then a controlled error — never a fabricated directive.

## Hours semantics

- `hours` is a **direct list of hours** (the LLM reports the exact array; no
  start/end conversion happens in the engine). Shared `hours` construction keeps
  LLM output and ground truth comparable.
- Covered in the replays and in `docs/test-cases.json` cases; windows that reach
  into the next day are not expressible (the horizon is exactly 0..23).

## Judging nuance

The judge replays the returned plan against its **own** interpretation, so:
- interpretation `type` + `hours` + numeric value must match the reference,
- the schedule must be feasible under those reference semantics,
- totals must match the reference optimum within the 0.01 tolerance.

`scripts/test-doc-cases.spec.ts` mirrors this: it replays each produced plan
against `docs/test-cases.json` reference interpretations and expected totals.