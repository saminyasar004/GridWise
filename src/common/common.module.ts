import { Global, Module } from '@nestjs/common';
import { InMemoryCacheService } from './cache.service.js';
import { AllExceptionsFilter } from './filters/all-exceptions.filter.js';

@Global()
@Module({
  providers: [InMemoryCacheService, AllExceptionsFilter],
  exports: [InMemoryCacheService, AllExceptionsFilter],
})
export class CommonModule {}