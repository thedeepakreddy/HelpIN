import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Ctx } from './context';
import { optionalUser } from './auth';
import { sha256 } from './crypto';
import { ApiError } from './errors';
import { now } from './clock';

const SKIP = ['/v1/auth/', '/v1/storage/', '/v1/events'];
const keys = new WeakMap<FastifyRequest, { userId: string; key: string }>();

/**
 * R-07: every command may carry an Idempotency-Key. Replaying a key returns the original
 * response; reusing it for a different request is an error; a concurrent duplicate gets 409.
 */
export function registerIdempotency(app: FastifyInstance, ctx: Ctx) {
  app.addHook('preHandler', async (req, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) return;
    if (SKIP.some((p) => req.url.startsWith(p))) return;
    const user = await optionalUser(ctx, req).catch(() => null);
    if (!user) return;
    const hash = sha256(`${req.method} ${req.url} ${JSON.stringify(req.body ?? null)}`);
    const inserted = await ctx.db
      .insertInto('idempotency_keys')
      .values({ user_id: user.id, key, request_hash: hash, created_at: now() })
      .onConflict((oc) => oc.columns(['user_id', 'key']).doNothing())
      .returning('key')
      .executeTakeFirst();
    if (inserted) {
      keys.set(req, { userId: user.id, key });
      return;
    }
    const prev = await ctx.db.selectFrom('idempotency_keys').selectAll().where('user_id', '=', user.id).where('key', '=', key).executeTakeFirstOrThrow();
    if (prev.request_hash !== hash) throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This request key was already used for something else.');
    if (prev.status_code === null) throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'Still working on that. One moment.');
    reply.header('Idempotent-Replay', 'true');
    return reply.code(prev.status_code).send(prev.response);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const k = keys.get(req);
    if (!k) return payload;
    keys.delete(req);
    if (reply.statusCode >= 200 && reply.statusCode < 300) {
      let response: unknown;
      try {
        response = typeof payload === 'string' ? JSON.parse(payload) : null;
      } catch {
        response = null;
      }
      await ctx.db
        .updateTable('idempotency_keys')
        .set({ status_code: reply.statusCode, response: JSON.stringify(response) })
        .where('user_id', '=', k.userId)
        .where('key', '=', k.key)
        .execute();
    } else {
      // Failed commands can be retried with the same key.
      await ctx.db.deleteFrom('idempotency_keys').where('user_id', '=', k.userId).where('key', '=', k.key).execute();
    }
    return payload;
  });
}
