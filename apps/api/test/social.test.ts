import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { PostSchema } from '@helpin/contracts';
import { clock, now } from '../src/platform/clock';
import { totpCode } from '../src/platform/crypto';
import { H, harness, problemInput, type Harness, type TestUser } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

/** A JPEG that carries location-like EXIF metadata. */
async function taggedJpeg() {
  return sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 10, g: 122, b: 86 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'SECRET-GPS-MARKER', Artist: 'Home: Bartok Bela ut 12' } })
    .toBuffer();
}

async function upload(u: TestUser, purpose: string, buf?: Buffer) {
  const body = buf ?? (await taggedJpeg());
  const ticket = (await h.req(u, 'POST', '/v1/media/upload-url', { purpose, contentType: 'image/jpeg', bytes: body.length })).body;
  const url = new URL(ticket.uploadUrl);
  const put = await h.app.inject({ method: 'PUT', url: url.pathname + url.search, payload: body, headers: { 'content-type': 'image/jpeg' } });
  expect(put.statusCode).toBe(200);
  await h.req(u, 'POST', `/v1/media/${ticket.mediaId}/finalize`);
  await h.drain();
  return ticket.mediaId as string;
}

async function fetchMedia(url: string) {
  const u = new URL(url);
  const res = await h.app.inject({ method: 'GET', url: u.pathname + u.search });
  return res;
}

describe('media pipeline (L-08, F-03)', () => {
  it('strips all metadata, makes WebP sizes, and never serves the original', async () => {
    const u = await h.user('Arjun');
    const original = await taggedJpeg();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const id = await upload(u, 'problem_photo', original);
    const status = (await h.req(u, 'GET', `/v1/media/${id}`)).body;
    expect(status.status).toBe('ready');
    expect(status.media.width).toBe(1600);
    const res = await fetchMedia(status.media.fullUrl);
    expect(res.statusCode).toBe(200);
    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(res.rawPayload.includes(Buffer.from('SECRET-GPS-MARKER'))).toBe(false);
    // The quarantined original is gone and was never downloadable.
    const forged = status.media.fullUrl.replace(`media/${id}/1600.webp`, `quarantine/${id}`);
    expect((await fetchMedia(forged)).statusCode).toBe(403);
  });

  it('F-03: feed photos can’t go on problems, and problem photos can’t go on posts', async () => {
    const u = await h.user('Arjun');
    const postPhoto = await upload(u, 'post_photo');
    const problemPhoto = await upload(u, 'problem_photo');
    expect((await h.req(u, 'POST', '/v1/problems', problemInput({ mediaIds: [postPhoto] }))).body.error.code).toBe('INVALID_MEDIA');
    expect((await h.req(u, 'POST', '/v1/posts', { kind: 'photo', caption: 'x', mediaIds: [problemPhoto], communityId: null, problemId: null })).body.error.code).toBe('INVALID_MEDIA');
    const p = (await h.req(u, 'POST', '/v1/problems', problemInput({ mediaIds: [problemPhoto] }))).body;
    expect(p.photos).toHaveLength(1);
    expect(p.coverPhoto.id).toBe(problemPhoto);
    // F-04: problem photos show in their own profile tab, never as posts.
    const viewer = await h.user('Viewer');
    expect((await h.req(viewer, 'GET', `/v1/users/${u.id}/problem-photos`)).body).toHaveLength(1);
    expect((await h.req(viewer, 'GET', `/v1/users/${u.id}/posts`)).body).toHaveLength(0);
  });
});

