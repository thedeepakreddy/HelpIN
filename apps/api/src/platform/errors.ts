import { DomainError } from '@helpin/domain';
import { ZodError } from 'zod';

/** An error with a stable code the client switches on (Architecture §10). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new ApiError(400, code, message, details);
export const unauthorized = (message = 'Please log in.') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);
export const notFound = (what = 'That') => new ApiError(404, 'NOT_FOUND', `${what} doesn't exist or isn't available.`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const tooMany = (message = 'Slow down a little and try again later.') => new ApiError(429, 'RATE_LIMITED', message);

const DOMAIN_STATUS: Partial<Record<DomainError['code'], number>> = {
  NOT_ASKER: 403,
  FORBIDDEN: 403,
  BLOCKED: 403,
  OWN_PROBLEM: 409,
  OFFER_EXISTS: 409,
  OFFER_DECLINED: 409,
  PROBLEM_NOT_OPEN: 409,
  PROBLEM_NOT_SOLVED: 409,
  INVALID_STATE: 409,
  ALREADY_CREDITED: 409,
  CREDIT_WINDOW_CLOSED: 409,
  ON_NOTICE_LIMIT: 429,
};

export function toApiError(e: unknown): ApiError | null {
  if (e instanceof ApiError) return e;
  if (e instanceof DomainError) return new ApiError(DOMAIN_STATUS[e.code] ?? 422, e.code, e.message);
  if (e instanceof ZodError) {
    return new ApiError(400, 'VALIDATION', e.issues[0]?.message ?? 'Invalid request', e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  // Postgres constraint violations that reach us are client errors in disguise.
  const pg = e as { code?: string; constraint?: string };
  if (pg?.code === '23505') return new ApiError(409, 'CONFLICT', 'That already exists.', { constraint: pg.constraint });
  if (pg?.code === '23514') return new ApiError(400, 'VALIDATION', 'Some details are not valid.', { constraint: pg.constraint });
  return null;
}
