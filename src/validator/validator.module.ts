import { Module } from '@nestjs/common';
import { OptimizerModule } from '../optimizer/optimizer.module.js';
import { FinalValidatorService } from './final-validator.service.js';

@Module({
  imports: [OptimizerModule],
  providers: [FinalValidatorService],
  exports: [FinalValidatorService],
})
export class ValidatorModule {}