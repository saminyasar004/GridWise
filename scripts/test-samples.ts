import type {
  BatteryInput,
  DirectiveEffects,
  HourInput,
  OptimizeEnergyRequest,
  OptimizerOutput,
} from '../src/common/types.js';
import { HOURS_PER_DAY, JUDGE_TOLERANCE_KWH } from '../src/common/constants.js';
import { OptimizerService } from '../src/optimizer/optimizer.service.js';

function buildSampleHours(): HourInput[] {
  return Array.from({ length: HOURS_PER_DAY }, (_, hour) => ({
    hour,
    demand_kwh: (hour >= 8 && hour <= 22 ? 34 : 16) + (hour % 4 === 0 ? 8 : 0),
    solar_kwh: hour >= 6 && hour <= 18 ? 18 : 0,
    tariff_bdt_per_kwh: hour >= 8 && hour <= 22 ? 11 : 6,
  }));
}

function buildSampleBattery(): BatteryInput {
  return {
    capacity_kwh: 60,
    initial_energy_kwh: 30,
    minimum_energy_kwh: 10,
    max_charge_kwh_per_hour: 12,
    max_discharge_kwh_per_hour: 12,
  };
}

function buildNoOpEffects(): DirectiveEffects {
  return {
    effectiveSolar: buildSampleHours().map((h) => h.solar_kwh),
    activeMinReserve: buildSampleHours().map(() => 10),
    noChargeHours: new Set<number>(),
    noDischargeHours: new Set<number>(),
    maxGridPerHour: buildSampleHours().map(() => Infinity),
  };
}

function assertPlanValidity(output: OptimizerOutput): void {
  if (output.plan.length !== HOURS_PER_DAY) {
    throw new Error(`plan length ${output.plan.length} != ${HOURS_PER_DAY}`);
  }
  for (const entry of output.plan) {
    if (entry.grid_kwh < 0 && entry.grid_kwh < -JUDGE_TOLERANCE_KWH) {
      throw new Error(`negative grid_kwh at hour ${entry.hour}: ${entry.grid_kwh}`);
    }
  }
  if (Number.isNaN(output.totalCostBdt) || output.totalCostBdt < 0) {
    throw new Error(`bad total cost: ${output.totalCostBdt}`);
  }
  if (Number.isNaN(output.peakGridKwh) || output.peakGridKwh < 0) {
    throw new Error(`bad peak: ${output.peakGridKwh}`);
  }
}

function main(): void {
  const optimizer = new OptimizerService();
  const request: OptimizeEnergyRequest = {
    scenario_id: 'sample-001',
    operator_notes: ['Prioritize solar self-consumption and shave the evening peak.'],
    hours: buildSampleHours(),
    battery: buildSampleBattery(),
  };
  const output = optimizer.optimize(request, buildNoOpEffects());
  assertPlanValidity(output);
  console.log('Sample case passed: totalGridKwh=%s totalCostBdt=%s peakGridKwh=%s', output.totalGridKwh, output.totalCostBdt, output.peakGridKwh);
}

main();
