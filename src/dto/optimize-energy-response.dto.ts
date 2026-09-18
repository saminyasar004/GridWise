import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  BATTERY_ACTIONS,
  DIRECTIVE_TYPES,
} from '../common/constants.js';
import type { BatteryAction, DirectiveType } from '../common/constants.js';
import type { OptimizeEnergyResponse, StructuredAdjustment } from '../common/types.js';
import {
  MaxGridAdjustmentDto,
  MinimumReserveAdjustmentDto,
  NoChargeAdjustmentDto,
  NoDischargeAdjustmentDto,
  SolarReductionAdjustmentDto,
} from './adjustments.dto.js';

@ApiExtraModels(
  SolarReductionAdjustmentDto,
  MinimumReserveAdjustmentDto,
  NoChargeAdjustmentDto,
  NoDischargeAdjustmentDto,
  MaxGridAdjustmentDto,
)
export class DirectiveInterpretationDto {
  @ApiProperty({
    description:
      'Zero-based index of the corresponding operator_notes entry. One entry per note, in order 0..N-1.',
    example: 0,
    minimum: 0,
  })
  note_index: number;

  @ApiProperty({
    description:
      'true for every applicable non-no_op directive; false only for no_op.',
    example: true,
  })
  applies: boolean;

  @ApiProperty({
    description: 'One of the supported directive types.',
    enum: DIRECTIVE_TYPES,
    example: 'solar_reduction',
  })
  directive_type: DirectiveType;

  @ApiProperty({
    description:
      'Exact machine-checkable object required by the directive type, or null only for no_op.',
    nullable: true,
    oneOf: [
      { $ref: getSchemaPath(SolarReductionAdjustmentDto) },
      { $ref: getSchemaPath(MinimumReserveAdjustmentDto) },
      { $ref: getSchemaPath(NoChargeAdjustmentDto) },
      { $ref: getSchemaPath(NoDischargeAdjustmentDto) },
      { $ref: getSchemaPath(MaxGridAdjustmentDto) },
    ],
    example: { hours: [12, 13], factor: 0.25 },
  })
  structured_adjustment: StructuredAdjustment | null;

  @ApiProperty({
    description: 'Short human-readable explanation of the interpretation.',
    example:
      'Solar availability is reduced to 25% during the panel-cleaning window.',
  })
  explanation: string;
}

export class HourlyPlanEntryDto {
  @ApiProperty({ description: 'Hour index, 0 through 23.', example: 0 })
  hour: number;

  @ApiProperty({
    description: 'Grid electricity purchased in this hour (kWh).',
    example: 90,
    minimum: 0,
  })
  grid_kwh: number;

  @ApiProperty({
    description: 'Solar energy used in this hour (kWh); never exceeds effective solar.',
    example: 0,
    minimum: 0,
  })
  solar_used_kwh: number;

  @ApiProperty({
    description: 'Battery action for this hour.',
    enum: BATTERY_ACTIONS,
    example: 'idle',
  })
  battery_action: BatteryAction;

  @ApiProperty({
    description:
      'Non-negative magnitude of the battery action (kWh). Must be 0 when idle.',
    example: 0,
    minimum: 0,
  })
  battery_kwh: number;

  @ApiProperty({
    description:
      'Battery energy immediately after completing this hour (kWh).',
    example: 110,
  })
  battery_energy_after_kwh: number;
}

export class OptimizeEnergyResponseDto implements OptimizeEnergyResponse {
  @ApiProperty({
    description: 'Echo of the request scenario_id.',
    example: 'SAMPLE-01',
  })
  scenario_id: string;

  @ApiProperty({
    description:
      'One machine-checkable interpretation entry for every operator note, in note_index order.',
    type: [DirectiveInterpretationDto],
  })
  directive_interpretation: DirectiveInterpretationDto[];

  @ApiProperty({
    description: 'One plan entry for every hour 0 through 23.',
    type: [HourlyPlanEntryDto],
  })
  hourly_plan: HourlyPlanEntryDto[];

  @ApiProperty({
    description: 'Sum of grid_kwh across all 24 hours (kWh).',
    example: 2692.5,
    minimum: 0,
  })
  total_grid_kwh: number;

  @ApiProperty({
    description: 'Total grid electricity cost (BDT).',
    example: 38365,
    minimum: 0,
  })
  total_cost_bdt: number;

  @ApiProperty({
    description: 'Maximum hourly grid_kwh in the returned plan (kWh).',
    example: 175,
    minimum: 0,
  })
  peak_grid_kwh: number;

  @ApiProperty({
    description: 'Short human-readable explanation of the final strategy.',
    example:
      'Applies the 25% solar-reduction window and ignores the unrelated note, shifting battery energy toward higher-tariff hours while restoring the initial battery level.',
  })
  plan_summary: string;
}