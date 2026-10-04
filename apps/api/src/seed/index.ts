/**
 * Development seed: a believable week in District XI, created through the real API so every
 * rule (offers, response clock, karma, notifications, media processing) runs as in production.
 *
 *   pnpm --filter @helpin/api seed          (refuses to run twice; use `pnpm db:reset` first)
 *
 * Every demo account signs in with its phone number below and the AUTH_DEV_CODE (123456).
 */
import { readFileSync } from 'node:fs';
import { latLngToCell } from 'h3-js';
import sharp from 'sharp';
import { buildApp } from '../app';
import { createCtx } from '../ctx';
import { drainAll } from '../jobs/dispatcher';
import { signAccessToken } from '../platform/auth';
import { clock, DAY, HOUR, now } from '../platform/clock';
import { loadEnv } from '../platform/env';

const MIN = 60_000;

const env = loadEnv();
if (env.NODE_ENV === 'production') throw new Error('The dev seed never runs in production.');
if (!env.AUTH_DEV_CODE) throw new Error('Set AUTH_DEV_CODE=123456 in apps/api/.env to seed.');

const ctx = createCtx(env);
ctx.log = { info: () => undefined, warn: (m) => console.warn(m), error: (m, e) => console.error(m, e) };
const app = await buildApp(ctx);

interface Seeded {
  id: string;
  sid: string;
  name: string;
}

type Body = Record<string, unknown> | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- seed responses are read field by field
async function call(user: Seeded | null, method: string, url: string, body?: Body): Promise<any> {
  const headers: Record<string, string> = {};
  if (user) headers.authorization = `Bearer ${await signAccessToken(ctx, { sub: user.id, sid: user.sid, role: 'user', mfa: false })}`;
  const res = await app.inject({ method: method as 'GET', url, payload: body, headers });
  if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
  return res.body ? res.json() : null;
}

const drain = () => drainAll(ctx);

/* ------------------------------------------------------------------ people */

const SPOTS = {
  bartok: { lat: 47.47721, lng: 19.04802 },
  allee: { lat: 47.47188, lng: 19.05432 },
  pond: { lat: 47.47962, lng: 19.03983 },
  gellert: { lat: 47.48392, lng: 19.05318 },
  bocskai: { lat: 47.47321, lng: 19.04402 },
  rady: { lat: 47.48122, lng: 19.06204 },
  kosztolanyi: { lat: 47.46905, lng: 19.03811 },
  bikas: { lat: 47.46551, lng: 19.03312 },
};

const PEOPLE = [
  { key: 'zsofi', phone: '+36300000001', name: 'Zsófi K.', langs: ['hu', 'en', 'de'], newcomer: false, home: SPOTS.bartok, avatar: 'sunset',
    bio: 'Budapest local · language buddy. Happy to translate letters, explain offices and show you the best lángos in District XI.' },
  { key: 'arjun', phone: '+36300000002', name: 'Arjun S.', langs: ['en', 'hi'], newcomer: true, home: SPOTS.bartok, avatar: null,
    bio: "Master's student at BME, three weeks in Budapest. Can help with English, Hindi and spreadsheets." },
  { key: 'bence', phone: '+36300000003', name: 'Bence T.', langs: ['hu', 'en'], newcomer: false, home: SPOTS.bocskai, avatar: 'tram',
    bio: 'Engineer, cyclist, District XI since forever.' },
  { key: 'david', phone: '+36300000004', name: 'Dávid S.', langs: ['hu'], newcomer: false, home: SPOTS.allee, avatar: null,
    bio: 'Works near the Kormányablak on Bocskai út.' },
  { key: 'lili', phone: '+36300000005', name: 'Lili R.', langs: ['hu', 'en'], newcomer: false, home: SPOTS.pond, avatar: 'cleanup',
    bio: 'Organiser of the Feneketlen-tó clean-ups.' },
  { key: 'olena', phone: '+36300000006', name: 'Olena K.', langs: ['uk', 'ru', 'en'], newcomer: true, home: SPOTS.rady, avatar: null,
    bio: 'Teacher from Kharkiv, now in Budapest with my daughter.' },
  { key: 'reka', phone: '+36300000007', name: 'Réka M.', langs: ['hu', 'en'], newcomer: false, home: SPOTS.allee, avatar: 'dog',
    bio: 'Block C rep for our társasház.' },
  { key: 'wei', phone: '+36300000008', name: 'Wei L.', langs: ['zh', 'en'], newcomer: true, home: SPOTS.kosztolanyi, avatar: null,
    bio: 'PhD student, new in town, very good at fixing bikes.' },
] as const;
type Key = (typeof PEOPLE)[number]['key'];

