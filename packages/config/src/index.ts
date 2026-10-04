/**
 * HelpIn product configuration. These values are the single source of truth for both the
 * web app and (later) the API, and will be served by `GET /meta/config` so they can change
 * without a client release. Rule IDs refer to docs/02-domain-model.md.
 */

export type Kind = 'request' | 'issue';
export type Urgency = 'basic' | 'medium' | 'serious';
export type ProgressStatus =
  | 'still_need_help'
  | 'making_progress'
  | 'partly_solved'
  | 'need_changed'
  | 'note';
export type ProblemStatus = 'open' | 'solved' | 'abandoned' | 'expired' | 'withdrawn' | 'removed';
export type Precision = 'standard' | 'wider' | 'exact';

export interface Category {
  id: string;
  label: string;
  defaultKind: Kind;
  defaultUrgency: Urgency;
  /** LANG-02: language help required for this category. */
  requiresLanguage?: boolean;
  /** CAT-07 / CAT-08: show the paperwork safety tips. */
  paperworkTips?: boolean;
}

export interface CategoryGroup {
  id: string;
  label: string;
  hint: string;
  categories: Category[];
}

const c = (
  id: string,
  label: string,
  defaultKind: Kind,
  defaultUrgency: Urgency = 'basic',
  extra: Partial<Category> = {},
): Category => ({ id, label, defaultKind, defaultUrgency, ...extra });

/** Domain §11 — any local problem can be posted. */
export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: 'everyday',
    label: 'Everyday help',
    hint: 'A hand, lost things, pets',
    categories: [
      c('need_a_hand', 'Need a hand', 'request'),
      c('lost_found', 'Lost & found', 'request', 'medium'),
      c('borrow_lend', 'Borrow / lend', 'request'),
      c('elderly_support', 'Elderly & neighbour support', 'request', 'medium'),
      c('pets_animals', 'Pets & animals', 'request', 'medium'),
      c('vehicle_help', 'Vehicle help', 'request'),
      c('advice', 'Advice & recommendations', 'request'),
    ],
  },
  {
    id: 'newcomers',
    label: 'Newcomers & language',
    hint: 'Letters, offices, a doctor',
    categories: [
      c('language_translation', 'Language & translation', 'request', 'basic', {
        requiresLanguage: true,
      }),
      c('paperwork_offices', 'Paperwork & official offices', 'request', 'medium', {
        paperworkTips: true,
      }),
      c('finding_services', 'Finding a doctor, school or service', 'request'),
      c('settling_in', 'Settling in & city know-how', 'request'),
    ],
  },
  {
    id: 'environment',
    label: 'Environment',
    hint: 'Dirty areas, ponds, parks',
    categories: [
      c('garbage', 'Garbage & dirty areas', 'issue'),
      c('water_bodies', 'Rivers, lakes & ponds', 'issue'),
      c('parks', 'Parks & green spaces', 'issue'),
      c('trees', 'Trees & plants', 'issue'),
      c('air_noise', 'Air, smoke & noise', 'issue'),
      c('water_wastage', 'Water wastage', 'issue'),
    ],
  },
  {
    id: 'roads',
    label: 'Roads & public spaces',
    hint: 'Potholes, lights, drains',
    categories: [
      c('potholes', 'Roads & potholes', 'issue'),
      c('streetlights', 'Streetlights', 'issue'),
      c('drainage', 'Drainage & sewage', 'issue', 'medium'),
      c('footpaths', 'Footpaths & public spaces', 'issue'),
      c('traffic_parking', 'Traffic & parking', 'issue'),
    ],
  },
  {
    id: 'utilities',
    label: 'Utilities',
    hint: 'Water, power, gas',
    categories: [
      c('water_supply', 'Water supply', 'issue', 'medium'),
      c('power_cuts', 'Power cuts', 'issue', 'medium'),
      c('gas', 'Gas', 'issue', 'serious'),
      c('network', 'Internet / phone network', 'issue'),
    ],
  },
  {
    id: 'safety',
    label: 'Safety',
    hint: 'Non-emergency concerns',
    categories: [
      c('safety_concern', 'Safety concern (non-emergency)', 'request', 'medium'),
      c('personal_support', 'Personal support', 'request', 'medium'),
    ],
  },
  {
    id: 'other',
    label: 'Other',
    hint: 'Anything else',
    categories: [c('other', 'Anything else', 'request')],
  },
];

const categoryIndex = new Map<string, { category: Category; group: CategoryGroup }>(
  CATEGORY_GROUPS.flatMap((group) =>
    group.categories.map((category) => [category.id, { category, group }] as const),
  ),
);

export function findCategory(id: string): { category: Category; group: CategoryGroup } {
  const hit = categoryIndex.get(id);
  if (!hit) throw new Error(`Unknown category: ${id}`);
  return hit;
}

export const URGENCY: Record<Urgency, { label: string; order: number }> = {
  basic: { label: 'Basic', order: 0 },
  medium: { label: 'Medium', order: 1 },
  serious: { label: 'Serious', order: 2 },
};

export const PROGRESS_STATUS: Record<ProgressStatus, { label: string }> = {
  still_need_help: { label: 'Still need help' },
  making_progress: { label: 'Making progress' },
  partly_solved: { label: 'Partly solved' },
  need_changed: { label: 'Need has changed' },
  note: { label: 'Note' },
};

/** R-57: maximum lifetime (days) before a problem expires without penalty. */
export const MAX_LIFETIME_DAYS: Record<Kind, Record<Urgency, number>> = {
  request: { basic: 30, medium: 14, serious: 3 },
  issue: { basic: 90, medium: 60, serious: 7 },
};

/** R-50…R-56: raiser response rule (personal problems only). */
export const RESPONSE_RULE = {
  windowHours: 48,
  reminderHours: [24, 44] as const,
} as const;

/** K-rules. */
export const KARMA = {
  solveAward: 10,
  closingAward: 2,
  closingAwardWeeklyCap: 5,
  maxCreditedHelpers: 3,
  pairCooldownDays: 7,
  pairLifetimeCap: 50,
  abandonmentPenalties: [-5, -10, -10] as const,
  fakeProblemPenalty: -20,
} as const;

/** R-21: affected users needed to auto-solve a community problem. */
export const FIXED_QUORUM = 3;

/** Text length limits (Architecture §13). */
export const LIMITS = {
  titleMin: 3,
  titleMax: 80,
  description: 1000,
  update: 500,
  offerMessage: 500,
  message: 2000,
  caption: 500,
  problemPhotos: 6,
  updatePhotos: 3,
  postPhotos: 10,
} as const;

/** L-02: H3 resolution per public precision. */
export const AREA_RESOLUTION: Record<Precision, 7 | 8 | 9> = {
  wider: 7,
  standard: 8,
  exact: 9,
};

export interface Language {
  code: string;
  name: string;
}

/** LANG-01: languages people can list on their profile. */
export const LANGUAGES: Language[] = [
  { code: 'hu', name: 'Hungarian' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'German' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ru', name: 'Russian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'pl', name: 'Polish' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'zh', name: 'Chinese' },
  { code: 'vi', name: 'Vietnamese' },
];

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

/** ADR-024: the launch area is all of Budapest. */
export const LAUNCH_AREA = {
  id: 'budapest',
  name: 'Budapest',
  center: { lat: 47.4746, lng: 19.0463 },
  /** [west, south, east, north] — approximate city bounds. */
  bbox: [18.925, 47.349, 19.335, 47.613] as [number, number, number, number],
} as const;

export const EMERGENCY_NUMBER = '112';
