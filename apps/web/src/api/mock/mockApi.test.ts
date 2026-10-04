import { describe, expect, it, beforeEach } from 'vitest';
import {
  FORBIDDEN_PUBLIC_KEYS,
  MapResponseSchema,
  PostSchema,
  ProblemCardSchema,
  ProblemDetailSchema,
} from '@helpin/contracts';
import { MockApi } from './mockApi';
import { createSeed } from './seed';

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const H = 3_600_000;

function setup(userId = 'u_zsofi', now = NOW) {
  let t = now;
  const api = new MockApi(createSeed(now), { latencyMs: 0, now: () => t });
  return {
    api,
    as: (id: string) => api.switchDemoUser(id),
    tick: (ms: number) => {
      t += ms;
    },
    ready: api.switchDemoUser(userId),
  };
}

/** Walks a JSON value and returns every key path. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => keyPaths(v, `${prefix}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [`${prefix}.${k}`, ...keyPaths(v, `${prefix}.${k}`)]);
  }
  return [];
}

describe('privacy contract (L-01, L-03, A-01)', () => {
  it('public problem responses never contain exact coordinates or contact details', async () => {
    const { api, ready } = setup();
    await ready;
    const map = await api.getMap([18.9, 47.3, 19.4, 47.7], 15);
    const nearby = await api.listNearby({ lat: 47.47, lng: 19.05 });
    const detail = await api.getProblem('p_letter');
    for (const payload of [map, nearby, detail]) {
      const paths = keyPaths(payload);
      for (const forbidden of FORBIDDEN_PUBLIC_KEYS) {
        expect(paths.some((p) => p.endsWith(`.${forbidden}`))).toBe(false);
      }
      // the only coordinates allowed are the cell centre
      const coordPaths = paths.filter((p) => p.endsWith('.lat'));
      expect(coordPaths.every((p) => p.endsWith('center.lat'))).toBe(true);
    }
  });

  it('public centre is the hexagon centre, not the exact point', async () => {
    const { api, ready } = setup();
    await ready;
    const detail = await api.getProblem('p_letter');
    expect(detail.area.center).not.toEqual({ lat: 47.47721, lng: 19.04802 });
    expect(detail.area.areaRes).toBe(8);
  });

  it('hides anonymous askers', async () => {
    const { api, ready } = setup();
    await ready;
    const cat = await api.getProblem('p_cat');
    expect(cat.asker).toEqual({ anonymous: true, reliability: 1 });
    expect(JSON.stringify(cat)).not.toContain('Olena');
  });

  it('responses match the shared contracts', async () => {
    const { api, ready } = setup();
    await ready;
    MapResponseSchema.parse(await api.getMap([18.9, 47.3, 19.4, 47.7], 15));
    ProblemDetailSchema.parse(await api.getProblem('p_water'));
    (await api.listNearby({ lat: 47.47, lng: 19.05 })).forEach((c) => ProblemCardSchema.parse(c));
    (await api.getFeed()).forEach((p) => PostSchema.parse(p));
  });
});

describe('help offers (R-10…R-13)', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup('u_wei');
    await ctx.ready;
  });

  it('cannot offer help on your own problem', async () => {
    await expect(ctx.api.offerHelp('p_drill', null)).rejects.toMatchObject({ code: 'OWN_PROBLEM' });
  });

  it('one offer per helper per problem', async () => {
    await ctx.api.offerHelp('p_letter', 'I can help too');
    await expect(ctx.api.offerHelp('p_letter', 'again')).rejects.toMatchObject({ code: 'OFFER_EXISTS' });
  });

  it('accepting opens a chat with the offer message first', async () => {
    await ctx.as('u_zsofi');
    await ctx.api.offerHelp('p_drill', 'I have a drill, can bring it at 6.');
    await ctx.as('u_wei');
    const detail = await ctx.api.getProblem('p_drill');
    const offer = detail.offers[0]!;
    const { conversationId } = await ctx.api.acceptOffer(offer.id);
    const { messages } = await ctx.api.getConversation(conversationId);
    expect(messages.map((m) => m.type)).toEqual(['system', 'text']);
    expect(messages[1]!.body).toBe('I have a drill, can bring it at 6.');
  });
});

describe('response rule (R-50…R-58)', () => {
  it('starts the 48 h clock on the first offer, personal problems only', async () => {
    const ctx = setup('u_zsofi');
    await ctx.ready;
    await ctx.api.offerHelp('p_drill', null);
    await ctx.as('u_wei');
    const drill = await ctx.api.getProblem('p_drill');
    expect(new Date(drill.responseDueAt!).getTime()).toBe(NOW + 48 * H);

    await ctx.as('u_zsofi');
    await ctx.api.offerHelp('p_water', null);
    await ctx.as('u_reka');
    expect((await ctx.api.getProblem('p_water')).responseDueAt).toBeNull();
  });

  it('a raiser response (chat reply) resets the clock', async () => {
    const ctx = setup('u_arjun');
    await ctx.ready;
    ctx.tick(10 * H);
    await ctx.api.sendMessage('c_letter', 'Thursday works, thank you!');
    const letter = await ctx.api.getProblem('p_letter');
    expect(new Date(letter.responseDueAt!).getTime()).toBe(NOW + 10 * H + 48 * H);
  });

  it('only the asker sees the deadline', async () => {
    const ctx = setup('u_zsofi');
    await ctx.ready;
    expect((await ctx.api.getProblem('p_letter')).responseDueAt).toBeNull();
  });
});

describe('confirm solved & karma (K-01, K-02, K-05, K-11)', () => {
  it('credits helpers +10 and the asker +2, once', async () => {
    const ctx = setup('u_arjun');
    await ctx.ready;
    const before = await ctx.api.getUser('u_zsofi');
    const result = await ctx.api.confirmSolved('p_letter', ['o_zsofi_letter', 'o_bence_letter']);
    expect(result.credited).toBe(2);
    expect(result.askerAward).toBe(2);
    expect(result.problem.status).toBe('solved');
    expect((await ctx.api.getUser('u_zsofi')).karma).toBe(before.karma + 10);
    await expect(ctx.api.confirmSolved('p_letter', [])).rejects.toMatchObject({ code: 'PROBLEM_NOT_OPEN' });
  });

  it('caps credits at 3 helpers', async () => {
    const ctx = setup('u_arjun');
    await ctx.ready;
    await expect(ctx.api.confirmSolved('p_letter', ['a', 'b', 'c', 'd'])).rejects.toMatchObject({ code: 'TOO_MANY_CREDITS' });
  });

  it('gives no closing award when nobody is credited', async () => {
    const ctx = setup('u_arjun');
    await ctx.ready;
    const result = await ctx.api.confirmSolved('p_letter', []);
    expect(result.askerAward).toBe(0);
  });

  it('applies the 7-day pair cooldown', async () => {
    const ctx = setup('u_zsofi');
    await ctx.ready;
    await ctx.api.offerHelp('p_drill', null);
    await ctx.as('u_wei');
    const first = (await ctx.api.getProblem('p_drill')).offers[0]!;
    await ctx.api.confirmSolved('p_drill', [first.id]);
    const created = await ctx.api.createProblem({
      categoryId: 'borrow_lend', kind: 'request', title: 'Borrow a ladder', description: '', urgency: 'basic',
      precision: 'standard', point: { lat: 47.47, lng: 19.04 }, saveExactPrivately: false, languageNeeded: null,
      anonymous: false, photoCount: 0, communityId: null,
    });
    await ctx.as('u_zsofi');
    await ctx.api.offerHelp(created.id, null);
    await ctx.as('u_wei');
    const second = (await ctx.api.getProblem(created.id)).offers[0]!;
    ctx.tick(2 * H);
    const result = await ctx.api.confirmSolved(created.id, [second.id]);
    expect(result.askerAward).toBe(0);
    await ctx.as('u_zsofi');
    const history = await ctx.api.getKarmaHistory();
    expect(history[0]).toMatchObject({ amount: 0, reason: 'pair_cooldown' });
  });
});

describe('community problems', () => {
  it('"Fixed now" from 3 affected neighbours solves it (R-21)', async () => {
    const ctx = setup('u_zsofi');
    await ctx.ready;
    for (const id of ['u_zsofi', 'u_wei', 'u_olena']) {
      await ctx.as(id);
      await ctx.api.markSameHere('p_light', true);
      const d = await ctx.api.fixedNow('p_light');
      if (id === 'u_olena') expect(d.status).toBe('solved');
      else expect(d.status).toBe('open');
    }
  });

  it('only allows exact public spots for community problems (L-02)', async () => {
    const ctx = setup('u_wei');
    await ctx.ready;
    await expect(
      ctx.api.createProblem({
        categoryId: 'borrow_lend', kind: 'request', title: 'Borrow a ladder', description: '', urgency: 'basic',
        precision: 'exact', point: { lat: 47.47, lng: 19.04 }, saveExactPrivately: false, languageNeeded: null,
        anonymous: false, photoCount: 0, communityId: null,
      }),
    ).rejects.toThrow();
  });

  it('rejects problems outside Budapest (L-10)', async () => {
    const ctx = setup('u_wei');
    await ctx.ready;
    await expect(
      ctx.api.createProblem({
        categoryId: 'borrow_lend', kind: 'request', title: 'Borrow a ladder', description: '', urgency: 'basic',
        precision: 'standard', point: { lat: 48.2082, lng: 16.3738 }, saveExactPrivately: false, languageNeeded: null,
        anonymous: false, photoCount: 0, communityId: null,
      }),
    ).rejects.toMatchObject({ code: 'OUTSIDE_LAUNCH_AREA' });
  });
});

describe('login (demo)', () => {
  it('accepts only the demo code', async () => {
    const api = new MockApi(createSeed(NOW), { latencyMs: 0 });
    await api.requestCode('+36 30 987 6543');
    await expect(api.verifyCode('000000')).rejects.toMatchObject({ code: 'CODE_MISMATCH' });
    const me = await api.verifyCode('123456');
    expect(me.displayName).toBe('Arjun S.');
  });
});
