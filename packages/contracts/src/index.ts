/**
 * API contracts shared by the web app and (later) the API (ADR-012). Every public response is
 * validated against these schemas in tests, and the privacy test asserts that no public shape
 * can carry exact coordinates (L-03).
 */
import { z } from 'zod';

export const KindSchema = z.enum(['request', 'issue']);
export const UrgencySchema = z.enum(['basic', 'medium', 'serious']);
export const ProblemStatusSchema = z.enum([
  'open',
  'solved',
  'abandoned',
  'expired',
  'withdrawn',
  'removed',
]);
export const ProgressStatusSchema = z.enum([
  'still_need_help',
  'making_progress',
  'partly_solved',
  'need_changed',
  'note',
]);
export const PrecisionSchema = z.enum(['standard', 'wider', 'exact']);

const isoDate = z.string();

export const LatLngSchema = z.object({ lat: z.number(), lng: z.number() });

/** A user as anyone can see them. Never contains phone, email or home area. */
export const PublicUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  initials: z.string(),
  color: z.string(),
  karma: z.number(),
  neighboursHelped: z.number(),
  /** K-15: null until the user has ≥ 3 finished problems with helpers. */
  reliability: z.number().nullable(),
  languages: z.array(z.string()),
  isNewcomer: z.boolean(),
  verified: z.boolean(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

/** A-01: anonymous askers are hidden publicly; reliability stays visible. */
export const AskerSchema = z.discriminatedUnion('anonymous', [
  z.object({ anonymous: z.literal(true), reliability: z.number().nullable() }),
  z.object({ anonymous: z.literal(false), user: PublicUserSchema }),
]);
export type Asker = z.infer<typeof AskerSchema>;

/** Public area: the hexagon, never the exact point (L-01). */
export const PublicAreaSchema = z.object({
  areaCell: z.string(),
  areaRes: z.union([z.literal(7), z.literal(8), z.literal(9)]),
  locality: z.string(),
  district: z.string(),
  center: LatLngSchema,
});
export type PublicArea = z.infer<typeof PublicAreaSchema>;

export const ProblemCardSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  title: z.string(),
  categoryId: z.string(),
  kind: KindSchema,
  urgency: UrgencySchema,
  status: ProblemStatusSchema,
  area: PublicAreaSchema,
  /** LANG-02, e.g. "hu>en" */
  languageNeeded: z.string().nullable(),
  createdAt: isoDate,
  lastActivityAt: isoDate,
  latestProgress: ProgressStatusSchema.nullable(),
  helpingCount: z.number(),
  offersCount: z.number(),
  affectedCount: z.number(),
  photoCount: z.number(),
  asker: AskerSchema,
});
export type ProblemCard = z.infer<typeof ProblemCardSchema>;

export const UpdateAuthorRoleSchema = z.enum(['asker', 'helper', 'affected']);

export const ProblemUpdateSchema = z.object({
  id: z.string(),
  authorRole: UpdateAuthorRoleSchema,
  authorName: z.string(),
  progressStatus: ProgressStatusSchema,
  body: z.string().nullable(),
  createdAt: isoDate,
});
export type ProblemUpdate = z.infer<typeof ProblemUpdateSchema>;

export const OfferStatusSchema = z.enum([
  'offered',
  'accepted',
  'declined',
  'withdrawn',
  'credited',
  'closed',
]);

export const OfferSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  helper: PublicUserSchema,
  message: z.string().nullable(),
  status: OfferStatusSchema,
  createdAt: isoDate,
  claimedSolved: z.boolean(),
  conversationId: z.string().nullable(),
  sharesLanguage: z.boolean(),
});
export type Offer = z.infer<typeof OfferSchema>;

export const ViewerRoleSchema = z.enum(['visitor', 'helper_offered', 'helper_accepted', 'asker', 'affected']);
export type ViewerRole = z.infer<typeof ViewerRoleSchema>;

export const ProblemDetailSchema = ProblemCardSchema.extend({
  description: z.string(),
  updates: z.array(ProblemUpdateSchema),
  viewerRole: ViewerRoleSchema,
  myOffer: OfferSchema.nullable(),
  /** Asker only (R-60). */
  responseDueAt: isoDate.nullable(),
  /** Asker only. */
  offers: z.array(OfferSchema),
  creditedHelperNames: z.array(z.string()),
  fixedVotes: z.number(),
});
export type ProblemDetail = z.infer<typeof ProblemDetailSchema>;

