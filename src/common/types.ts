import type { BatteryAction, DirectiveType } from './constants.js';

export interface HourInput {
  hour: number;
  demand_kwh: number;
  solar_kwh: number;
  tariff_bdt_per_kwh: number;
}

export interface BatteryInput {
  capacity_kwh: number;
  initial_energy_kwh: number;
  minimum_energy_kwh: number;
  max_charge_kwh_per_hour: number;
  max_discharge_kwh_per_hour: number;
}

export interface OptimizeEnergyRequest {
  scenario_id: string;
  operator_notes: string[];
  hours: HourInput[];
  battery: BatteryInput;
}

export interface StructuredAdjustment {
  hours: number[];
  factor?: number;
  minimum_energy_kwh?: number;
  max_grid_kwh?: number;
}

export interface DirectiveInterpretation {
  note_index: number;
  applies: boolean;
  directive_type: DirectiveType;
  structured_adjustment: StructuredAdjustment | null;
  explanation: string;
}

export interface HourlyPlanEntry {
  hour: number;
  grid_kwh: number;
  solar_used_kwh: number;
  battery_action: BatteryAction;
  battery_kwh: number;
  battery_energy_after_kwh: number;
}

export interface OptimizeEnergyResponse {
  scenario_id: string;
  directive_interpretation: DirectiveInterpretation[];
  hourly_plan: HourlyPlanEntry[];
  total_grid_kwh: number;
  total_cost_bdt: number;
  peak_grid_kwh: number;
  plan_summary: string;
}

export interface DirectiveEffects {
  effectiveSolar: number[];
  activeMinReserve: number[];
  noChargeHours: Set<number>;
  noDischargeHours: Set<number>;
  maxGridPerHour: number[];
}

export interface OptimizerOutput {
  plan: HourlyPlanEntry[];
  effects: DirectiveEffects;
  totalGridKwh: number;
  totalCostBdt: number;
  peakGridKwh: number;
}

export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};