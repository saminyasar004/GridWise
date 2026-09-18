import { Injectable, Logger } from '@nestjs/common';
import lpSolverModule from 'javascript-lp-solver';
import { HOURS_PER_DAY, JUDGE_TOLERANCE_KWH, LP_EPSILON, NEAR_ZERO, NUMBER_ROUNDING } from '../common/constants.js';
import { OptimizerInfeasibleException } from '../common/errors.js';
import type {
  BatteryInput,
  DirectiveEffects,
  DirectiveInterpretation,
  HourInput,
  HourlyPlanEntry,
  OptimizerOutput,
  OptimizeEnergyRequest,
} from '../common/types.js';

interface LpSolveFacade {
  Solve(model: Record<string, unknown>): {
    feasible: boolean;
    result: number;
    [variable: string]: number | boolean | undefined;
  } | null;
}

interface LpResult {
  feasible: boolean;
  result: number;
  [variable: string]: number | boolean | undefined;
}

const lpSolve = (lpSolverModule as unknown as LpSolveFacade).Solve.bind(lpSolverModule as unknown as Record<string, unknown>) as (model: Record<string, unknown>) => { feasible: boolean; result: number; [variable: string]: number | boolean | undefined; } | null;

@Injectable()
export class OptimizerService {
  private readonly logger = new Logger('OptimizerService');

  buildEffects(
    hours: HourInput[],
    battery: BatteryInput,
    interpretations: DirectiveInterpretation[],
  ): DirectiveEffects {
    const effectiveSolar = hours.map((hour) => hour.solar_kwh);
    const activeMinReserve = new Array<number>(HOURS_PER_DAY).fill(battery.minimum_energy_kwh);
    const noChargeHours = new Set<number>();
    const noDischargeHours = new Set<number>();
    const maxGridPerHour = new Array<number>(HOURS_PER_DAY).fill(Infinity);

    for (const interpretation of interpretations) {
      if (!interpretation.applies) continue;
      const adjustment = interpretation.structured_adjustment;
      if (!adjustment) continue;
      for (const hour of adjustment.hours) {
        switch (interpretation.directive_type) {
          case 'solar_reduction':
            effectiveSolar[hour] *= adjustment.factor ?? 1;
            break;
          case 'minimum_battery_reserve':
            activeMinReserve[hour] = Math.max(activeMinReserve[hour], adjustment.minimum_energy_kwh ?? battery.minimum_energy_kwh);
            break;
          case 'no_charge_window':
            noChargeHours.add(hour);
            break;
          case 'no_discharge_window':
            noDischargeHours.add(hour);
            break;
          case 'max_grid_window':
            maxGridPerHour[hour] = Math.min(maxGridPerHour[hour], adjustment.max_grid_kwh ?? Infinity);
            break;
          default:
            break;
        }
      }
    }

    return { effectiveSolar, activeMinReserve, noChargeHours, noDischargeHours, maxGridPerHour };
  }

  optimize(
    request: OptimizeEnergyRequest,
    effects: DirectiveEffects,
  ): OptimizerOutput {
    if (effects.effectiveSolar.length !== HOURS_PER_DAY) {
      throw new OptimizerInfeasibleException();
    }
    const model = this.buildModel(request, effects);
    const result = lpSolve(model);

    if (!result || result.feasible !== true) {
      this.logger.error(`LP infeasible for scenario ${request.scenario_id}`);
      throw new OptimizerInfeasibleException();
    }

    const plan = this.buildPlan(request, result, effects);
    const peak = Math.max(...plan.map((entry) => entry.grid_kwh), 0);
    let totalGridKwh = 0;
    let totalCostBdt = 0;
    for (const entry of plan) {
      totalGridKwh += entry.grid_kwh;
      totalCostBdt += entry.grid_kwh * request.hours[entry.hour].tariff_bdt_per_kwh;
    }

    return {
      plan,
      effects,
      totalGridKwh: this.round(totalGridKwh),
      totalCostBdt: this.round(totalCostBdt),
      peakGridKwh: this.round(peak),
    };
  }