export const MapClusterSchema = z.object({
  cell: z.string(),
  center: LatLngSchema,
  count: z.number(),
  maxUrgency: UrgencySchema,
});
export const MapResponseSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('incidents'), problems: z.array(ProblemCardSchema) }),
  z.object({ mode: z.literal('clusters'), clusters: z.array(MapClusterSchema) }),
]);
export type MapResponse = z.infer<typeof MapResponseSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderId: z.string().nullable(),
  type: z.enum(['text', 'image', 'location', 'system']),
  body: z.string().nullable(),
  /** Only present for location messages, only visible to participants (L-04). */
  location: LatLngSchema.nullable(),
  createdAt: isoDate,
});
export type Message = z.infer<typeof MessageSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  problemId: z.string(),
  problemTitle: z.string(),
  other: AskerSchema,
  lastMessage: z.string().nullable(),
  lastAt: isoDate,
  unread: z.number(),
  readOnly: z.boolean(),
  viewerIsAsker: z.boolean(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const CommunityRefSchema = z.object({ id: z.string(), name: z.string() });

export const PostSchema = z.object({
  id: z.string(),
  kind: z.enum(['photo', 'thank_you', 'welcome']),
  author: AskerSchema,
  community: CommunityRefSchema.nullable(),
  caption: z.string().nullable(),
  /** Illustration key in the mock; a media URL in the real API. */
  image: z.string().nullable(),
  createdAt: isoDate,
  likes: z.number(),
  liked: z.boolean(),
  comments: z.number(),
  problem: z.object({ id: z.string(), title: z.string() }).nullable(),
  thanked: z.array(z.string()),
  district: z.string(),
});
export type Post = z.infer<typeof PostSchema>;

export const CommunitySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['district', 'language_culture', 'students', 'civic_environment', 'interest']),
  description: z.string(),
  memberCount: z.number(),
  joined: z.boolean(),
  newPosts: z.number(),
  color: z.string(),
});
export type Community = z.infer<typeof CommunitySchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  type: z.enum([
    'response_due',
    'solve_claimed',
    'karma',
    'nearby_problem',
    'offer_received',
    'offer_accepted',
    'problem_updated',
    'community',
    'message',
  ]),
  title: z.string(),
  body: z.string(),
  createdAt: isoDate,
  read: z.boolean(),
  link: z.string(),
  problemId: z.string().nullable(),
});
export type AppNotification = z.infer<typeof NotificationSchema>;

export const MeSchema = PublicUserSchema.extend({
  phoneVerified: z.boolean(),
  bio: z.string(),
  memberSince: isoDate,
  postsCount: z.number(),
});
export type Me = z.infer<typeof MeSchema>;

export const KarmaEntrySchema = z.object({
  id: z.string(),
  amount: z.number(),
  reason: z.enum([
    'solve_award',
    'closing_award',
    'pair_cooldown',
    'pair_cap',
    'ineligible_account',
    'abandonment_penalty',
    'fake_problem_penalty',
    'reversal',
  ]),
  label: z.string(),
  createdAt: isoDate,
});
export type KarmaEntry = z.infer<typeof KarmaEntrySchema>;

/** Commands */
export const CreateProblemInputSchema = z.object({
  categoryId: z.string(),
  kind: KindSchema,
  title: z.string().min(3).max(80),
  description: z.string().max(1000),
  urgency: UrgencySchema,
  precision: PrecisionSchema,
  /** Exact point; stored privately and never returned publicly (L-03). */
  point: LatLngSchema,
  saveExactPrivately: z.boolean(),
  languageNeeded: z.string().nullable(),
  anonymous: z.boolean(),
  photoCount: z.number().min(0).max(6),
  communityId: z.string().nullable(),
});
export type CreateProblemInput = z.infer<typeof CreateProblemInputSchema>;

export const PostUpdateInputSchema = z
  .object({
    progressStatus: ProgressStatusSchema,
    body: z.string().max(500).nullable(),
  })
  .refine(
    (v) => !['need_changed', 'note'].includes(v.progressStatus) || (v.body?.trim().length ?? 0) > 0,
    { message: 'Please describe what changed', path: ['body'] },
  );
export type PostUpdateInput = z.infer<typeof PostUpdateInputSchema>;

/** Keys that must never appear in a public response (privacy contract test). */
export const FORBIDDEN_PUBLIC_KEYS = ['exactLocation', 'phone', 'email', 'homeCell', 'address'];
