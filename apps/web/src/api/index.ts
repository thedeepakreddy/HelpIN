import { HelpInApi } from './client';

/** The API base URL; the dev server and `vite preview` default to the local API. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

export const api = new HelpInApi(API_URL);

export { ApiError } from './client';
export type { MediaPurpose, RealtimeEvent } from './client';