describe('social feed (F-01…F-06)', () => {
  it('posts appear for neighbours, with likes and comments', async () => {
    const zsofi = await h.user('Zsófi');
    const lili = await h.user('Lili');
    const photo = await upload(zsofi, 'post_photo');
    expect((await h.req(zsofi, 'POST', '/v1/posts', { kind: 'photo', caption: 'Sunset', mediaIds: [], communityId: null, problemId: null })).status).toBe(400); // F-01
    const post = (await h.req(zsofi, 'POST', '/v1/posts', { kind: 'photo', caption: 'Evening walk up Gellért Hill', mediaIds: [photo], communityId: null, problemId: null })).body;
    PostSchema.parse(post);
    const feed = (await h.req(lili, 'GET', '/v1/feed')).body;
    expect(feed.items.map((p: { id: string }) => p.id)).toEqual([post.id]);
    expect((await h.req(lili, 'PUT', `/v1/posts/${post.id}/reaction`)).body).toMatchObject({ likes: 1, liked: true });
    await h.req(lili, 'POST', `/v1/posts/${post.id}/comments`, { body: 'Gorgeous!' });
    expect((await h.req(zsofi, 'GET', `/v1/posts/${post.id}/comments`)).body[0]).toMatchObject({ body: 'Gorgeous!' });
    await h.drain();
    expect((await h.req(zsofi, 'GET', '/v1/me/notifications')).body[0].type).toBe('comment');
  });

  it('F-06: thank-you posts tag credited helpers only after they approve', async () => {
    const arjun = await h.user('Arjun');
    const zsofi = await h.user('Zsófi');
    clock.advance(25 * H);
    const p = (await h.req(arjun, 'POST', '/v1/problems', problemInput())).body;
    await h.req(zsofi, 'POST', `/v1/problems/${p.id}/offers`, { message: null });
    const offerId = (await h.req(arjun, 'GET', `/v1/problems/${p.id}`)).body.offers[0].id;
    await h.req(arjun, 'POST', `/v1/problems/${p.id}/confirm-solved`, { creditedOfferIds: [offerId] });
    const post = (await h.req(arjun, 'POST', '/v1/posts', { kind: 'thank_you', caption: 'Thank you Zsófi!', mediaIds: [], communityId: null, problemId: p.id })).body;
    expect(post.thanked).toEqual([]);
    expect(post.problem.id).toBe(p.id);
    await h.drain();
    expect((await h.req(zsofi, 'GET', '/v1/me/notifications')).body.some((n: { type: string }) => n.type === 'tag_request')).toBe(true);
    await h.req(zsofi, 'POST', `/v1/posts/${post.id}/tags/approve`);
    expect((await h.req(zsofi, 'GET', '/v1/feed')).body.items[0].thanked).toEqual(['Zsófi']);
  });

  it('communities: join, welcome thread, and private membership (COM-03, COM-05, COM-06)', async () => {
    const admin = await h.user('Founder', { role: 'admin' });
    const u = await h.user('Arjun');
    const c = (await h.req(admin, 'POST', '/v1/admin/communities', { name: 'District XI neighbours', slug: 'district-xi', type: 'district', description: 'Újbuda', rules: null })).body;
    expect((await h.req(u, 'POST', '/v1/posts', { kind: 'welcome', caption: 'Hi!', mediaIds: [], communityId: c.id, problemId: null })).body.error.code).toBe('NOT_A_MEMBER');
    expect((await h.req(u, 'POST', `/v1/communities/${c.id}/members`)).body).toMatchObject({ joined: true, memberCount: 1 });
    await h.req(u, 'POST', '/v1/posts', { kind: 'welcome', caption: 'Hi! I just moved to Budapest.', mediaIds: [], communityId: c.id, problemId: null });
    const detail = (await h.req(u, 'GET', '/v1/communities/district-xi')).body;
    expect(detail.welcome).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain('members":[');
    expect((await h.req(u, 'GET', `/v1/users/${u.id}`)).body).not.toHaveProperty('communities');
  });
});

