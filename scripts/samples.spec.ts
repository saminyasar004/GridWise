import { describe, expect, it } from 'vitest';
import type {
  BatteryInput,
  DirectiveEffects,
  HourInput,
  OptimizeEnergyRequest,
} from '../src/common/types.js';
import {
  HOURS_PER_DAY,
  JUDGE_TOLERANCE_KWH,
} from '../src/common/constants.js';
import { OptimizerService } from '../src/optimizer/optimizer.service.js';

function scenarioHours(): HourInput[] {
  return Array.from({ length: HOURS_PER_DAY }, (_, hour) => ({
    hour,
    demand_kwh: hour >= 8 && hour <= 22 ? 42 : 18,
    solar_kwh: hour >= 6 && hour <= 18 ? 20 : 0,
    tariff_bdt_per_kwh: hour >= 8 && hour <= 22 ? 11 : 5,
  }));
}

function scenarioBattery(): BatteryInput {
  return {
    capacity_kwh: 80,
    initial_energy_kwh: 40,
    minimum_energy_kwh: 15,
    max_charge_kwh_per_hour: 14,
    max_discharge_kwh_per_hour: 14,
  };
}

function noOpEffects(): DirectiveEffects {
  const hours = scenarioHours();
  return {
    effectiveSolar: hours.map((h) => h.solar_kwh),
    activeMinReserve: hours.map(() => 15),
    noChargeHours: new Set<number>(),
    noDischargeHours: new Set<number>(),
    maxGridPerHour: hours.map(() => Infinity),
  };
}

describe('sample cases', () => {
  it('runs the default 24-hour scenario through the real LP optimizer', () => {
    const optimizer = new OptimizerService();
    const request: OptimizeEnergyRequest = {
      scenario_id: 'sample-default',
      operator_notes: ['Prioritize solar self-consumption and shave the evening peak.'],
      hours: scenarioHours(),
      battery: scenarioBattery(),
    };
    const output = optimizer.optimize(request, noOpEffects());

    expect(output.plan).toHaveLength(HOURS_PER_DAY);
    for (const entry of output.plan) {
      expect(entry.grid_kwh).toBeGreaterThanOrEqual(-JUDGE_TOLERANCE_KWH);
      expect(Number.isFinite(entry.battery_energy_after_kwh)).toBe(true);
    }
    expect(output.totalGridKwh).toBeGreaterThan(0);
    expect(output.totalCostBdt).toBeGreaterThan(0);
    expect(output.peakGridKwh).toBeGreaterThan(0);
  });

  it('runs a peak-heavy winter-style scenario and stays feasible', () => {
    const optimizer = new OptimizerService();
    const hours = scenarioHours().map((h) => ({
      ...h,
      demand_kwh: h.demand_kwh + (h.hour >= 18 && h.hour <= 21 ? 30 : 0),
      solar_kwh: Math.max(0, h.solar_kwh - 10),
    }));
    const request: OptimizeEnergyRequest = {
      scenario_id: 'sample-winter-evening-peak',
      operator_notes: ['Every evening peak hour is priority; keep export zero.'],
      hours,
      battery: scenarioBattery(),
    };
    const output = optimizer.optimize(request, noOpEffects());

    expect(output.plan).toHaveLength(HOURS_PER_DAY);
    const evening = output.plan.filter((e) => e.hour >= 18 && e.hour <= 21);
    expect(evening.length).toBe(4);
    for (const entry of output.plan) {
      expect(entry.grid_kwh).toBeGreaterThanOrEqual(-JUDGE_TOLERANCE_KWH);
    }
    expect(output.totalCostBdt).toBeGreaterThan(0);
    expect(output.peakGridKwh).toBeGreaterThan(0);
  });
});