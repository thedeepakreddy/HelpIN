/**
 * API contracts shared by the web app and the API (ADR-012). Every public response is
 * validated against these schemas in tests, and the privacy test asserts that no public shape
 * can carry exact coordinates (L-03).
 */
import { z } from 'zod';

export const KindSchema = z.enum(['request', 'issue']);
export const UrgencySchema = z.enum(['basic', 'medium', 'serious']);
export const ProblemStatusSchema = z.enum(['open', 'solved', 'abandoned', 'expired', 'withdrawn', 'removed']);
export const ProgressStatusSchema = z.enum(['still_need_help', 'making_progress', 'partly_solved', 'need_changed', 'note']);
export const PrecisionSchema = z.enum(['standard', 'wider', 'exact']);

const isoDate = z.string();
const uuid = z.string();

export const LatLngSchema = z.object({ lat: z.number(), lng: z.number() });

/** A processed, EXIF-free image (L-08). URLs are short-lived and signed. */
export const MediaRefSchema = z.object({
  id: uuid,
  url: z.string(),
  thumbUrl: z.string(),
  fullUrl: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  blurhash: z.string().nullable(),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

/** A user as anyone can see them. Never contains phone, email or home area. */
export const PublicUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  initials: z.string(),
  color: z.string(),
  avatar: MediaRefSchema.nullable(),
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
  coverPhoto: MediaRefSchema.nullable(),
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
  photos: z.array(MediaRefSchema),
  createdAt: isoDate,
});
export type ProblemUpdate = z.infer<typeof ProblemUpdateSchema>;

export const OfferStatusSchema = z.enum(['offered', 'accepted', 'declined', 'withdrawn', 'credited', 'closed']);

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
  photos: z.array(MediaRefSchema),
  updates: z.array(ProblemUpdateSchema),
  viewerRole: ViewerRoleSchema,
  myOffer: OfferSchema.nullable(),
  /** Asker only (R-60). */
  responseDueAt: isoDate.nullable(),
  /** Asker only. */
  offers: z.array(OfferSchema),
  creditedHelperNames: z.array(z.string()),
  fixedVotes: z.number(),
  myFixedVote: z.boolean(),
  /** R-22: the reporter may credit helpers until then after a fixed-quorum solve. */
  creditUntil: isoDate.nullable(),
  /** R-60: what helpers see instead of the deadline. */
  askerLastActiveAt: isoDate.nullable(),
  /** L-03: the asker saved an exact spot privately (asker only). */
  hasPrivateLocation: z.boolean(),
  hidden: z.boolean(),
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
  media: MediaRefSchema.nullable(),
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
  /** A-03: an anonymous asker revealed their profile in this chat. */
  identityRevealed: z.boolean(),
  askerAnonymous: z.boolean(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const CommunityRefSchema = z.object({ id: z.string(), name: z.string() });

export const PostSchema = z.object({
  id: z.string(),
  kind: z.enum(['photo', 'thank_you', 'welcome']),
  author: AskerSchema,
  community: CommunityRefSchema.nullable(),
  caption: z.string().nullable(),
  photos: z.array(MediaRefSchema),
  createdAt: isoDate,
  likes: z.number(),
  liked: z.boolean(),
  comments: z.number(),
  problem: z.object({ id: z.string(), title: z.string() }).nullable(),
  /** F-06: only helpers who approved their tag. */
  thanked: z.array(z.string()),
  district: z.string(),
  mine: z.boolean(),
});
export type Post = z.infer<typeof PostSchema>;

export const CommentSchema = z.object({
  id: z.string(),
  postId: z.string(),
  author: PublicUserSchema,
  body: z.string(),
  createdAt: isoDate,
  mine: z.boolean(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const CommunityTypeSchema = z.enum(['district', 'language_culture', 'students', 'civic_environment', 'interest']);

export const CommunitySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: CommunityTypeSchema,
  description: z.string(),
  memberCount: z.number(),
  joined: z.boolean(),
  newPosts: z.number(),
  color: z.string(),
});
export type Community = z.infer<typeof CommunitySchema>;

export const CommunityDetailSchema = CommunitySchema.extend({
  rules: z.string().nullable(),
  posts: z.array(PostSchema),
  welcome: z.array(PostSchema),
  sharedProblems: z.array(ProblemCardSchema),
  alerts: z.boolean(),
});
export type CommunityDetail = z.infer<typeof CommunityDetailSchema>;

export const NotificationTypeSchema = z.enum([
  'response_due',
  'solve_claimed',
  'karma',
  'nearby_problem',
  'offer_received',
  'offer_accepted',
  'offer_declined',
  'problem_updated',
  'problem_closed',
  'penalty',
  'community',
  'message',
  'tag_request',
  'comment',
  'content_removed',
  'system',
]);

export const NotificationSchema = z.object({
  id: z.string(),
  type: NotificationTypeSchema,
  title: z.string(),
  body: z.string(),
  createdAt: isoDate,
  read: z.boolean(),
  link: z.string(),
  problemId: z.string().nullable(),
  /** DSA statement of reasons (content_removed) can be appealed. */
  moderationActionId: z.number().nullable(),
});
export type AppNotification = z.infer<typeof NotificationSchema>;

export const AlertPrefsSchema = z.object({
  enabled: z.boolean(),
  ring: z.number().int().min(0).max(2),
  categories: z.array(z.string()),
  minUrgency: UrgencySchema,
  dailyCap: z.number().int().min(0).max(50),
  quietStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  quietEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  seriousInQuiet: z.boolean(),
  emailDigest: z.boolean(),
});
export type AlertPrefs = z.infer<typeof AlertPrefsSchema>;

export const MeSchema = PublicUserSchema.extend({
  role: z.enum(['user', 'moderator', 'admin']),
  phoneVerified: z.boolean(),
  phoneMasked: z.string().nullable(),
  hasPassword: z.boolean(),
  email: z.string().nullable(),
  bio: z.string(),
  memberSince: isoDate,
  postsCount: z.number(),
  homeCell: z.string().nullable(),
  homeDistrict: z.string().nullable(),
  onboarding: z.object({
    adultConfirmed: z.boolean(),
    guidelinesAccepted: z.boolean(),
    profileDone: z.boolean(),
    homeAreaSet: z.boolean(),
    done: z.boolean(),
  }),
  onNoticeUntil: isoDate.nullable(),
  canPostAnonymously: z.boolean(),
  mfaEnabled: z.boolean(),
  mfaVerified: z.boolean(),
  alertPrefs: AlertPrefsSchema,
  pushSubscribed: z.boolean(),
});
export type Me = z.infer<typeof MeSchema>;

export const PublicProfileSchema = z.object({
  user: PublicUserSchema,
  bio: z.string(),
  memberSince: isoDate,
  postsCount: z.number(),
  blockedByMe: z.boolean(),
});
export type PublicProfile = z.infer<typeof PublicProfileSchema>;

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

export const SolverHistoryItemSchema = z.object({
  problemId: z.string(),
  title: z.string(),
  categoryId: z.string(),
  solvedAt: isoDate,
  /** Shown only when the asker posted publicly (A-04). */
  askerName: z.string().nullable(),
});
export type SolverHistoryItem = z.infer<typeof SolverHistoryItemSchema>;

export const ProblemPhotoSchema = z.object({
  problemId: z.string(),
  status: ProblemStatusSchema,
  photo: MediaRefSchema,
});
export type ProblemPhoto = z.infer<typeof ProblemPhotoSchema>;

export const SessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  me: MeSchema,
});
export type Session = z.infer<typeof SessionSchema>;

