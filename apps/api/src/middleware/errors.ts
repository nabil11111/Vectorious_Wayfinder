import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint.' } });
};

// The JSON body parser throws these for a body it cannot read. They are the client's mistake, not ours.
const BODY_ERRORS: Record<string, [number, string, string]> = {
  'entity.parse.failed': [400, 'invalid_json', 'That request body is not valid JSON.'],
  'entity.too.large': [413, 'too_large', 'That request is too big.'],
};

// Every failure leaves the API in the same shape (see ApiError in contracts). Unknown errors are logged with
// their stack but the client only gets a generic message.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const bodyError = BODY_ERRORS[(err as { type?: string })?.type ?? ''];
  if (bodyError) {
    const [status, code, message] = bodyError;
    res.status(status).json({ error: { code, message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'invalid_input', message: 'Some fields are missing or wrong.', details: err.issues } });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // Log the name, message and stack only. Errors can carry the request body (the body parser's do), and a body
  // can hold a password.
  const { name, message, stack } = err instanceof Error ? err : new Error(String(err));
  logger.error({ err: { name, message, stack }, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on our side.' } });
};
