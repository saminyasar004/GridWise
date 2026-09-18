import { Module } from '@nestjs/common';
import { OptimizerService } from './optimizer.service.js';

@Module({
  providers: [OptimizerService],
  exports: [OptimizerService],
})
export class OptimizerModule {}