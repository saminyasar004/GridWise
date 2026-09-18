# GridWise — Project Documentation

BUP CSE Fest 2026 · Online Preliminary · Grid Energy Optimization Challenge

This directory documents the shipped NestJS/TypeScript implementation. The
planning pack that drove the build lives in [`../fable-plan/`](../fable-plan/)
(score mapping, minute-by-minute schedule, reference Python code).

## Read in this order

| # | File | Use it for |
|---|---|---|
| 01 | `ARCHITECTURE.md` | Components, request lifecycle, LP formulation, data contracts |
| 02 | `DIRECTIVES.md` | The six directive types, guardrail rules, and how notes reach the math |
| 03 | `WORKFLOW.md` | Request lifecycle, failure paths, dev/test/release workflows |
| 04 | `LLM_NOTES.md` | Prompt rationale, provider config, fallback behaviour, test set tips |
| 05 | `DEPLOYMENT.md` | Docker, compose, VPS + Nginx steps, ops checklist |

## The three facts that shape the implementation

1. **The optimizer is a plain linear program.** No battery-efficiency loss, no
   grid export. A 120-variable LP (`javascript-lp-solver`) reproduces the reference
   optimal cost on all 10 public samples (verified via `npm run test:docs`).
2. **The LLM extracts language, not math.** Guardrails convert speech to structure;
   the optimizer only consumes guardrail-approved directives.
3. **A replay validator mirrors the judge.** Before any response leaves the service,
   the plan is re-checked hour by hour against the very constraints it was built with.

## Quick check commands

```bash
npm test              # unit suites
npm run test:e2e      # full HTTP lifecycle against the app
npm run test:samples  # standalone sample scenario runner
npm run test:docs     # all 10 public cases in docs/test-cases.json (30 assertions)
npx tsc --noEmit      # type check
npm run lint          # Oxlint
npm run build         # tsc + nest build
```