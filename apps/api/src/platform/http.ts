import type { z } from 'zod';

/** Parses input with a contract schema; errors become 400 VALIDATION via the error handler. */
export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  return schema.parse(input);
}

/** Opaque cursor = base64url of "iso|id". */
export const encodeCursor = (at: Date, id: string | number) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
export function decodeCursor(cursor: unknown): { at: Date; id: string } | null {
  if (typeof cursor !== 'string' || !cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso ?? '');
  return Number.isNaN(at.getTime()) || !id ? null : { at, id };
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
