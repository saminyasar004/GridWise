import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module.js';
import { GuardrailsModule } from '../guardrails/guardrails.module.js';
import { LlmClientService } from './llm-client.service.js';
import { LlmInterpreterService } from './llm-interpreter.service.js';

@Module({
  imports: [AppConfigModule, GuardrailsModule],
  providers: [LlmClientService, LlmInterpreterService],
  exports: [LlmInterpreterService],
})
export class LlmModule {}