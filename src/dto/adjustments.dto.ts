import { ApiProperty } from '@nestjs/swagger';

export class SolarReductionAdjustmentDto {
  @ApiProperty({
    description:
      'Whole-hour window, start-inclusive and end-exclusive, listed as unique integers 0-23 in ascending order.',
    example: [12, 13],
  })
  hours: number[];

  @ApiProperty({
    description:
      'Usable fraction of solar that remains (0-1). An 80% reduction means factor = 0.2.',
    example: 0.25,
    minimum: 0,
    maximum: 1,
  })
  factor: number;
}

export class MinimumReserveAdjustmentDto {
  @ApiProperty({
    description:
      'Whole-hour window, start-inclusive and end-exclusive, listed as unique integers 0-23 in ascending order.',
    example: [18, 19, 20],
  })
  hours: number[];

  @ApiProperty({
    description:
      'Absolute minimum battery energy required during the window (kWh). Must not exceed battery capacity.',
    example: 100,
    minimum: 0,
  })
  minimum_energy_kwh: number;
}

export class NoChargeAdjustmentDto {
  @ApiProperty({
    description:
      'Whole-hour window, start-inclusive and end-exclusive, listed as unique integers 0-23 in ascending order.',
    example: [2, 3, 4],
  })
  hours: number[];
}

export class NoDischargeAdjustmentDto {
  @ApiProperty({
    description:
      'Whole-hour window, start-inclusive and end-exclusive, listed as unique integers 0-23 in ascending order.',
    example: [18, 19],
  })
  hours: number[];
}

export class MaxGridAdjustmentDto {
  @ApiProperty({
    description:
      'Whole-hour window, start-inclusive and end-exclusive, listed as unique integers 0-23 in ascending order.',
    example: [18, 19, 20],
  })
  hours: number[];

  @ApiProperty({
    description:
      'Maximum grid import allowed in each listed hour (kWh).',
    example: 155,
    minimum: 0,
  })
  max_grid_kwh: number;
}