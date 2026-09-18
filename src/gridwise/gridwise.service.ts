import { Injectable, Logger } from '@nestjs/common';
import {
  DirectiveInterpretation,
  OptimizeEnergyRequest,
  OptimizeEnergyResponse,
} from '../common/types.js';
import { InMemoryCacheService } from '../common/cache.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { LlmInterpreterService } from '../llm/llm-interpreter.service.js';
import { OptimizerService } from '../optimizer/optimizer.service.js';
import { FinalValidatorService } from '../validator/final-validator.service.js';
import { RequestTimeoutException } from '../common/errors.js';

@Injectable()
export class GridwiseService {
  private readonly logger = new Logger('GridwiseService');
  constructor(
    private readonly llmInterpreter: LlmInterpreterService,
    private readonly optimizer: OptimizerService,
    private readonly validator: FinalValidatorService,
    private readonly cache: InMemoryCacheService,
    private readonly config: AppConfigService,
  ) {}

  async doOptimize(request: OptimizeEnergyRequest): Promise<OptimizeEnergyResponse> {
    const cacheKey = InMemoryCacheService.hashPayload(request);
    if (this.config.cacheEnabled) {
      const cached = this.cache.get<OptimizeEnergyResponse>(cacheKey);
      if (cached !== undefined) {
        this.logger.debug(`Cache hit for scenario ${request.scenario_id}`);
        return cached;
      }
    }
    const result = await this.withTimeout(this.execute(request));
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, result);
    }
    return result;
  }

  private async execute(request: OptimizeEnergyRequest): Promise<OptimizeEnergyResponse> {
    const interpretations = await this.llmInterpreter.interpretAll(
      request.operator_notes,
      request.battery,
    );
    const effects = this.optimizer.buildEffects(
      request.hours,
      request.battery,
      interpretations,
    );
    const { plan, totalGridKwh, totalCostBdt, peakGridKwh } =
      this.optimizer.optimize(request, effects);
    this.validator.replay(plan, interpretations, request, effects);
    const planSummary = this.buildPlanSummary(interpretations);
    return {
      scenario_id: request.scenario_id,
      directive_interpretation: interpretations,
      hourly_plan: plan,
      total_grid_kwh: totalGridKwh,
      total_cost_bdt: totalCostBdt,
      peak_grid_kwh: peakGridKwh,
      plan_summary: planSummary,
    };
  }

  private buildPlanSummary(interpretations: DirectiveInterpretation[]): string {
    const applied = interpretations.filter(
      (i) => i.applies && i.directive_type !== 'no_op',
    );
    if (applied.length === 0) {
      return 'No operator directives applied to the energy plan.';
    }
    const parts = applied.map((i) => {
      const adj = i.structured_adjustment;
      switch (i.directive_type) {
        case 'solar_reduction':
          return `Solar reduced to ${(adj!.factor! * 100).toFixed(0)}% during the ${this.hoursLabel(adj!.hours)} window`;
        case 'minimum_battery_reserve':
          return `Minimum battery reserve of ${adj!.minimum_energy_kwh!.toFixed(0)} kWh during the ${this.hoursLabel(adj!.hours)} window`;
        case 'no_charge_window':
          return `Battery charging disabled during the ${this.hoursLabel(adj!.hours)} window`;
        case 'no_discharge_window':
          return `Battery discharging disabled during the ${this.hoursLabel(adj!.hours)} window`;
        case 'max_grid_window':
          return `Grid import capped at ${adj!.max_grid_kwh!.toFixed(0)} kWh during the ${this.hoursLabel(adj!.hours)} window`;
        default:
          return i.explanation;
      }
    });
    return parts.join('; ') + '.';
  }

  private hoursLabel(hours: number[]): string {
    if (hours.length === 0) return '';
    const first = hours[0];
    const last = hours[hours.length - 1];
    if (hours.length === 1) return `hour ${first}`;
    return `hours ${first}–${last}`;
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    const ms = this.config.requestTimeoutMs;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new RequestTimeoutException()), ms);
      }),
    ]);
  }
}