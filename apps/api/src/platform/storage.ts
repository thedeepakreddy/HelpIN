import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from './env';
import { hmac, safeEqual } from './crypto';

/**
 * Object storage (Architecture §7). Originals go to `quarantine/…` and are readable only by the
 * worker; processed images live under `media/{id}/…` and are served through short-lived signed
 * URLs, so removed content stops loading and nobody can hotlink.
 */
export interface Storage {
  readonly driver: 'local' | 's3';
  uploadUrl(key: string, contentType: string, ttlSeconds: number): Promise<{ url: string; headers: Record<string, string> }>;
  downloadUrl(key: string, ttlSeconds: number): Promise<string>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /** Local driver only: check a signed link. */
  verify?(key: string, op: 'get' | 'put', exp: number, sig: string, now: number): boolean;
}

export function localStorage(env: Env): Storage {
  const root = resolve(env.STORAGE_DIR);
  const path = (key: string) => {
    const p = resolve(join(root, key));
    if (!p.startsWith(root)) throw new Error('Invalid storage key');
    return p;
  };
  const sign = (key: string, op: string, exp: number) => hmac(env.JWT_SECRET, `${op}:${key}:${exp}`);
  const link = (key: string, op: 'get' | 'put', ttl: number) => {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    return `${env.PUBLIC_API_URL}/v1/storage/${key}?op=${op}&exp=${exp}&sig=${sign(key, op, exp)}`;
  };
  return {
    driver: 'local',
    async uploadUrl(key, contentType, ttl) {
      return { url: link(key, 'put', ttl), headers: { 'Content-Type': contentType } };
    },
    async downloadUrl(key, ttl) {
      return link(key, 'get', ttl);
    },
    async put(key, body) {
      await mkdir(dirname(path(key)), { recursive: true });
      await writeFile(path(key), body);
    },
    async get(key) {
      return readFile(path(key));
    },
    async remove(key) {
      await rm(path(key), { force: true, recursive: true });
    },
    verify(key, op, exp, sig, now) {
      return exp * 1000 > now && safeEqual(sign(key, op, exp), sig);
    },
  };
}

/**
 * S3-compatible storage (Cloudflare R2, AWS, MinIO). Browsers upload straight to the bucket
 * with a presigned PUT, so the bucket needs a CORS rule for the web origin (docs/07).
 */
export function s3Storage(env: Env): Storage {
  if (!env.S3_BUCKET) throw new Error('S3 storage needs S3_BUCKET');
  const bucket = env.S3_BUCKET;
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: !!env.S3_ENDPOINT,
    // Newer SDKs add CRC32 checksums to presigned uploads by default; a browser PUT can't match
    // them and R2 rejects the request. Only send checksums when an operation requires one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } : undefined,
  });
  return {
    driver: 's3',
    async uploadUrl(key, contentType, ttl) {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: ttl });
      return { url, headers: { 'Content-Type': contentType } };
    },
    async downloadUrl(key, ttl) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttl });
    },
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export const storageFromEnv = (env: Env): Storage => (env.STORAGE_DRIVER === 's3' ? s3Storage(env) : localStorage(env));