export const OtpChallengeSchema = z.object({ challengeId: z.string(), sentTo: z.string(), devCode: z.string().optional() });
export type OtpChallenge = z.infer<typeof OtpChallengeSchema>;

export const UploadTicketSchema = z.object({
  mediaId: z.string(),
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
});
export type UploadTicket = z.infer<typeof UploadTicketSchema>;

export const MediaStatusSchema = z.object({ id: z.string(), status: z.enum(['pending', 'processing', 'ready', 'rejected', 'deleted']), media: MediaRefSchema.nullable() });
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

export const Page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/* ------------------------------------------------------------------ Commands */

export const OtpRequestSchema = z.object({
  channel: z.enum(['sms', 'email']),
  destination: z.string().min(5).max(254),
});
export const OtpVerifySchema = z.object({ challengeId: z.string(), code: z.string().regex(/^\d{6}$/) });

/** Passwords: 8+ characters, at most 128 (scrypt input). */
export const PasswordSchema = z.string().min(8, 'Use at least 8 characters.').max(128);

export const SignupInputSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
  email: z.string().trim().min(5).max(254),
  password: PasswordSchema,
  adult: z.literal(true),
  guidelines: z.literal(true),
});
export type SignupInput = z.infer<typeof SignupInputSchema>;

export const LoginInputSchema = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof LoginInputSchema>;

/** Forgot password: an email code (from /v1/auth/otp) plus the new password. */
export const PasswordResetInputSchema = z.object({ challengeId: z.string(), code: z.string().regex(/^\d{6}$/), password: PasswordSchema });
export type PasswordResetInput = z.infer<typeof PasswordResetInputSchema>;

