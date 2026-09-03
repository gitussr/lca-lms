import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from './errors.js';

/**
 * Standard error response body.
 * `details` is only present for validation-style errors and is safe to show a client.
 */
interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

function body(code: string, message: string, requestId: string, details?: unknown): ErrorBody {
  const err: ErrorBody['error'] = { code, message };
  if (details !== undefined) err.details = details;
  return { error: err, requestId };
}

/**
 * Registers the global error handler and the not-found handler.
 *
 * Rules:
 * - Fastify schema validation errors -> 400 VALIDATION_ERROR with field details.
 * - AppError -> its own status/code/message (details passed through when set).
 * - Any other error with a 4xx status -> passed through with a generic code.
 * - Everything else -> 500 INTERNAL, full error logged server-side, generic message out.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(body('NOT_FOUND', `Route ${request.method} ${request.url} not found`, request.id));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      request.log.info({ err: error }, 'request validation failed');
      const details = error.validation.map((v) => ({
        path: v.instancePath.length > 0 ? v.instancePath : (v.schemaPath ?? ''),
        message: v.message ?? 'invalid value',
      }));
      void reply
        .status(400)
        .send(body('VALIDATION_ERROR', 'Request validation failed', request.id, details));
      return;
    }

    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
      else request.log.info({ err: error }, error.message);
      void reply
        .status(error.statusCode)
        .send(body(error.code, error.message, request.id, error.details));
      return;
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      void reply.status(500).send(body('INTERNAL', 'Internal server error', request.id));
      return;
    }

    request.log.info({ err: error }, error.message);
    void reply
      .status(statusCode)
      .send(body(error.code ?? 'BAD_REQUEST', error.message, request.id));
  });
}
