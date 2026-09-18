import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsString,
  Max,
  Min,
  Validate,
  ValidateNested,
} from 'class-validator';
import {
  BatterySemanticsConstraint,
  IsCompleteHoursConstraint,
  NonEmptyStringArrayConstraint,
} from './validators.js';
import type { OptimizeEnergyRequest } from '../common/types.js';

export class HourEntryDto {
  @ApiProperty({
    description: 'Hour index, 0 through 23.',
    example: 0,
    minimum: 0,
    maximum: 23,
  })
  @IsInt()
  @Min(0)
  @Max(23)
  hour: number;

  @ApiProperty({
    description: 'Campus demand that must be supplied during this hour (kWh).',
    example: 90,
    minimum: 0,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  demand_kwh: number;

  @ApiProperty({
    description:
      'Base solar energy available before any operator-note adjustments (kWh).',
    example: 0,
    minimum: 0,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  solar_kwh: number;

  @ApiProperty({
    description: 'Grid electricity price for this hour (BDT per kWh).',
    example: 6,
    minimum: 0,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  tariff_bdt_per_kwh: number;
}

export class BatteryDto {
  @ApiProperty({
    description: 'Maximum energy the battery can store (kWh).',
    example: 220,
    minimum: 0,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  capacity_kwh: number;

  @ApiProperty({
    description: 'Battery energy at the start of hour 0 (kWh).',
    example: 110,
    minimum: 0,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  initial_energy_kwh: number;

  @ApiProperty({
    description:
      'Base reserve level the battery must never go below (kWh).',
    example: 40,
    minimum: 0,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  minimum_energy_kwh: number;

  @ApiProperty({
    description: 'Maximum energy that may be added to the battery in one hour (kWh).',
    example: 50,
    minimum: 0,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  max_charge_kwh_per_hour: number;

  @ApiProperty({
    description: 'Maximum energy that may be removed from the battery in one hour (kWh).',
    example: 50,
    minimum: 0,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  max_discharge_kwh_per_hour: number;
}

export class OptimizeEnergyRequestDto implements OptimizeEnergyRequest {
  @ApiProperty({
    description: 'Unique synthetic scenario identifier; echoed back in the response.',
    example: 'SAMPLE-01',
  })
  @IsString()
  @IsNotEmpty()
  scenario_id: string;

  @ApiProperty({
    description:
      'Natural-language campus operator notes to interpret (1 to 3 non-empty strings).',
    example: [
      'Facilities will wash the rooftop solar panels from noon until 2 PM. During cleaning, usable solar should be treated as roughly 25% of the forecast.',
      'The sports office moved next month\u2019s registration deadline.',
    ],
    minItems: 1,
    maxItems: 3,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @Validate(NonEmptyStringArrayConstraint)
  @IsString({ each: true })
  operator_notes: string[];

  @ApiProperty({
    description:
      'Exactly 24 hourly entries, one per hour 0 through 23 (order within the array is flexible).',
    type: [HourEntryDto],
  })
  @IsArray()
  @ArrayMinSize(24)
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => HourEntryDto)
  @Validate(IsCompleteHoursConstraint)
  hours: HourEntryDto[];

  @ApiProperty({
    description: 'Battery storage system parameters.',
    type: BatteryDto,
  })
  @IsObject()
  @ValidateNested()
  @Type(() => BatteryDto)
  @Validate(BatterySemanticsConstraint)
  battery: BatteryDto;
}