export const CreateProblemInputSchema = z.object({
  categoryId: z.string(),
  kind: KindSchema,
  title: z.string().trim().min(3).max(80),
  description: z.string().max(1000),
  urgency: UrgencySchema,
  precision: PrecisionSchema,
  /** Exact point; snapped server-side and stored privately only if asked (L-01, L-03). */
  point: LatLngSchema,
  saveExactPrivately: z.boolean(),
  languageNeeded: z.string().regex(/^[a-z]{2}>[a-z]{2}$/).nullable(),
  anonymous: z.boolean(),
  mediaIds: z.array(z.string()).max(6),
  communityId: z.string().nullable(),
});
export type CreateProblemInput = z.infer<typeof CreateProblemInputSchema>;

export const PostUpdateInputSchema = z
  .object({
    progressStatus: ProgressStatusSchema,
    body: z.string().max(500).nullable(),
    mediaIds: z.array(z.string()).max(3).default([]),
  })
  .refine((v) => !['need_changed', 'note'].includes(v.progressStatus) || (v.body?.trim().length ?? 0) > 0, {
    message: 'Please describe what changed',
    path: ['body'],
  });
export type PostUpdateInput = z.input<typeof PostUpdateInputSchema>;

export const ProfileInputSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
  bio: z.string().max(300),
  languages: z.array(z.string().regex(/^[a-z]{2}$/)).max(10),
  isNewcomer: z.boolean(),
  avatarMediaId: z.string().nullable().optional(),
});
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export const OnboardingInputSchema = z.object({ adult: z.literal(true), guidelines: z.literal(true) });

export const CreatePostInputSchema = z.object({
  kind: z.enum(['photo', 'thank_you', 'welcome']),
  caption: z.string().max(500).nullable(),
  mediaIds: z.array(z.string()).max(10),
  communityId: z.string().nullable(),
  problemId: z.string().nullable(),
});
export type CreatePostInput = z.infer<typeof CreatePostInputSchema>;

export const ReportReasonSchema = z.enum([
  'fake_problem',
  'scam',
  'paid_work',
  'spam',
  'harassment',
  'dangerous',
  'fraud',
  'false_emergency',
  'inappropriate',
  'privacy',
  'other',
]);
export const ReportTargetSchema = z.enum(['problem', 'problem_update', 'help_offer', 'message', 'post', 'comment', 'user', 'community']);
export const ReportInputSchema = z.object({
  targetType: ReportTargetSchema,
  targetId: z.string(),
  reason: ReportReasonSchema,
  details: z.string().max(1000).nullable(),
});
export type ReportInput = z.infer<typeof ReportInputSchema>;

export const PushSubscriptionInputSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

/* ------------------------------------------------------------------ Admin */

export const AdminReportSchema = z.object({
  id: z.string(),
  targetType: ReportTargetSchema,
  targetId: z.string(),
  reason: ReportReasonSchema,
  details: z.string().nullable(),
  reporterName: z.string(),
  createdAt: isoDate,
  status: z.enum(['open', 'actioned', 'dismissed']),
  reportCount: z.number(),
  serious: z.boolean(),
  preview: z.object({ title: z.string(), body: z.string().nullable(), authorId: z.string().nullable(), hidden: z.boolean(), link: z.string().nullable() }),
});
export type AdminReport = z.infer<typeof AdminReportSchema>;

export const AdminDecisionSchema = z.object({
  action: z.enum(['dismiss', 'remove', 'restore', 'fake_problem', 'restrict_user']),
  reason: z.string().min(3).max(500),
  statement: z.string().max(2000).nullable(),
});
export type AdminDecision = z.infer<typeof AdminDecisionSchema>;

export const AdminAppealSchema = z.object({
  id: z.string(),
  userName: z.string(),
  body: z.string(),
  createdAt: isoDate,
  status: z.enum(['open', 'upheld', 'overturned']),
  action: z.object({ id: z.number(), action: z.string(), targetType: z.string(), targetId: z.string(), reason: z.string(), statement: z.string().nullable() }),
});
export type AdminAppeal = z.infer<typeof AdminAppealSchema>;

export const AdminMetricsSchema = z.object({
  liquidityByDistrict: z.array(z.object({ district: z.string(), week: isoDate, problems: z.number(), liquidityPct: z.number().nullable() })),
  solveRate: z.array(z.object({ week: isoDate, closed: z.number(), solved: z.number(), solveRatePct: z.number().nullable(), abandonmentRatePct: z.number().nullable() })),
  totals: z.object({ users: z.number(), openProblems: z.number(), openReports: z.number(), openAppeals: z.number(), flags: z.number() }),
});
export type AdminMetrics = z.infer<typeof AdminMetricsSchema>;

/** Keys that must never appear in a public response (privacy contract test). */
export const FORBIDDEN_PUBLIC_KEYS = ['exactLocation', 'phone', 'phone_e164', 'email', 'homeCell', 'home_cell_r7', 'address', 'lat_exact', 'ownerId', 'owner_id'];

/** Error codes the client switches on (Architecture §10). */
export const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
