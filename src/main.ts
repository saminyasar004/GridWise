import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/app-config.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true });

  const config = app.get(AppConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  if (config.swaggerEnabled) {
    const documentConfig = new DocumentBuilder()
      .setTitle('GridWise Optimizer API')
      .setDescription(
        'BUP CSE Fest 2026 \u2014 Smart Campus Energy Optimization Challenge. ' +
          'Interprets operator notes and returns an optimal 24-hour grid-import schedule.',
      )
      .setVersion('1.0.0')
      .build();
    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(config.port, config.host);
  console.log(`GridWise API listening on http://${config.host}:${config.port}`);
  console.log(
    config.swaggerEnabled
      ? `Swagger UI available at http://${config.host}:${config.port}/docs`
      : 'Swagger UI disabled (SWAGGER_ENABLED=false)',
  );
}

void bootstrap();