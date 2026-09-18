import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { GridwiseModule } from './gridwise/gridwise.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

@Module({
  imports: [AppConfigModule, GridwiseModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}