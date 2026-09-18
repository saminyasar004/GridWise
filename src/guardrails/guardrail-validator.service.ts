import { Injectable, Logger } from '@nestjs/common';
import { DIRECTIVE_TYPES } from '../common/constants.js';
import type { DirectiveType } from '../common/constants.js';
import type {
  BatteryInput,
  DirectiveInterpretation,
  StructuredAdjustment,
} from '../common/types.js';

export interface GuardrailContext {
  noteCount: number;
  battery: BatteryInput;
}

export interface GuardrailResult {
  ok: boolean;
  value: DirectiveInterpretation | null;
  reasons: string[];
}

interface RawAdjustment {
  hours?: unknown;
  factor?: unknown;
  minimum_energy_kwh?: unknown;
  max_grid_kwh?: unknown;
  [key: string]: unknown;
}

@Injectable()
export class GuardrailValidatorService {
  private readonly logger = new Logger('GuardrailValidatorService');

  /**
   * Deterministically validates an LLM-produced announcement object.
   * Never throws: returns reasons + a normalized value when valid.
   */
  validateRaw(
    input: unknown,
    context: GuardrailContext,
    expectedNoteIndex?: number,
  ): GuardrailResult {
    const reasons: string[] = [];

    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      reasons.push('output must be a JSON object');
      return { ok: false, value: null, reasons };
    }

    const raw = input as Record<string, unknown>;

    const noteIndex = raw.note_index;
    if (
      typeof noteIndex !== 'number' ||
      !Number.isInteger(noteIndex) ||
      noteIndex < 0 ||
      noteIndex >= context.noteCount
    ) {
      reasons.push(
        `note_index must be an integer in 0..${context.noteCount - 1}`,
      );
    } else if (
      expectedNoteIndex !== undefined &&
      noteIndex !== expectedNoteIndex
    ) {
      reasons.push(`note_index must be ${expectedNoteIndex} for this note`);
    }

    const directiveType = raw.directive_type;
    if (
      typeof directiveType !== 'string' ||
      !(DIRECTIVE_TYPES as readonly string[]).includes(directiveType)
    ) {
      reasons.push(
        `directive_type must be one of ${DIRECTIVE_TYPES.join(', ')}`,
      );
    }

    const applies = raw.applies;
    if (typeof applies !== 'boolean') {
      reasons.push('applies must be a boolean');
    }

    const explanation = raw.explanation;
    if (explanation !== undefined && explanation !== null && typeof explanation !== 'string') {
      reasons.push('explanation must be a string');
    }

    const type = directiveType as DirectiveType | undefined;
    const adjustment = raw.structured_adjustment;
    const adjustmentReasons = this.validateAdjustment(
      type,
      applies,
      adjustment,
      context.battery,
    );
    reasons.push(...adjustmentReasons);

    if (reasons.length > 0) {
      return { ok: false, value: null, reasons };
    }

    const value: DirectiveInterpretation = {
      note_index: noteIndex as number,
      applies: applies as boolean,
      directive_type: type as DirectiveType,
      structured_adjustment:
        type === 'no_op' ? null : this.normalizeAdjustment(type as DirectiveType, adjustment),
      explanation:
        typeof explanation === 'string'
          ? explanation
          : this.defaultExplanation(type as DirectiveType),
    };

