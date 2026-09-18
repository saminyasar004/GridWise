import { Injectable, Logger } from '@nestjs/common';
import {
  HOURS_PER_DAY,
  JUDGE_TOLERANCE_BDT,
  JUDGE_TOLERANCE_KWH,
} from '../common/constants.js';
import { FinalReplayException } from '../common/errors.js';
import type {
  DirectiveEffects,
  DirectiveInterpretation,
  HourInput,
  HourlyPlanEntry,
  OptimizeEnergyRequest,
} from '../common/types.js';
import { OptimizerService } from '../optimizer/optimizer.service.js';

@Injectable()
export class FinalValidatorService {
  private readonly logger = new Logger('FinalValidatorService');

  constructor(private readonly optimizerService: OptimizerService) {}

  /**
   * Full independent replay of the plan under the exact same constraints
   * used by the solver, checked against the judge tolerance. This is the
   * last defensive check before the response is returned to the caller.
   * Only throws when a constraint is violated by more than the tolerance.
   */
  replay(
    plan: HourlyPlanEntry[],
    interpretations: DirectiveInterpretation[],
    request: OptimizeEnergyRequest,
    effects: DirectiveEffects,
  ): void {
    const issues: string[] = [];

    if (plan.length !== HOURS_PER_DAY) {
      issues.push(
        `Plan must contain ${HOURS_PER_DAY} entries; got ${plan.length}`,
      );
    }

    const battery = request.battery;
    const cap = battery.capacity_kwh;
    const initial = battery.initial_energy_kwh;

    let energy = initial;

    for (let h = 0; h < plan.length; h += 1) {
      const entry = plan[h];
      const hour = request.hours[h];
      const tol = JUDGE_TOLERANCE_KWH;

      // non-negativity
      if (entry.grid_kwh < -tol) {
        issues.push(`hour ${h}: grid_kwh must be non-negative`);
      }
      if (entry.solar_used_kwh < -tol) {
        issues.push(`hour ${h}: solar_used_kwh must be non-negative`);
      }
      if (entry.battery_kwh < -tol) {
        issues.push(`hour ${h}: battery_kwh must be non-negative`);
      }
      if (entry.battery_energy_after_kwh < -tol) {
        issues.push(`hour ${h}: battery_energy_after_kwh must be non-negative`);
      }

      // solar cap
      const effSolar = effects.effectiveSolar[h];
      if (entry.solar_used_kwh > effSolar + tol) {
        issues.push(
          `hour ${h}: solar_used_kwh (${entry.solar_used_kwh}) exceeds effective solar (${effSolar.toFixed(4)})`,
        );
      }

      // balance
      const charge =
        entry.battery_action === 'charge' ? entry.battery_kwh : 0;
      const discharge =
        entry.battery_action === 'discharge' ? entry.battery_kwh : 0;
      const balance =
        entry.grid_kwh + entry.solar_used_kwh + discharge - charge;
      if (Math.abs(balance - hour.demand_kwh) > tol) {
        issues.push(
          `hour ${h}: balance (${balance.toFixed(4)}) ≠ demand (${hour.demand_kwh})`,
        );
      }

      // charge / discharge in wrong windows
      if (effects.noChargeHours.has(h) && charge > tol) {
        issues.push(
          `hour ${h}: charge action ${charge.toFixed(4)} inside no-charge window`,
        );
      }
      if (effects.noDischargeHours.has(h) && discharge > tol) {
        issues.push(
          `hour ${h}: discharge action ${discharge.toFixed(4)} inside no-discharge window`,
        );
      }

      // max grid cap
      if (Number.isFinite(effects.maxGridPerHour[h])) {
        if (entry.grid_kwh > effects.maxGridPerHour[h] + tol) {
          issues.push(
            `hour ${h}: grid_kwh (${entry.grid_kwh}) exceeds cap (${effects.maxGridPerHour[h]})`,
          );
        }
      }

      // capacity
      if (entry.battery_energy_after_kwh > cap + tol) {
        issues.push(
          `hour ${h}: energy_after (${entry.battery_energy_after_kwh}) exceeds capacity (${cap})`,
        );
      }

      // reserve
      if (entry.battery_energy_after_kwh < effects.activeMinReserve[h] - tol) {
        issues.push(
          `hour ${h}: energy_after (${entry.battery_energy_after_kwh}) below reserve (${effects.activeMinReserve[h]})`,
        );
      }

      // state continuity (recomputed from plan actions for rounding safety)
      energy = Math.max(
        0,
        Math.min(
          cap,
          energy + (entry.battery_action === 'charge' ? entry.battery_kwh : 0) - (entry.battery_action === 'discharge' ? entry.battery_kwh : 0),
        ),
      );
      if (Math.abs(energy - entry.battery_energy_after_kwh) > tol) {
        issues.push(
          `hour ${h}: recomputed energy_after (${energy.toFixed(4)}) differs from plan (${entry.battery_energy_after_kwh})`,
        );
      }
    }

    if (Math.abs(energy - initial) > JUDGE_TOLERANCE_KWH) {
      issues.push(
        `final battery (${energy.toFixed(4)}) does not equal initial (${initial})`,
      );
    }

    if (issues.length > 0) {
      this.logger.error(
        `Final validation failed for scenario ${request.scenario_id}:`,
        issues,
      );
      throw new FinalReplayException(
        'Plan failed final constraint validation',
        issues,
      );
    }
  }
}