async function signUp(phone: string): Promise<Seeded> {
  const otp = await call(null, 'POST', '/v1/auth/otp', { channel: 'sms', destination: phone });
  const session = await call(null, 'POST', '/v1/auth/verify', { challengeId: otp.challengeId, code: env.AUTH_DEV_CODE });
  const id = session.me.id as string;
  const sid = (await ctx.db.selectFrom('sessions').select('id').where('user_id', '=', id).orderBy('created_at', 'desc').executeTakeFirstOrThrow()).id;
  return { id, sid, name: '' };
}

/* ------------------------------------------------------------------ photos */

const scene = (name: string) => readFileSync(new URL(`./scenes/${name}.svg`, import.meta.url));

/** Rasterises a design scene to a JPEG and uploads it through the normal media pipeline. */
async function photo(user: Seeded, name: string, purpose: 'problem_photo' | 'post_photo' | 'avatar' | 'chat_image'): Promise<string> {
  const jpeg = await sharp(scene(name)).resize(1200, 1200).jpeg({ quality: 82 }).toBuffer();
  const ticket = await call(user, 'POST', '/v1/media/upload-url', { purpose, contentType: 'image/jpeg', bytes: jpeg.length });
  const put = new URL(ticket.uploadUrl as string);
  const res = await app.inject({ method: 'PUT', url: put.pathname + put.search, payload: jpeg, headers: { 'content-type': 'image/jpeg' } });
  if (res.statusCode !== 200) throw new Error(`upload failed: ${res.body}`);
  await call(user, 'POST', `/v1/media/${ticket.mediaId}/finalize`);
  await drain();
  return ticket.mediaId as string;
}

/* ------------------------------------------------------------------ helpers */

const problem = (over: Record<string, unknown>) => ({
  kind: 'request',
  urgency: 'basic',
  precision: 'standard',
  saveExactPrivately: true,
  languageNeeded: null,
  anonymous: false,
  mediaIds: [],
  communityId: null,
  ...over,
});

async function offerOf(asker: Seeded, problemId: string, helper: Seeded) {
  const detail = await call(asker, 'GET', `/v1/problems/${problemId}`);
  const offer = (detail.offers as { id: string; helper: { id: string }; conversationId: string | null }[]).find((o) => o.helper.id === helper.id);
  if (!offer) throw new Error('offer not found');
  return offer;
}

const say = (user: Seeded, conversationId: string, body: string) => call(user, 'POST', `/v1/conversations/${conversationId}/messages`, { type: 'text', body });

/* ------------------------------------------------------------------ story */

