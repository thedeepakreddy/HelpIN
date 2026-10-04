import type {
  AppNotification,
  Community,
  Conversation,
  CreateProblemInput,
  KarmaEntry,
  MapResponse,
  Me,
  Message,
  Post,
  PostUpdateInput,
  ProblemCard,
  ProblemDetail,
  PublicUser,
} from '@helpin/contracts';
import type { BBox, LatLng } from '@helpin/geo';

/**
 * The API surface the screens use. The mock implements it in memory today; the real
 * `/v1` HTTP client will implement the same interface (Architecture §10).
 */
export interface ApiClient {
  // identity
  requestCode(contact: string): Promise<{ sentTo: string }>;
  verifyCode(code: string): Promise<Me>;
  getMe(): Promise<Me | null>;
  logout(): Promise<void>;
  switchDemoUser(userId: string): Promise<Me>;
  getUser(userId: string): Promise<PublicUser>;
  getKarmaHistory(): Promise<KarmaEntry[]>;

  // problems
  getMap(bbox: BBox, zoom: number): Promise<MapResponse>;
  listNearby(center: LatLng): Promise<ProblemCard[]>;
  similarOpen(categoryId: string, point: LatLng): Promise<ProblemCard[]>;
  getProblem(problemId: string): Promise<ProblemDetail>;
  createProblem(input: CreateProblemInput): Promise<ProblemDetail>;
  postUpdate(problemId: string, input: PostUpdateInput): Promise<ProblemDetail>;
  stillNeedHelp(problemId: string): Promise<ProblemDetail>;
  withdrawProblem(problemId: string, reason: string): Promise<ProblemDetail>;
  confirmSolved(
    problemId: string,
    creditedOfferIds: string[],
  ): Promise<{ problem: ProblemDetail; credited: number; askerAward: number }>;
  markSameHere(problemId: string, on: boolean): Promise<ProblemDetail>;
  fixedNow(problemId: string): Promise<ProblemDetail>;
  myProblems(): Promise<ProblemCard[]>;

  // help offers
  offerHelp(problemId: string, message: string | null): Promise<ProblemDetail>;
  withdrawOffer(offerId: string): Promise<ProblemDetail>;
  acceptOffer(offerId: string): Promise<{ problem: ProblemDetail; conversationId: string }>;
  declineOffer(offerId: string): Promise<ProblemDetail>;
  claimSolved(offerId: string): Promise<ProblemDetail>;

  // chat
  listConversations(): Promise<Conversation[]>;
  getConversation(conversationId: string): Promise<{ conversation: Conversation; messages: Message[] }>;
  sendMessage(conversationId: string, body: string): Promise<Message>;
  shareLocation(conversationId: string): Promise<Message>;

  // social
  getFeed(): Promise<Post[]>;
  toggleLike(postId: string): Promise<Post>;
  listCommunities(): Promise<Community[]>;
  toggleJoin(communityId: string): Promise<Community>;
  myPosts(): Promise<Post[]>;

  // notifications
  listNotifications(): Promise<AppNotification[]>;
  markAllRead(): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
