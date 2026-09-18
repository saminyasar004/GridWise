import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Health / readiness check',
    description:
      'Returns HTTP 200 with {"status":"ok"} when the service is ready. No database or LLM dependency.',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is ready.',
    content: {
      'application/json': {
        example: { status: 'ok' },
      },
    },
  })
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}