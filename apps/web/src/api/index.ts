import type { ApiClient } from './client';
import { MockApi } from './mock/mockApi';
import { createSeed } from './mock/seed';

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The app talks to this client only. Until the backend exists it is an in-memory mock that
 * enforces the same domain rules; swapping in the HTTP client changes nothing in the screens.
 */
export const api: ApiClient = new MockApi(createSeed(), { storage: safeStorage() });

export { ApiError } from './client';
