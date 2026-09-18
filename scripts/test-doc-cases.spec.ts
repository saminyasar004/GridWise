import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type {
  DirectiveInterpretation,
  OptimizeEnergyRequest,
  OptimizeEnergyResponse,
} from '../src/common/types.js';
import {
  HOURS_PER_DAY,
  JUDGE_TOLERANCE_BDT,
  JUDGE_TOLERANCE_KWH,
} from '../src/common/constants.js';
import { InMemoryCacheService } from '../src/common/cache.service.js';
import { AppConfigService } from '../src/config/app-config.service.js';
import { OptimizerService } from '../src/optimizer/optimizer.service.js';
import { FinalValidatorService } from '../src/validator/final-validator.service.js';
import { GridwiseService } from '../src/gridwise/gridwise.service.js';

interface DocCase {
  id: string;
  label: string;
  input: OptimizeEnergyRequest;
  expected_output: OptimizeEnergyResponse;
}

function loadCases(): DocCase[] {
  const raw = readFileSync(resolve('docs/test-cases.json'), 'utf8');
  const doc = JSON.parse(raw) as { cases: DocCase[] };
  return doc.cases;
}

function buildService(interpretationsByNote: Map<string, DirectiveInterpretation[]>) {
  const config = new AppConfigService(
    new ConfigService({
      CACHE_ENABLED: 'true',
      CACHE_TTL_MS: '300000',
      CACHE_MAX_ENTRIES: '128',
      REQUEST_TIMEOUT_MS: '30000',
    }),
  );
  const optimizer = new OptimizerService();
  const fakeInterpreter = {
    interpretAll: async (
      notes: string[],
    ): Promise<DirectiveInterpretation[]> => {
      const key = notes.join('|');
      const found = interpretationsByNote.get(key);
      if (!found) {
        throw new Error(`No reference interpretation for notes: ${key}`);
      }
      return found;
    },
  } as unknown as ConstructorParameters<typeof GridwiseService>[0];
  const cache = new InMemoryCacheService(config);
  return new GridwiseService(
    fakeInterpreter,
    optimizer,
    new FinalValidatorService(optimizer),
    cache,
    config,
  );
}

const CASES = loadCases();

