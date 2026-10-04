import { cellCenter } from '@helpin/geo';
import type { Db } from '@helpin/db';
import type { Env } from './env';
import { now } from './clock';

/**
 * L-09: locality labels come from the cell centre (never the exact point) and are cached per
 * cell. Without a geocoder the label falls back to the district.
 */
export interface Geocoder {
  locality(cell: string): Promise<string | null>;
}

export function geocoderFromEnv(env: Env, db: Db): Geocoder {
  return {
    async locality(cell) {
      const cached = await db.selectFrom('locality_cache').select('locality').where('cell', '=', cell).executeTakeFirst();
      if (cached) return cached.locality;
      if (env.GEOCODER !== 'nominatim') return null;
      try {
        const c = cellCenter(cell);
        const res = await fetch(`${env.NOMINATIM_URL}/reverse?format=jsonv2&zoom=17&lat=${c.lat}&lon=${c.lng}`, {
          headers: { 'User-Agent': 'HelpIn/1.0 (community help app)', 'Accept-Language': 'hu,en' },
          signal: AbortSignal.timeout(2500),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { address?: Record<string, string> };
        const a = json.address ?? {};
        const label = a.road ?? a.square ?? a.park ?? a.neighbourhood ?? a.suburb ?? null;
        if (label) {
          await db.insertInto('locality_cache').values({ cell, locality: label, fetched_at: now() }).onConflict((oc) => oc.column('cell').doNothing()).execute();
        }
        return label;
      } catch {
        return null;
      }
    },
  };
}