  private buildModel(
    request: OptimizeEnergyRequest,
    effects: DirectiveEffects,
  ): Record<string, unknown> {
    const battery = request.battery;
    const cap = battery.capacity_kwh;
    const init = battery.initial_energy_kwh;
    const min = battery.minimum_energy_kwh;
    const maxCh = battery.max_charge_kwh_per_hour;
    const maxDis = battery.max_discharge_kwh_per_hour;
    const constraints: Record<string, { equal?: number; max?: number; min?: number }> = {};
    const variables: Record<string, Record<string, number | boolean>> = {};

    for (let h = 0; h < HOURS_PER_DAY; h += 1) {
      const g = `grid_${h}`;
      const s = `solar_${h}`;
      const c = `charge_${h}`;
      const d = `discharge_${h}`;
      const b = `batt_${h}`;

      constraints[`balance_${h}`] = { equal: request.hours[h].demand_kwh };
      constraints[`solarcap_${h}`] = { max: effects.effectiveSolar[h] };
      constraints[`battcap_${h}`] = { max: cap };
      constraints[`battmin_${h}`] = { min: effects.activeMinReserve[h] };
      constraints[`chmax_${h}`] = { max: maxCh };
      constraints[`dismax_${h}`] = { max: maxDis };

      variables[g] = { [`balance_${h}`]: 1, cost: request.hours[h].tariff_bdt_per_kwh };
      variables[s] = { [`balance_${h}`]: 1, [`solarcap_${h}`]: 1, cost: 0 };
      variables[c] = { [`balance_${h}`]: -1, [`chmax_${h}`]: 1, cost: LP_EPSILON };
      variables[d] = { [`balance_${h}`]: 1, [`dismax_${h}`]: 1, cost: LP_EPSILON };
      variables[b] = { [`battcap_${h}`]: 1, [`battmin_${h}`]: 1, cost: 0 };

      if (effects.noChargeHours.has(h)) {
        constraints[`nochg_${h}`] = { equal: 0 };
        variables[c][`nochg_${h}`] = 1;
      }
      if (effects.noDischargeHours.has(h)) {
        constraints[`nodis_${h}`] = { equal: 0 };
        variables[d][`nodis_${h}`] = 1;
      }
      if (Number.isFinite(effects.maxGridPerHour[h])) {
        constraints[`maxgrid_${h}`] = { max: effects.maxGridPerHour[h] };
        variables[g][`maxgrid_${h}`] = 1;
      }

      if (h === 0) {
        constraints[`state_${h}`] = { equal: init };
        variables[b][`state_${h}`] = 1;
        variables[d][`state_${h}`] = 1;
        variables[c][`state_${h}`] = -1;
      } else {
        constraints[`state_${h}`] = { equal: 0 };
        variables[b][`state_${h}`] = 1;
        variables[`batt_${h - 1}`][`state_${h}`] = -1;
        variables[d][`state_${h}`] = 1;
        variables[c][`state_${h}`] = -1;
      }
    }

    constraints.final_state = { equal: init };
    variables[`batt_${HOURS_PER_DAY - 1}`].final_state = 1;

    return {
      name: `gridwise_${request.scenario_id}`,
      optimize: 'cost',
      opType: 'min',
      constraints,
      variables,
    };
  }

  private buildPlan(
    request: OptimizeEnergyRequest,
    result: LpResult,
    effects: DirectiveEffects,
  ): HourlyPlanEntry[] {
    const cap = request.battery.capacity_kwh;
    const init = Math.min(request.battery.initial_energy_kwh, cap);
    const plan: HourlyPlanEntry[] = [];
    let energy = init;

    for (let h = 0; h < HOURS_PER_DAY; h += 1) {
      const charge = this.num(result[`charge_${h}`]);
      const discharge = this.num(result[`discharge_${h}`]);

      let batteryAction: 'charge' | 'discharge' | 'idle' = 'idle';
      let batteryKwh = 0;
      if (charge > NEAR_ZERO && charge >= discharge) {
        batteryAction = 'charge';
        batteryKwh = charge;
      } else if (discharge > NEAR_ZERO) {
        batteryAction = 'discharge';
        batteryKwh = discharge;
      }

      if (batteryAction === 'charge') {
        energy = Math.min(cap, energy + batteryKwh);
      } else if (batteryAction === 'discharge') {
        energy = Math.max(0, energy - batteryKwh);
      }

      plan.push({
        hour: request.hours[h].hour,
        grid_kwh: this.round(this.num(result[`grid_${h}`])),
        solar_used_kwh: this.round(this.num(result[`solar_${h}`])),
        battery_action: batteryAction,
        battery_kwh: this.round(batteryKwh),
        battery_energy_after_kwh: this.round(energy),
      });
    }

    return plan;
  }

  private num(value: number | boolean | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private round(value: number): number {
    const factor = 10 ** NUMBER_ROUNDING;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
}
