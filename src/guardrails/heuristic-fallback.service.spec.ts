import { describe, expect, it } from 'vitest';
import { HeuristicFallbackService } from './heuristic-fallback.service.js';
import type { BatteryInput } from '../common/types.js';

const battery: BatteryInput = {
  capacity_kwh: 220,
  initial_energy_kwh: 120,
  minimum_energy_kwh: 60,
  max_charge_kwh_per_hour: 50,
  max_discharge_kwh_per_hour: 50,
};

describe('HeuristicFallbackService time parsing', () => {
  const svc = new HeuristicFallbackService();

  it('parses "noon until 2 PM" as hours 12-13', () => {
    const result = svc.classify(
      0,
      'Facilities will wash the rooftop solar panels from noon until 2 PM. During cleaning, usable solar should be treated as roughly 25% of the forecast.',
      battery,
    );
    expect(result).not.toBeNull();
    expect(result?.applies).toBe(true);
    expect(result?.directive_type).toBe('solar_reduction');
    expect(result?.structured_adjustment?.hours).toEqual([12, 13]);
    expect(result?.structured_adjustment?.factor).toBeCloseTo(0.25, 5);
  });

  it('parses "midnight until 3 AM" as hours 0-2', () => {
    const result = svc.classify(
      0,
      'Battery charging is prohibited from midnight until 3 AM.',
      battery,
    );
    expect(result).not.toBeNull();
    expect(result?.applies).toBe(true);
    expect(result?.directive_type).toBe('no_charge_window');
    expect(result?.structured_adjustment?.hours).toEqual([0, 1, 2]);
  });
});