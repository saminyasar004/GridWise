import { Injectable, Logger } from '@nestjs/common';
import type { DirectiveType } from '../common/constants.js';
import type {
  BatteryInput,
  DirectiveInterpretation,
} from '../common/types.js';

interface TimeRange {
  start: number;
  endExclusive: number;
}

interface Classification {
  applies: boolean;
  directive_type: DirectiveType;
  hours: number[];
  numeric: number | null;
  explanation: string;
}

@Injectable()
export class HeuristicFallbackService {
  private readonly logger = new Logger('HeuristicFallbackService');

  /**
   * Best-effort deterministic classification. Used ONLY after the LLM path and
   * its reprompt have both failed for a note. Returns null when it cannot
   * produce a structurally valid classification.
   */
  classify(
    noteIndex: number,
    note: string,
    battery: BatteryInput,
  ): DirectiveInterpretation | null {
    const text = note.toLowerCase();
    const classification = this.classifyText(text, battery);
    if (!classification) {
      this.logger.warn(
        `Heuristic fallback could not classify note ${noteIndex} -> will be treated as a hard failure`,
      );
      return null;
    }
    return {
      note_index: noteIndex,
      applies: classification.applies,
      directive_type: classification.directive_type,
      structured_adjustment: classification.applies
        ? this.buildAdjustment(classification)
        : null,
      explanation: classification.explanation,
    };
  }

  private classifyText(
    text: string,
    battery: BatteryInput,
  ): Classification | null {
    const solar = this.trySolarReduction(text);
    if (solar) return solar;

    const reserve = this.tryMinimumReserve(text, battery);
    if (reserve) return reserve;

    const noCharge = this.tryNoCharge(text);
    if (noCharge) return noCharge;

    const noDischarge = this.tryNoDischarge(text);
    if (noDischarge) return noDischarge;

    const maxGrid = this.tryMaxGrid(text);
    if (maxGrid) return maxGrid;

    if (this.looksIrrelevant(text)) {
      return {
        applies: false,
        directive_type: 'no_op',
        hours: [],
        numeric: null,
        explanation: 'This note does not affect today\u2019s energy schedule.',
      };
    }

    return null;
  }

  private trySolarReduction(text: string): Classification | null {
    const energy =
      /\b(solar|rooftop|pv|photovoltaic|panel|generation|output)\b/.test(text);
    const action =
      /\b(reduc|dropp?|dip|fall|deteriorat|decrease|less)\b|\b(wash|cleaning|clean|maintenance|inspect|cloud cover|clouds)\b/.test(
        text,
      );
    if (!energy || !action) return null;
    const range = this.parseTimeRange(text);
    if (!range) return null;
    return {
      applies: true,
      directive_type: 'solar_reduction',
      hours: this.rangeToHours(range),
      numeric: this.parseRemainingFraction(text),
      explanation: 'Usable solar is reduced during the stated window.',
    };
  }

  private tryMinimumReserve(
    text: string,
    battery: BatteryInput,
  ): Classification | null {
    const relevant = /\b(reserve|store|keep|hold|maintain|ensure|backup|emergency)\b/.test(
      text,
    );
    const batteryish = /\b(battery|stored|energy|charged)\b/.test(text);
    if (!relevant || !batteryish) return null;
    const range = this.parseTimeRange(text);
    if (!range) return null;
    const value = this.parseReserveKwh(text, battery.capacity_kwh);
    if (value === null) return null;
    return {
      applies: true,
      directive_type: 'minimum_battery_reserve',
      hours: this.rangeToHours(range),
      numeric: value,
      explanation: 'A minimum battery reserve is required during the stated window.',
    };
  }

  private tryNoCharge(text: string): Classification | null {
    const mentionsCharge = /\b(charg|charger|recharge)\w*\b/.test(text);
    const prohibits =
      /\b(no|not|cannot|can't|must not|do not|don't|avoid|stop|unavailable|disabled|isolat|offline|maintenance|inspect|outage|refrain|prohibit\w*)\b/.test(
        text,
      );
    if (!mentionsCharge || !prohibits) return null;
    const range = this.parseTimeRange(text);
    if (!range) return null;
    return {
      applies: true,
      directive_type: 'no_charge_window',
      hours: this.rangeToHours(range),
      numeric: null,
      explanation: 'Battery charging is unavailable during the stated window.',
    };
  }

  private tryNoDischarge(text: string): Classification | null {
    const mentionsDischarge = /\b(discharg)\w*\b/.test(text);
    const prohibits =
      /\b(no|not|cannot|can't|must not|do not|don't|avoid|stop|unavailable|disabled|isolat|offline|maintenance|test|relay|protect|refrain|prohibit\w*)\b/.test(
        text,
      );
    if (!mentionsDischarge || !prohibits) return null;
    const range = this.parseTimeRange(text);
    if (!range) return null;
    return {
      applies: true,
      directive_type: 'no_discharge_window',
      hours: this.rangeToHours(range),
      numeric: null,
      explanation: 'Battery discharge is disabled during the stated window.',
    };
  }

