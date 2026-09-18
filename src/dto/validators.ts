import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { HOURS_PER_DAY } from '../common/constants.js';
import type { HourInput } from '../common/types.js';

@ValidatorConstraint({ name: 'isCompleteHours', async: false })
export class IsCompleteHoursConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    if (value.length !== HOURS_PER_DAY) return false;
    const seen = Array.from({ length: HOURS_PER_DAY }, () => false);
    for (const entry of value) {
      if (entry === null || typeof entry !== 'object') return false;
      const { hour } = entry as Partial<HourInput>;
      if (
        typeof hour !== 'number' ||
        !Number.isInteger(hour) ||
        hour < 0 ||
        hour > 23
      ) {
        return false;
      }
      if (seen[hour]) return false;
      seen[hour] = true;
    }
    return seen.every(Boolean);
  }

  defaultMessage(): string {
    return 'hours must contain exactly 24 entries covering every hour 0 through 23 exactly once';
  }
}

@ValidatorConstraint({ name: 'nonEmptyStringArray', async: false })
export class NonEmptyStringArrayConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    if (value.length < 1 || value.length > 3) return false;
    return value.every(
      (item) => typeof item === 'string' && item.trim().length > 0,
    );
  }

  defaultMessage(): string {
    return 'operator_notes must contain 1 to 3 non-empty strings';
  }
}

@ValidatorConstraint({ name: 'batterySemantics', async: false })
export class BatterySemanticsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false;
    const battery = value as Record<string, unknown>;
    const capacity = battery.capacity_kwh;
    const initial = battery.initial_energy_kwh;
    const minimum = battery.minimum_energy_kwh;
    const maxCharge = battery.max_charge_kwh_per_hour;
    const maxDischarge = battery.max_discharge_kwh_per_hour;

    const isNonNegativeNumber = (n: unknown): boolean =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0;

    if (
      !isNonNegativeNumber(capacity) ||
      !isNonNegativeNumber(initial) ||
      !isNonNegativeNumber(minimum) ||
      !isNonNegativeNumber(maxCharge) ||
      !isNonNegativeNumber(maxDischarge)
    ) {
      return false;
    }

    const cap = capacity as number;
    const init = initial as number;
    const min = minimum as number;

    if (min > cap) return false;
    if (init > cap) return false;

    return true;
  }

  defaultMessage(): string {
    return 'battery values are semantically invalid (0 <= minimum <= capacity, 0 <= initial <= capacity, rates >= 0)';
  }
}