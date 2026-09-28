import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error', public details?: unknown) { super(message); }
}
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`, 'not_found');
export const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg, 'forbidden');
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'bad_request', details);

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
export const h = (fn: Handler): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'validation', message: 'Invalid request', details: err.issues } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  const e = err as { type?: string; code?: string; message?: string };
  if (e?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'too_large', message: 'File too large' } });
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
}
