import { Module } from '@nestjs/common';
import { GuardrailValidatorService } from './guardrail-validator.service.js';
import { HeuristicFallbackService } from './heuristic-fallback.service.js';

@Module({
  providers: [GuardrailValidatorService, HeuristicFallbackService],
  exports: [GuardrailValidatorService, HeuristicFallbackService],
})
export class GuardrailsModule {}