  private tryMaxGrid(text: string): Classification | null {
    const mentionsGrid =
      /\b(grid|import|intake|feeder|transformer|substation)\b/.test(text);
    const cap =
      /\b(limit|cap|not exceed|at or below|must not|restrict|constrain|maximum|below|under)\b/.test(
        text,
      );
    if (!mentionsGrid || !cap) return null;
    const range = this.parseTimeRange(text);
    if (!range) return null;
    const value = this.extractNumber(text);
    if (value === null) return null;
    return {
      applies: true,
      directive_type: 'max_grid_window',
      hours: this.rangeToHours(range),
      numeric: value,
      explanation: 'Grid import is capped during the stated window.',
    };
  }

  private looksIrrelevant(text: string): boolean {
    return /(cafeteria|menu|library|book|registration|deadline|sports office|student affairs|seminar|booking|calendar|notice|club|next week|tomorrow|moved|announcement|event)/.test(
      text,
    );
  }

  private buildAdjustment(
    classification: Classification,
  ): {
    hours: number[];
    factor?: number;
    minimum_energy_kwh?: number;
    max_grid_kwh?: number;
  } {
    const base: {
      hours: number[];
      factor?: number;
      minimum_energy_kwh?: number;
      max_grid_kwh?: number;
    } = { hours: classification.hours };
    switch (classification.directive_type) {
      case 'solar_reduction':
        base.factor = classification.numeric ?? 0.5;
        break;
      case 'minimum_battery_reserve':
        base.minimum_energy_kwh = classification.numeric ?? 0;
        break;
      case 'max_grid_window':
        base.max_grid_kwh = classification.numeric ?? 0;
        break;
      default:
        break;
    }
    return base;
  }

  private parseTimeRange(text: string): TimeRange | null {
    const lower = text
      .replace(/\bmidnight\b/g, '12:00 am')
      .replace(/\bnoon\b/g, '12:00 pm');

    const tokens = [
      ...lower.matchAll(
        /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:until|to|-|through|throughout)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g,
      ),
    ];

    if (tokens.length === 0) return null;
    const m = tokens[0];

    const startHour = this.toHour(
      Number.parseInt(m[1], 10),
      m[2] ? Number.parseInt(m[2], 10) : 0,
      this.normalizeMeridiem(m[3]),
    );
    const endHour = this.toHour(
      Number.parseInt(m[4], 10),
      m[5] ? Number.parseInt(m[5], 10) : 0,
      this.normalizeMeridiem(m[6]),
    );

    if (startHour === null || endHour === null) return null;
    if (endHour <= startHour) return null;

    return { start: startHour, endExclusive: endHour };
  }

  private normalizeMeridiem(m: string | undefined): 'am' | 'pm' | undefined {
    if (!m) return undefined;
    return m.toLowerCase() === 'am' ? 'am' : 'pm';
  }

  private toHour(
    hourToken: number,
    minute: number,
    meridiem: 'am' | 'pm' | undefined,
  ): number | null {
    let value = hourToken;
    if (meridiem === 'am' || meridiem === 'pm') {
      value = hourToken % 12;
      if (meridiem === 'pm') value += 12;
    } else if (hourToken >= 13) {
      return hourToken >= 24 ? null : hourToken;
    } else if (hourToken === 0) {
      return 0;
    } else {
      return null;
    }
    if (minute > 0) return null;
    return value >= 0 && value <= 23 ? value : null;
  }

  private rangeToHours(range: TimeRange): number[] {
    const hours: number[] = [];
    for (let h = range.start; h < range.endExclusive; h += 1) {
      hours.push(h);
    }
    return hours;
  }

  private parseRemainingFraction(text: string): number {
    const reductionPct = text.match(
      /(\d+(?:\.\d+)?)\s*%\s*(reduction|reduc)/,
    );
    if (reductionPct) {
      const pct = Number.parseFloat(reductionPct[1]);
      return Math.max(0, Math.min(1, (100 - pct) / 100));
    }
    const dropToPct = text.match(/(?:to|about|roughly|under|drop|fall)\D*(\d+(?:\.\d+)?)\s*%/);
    if (dropToPct) {
      const pct = Number.parseFloat(dropToPct[1]);
      return Math.max(0, Math.min(1, pct / 100));
    }
    const plainPct = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (plainPct) {
      const pct = Number.parseFloat(plainPct[1]);
      return Math.max(0, Math.min(1, pct / 100));
    }
    if (/(one-fifth|a fifth|1\/5)/.test(text)) return 0.2;
    if (/(one-quarter|a quarter|1\/4)/.test(text)) return 0.25;
    if (/(half|one-half|50%)/.test(text)) return 0.5;
    return 0.5;
  }

  private parseReserveKwh(text: string, capacity: number): number | null {
    const explicit = text.match(
      /(?:keep|reserve|store|maintain|at least|at or above)\D*(\d+(?:\.\d+)?)\s*kwh/,
    );
    if (explicit) return Number.parseFloat(explicit[1]);

    const pct = text.match(
      /(?:(\d+(?:\.\d+)?)\s*%\s*of\s*(?:the\s*)?battery|at\s*least\s*(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?(?:battery|capacity))/,
    );
    if (pct) {
      const value = Number.parseFloat(pct[1] ?? pct[2]);
      if (capacity > 0) return (value / 100) * capacity;
    }
    return null;
  }

  private extractNumber(text: string): number | null {
    const m = text.match(/(\d+(?:\.\d+)?)\s*kwh/);
    if (!m) return null;
    return Number.parseFloat(m[1]);
  }
}