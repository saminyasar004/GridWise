import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OptimizeEnergyResponseDto } from '../dto/optimize-energy-response.dto.js';
import { OptimizeEnergyRequestDto } from '../dto/optimize-energy-request.dto.js';
import { GridwiseService } from './gridwise.service.js';

@ApiTags('optimize-energy')
@Controller('optimize-energy')
export class GridwiseController {
  constructor(private readonly gridwiseService: GridwiseService) {}

  @Post()
  @ApiOperation({
    summary: 'Optimize campus energy for the next 24 hours',
    description:
      'Accepts operator notes and system state, interprets directives, and returns an optimal hourly grid-import schedule.',
  })
  @ApiResponse({
    status: 200,
    description: 'Optimized 24-hour energy plan.',
    type: OptimizeEnergyResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async optimize(
    @Body() dto: OptimizeEnergyRequestDto,
  ): Promise<OptimizeEnergyResponseDto> {
    return this.gridwiseService.doOptimize(dto);
  }
}