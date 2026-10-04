import { HelpInApi } from './client';

/** The API base URL; the dev server and `vite preview` default to the local API. */
// Production builds talk to the address they were served from (the API serves the app);
// local development points at the API on port 8787 unless VITE_API_URL says otherwise.
export const API_URL: string = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : window.location.origin);

export const api = new HelpInApi(API_URL);

export { ApiError } from './client';
export type { MediaPurpose, RealtimeEvent } from './client';