    return { ok: true, value, reasons: [] };
  }

  private validateAdjustment(
    type: DirectiveType | undefined,
    applies: unknown,
    adjustment: unknown,
    battery: BatteryInput,
  ): string[] {
    const reasons: string[] = [];

    if (!type) return reasons;

    if (type === 'no_op') {
      if (applies !== false) {
        reasons.push('no_op requires applies = false');
      }
      if (adjustment !== null && adjustment !== undefined) {
        reasons.push('no_op requires structured_adjustment = null');
      }
      return reasons;
    }

    if (applies !== true) {
      reasons.push(`${type} requires applies = true`);
    }

    if (adjustment === null || typeof adjustment !== 'object' || Array.isArray(adjustment)) {
      reasons.push(`${type} requires a structured_adjustment object`);
      return reasons;
    }

    const adj = adjustment as RawAdjustment;
    const allowedKeys = this.allowedKeys(type);
    const actualKeys = Object.keys(adj).filter((k) => k !== 'hours' && k !== undefined);
    for (const key of actualKeys) {
      if (!allowedKeys.includes(key)) {
        reasons.push(`structured_adjustment has unexpected key "${key}"`);
      }
    }

    reasons.push(...this.validateHours(adj.hours));

    switch (type) {
      case 'solar_reduction': {
        const factor = adj.factor;
        if (typeof factor !== 'number' || !Number.isFinite(factor)) {
          reasons.push('solar_reduction requires a finite numeric factor');
        } else if (factor < 0 || factor > 1) {
          reasons.push('solar_reduction factor must be between 0 and 1');
        }
        if (adj.minimum_energy_kwh !== undefined) {
          reasons.push('solar_reduction does not accept minimum_energy_kwh');
        }
        if (adj.max_grid_kwh !== undefined) {
          reasons.push('solar_reduction does not accept max_grid_kwh');
        }
        break;
      }
      case 'minimum_battery_reserve': {
        const value = adj.minimum_energy_kwh;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          reasons.push(
            'minimum_battery_reserve requires a finite numeric minimum_energy_kwh',
          );
        } else if (value < 0) {
          reasons.push('minimum_energy_kwh must be non-negative');
        } else if (value > battery.capacity_kwh) {
          reasons.push(
            `minimum_energy_kwh (${value}) must not exceed battery capacity (${battery.capacity_kwh})`,
          );
        }
        if (adj.factor !== undefined) {
          reasons.push('minimum_battery_reserve does not accept factor');
        }
        if (adj.max_grid_kwh !== undefined) {
          reasons.push('minimum_battery_reserve does not accept max_grid_kwh');
        }
        break;
      }
      case 'no_charge_window':
      case 'no_discharge_window': {
        if (adj.factor !== undefined) {
          reasons.push(`${type} does not accept factor`);
        }
        if (adj.minimum_energy_kwh !== undefined) {
          reasons.push(`${type} does not accept minimum_energy_kwh`);
        }
        if (adj.max_grid_kwh !== undefined) {
          reasons.push(`${type} does not accept max_grid_kwh`);
        }
        break;
      }
      case 'max_grid_window': {
        const value = adj.max_grid_kwh;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          reasons.push('max_grid_window requires a finite numeric max_grid_kwh');
        } else if (value < 0) {
          reasons.push('max_grid_kwh must be non-negative');
        }
        if (adj.factor !== undefined) {
          reasons.push('max_grid_window does not accept factor');
        }
        if (adj.minimum_energy_kwh !== undefined) {
          reasons.push('max_grid_window does not accept minimum_energy_kwh');
        }
        break;
      }
      default:
        break;
    }

    return reasons;
  }

  private validateHours(hours: unknown): string[] {
    const reasons: string[] = [];
    if (!Array.isArray(hours)) {
      reasons.push('structured_adjustment.hours must be an array');
      return reasons;
    }
    if (hours.length === 0) {
      reasons.push('structured_adjustment.hours must contain at least one hour');
    }
    for (const h of hours) {
      if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 23) {
        reasons.push('hours entries must be integers 0..23');
        break;
      }
    }
    if (
      reasons.length === 0 &&
      hours.length !== new Set(hours as number[]).size
    ) {
      reasons.push('hours entries must be unique');
    }
    if (reasons.length === 0 && !this.isAscending(hours as number[])) {
      reasons.push('hours entries must be in ascending order');
    }
    return reasons;
  }

  private isAscending(values: number[]): boolean {
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] <= values[i - 1]) return false;
    }
    return true;
  }

  private allowedKeys(type: DirectiveType): string[] {
    switch (type) {
      case 'solar_reduction':
        return ['hours', 'factor'];
      case 'minimum_battery_reserve':
        return ['hours', 'minimum_energy_kwh'];
      case 'no_charge_window':
      case 'no_discharge_window':
        return ['hours'];
      case 'max_grid_window':
        return ['hours', 'max_grid_kwh'];
      default:
        return [];
    }
  }

  private normalizeAdjustment(
    type: DirectiveType,
    adjustment: unknown,
  ): StructuredAdjustment {
    const adj = adjustment as RawAdjustment;
    const base: StructuredAdjustment = {
      hours: (adj.hours as number[]).slice().sort((a, b) => a - b),
    };
    if (type === 'solar_reduction') {
      base.factor = adj.factor as number;
    } else if (type === 'minimum_battery_reserve') {
      base.minimum_energy_kwh = adj.minimum_energy_kwh as number;
    } else if (type === 'max_grid_window') {
      base.max_grid_kwh = adj.max_grid_kwh as number;
    }
    return base;
  }

  private defaultExplanation(type: DirectiveType): string {
    switch (type) {
      case 'no_op':
        return 'This note does not affect today\u2019s energy schedule.';
      case 'solar_reduction':
        return 'Solar availability is reduced during the stated window.';
      case 'minimum_battery_reserve':
        return 'A minimum battery reserve is required during the stated window.';
      case 'no_charge_window':
        return 'Battery charging is unavailable during the stated window.';
      case 'no_discharge_window':
        return 'Battery discharging is unavailable during the stated window.';
      case 'max_grid_window':
        return 'Grid import is capped during the stated window.';
      default:
        return 'Interpreted operator note.';
    }
  }
}