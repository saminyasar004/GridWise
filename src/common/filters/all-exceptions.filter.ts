import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const body = this.toErrorBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(
        `Unhandled error -> ${exception instanceof Error ? exception.constructor.name : 'unknown'} ${String(exception && typeof exception === 'object' && 'message' in exception ? exception.message : exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`Request rejected -> ${JSON.stringify(body)}`);
    }

    response.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return { statusCode: status, message: res, error: this.statusLabel(status) };
      }
      const resObj = res as Record<string, unknown>;
      const message =
        typeof resObj.message === 'string' || Array.isArray(resObj.message)
          ? (resObj.message as string | string[])
          : this.statusLabel(status);
      return {
        statusCode: status,
        message,
        error:
          typeof resObj.error === 'string' ? resObj.error : this.statusLabel(status),
      };
    }

    if (this.isBodyParseError(exception)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Malformed JSON request body',
        error: 'Bad Request',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }

  private isBodyParseError(exception: unknown): boolean {
    if (!(exception instanceof Error)) return false;
    const any = exception as unknown as Record<string, unknown>;
    return (
      (any.status === 400 && any.type === 'entity.parse.failed') ||
      exception.name === 'SyntaxError' && any.status === 400
    );
  }

  private statusLabel(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Bad Request';
      case HttpStatus.NOT_FOUND:
        return 'Not Found';
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return 'Internal Server Error';
      default:
        return 'Error';
    }
  }
}