import { z } from 'zod';

/** All configuration comes from the environment (12-factor). Secrets are never committed. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8787),
  DATABASE_URL: z.string().min(1),
  /** Public base URL of this API (used for local storage upload/download links). */
  PUBLIC_API_URL: z.string().default('http://localhost:8787'),
  /** Comma-separated browser origins allowed by CORS. */
  WEB_ORIGINS: z.string().default('http://localhost:5173,http://localhost:4173'),
  /** HS256 secret for access tokens (≥ 32 chars in production). */
  JWT_SECRET: z.string().min(16),
  /** Development only: this code is accepted for any OTP challenge. Refused in production. */
  AUTH_DEV_CODE: z.string().regex(/^\d{6}$/).optional(),
  SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  /** Either a full SMTP_URL, or host/port/user/pass separately (easier: no URL-encoding). */
  SMTP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('HelpIn <hello@helpin.local>'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('./.data/storage'),
  /** Cloudflare R2: https://<account id>.r2.cloudflarestorage.com (EU jurisdiction: .eu.r2…). */
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('eu-central-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:hello@helpin.local'),
  /** ADR-023: emails that become admins on login (kept out of the repo). */
  ADMIN_EMAILS: z.string().default(''),
  /** Optional reverse geocoding for locality labels (L-09). */
  GEOCODER: z.enum(['none', 'nominatim']).default('none'),
  NOMINATIM_URL: z.string().default('https://nominatim.openstreetmap.org'),
  WEB_URL: z.string().default('http://localhost:5173'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = EnvSchema.parse(source);
  if (env.NODE_ENV === 'production') {
    if (env.AUTH_DEV_CODE) throw new Error('AUTH_DEV_CODE must not be set in production');
    if (env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
    if (env.SMS_PROVIDER === 'console' || env.EMAIL_PROVIDER === 'console') {
      throw new Error('Configure real SMS and email providers in production');
    }
  }
  return env;
}

export const adminEmails = (env: Env) =>
  new Set(
    env.ADMIN_EMAILS.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
