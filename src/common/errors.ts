import { HttpException, HttpStatus } from '@nestjs/common';

export class BadRequestGridwiseException extends HttpException {
  constructor(message: string | string[]) {
    super(
      { statusCode: HttpStatus.BAD_REQUEST, message, error: 'Bad Request' },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class LlmProviderException extends Error {
  constructor(
    message: string,
    public readonly providerStatus?: number,
    public readonly retryable: boolean = true,
  ) {
    super(message);
    this.name = 'LlmProviderException';
  }
}

export class LlmClassificationException extends Error {
  constructor(
    message: string,
    public readonly noteIndex: number,
    public readonly reasons: string[],
  ) {
    super(message);
    this.name = 'LlmClassificationException';
  }
}

export class GuardrailValidationException extends Error {
  constructor(
    message: string,
    public readonly reasons: string[],
  ) {
    super(message);
    this.name = 'GuardrailValidationException';
  }
}

export class OptimizerInfeasibleException extends Error {
  constructor(message?: string) {
    super(message ?? 'Optimization problem is infeasible under the given constraints');
    this.name = 'OptimizerInfeasibleException';
  }
}

export class OptimizerException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptimizerException';
  }
}

export class FinalReplayException extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = 'FinalReplayException';
  }
}

export class RequestTimeoutException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Optimization request timed out',
        error: 'Internal Server Error',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}