import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';

/** Friendly copy for an API error: a translated message per code, else the server's message. */
export function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    const translated = t(key, { defaultValue: '' });
    return translated || error.message;
  }
  return t('errors.generic');
}
