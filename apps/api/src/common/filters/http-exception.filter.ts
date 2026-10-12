import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { reportServerError } from '../../observability/sentry';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * One error shape for the whole API (doc 21 §5.9):
 * { success:false, error:{ code, message, details?, requestId } }
 * Never leaks stack traces, SQL or provider errors to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req as any).requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong on our side. Please try again.';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? 'ERROR';
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const b = body as { message?: string | string[]; code?: string; details?: unknown };
        if (b.details !== undefined) details = b.details;
        if (b.code) code = b.code;
        if (Array.isArray(b.message)) {
          message = 'Some details are invalid.';
          details = b.message;
          code = status === 400 ? 'VALIDATION_FAILED' : code;
        } else if (b.message) {
          message = b.message;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'ALREADY_EXISTS';
        message = 'That already exists.';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'Not found.';
      }
    }

    if (status >= 500) {
      reportServerError(exception, { requestId, userId: (req as any).user?.id, route: `${req.method} ${req.route?.path ?? 'unknown'}` });
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status} [${requestId}] ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    }

    res.status(status).json({ success: false, error: { code, message, details, requestId } });
  }
}
