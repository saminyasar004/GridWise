export const HOURS_PER_DAY = 24;

export const DIRECTIVE_TYPES = [
  'solar_reduction',
  'minimum_battery_reserve',
  'no_charge_window',
  'no_discharge_window',
  'max_grid_window',
  'no_op',
] as const;

export type DirectiveType = (typeof DIRECTIVE_TYPES)[number];

export const BATTERY_ACTIONS = ['charge', 'discharge', 'idle'] as const;

export type BatteryAction = (typeof BATTERY_ACTIONS)[number];

export const NUMBER_ROUNDING = 4;

export const JUDGE_TOLERANCE_KWH = 0.01;

export const JUDGE_TOLERANCE_BDT = 0.01;

export const LP_EPSILON = 1e-6;

export const NEAR_ZERO = 1e-6;