describe('safety and moderation (S-04…S-10, A-06, A-07, K-16)', () => {
  it('auto-hides at 3 reports; admin needs 2FA; fake-problem penalty; appeal', async () => {
    const asker = await h.user('Faker');
    const reporters = [await h.user('R1'), await h.user('R2'), await h.user('R3')];
    const p = (await h.req(asker, 'POST', '/v1/problems', problemInput({ anonymous: true, title: 'Totally real problem' }))).body;
    for (const r of reporters.slice(0, 2)) await h.req(r, 'POST', '/v1/reports', { targetType: 'problem', targetId: p.id, reason: 'fake_problem', details: null });
    expect((await h.req(reporters[2]!, 'GET', `/v1/problems/${p.id}`)).status).toBe(200);
    await h.req(reporters[2]!, 'POST', '/v1/reports', { targetType: 'problem', targetId: p.id, reason: 'fake_problem', details: 'Made up' });
    expect((await h.req(reporters[2]!, 'GET', `/v1/problems/${p.id}`)).status).toBe(404); // S-05
    expect((await h.req(asker, 'GET', `/v1/problems/${p.id}`)).body.hidden).toBe(true);

    // S-10: an admin without a verified second factor is turned away.
    const admin = { ...(await h.user('Founder', { role: 'admin' })), mfa: false };
    expect((await h.req(admin, 'GET', '/v1/admin/reports')).body.error.code).toBe('MFA_REQUIRED');
    const setup = (await h.req(admin, 'POST', '/v1/auth/mfa/setup')).body;
    const verified = await h.req(admin, 'POST', '/v1/auth/mfa/verify', { code: totpCode(setup.secret, now().getTime()) });
    expect(verified.status).toBe(200);
    expect(verified.body.me.mfaVerified).toBe(true);
    const staff = { ...admin, mfa: true };

    const queue = (await h.req(staff, 'GET', '/v1/admin/reports')).body;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ reportCount: 3, preview: { authorId: null, hidden: true } }); // A-07: hidden by default
    const revealed = (await h.req(staff, 'POST', `/v1/admin/reports/${queue[0].id}/reveal`)).body;
    expect(revealed.userId).toBe(asker.id);

    await h.req(staff, 'POST', `/v1/admin/reports/${queue[0].id}/decide`, { action: 'fake_problem', reason: 'Made-up problem', statement: 'This problem was not real (community guidelines: no fake problems).' });
    const me = (await h.req(asker, 'GET', '/v1/me')).body;
    expect(me.karma).toBe(-20);
    expect(me.canPostAnonymously).toBe(false);
    expect((await h.req(asker, 'GET', `/v1/problems/${p.id}`)).body.status).toBe('removed'); // the owner still sees why
    expect((await h.req(reporters[0]!, 'GET', `/v1/problems/${p.id}`)).status).toBe(404);
    const audit = await h.ctx.db.selectFrom('moderation_actions').select('action').execute();
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['hide', 'reveal_anonymous_author', 'fake_problem_penalty']));

    // S-09: statement of reasons arrives, and the user can appeal once.
    await h.drain();
    const notice = (await h.req(asker, 'GET', '/v1/me/notifications')).body.find((n: { type: string }) => n.type === 'content_removed');
    expect(notice.body).toContain('not real');
    expect((await h.req(asker, 'POST', '/v1/appeals', { moderationActionId: notice.moderationActionId, body: 'It was real!' })).status).toBe(200);
    expect((await h.req(asker, 'POST', '/v1/appeals', { moderationActionId: notice.moderationActionId, body: 'Again' })).body.error.code).toBe('ALREADY_APPEALED');
    const appeal = (await h.req(staff, 'GET', '/v1/admin/appeals')).body[0];
    await h.req(staff, 'POST', `/v1/admin/appeals/${appeal.id}/decide`, { decision: 'overturned', note: 'You showed it was real, sorry.' });
    expect((await h.req(asker, 'GET', '/v1/me')).body).toMatchObject({ karma: 0, canPostAnonymously: true });
  });

  it('K-08: an admin can reverse karma once', async () => {
    const asker = await h.user('Asker');
    const helper = await h.user('Helper');
    const staff = await h.user('Founder', { role: 'admin' });
    clock.advance(25 * H);
    const p = (await h.req(asker, 'POST', '/v1/problems', problemInput())).body;
    await h.req(helper, 'POST', `/v1/problems/${p.id}/offers`, { message: null });
    const offerId = (await h.req(asker, 'GET', `/v1/problems/${p.id}`)).body.offers[0].id;
    await h.req(asker, 'POST', `/v1/problems/${p.id}/confirm-solved`, { creditedOfferIds: [offerId] });
    const entry = (await h.req(staff, 'GET', `/v1/admin/users/${helper.id}/karma`)).body[0];
    expect((await h.req(staff, 'POST', `/v1/admin/karma/${entry.id}/reverse`, { reason: 'Collusion' })).status).toBe(200);
    expect((await h.req(helper, 'GET', '/v1/me')).body).toMatchObject({ karma: 0, neighboursHelped: 0 });
    expect((await h.req(staff, 'POST', `/v1/admin/karma/${entry.id}/reverse`, { reason: 'Again' })).body.error.code).toBe('ALREADY_REVERSED');
  });
});

describe('GDPR (S-07, S-08)', () => {
  it('exports everything and deletes the account', async () => {
    const u = await h.user('Leaving Neighbour');
    const helper = await h.user('Helper');
    const p = (await h.req(u, 'POST', '/v1/problems', problemInput())).body;
    await h.req(helper, 'POST', `/v1/problems/${p.id}/offers`, { message: null });
    const exp = (await h.req(u, 'GET', '/v1/me/export')).body;
    expect(exp.problems).toHaveLength(1);
    expect(exp.profile.display_name).toBe('Leaving Neighbour');
    expect((await h.req(u, 'DELETE', '/v1/me', { confirm: 'DELETE' })).status).toBe(200);
    expect((await h.req(u, 'GET', '/v1/me')).status).toBe(401);
    const user = await h.ctx.db.selectFrom('users').selectAll().where('id', '=', u.id).executeTakeFirstOrThrow();
    expect(user).toMatchObject({ status: 'deleted', phone_e164: null, email: null });
    expect(await h.ctx.db.selectFrom('problem_private_locations').selectAll().execute()).toHaveLength(0);
    const seen = (await h.req(helper, 'GET', `/v1/problems/${p.id}`)).body;
    expect(seen.status).toBe('withdrawn');
    expect(seen.asker.user.displayName).toBe('Deleted user');
  });
});