async function main() {
  const existing = await ctx.db.selectFrom('users').select('id').limit(1).executeTakeFirst();
  if (existing) {
    console.log('The database already has users. Run `pnpm db:reset` first, then seed again.');
    return;
  }

  const real = Date.now();
  clock.freeze(new Date(real - 8 * DAY));

  // A neutral account owns the beta communities (COM-02: created by the HelpIn team).
  const team = await signUp('+36300000099');
  await call(team, 'PATCH', '/v1/me/profile', { displayName: 'HelpIn team', bio: 'The people running the HelpIn beta.', languages: ['hu', 'en'], isNewcomer: false });
  await call(team, 'POST', '/v1/me/onboarding', { adult: true, guidelines: true });

  const u = {} as Record<Key, Seeded>;
  for (const p of PEOPLE) {
    const s = await signUp(p.phone);
    s.name = p.name;
    u[p.key] = s;
    const avatarMediaId = p.avatar ? await photo(s, p.avatar, 'avatar') : null;
    await call(s, 'PATCH', '/v1/me/profile', { displayName: p.name, bio: p.bio, languages: [...p.langs], isNewcomer: p.newcomer, avatarMediaId });
    await call(s, 'POST', '/v1/me/onboarding', { adult: true, guidelines: true });
    await call(s, 'PUT', '/v1/me/home-area', { cell: latLngToCell(p.home.lat, p.home.lng, 7) });
    clock.advance(17 * MIN);
  }

  /* communities */
  const COMMUNITIES = [
    { slug: 'district-xi', name: 'District XI neighbours', type: 'district', description: 'Everything Újbuda: news, help, events and welcomes.', rules: 'Be kind. No selling or advertising. Problems go on the map; this is for everything else.', members: ['zsofi', 'lili', 'bence', 'arjun', 'reka', 'david'] },
    { slug: 'hu-en-exchange', name: 'Hungarian–English exchange', type: 'language_culture', description: 'Practise Hungarian or English with friendly neighbours. Coffee meet-ups every Thursday.', rules: 'All levels welcome. Correct gently.', members: ['zsofi', 'arjun', 'olena', 'wei'] },
    { slug: 'intl-students', name: 'International students Budapest', type: 'students', description: 'For everyone studying in Budapest: housing tips, paperwork help and Friday hangouts.', rules: null, members: ['arjun', 'wei'] },
    { slug: 'feneketlen-to', name: 'Feneketlen-tó friends', type: 'civic_environment', description: 'Keeping our pond and park clean, one Sunday at a time.', rules: 'Bring gloves. Leave no bag behind.', members: ['lili', 'bence', 'zsofi'] },
    { slug: 'ukrainians-bp', name: 'Ukrainian community in Budapest', type: 'language_culture', description: 'Support, news and friendship for Ukrainians in Budapest.', rules: null, members: ['olena'] },
    { slug: 'parents-xi', name: 'Parents of District XI', type: 'interest', description: 'Schools, playgrounds, babysitting swaps and hand-me-downs.', rules: 'Never post photos of other people’s children.', members: ['reka'] },
  ] as const;
  const community = {} as Record<string, string>;
  for (const c of COMMUNITIES) {
    const row = await ctx.db
      .insertInto('communities')
      .values({ slug: c.slug, name: c.name, type: c.type, description: c.description, rules: c.rules, created_by: team.id, created_at: now() })
      .returning('id')
      .executeTakeFirstOrThrow();
    community[c.slug] = row.id;
    for (const m of c.members) await call(u[m], 'POST', `/v1/communities/${row.id}/members`);
  }
  await drain();

  // Everyone's account is older than a day before any karma moves (K-01).
  clock.advance(DAY + 3 * HOUR);

  /* Story 1: Wei fixes Bence's bike (solved 6 days ago). */
  const bike = await call(u.bence, 'POST', '/v1/problems', problem({
    categoryId: 'vehicle_help', title: 'Bike chain keeps slipping', description: 'My chain jumps off every few hundred metres. Is anyone handy with derailleurs? I have tools.', point: SPOTS.bocskai,
  }));
  await drain();
  clock.advance(40 * MIN);
  await call(u.wei, 'POST', `/v1/problems/${bike.id}/offers`, { message: 'I fix bikes all the time. I can come by after 6 pm.' });
  await drain();
  clock.advance(25 * MIN);
  let offer = await offerOf(u.bence, bike.id, u.wei);
  await call(u.bence, 'POST', `/v1/offers/${offer.id}/accept`);
  offer = await offerOf(u.bence, bike.id, u.wei);
  await say(u.bence, offer.conversationId!, 'Amazing, thanks! I’m at the corner of Bocskai and Fehérvári.');
  clock.advance(5 * MIN);
  await say(u.wei, offer.conversationId!, 'See you at 6:15 👍');
  clock.advance(3 * HOUR);
  await call(u.wei, 'POST', `/v1/offers/${offer.id}/claim-solved`);
  clock.advance(HOUR);
  await call(u.bence, 'POST', `/v1/problems/${bike.id}/confirm-solved`, { creditedOfferIds: [offer.id] });
  await drain();

  /* Photo posts across the week. */
  const posts: Record<string, string> = {};
  const photoPost = async (who: Key, img: string, caption: string, slug: string | null, key: string) => {
    const mediaId = await photo(u[who], img, 'post_photo');
    const post = await call(u[who], 'POST', '/v1/posts', { kind: 'photo', caption, mediaIds: [mediaId], communityId: slug ? community[slug] : null, problemId: null });
    posts[key] = post.id;
    await drain();
  };
  clock.advance(5 * HOUR);
  await photoPost('zsofi', 'poster', 'Making posters for the welcome picnic!', 'district-xi', 'poster');
  clock.advance(DAY - 2 * HOUR);
  await photoPost('zsofi', 'dog', 'Walked Bodza for my neighbour while she recovers. Best boy.', null, 'dog');
  await photoPost('lili', 'cleanup', '14 neighbours, 22 bags of rubbish. Thank you all!', 'feneketlen-to', 'cleanup');
  clock.advance(DAY);
  await photoPost('zsofi', 'bridge', 'Liberty Bridge lit up tonight.', null, 'bridge');
  clock.advance(DAY);

  /* Story 2: Zsófi helps Arjun with a letter (solved, thanked publicly). */
  const letter = await call(u.arjun, 'POST', '/v1/problems', problem({
    categoryId: 'paperwork_offices', urgency: 'medium', title: 'Help reading a letter from the district office',
    description: 'Got an official letter about my address registration. Google Translate isn’t making sense of it. Could someone explain what I need to do?',
    point: SPOTS.bartok, languageNeeded: 'hu>en',
  }));
  await drain();
  await photoPost('zsofi', 'langos', 'Lángos lesson for our exchange group: sour cream, cheese, a little garlic.', 'hu-en-exchange', 'langos');
  clock.advance(35 * MIN);
  await call(u.zsofi, 'POST', `/v1/problems/${letter.id}/offers`, { message: 'Szia! I can read it with you and explain. I speak English and live close by.' });
  await call(u.david, 'POST', `/v1/problems/${letter.id}/offers`, { message: 'I work near the Kormányablak, happy to help.' });
  await drain();
  clock.advance(50 * MIN);
  offer = await offerOf(u.arjun, letter.id, u.zsofi);
  await call(u.arjun, 'POST', `/v1/offers/${offer.id}/accept`);
  const davidOffer = await offerOf(u.arjun, letter.id, u.david);
  await call(u.arjun, 'POST', `/v1/offers/${davidOffer.id}/decline`);
  offer = await offerOf(u.arjun, letter.id, u.zsofi);
  const conv = offer.conversationId!;
  await say(u.arjun, conv, 'Thank you so much! Here’s the letter.');
  clock.advance(4 * MIN);
  await say(u.zsofi, conv, 'No worries! It says you need to confirm your address at the Kormányablak within 15 days. Bring your passport and rental contract.');
  clock.advance(3 * MIN);
  await say(u.arjun, conv, 'That’s all? I was so worried 😅');
  clock.advance(2 * MIN);
  await say(u.zsofi, conv, 'That’s all. Book an appointment online, I can show you how tomorrow.');
  clock.advance(DAY);
  await say(u.arjun, conv, 'Booked for Thursday. Köszönöm!');
  clock.advance(10 * MIN);
  await call(u.zsofi, 'POST', `/v1/offers/${offer.id}/claim-solved`);
  await drain();
  clock.advance(2 * HOUR);
  await call(u.arjun, 'POST', `/v1/problems/${letter.id}/confirm-solved`, { creditedOfferIds: [offer.id] });
  await drain();
  clock.advance(HOUR);
  const thanks = await call(u.arjun, 'POST', '/v1/posts', {
    kind: 'thank_you', caption: 'Huge thanks to Zsófi, who translated my letter and explained everything. Three weeks in Budapest and it already feels like home.',
    mediaIds: [], communityId: null, problemId: letter.id,
  });
  posts.thanks = thanks.id;
  await drain();
  clock.advance(40 * MIN);
  await call(u.zsofi, 'POST', `/v1/posts/${thanks.id}/tags/approve`);
  await drain();

  clock.advance(DAY);
  await photoPost('zsofi', 'tram', 'Tram 4-6 at golden hour.', null, 'tram');
  await call(u.arjun, 'POST', '/v1/posts', { kind: 'welcome', caption: 'Hi all! Arjun here, studying at BME. Happy to help with English or Hindi, and always up for a coffee.', mediaIds: [], communityId: community['intl-students'], problemId: null });
  await call(u.wei, 'POST', '/v1/posts', { kind: 'welcome', caption: 'Hello from Wei! New in District XI. If your bike squeaks, I’m your neighbour.', mediaIds: [], communityId: community['intl-students'], problemId: null });
  await drain();

  /* The last ~36 hours: open problems that make the map feel alive. */
  clock.freeze(new Date(real - 36 * HOUR));
  const drainPhoto = await photo(u.david, 'drain', 'problem_photo');
  const drainProblem = await call(u.david, 'POST', '/v1/problems', problem({
    kind: 'issue', categoryId: 'drainage', title: 'Blocked drain floods the corner after rain',
    description: 'The storm drain at the crossing is full of leaves. After every shower the pavement is ankle-deep. Reported to Fővárosi Csatornázási Művek too.',
    point: SPOTS.bocskai, mediaIds: [drainPhoto],
  }));
  await drain();
  clock.advance(2 * HOUR);
  await call(u.bence, 'POST', `/v1/problems/${drainProblem.id}/affected`);
  await call(u.reka, 'POST', `/v1/problems/${drainProblem.id}/affected`);
  await drain();

  clock.advance(3 * HOUR);
  const pondPhoto = await photo(u.lili, 'cleanup', 'problem_photo');
  const pond = await call(u.lili, 'POST', '/v1/problems', problem({
    kind: 'issue', categoryId: 'water_bodies', title: 'Plastic waste piling up at Feneketlen-tó',
    description: 'Bottles and bags collecting by the south bank again. Planning a clean-up on Sunday at 10. Gloves and bags provided!',
    point: SPOTS.pond, mediaIds: [pondPhoto], communityId: community['feneketlen-to'],
  }));
  await drain();
  clock.advance(HOUR);
  await call(u.zsofi, 'POST', `/v1/problems/${pond.id}/affected`);
  await call(u.bence, 'POST', `/v1/problems/${pond.id}/offers`, { message: 'I’ll be there Sunday with my cargo bike to take bags to the collection point.' });
  await drain();
  clock.advance(2 * HOUR);
  const bOffer = await offerOf(u.lili, pond.id, u.bence);
  await call(u.lili, 'POST', `/v1/offers/${bOffer.id}/accept`);
  await say(u.lili, (await offerOf(u.lili, pond.id, u.bence)).conversationId!, 'You’re a star. Meet by the gazebo at 10?');
  await drain();

  clock.advance(5 * HOUR);
  const gp = await call(u.olena, 'POST', '/v1/problems', problem({
    categoryId: 'finding_services', title: 'Looking for an English-speaking GP nearby',
    description: 'My daughter needs a check-up for school. We speak Ukrainian, Russian and English. Any recommendations in District IX or XI?',
    point: SPOTS.rady,
  }));
  await drain();
  clock.advance(HOUR);
  await call(u.zsofi, 'POST', `/v1/problems/${gp.id}/offers`, { message: 'My GP on Ráday utca speaks great English. I can send you the details and help you call.' });
  await drain();
  clock.advance(30 * MIN);
  const gOffer = await offerOf(u.olena, gp.id, u.zsofi);
  await call(u.olena, 'POST', `/v1/offers/${gOffer.id}/accept`);
  const gConv = (await offerOf(u.olena, gp.id, u.zsofi)).conversationId!;
  await say(u.olena, gConv, 'Thank you! That would help a lot.');
  clock.advance(6 * MIN);
  await say(u.zsofi, gConv, 'Dr. Németh, Ráday utca 30. They take new patients on Tuesdays. Want me to call with you?');
  await drain();

  clock.advance(8 * HOUR);
  await photoPost('lili', 'picnic', 'Welcome picnic for newcomers this Saturday at Bikás park! Bring something from home to share. Locals very welcome too.', 'district-xi', 'picnic');

  clock.freeze(new Date(real - 10 * HOUR));
  const drill = await call(u.wei, 'POST', '/v1/problems', problem({
    categoryId: 'borrow_lend', title: 'Can someone lend a drill for an hour?',
    description: 'Need to mount one shelf. I will bring it back the same day, promise. Can fix your bike in return!', point: SPOTS.kosztolanyi,
  }));
  await drain();
  clock.advance(2 * HOUR);
  await call(u.bence, 'POST', `/v1/problems/${drill.id}/offers`, { message: 'I have a cordless drill and bits. I’m home after 7.' });
  await drain();

  clock.freeze(new Date(real - 4 * HOUR));
  await photoPost('zsofi', 'sunset', 'Evening walk up Gellért Hill. Never gets old.', null, 'sunset');
  const cat = await call(u.reka, 'POST', '/v1/problems', problem({
    categoryId: 'pets_animals', urgency: 'medium', title: 'Lost grey cat near Gellért tér',
    description: 'Grey cat with white paws, very shy, answers to "Murka". Please check balconies and cellars.', point: SPOTS.gellert,
  }));
  await drain();
  void cat;

  clock.freeze(new Date(real - 70 * MIN));
  await call(u.reka, 'POST', '/v1/problems', problem({
    kind: 'issue', categoryId: 'water_supply', urgency: 'serious', title: 'No water in our buildings since 7 am',
    description: 'Allée area, at least three buildings without water. Elderly neighbours on the 4th floor need bottles. Waterworks says a pipe burst.',
    point: SPOTS.allee,
  }));
  await drain();
  clock.advance(20 * MIN);

  /* Likes and comments, so the feed has some life. */
  const likers: Record<string, Key[]> = {
    thanks: ['zsofi', 'bence', 'lili', 'reka', 'wei', 'olena'],
    sunset: ['arjun', 'bence', 'lili', 'reka', 'david'],
    picnic: ['zsofi', 'arjun', 'olena', 'wei'],
    cleanup: ['zsofi', 'bence', 'reka', 'david', 'arjun', 'wei'],
    dog: ['lili', 'reka', 'arjun', 'olena', 'bence', 'wei', 'david'],
    tram: ['bence', 'wei'],
    langos: ['arjun', 'olena', 'wei'],
    bridge: ['lili', 'arjun'],
    poster: ['lili', 'reka'],
  };
  for (const [key, who] of Object.entries(likers)) for (const k of who) if (posts[key]) await call(u[k], 'PUT', `/v1/posts/${posts[key]}/reaction`);
  const comments: [string, Key, string][] = [
    ['thanks', 'zsofi', 'Any time, Arjun! Good luck on Thursday 🍀'],
    ['thanks', 'olena', 'This is so nice to read.'],
    ['picnic', 'arjun', 'I’ll bring samosas!'],
    ['picnic', 'olena', 'We’ll come with my daughter 💛'],
    ['dog', 'reka', 'Bodza says thank you!'],
    ['sunset', 'bence', 'Best view in the city.'],
    ['cleanup', 'zsofi', 'Count me in for the next one.'],
  ];
  for (const [key, who, body] of comments) {
    await call(u[who], 'POST', `/v1/posts/${posts[key]}/comments`, { body });
    clock.advance(3 * MIN);
  }
  await drain();

  clock.reset();
  const counts = await Promise.all(
    (['users', 'problems', 'help_offers', 'messages', 'posts', 'media', 'notifications'] as const).map(async (t) => {
      const r = await ctx.db.selectFrom(t).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
      return `${t}: ${r.n}`;
    }),
  );
  console.log(`Seeded HelpIn demo data (${counts.join(', ')}).`);
  console.log('Sign in with any of these phone numbers and code', env.AUTH_DEV_CODE);
  for (const p of PEOPLE) console.log(`  ${p.phone}  ${p.name}`);
}

try {
  await main();
} finally {
  clock.reset();
  await app.close();
  await ctx.close();
}
