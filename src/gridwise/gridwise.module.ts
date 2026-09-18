import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module.js';
import { HealthModule } from '../health/health.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { GuardrailsModule } from '../guardrails/guardrails.module.js';
import { OptimizerModule } from '../optimizer/optimizer.module.js';
import { ValidatorModule } from '../validator/validator.module.js';
import { CommonModule } from '../common/common.module.js';
import { GridwiseController } from './gridwise.controller.js';
import { GridwiseService } from './gridwise.service.js';

@Module({
  imports: [
    AppConfigModule,
    CommonModule,
    HealthModule,
    LlmModule,
    GuardrailsModule,
    OptimizerModule,
    ValidatorModule,
  ],
  controllers: [GridwiseController],
  providers: [GridwiseService],
})
export class GridwiseModule {}