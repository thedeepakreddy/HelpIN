import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppNotification } from '@helpin/contracts';
import { optionalUser, requireUser } from '../platform/auth';
import { now } from '../platform/clock';
import type { Ctx } from '../platform/context';
import { unauthorized } from '../platform/errors';
import { parse } from '../platform/http';

export interface NotificationPayload {
  title: string;
  body: string;
  link: string;
  problemId?: string | null;
  moderationActionId?: number | null;
}

export function presentNotification(r: { id: string; type: string; payload: unknown; created_at: Date; read_at: Date | null }): AppNotification {
  const p = r.payload as NotificationPayload;
  return {
    id: r.id,
    type: r.type as AppNotification['type'],
    title: p.title,
    body: p.body,
    link: p.link,
    problemId: p.problemId ?? null,
    moderationActionId: p.moderationActionId ?? null,
    createdAt: r.created_at.toISOString(),
    read: !!r.read_at,
  };
}

export function notificationRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/me/notifications', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const rows = await ctx.db.selectFrom('notifications').selectAll().where('user_id', '=', user.id).orderBy('created_at', 'desc').limit(100).execute();
    return rows.map(presentNotification);
  });

  app.post('/v1/me/notifications/read', async (req) => {
    const user = await requireUser(ctx, req, { onboarded: false });
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).optional() }), req.body ?? {});
    let q = ctx.db.updateTable('notifications').set({ read_at: now() }).where('user_id', '=', user.id).where('read_at', 'is', null);
    if (ids?.length) q = q.where('id', 'in', ids);
    await q.execute();
    return { ok: true };
  });

  /**
   * Server-sent events: a hint stream (ADR-007). The client opens it with fetch so it can send
   * the Authorization header, and refetches whatever an event names.
   */
  app.get('/v1/events', async (req, reply) => {
    const user = await optionalUser(ctx, req);
    if (!user) throw unauthorized();
    if (!ctx.hub) return reply.code(503).send({ error: { code: 'UNAVAILABLE', message: 'Realtime is off.' } });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(ctx, req.headers.origin),
    });
    res.write(`event: ready\ndata: {}\n\n`);
    const off = ctx.hub.subscribe(user.id, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      off();
    });
  });
}

function corsHeaders(ctx: Ctx, origin: string | undefined): Record<string, string> {
  const allowed = ctx.env.WEB_ORIGINS.split(',').map((o) => o.trim());
  return origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {};
}
