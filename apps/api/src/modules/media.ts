import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import sharp from 'sharp';
import type { MediaStatus } from '@helpin/contracts';
import { requireUser } from '../platform/auth';
import { now } from '../platform/clock';
import type { Ctx } from '../platform/context';
import { ApiError, badRequest, forbidden, notFound } from '../platform/errors';
import { parse } from '../platform/http';
import { appendEvent } from '../platform/outbox';
import { rateLimit } from '../platform/ratelimit';
import { mediaRef } from '../views';

const CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_BYTES = 10 * 1024 * 1024;
const SIZES = [1600, 800, 320] as const;

/**
 * The media pipeline (Architecture §7, L-08). Originals land in quarantine; the worker
 * auto-rotates, strips ALL metadata (EXIF/GPS/XMP), converts to WebP in three sizes and only
 * then marks the media ready. Nobody but the uploader can ever read an original.
 */
export async function processMedia(ctx: Ctx, mediaId: string) {
  const m = await ctx.db.selectFrom('media').selectAll().where('id', '=', mediaId).executeTakeFirst();
  if (!m || m.status === 'ready' || m.status === 'deleted') return;
  await ctx.db.updateTable('media').set({ status: 'processing' }).where('id', '=', mediaId).execute();
  let original: Buffer;
  try {
    original = await ctx.storage.get(`quarantine/${mediaId}`);
  } catch {
    await ctx.db.updateTable('media').set({ status: 'rejected' }).where('id', '=', mediaId).execute();
    return;
  }
  try {
    const base = sharp(original, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate();
    const meta = await base.metadata();
    let width: number | null = null;
    let height: number | null = null;
    for (const size of SIZES) {
      // sharp drops all metadata unless asked to keep it; we never call withMetadata().
      const out = await base.clone().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      await ctx.storage.put(`media/${mediaId}/${size}.webp`, out.data, 'image/webp');
      if (size === 1600) {
        width = out.info.width;
        height = out.info.height;
      }
    }
    void meta;
    await ctx.db.updateTable('media').set({ status: 'ready', width, height, storage_prefix: `media/${mediaId}/`, processed_at: now() }).where('id', '=', mediaId).execute();
  } catch (e) {
    ctx.log.warn(`media ${mediaId} rejected: ${(e as Error).message}`);
    await ctx.db.updateTable('media').set({ status: 'rejected' }).where('id', '=', mediaId).execute();
  } finally {
    await ctx.storage.remove(`quarantine/${mediaId}`);
  }
}

async function status(ctx: Ctx, id: string): Promise<MediaStatus> {
  const m = await ctx.db.selectFrom('media').select(['id', 'status', 'width', 'height', 'blurhash']).where('id', '=', id).executeTakeFirstOrThrow();
  return { id: m.id, status: m.status as MediaStatus['status'], media: await mediaRef(ctx, m) };
}

export function mediaRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/v1/media/upload-url', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const body = parse(
      z.object({
        purpose: z.enum(['problem_photo', 'post_photo', 'avatar', 'chat_image']),
        contentType: z.string(),
        bytes: z.number().int().positive(),
      }),
      req.body,
    );
    if (!CONTENT_TYPES.includes(body.contentType)) throw badRequest('UNSUPPORTED_MEDIA', 'Use a JPEG, PNG, WebP or HEIC photo.');
    if (body.bytes > MAX_BYTES) throw badRequest('MEDIA_TOO_LARGE', 'Photos can be up to 10 MB.');
    await rateLimit(ctx.db, { userId: user.id }, 'upload', { max: 60, windowHours: 1 });
    const m = await ctx.db
      .insertInto('media')
      .values({ owner_id: user.id, purpose: body.purpose, content_type: body.contentType, bytes: body.bytes, created_at: now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { url, headers } = await ctx.storage.uploadUrl(`quarantine/${m.id}`, body.contentType, 15 * 60);
    return { mediaId: m.id, uploadUrl: url, method: 'PUT' as const, headers };
  });

  app.post('/v1/media/:id/finalize', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const id = (req.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) throw notFound('That photo');
    const m = await ctx.db.selectFrom('media').select(['owner_id', 'status']).where('id', '=', id).executeTakeFirst();
    if (!m || m.owner_id !== user.id) throw notFound('That photo');
    if (m.status === 'pending') {
      await ctx.db.transaction().execute(async (tx) => {
        await tx.updateTable('media').set({ status: 'processing' }).where('id', '=', id).where('status', '=', 'pending').execute();
        await appendEvent(tx, { type: 'MediaUploaded', mediaId: id });
      });
    }
    return status(ctx, id);
  });

  app.get('/v1/media/:id', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const id = (req.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) throw notFound('That photo');
    const m = await ctx.db.selectFrom('media').select('owner_id').where('id', '=', id).executeTakeFirst();
    if (!m) throw notFound('That photo');
    if (m.owner_id !== user.id) throw forbidden('FORBIDDEN', 'Not your photo.');
    return status(ctx, id);
  });

  // Local storage driver: signed PUT/GET links (S3 uses its own presigned URLs instead).
  app.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'], { parseAs: 'buffer', bodyLimit: MAX_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  app.route({
    method: ['GET', 'PUT'],
    url: '/v1/storage/*',
    handler: async (req, reply) => {
      if (ctx.storage.driver !== 'local' || !ctx.storage.verify) throw notFound();
      const key = (req.params as { '*': string })['*'];
      const q = req.query as { op?: string; exp?: string; sig?: string };
      const op = req.method === 'PUT' ? 'put' : 'get';
      if (q.op !== op || !q.sig || !ctx.storage.verify(key, op, Number(q.exp), q.sig, Date.now())) {
        throw new ApiError(403, 'BAD_SIGNATURE', 'This link has expired.');
      }
      if (op === 'put') {
        if (!key.startsWith('quarantine/')) throw new ApiError(403, 'BAD_SIGNATURE', 'Uploads go to quarantine only.');
        const body = req.body as Buffer;
        if (!Buffer.isBuffer(body) || !body.length) throw badRequest('VALIDATION', 'Empty upload.');
        await ctx.storage.put(key, body, String(req.headers['content-type'] ?? 'application/octet-stream'));
        return reply.code(200).send({ ok: true });
      }
      // Originals are never served (L-08).
      if (!key.startsWith('media/')) throw notFound();
      try {
        const data = await ctx.storage.get(key);
        return reply.header('Content-Type', 'image/webp').header('Cache-Control', 'private, max-age=3600').send(data);
      } catch {
        throw notFound();
      }
    },
  });
}