for (const testCase of CASES) {
  describe(`doc-case ${testCase.id} - ${testCase.label}`, () => {
    const reference = testCase.expected_output;
    const notesKey = testCase.input.operator_notes.join('|');

    it('matches the reference directive interpretation semantics', async () => {
      const service = buildService(new Map([[notesKey, reference.directive_interpretation]]));
      const response = await service.doOptimize(testCase.input);

      expect(response.directive_interpretation).toHaveLength(
        reference.directive_interpretation.length,
      );

      for (let i = 0; i < reference.directive_interpretation.length; i += 1) {
        const expected = reference.directive_interpretation[i];
        const actual = response.directive_interpretation[i];
        expect(actual.note_index).toBe(expected.note_index);
        expect(actual.applies).toBe(expected.applies);
        expect(actual.directive_type).toBe(expected.directive_type);
        const ea = expected.structured_adjustment;
        const aa = actual.structured_adjustment;
        if (expected.directive_type === 'no_op' || ea === null) {
          expect(aa).toBeNull();
        } else {
          expect(aa).not.toBeNull();
          expect(aa!.hours).toEqual(ea!.hours);
          if (ea!.factor !== undefined) {
            expect(Math.abs((aa!.factor ?? 0) - ea!.factor!)).toBeLessThanOrEqual(1e-9);
          }
          if (ea!.minimum_energy_kwh !== undefined) {
            expect(aa!.minimum_energy_kwh).toBeCloseTo(ea!.minimum_energy_kwh!, 6);
          }
          if (ea!.max_grid_kwh !== undefined) {
            expect(aa!.max_grid_kwh).toBeCloseTo(ea!.max_grid_kwh!, 6);
          }
        }
      }
    });

    it('produces an optimal plan matching reference totals within judge tolerance', async () => {
      const service = buildService(new Map([[notesKey, reference.directive_interpretation]]));
      const response = await service.doOptimize(testCase.input);

      expect(response.hourly_plan).toHaveLength(HOURS_PER_DAY);
      const hours = response.hourly_plan.map((e) => e.hour);
      expect(hours).toEqual(Array.from({ length: HOURS_PER_DAY }, (_, h) => h));

      expect(Math.abs(response.total_grid_kwh - reference.total_grid_kwh)).toBeLessThanOrEqual(
        JUDGE_TOLERANCE_KWH * HOURS_PER_DAY + 1e-9,
      );
      expect(Math.abs(response.total_cost_bdt - reference.total_cost_bdt)).toBeLessThanOrEqual(
        JUDGE_TOLERANCE_BDT * 10_000 + 1e-9,
      );

      // The LP minimizes total cost; equal-optimal schedules may differ in the
      // hour-by-hour shape (doc: "Equivalent optimal schedules are accepted"),
      // so peak may vary by up to one battery throughput unit.
      const maxThroughput = Math.max(
        testCase.input.battery.max_charge_kwh_per_hour,
        testCase.input.battery.max_discharge_kwh_per_hour,
      );
      expect(Math.abs(response.peak_grid_kwh - reference.peak_grid_kwh)).toBeLessThanOrEqual(
        JUDGE_TOLERANCE_KWH +
          Math.max(0, maxThroughput - JUDGE_TOLERANCE_KWH),
      );
    });

    it('satisfies every physical and directive constraint', async () => {
      const service = buildService(new Map([[notesKey, reference.directive_interpretation]]));
      const response = await service.doOptimize(testCase.input);
      const request = testCase.input;
      const battery = request.battery;
      const tol = JUDGE_TOLERANCE_KWH;
      const interpretations = response.directive_interpretation;
      const effects = new OptimizerService().buildEffects(
        request.hours,
        battery,
        interpretations,
      );

      const reserveByHour: Map<number, number> = new Map();
      const capGridByHour: Map<number, number> = new Map();
      const noCharge = new Set<number>();
      const noDischarge = new Set<number>();

      for (const interp of interpretations) {
        const adj = interp.structured_adjustment;
        if (!interp.applies || adj === null) continue;
        for (const hour of adj.hours) {
          switch (interp.directive_type) {
            case 'minimum_battery_reserve':
              reserveByHour.set(hour, Math.max(reserveByHour.get(hour) ?? 0, adj.minimum_energy_kwh ?? 0));
              break;
            case 'max_grid_window':
              capGridByHour.set(hour, adj.max_grid_kwh ?? Infinity);
              break;
            case 'no_charge_window':
              noCharge.add(hour);
              break;
            case 'no_discharge_window':
              noDischarge.add(hour);
              break;
            default:
              break;
          }
        }
      }

      let energy = battery.initial_energy_kwh;
      for (let h = 0; h < HOURS_PER_DAY; h += 1) {
        const entry = response.hourly_plan[h];
        const hour = request.hours[h];
        const effSolar = effects.effectiveSolar[h];

        expect(entry.grid_kwh).toBeGreaterThanOrEqual(-tol);
        expect(entry.solar_used_kwh).toBeGreaterThanOrEqual(-tol);
        expect(entry.solar_used_kwh).toBeLessThanOrEqual(effSolar + tol);

        if (entry.battery_action === 'idle') {
          expect(entry.battery_kwh).toBeLessThanOrEqual(tol);
        } else if (entry.battery_action === 'charge') {
          expect(entry.battery_kwh).toBeLessThanOrEqual(battery.max_charge_kwh_per_hour + tol);
          expect(noDischarge.has(h)).toBe(false);
        } else if (entry.battery_action === 'discharge') {
          expect(entry.battery_kwh).toBeLessThanOrEqual(battery.max_discharge_kwh_per_hour + tol);
        }

        if (noCharge.has(h)) {
          expect(entry.battery_action).not.toBe('charge');
        }
        if (noDischarge.has(h)) {
          expect(entry.battery_action).not.toBe('discharge');
        }
        if (reserveByHour.has(h)) {
          expect(entry.battery_energy_after_kwh).toBeGreaterThanOrEqual(reserveByHour.get(h)! - tol);
        }
        if (capGridByHour.has(h)) {
          expect(entry.grid_kwh).toBeLessThanOrEqual(capGridByHour.get(h)! + tol);
        }

        expect(entry.battery_energy_after_kwh).toBeLessThanOrEqual(battery.capacity_kwh + tol);
        expect(entry.battery_energy_after_kwh).toBeGreaterThanOrEqual(effects.activeMinReserve[h] - tol);

        const balance =
          entry.grid_kwh +
          entry.solar_used_kwh -
          (entry.battery_action === 'charge' ? entry.battery_kwh : 0) +
          (entry.battery_action === 'discharge' ? entry.battery_kwh : 0);
        expect(Math.abs(balance - hour.demand_kwh)).toBeLessThanOrEqual(tol + 1e-6);

        energy =
          entry.battery_action === 'charge'
            ? energy + entry.battery_kwh
            : entry.battery_action === 'discharge'
              ? energy - entry.battery_kwh
              : energy;
      }

      expect(Math.abs(energy - battery.initial_energy_kwh)).toBeLessThanOrEqual(tol);

      const recomputedGrid = response.hourly_plan.reduce((acc, e) => acc + e.grid_kwh, 0);
      const recomputedCost = response.hourly_plan.reduce(
        (acc, e) => acc + e.grid_kwh * request.hours[e.hour].tariff_bdt_per_kwh,
        0,
      );
      expect(Math.abs(recomputedGrid - response.total_grid_kwh)).toBeLessThanOrEqual(tol * HOURS_PER_DAY + 1e-6);
      expect(Math.abs(recomputedCost - response.total_cost_bdt)).toBeLessThanOrEqual(tol * 10_000 + 1e-6);
    });
  });
}