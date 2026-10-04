import type {
  AdminAppeal,
  AdminDecision,
  AdminMetrics,
  AdminReport,
  AlertPrefs,
  AppNotification,
  Comment,
  Community,
  CommunityDetail,
  Conversation,
  CreatePostInput,
  CreateProblemInput,
  KarmaEntry,
  MapResponse,
  Me,
  MediaStatus,
  Message,
  OtpChallenge,
  Post,
  PostUpdateInput,
  ProblemCard,
  ProblemDetail,
  ProblemPhoto,
  ProfileInput,
  PublicProfile,
  ReportInput,
  Session,
  SolverHistoryItem,
  UploadTicket,
} from '@helpin/contracts';
import type { BBox, LatLng } from '@helpin/geo';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 0,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface RealtimeEvent {
  type: 'notification' | 'message' | 'problem' | 'conversation' | 'me' | 'feed';
  id?: string;
}

export type MediaPurpose = 'problem_photo' | 'post_photo' | 'avatar' | 'chat_image';

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const SESSION_KEY = 'helpin.session';

function readSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeSession(s: StoredSession | null) {
  try {
    if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: the session lives in memory only */
  }
}

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * The typed client for the HelpIn /v1 API (Architecture §10). Every command carries an
 * Idempotency-Key (R-07); access tokens are refreshed transparently.
 */
export class HelpInApi {
  private session: StoredSession | null = typeof window !== 'undefined' ? readSession() : null;
  private refreshing: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor(public readonly baseUrl: string) {}

  get signedIn() {
    return !!this.session;
  }

  /** Called when the session ends (logout, expiry, account deleted). */
  onSignedOut(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private setSession(s: Session | null) {
    this.session = s ? { accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: Date.now() + s.expiresIn * 1000 } : null;
    writeSession(this.session);
    if (!s) this.listeners.forEach((l) => l());
  }

  private async refresh(): Promise<void> {
    if (!this.session) throw new ApiError('UNAUTHORIZED', 'Please log in.', 401);
    this.refreshing ??= (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.session!.refreshToken }),
        });
        if (!res.ok) {
          this.setSession(null);
          throw new ApiError('UNAUTHORIZED', 'Your session has expired. Please log in again.', 401);
        }
        this.setSession((await res.json()) as Session);
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async token(): Promise<string | null> {
    if (!this.session) return null;
    if (this.session.expiresAt - Date.now() < 30_000) await this.refresh();
    return this.session?.accessToken ?? null;
  }

  async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const token = await this.token();
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (method !== 'GET') headers['Idempotency-Key'] = uuid();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError('NETWORK', "Can't reach HelpIn. Check your connection.");
    }
    if (res.status === 401 && retry && this.session) {
      await this.refresh();
      return this.request<T>(method, path, body, false);
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (json as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
      if (res.status === 401) this.setSession(null);
      throw new ApiError(err?.code ?? 'HTTP_' + res.status, err?.message ?? 'Something went wrong.', res.status, err?.details);
    }
    return json as T;
  }

  private get = <T>(path: string) => this.request<T>('GET', path);
  private post = <T>(path: string, body: unknown = {}) => this.request<T>('POST', path, body);
  private put = <T>(path: string, body: unknown = {}) => this.request<T>('PUT', path, body);
  private patch = <T>(path: string, body: unknown = {}) => this.request<T>('PATCH', path, body);
  private del = <T>(path: string, body?: unknown) => this.request<T>('DELETE', path, body);

  /* ---------------------------------------------------------------- identity */

  requestCode(channel: 'sms' | 'email', destination: string) {
    return this.post<OtpChallenge>('/v1/auth/otp', { channel, destination });
  }
  async verifyCode(challengeId: string, code: string): Promise<Me> {
    const s = await this.post<Session>('/v1/auth/verify', { challengeId, code });
    this.setSession(s);
    return s.me;
  }
  async logout() {
    await this.post('/v1/auth/logout').catch(() => undefined);
    this.setSession(null);
  }
  async getMe(): Promise<Me | null> {
    if (!this.session) return null;
    try {
      return await this.get<Me>('/v1/me');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  }
  requestPhoneCode = (phone: string) => this.post<OtpChallenge>('/v1/me/phone/otp', { phone });
  verifyPhone = (challengeId: string, code: string) => this.post<Me>('/v1/me/phone/verify', { challengeId, code });
  acceptOnboarding = () => this.post<Me>('/v1/me/onboarding', { adult: true, guidelines: true });
  updateProfile = (input: ProfileInput) => this.patch<Me>('/v1/me/profile', input);
  setHomeArea = (cell: string) => this.put<Me>('/v1/me/home-area', { cell });
  setAlertPrefs = (prefs: AlertPrefs) => this.put<Me>('/v1/me/alert-prefs', prefs);
  addPushSubscription = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => this.post('/v1/me/push-subscriptions', sub);
  removePushSubscription = (endpoint: string) => this.del('/v1/me/push-subscriptions', { endpoint });
  testPush = () => this.post<{ delivered: number; enabled: boolean }>('/v1/me/push-subscriptions/test');
  getKarmaHistory = () => this.get<KarmaEntry[]>('/v1/me/karma');
  exportData = () => this.get<Record<string, unknown>>('/v1/me/export');
  async deleteAccount() {
    await this.del('/v1/me', { confirm: 'DELETE' });
    this.setSession(null);
  }
  getUser = (id: string) => this.get<PublicProfile>(`/v1/users/${id}`);
  getUserPosts = (id: string) => this.get<Post[]>(`/v1/users/${id}/posts`);
  getUserProblemPhotos = (id: string) => this.get<ProblemPhoto[]>(`/v1/users/${id}/problem-photos`);
  getSolverHistory = (id: string) => this.get<SolverHistoryItem[]>(`/v1/users/${id}/solver-history`);
  getConfig = () => this.get<{ vapidPublicKey: string | null; launchArea: { flags: Record<string, boolean> } }>('/v1/meta/config');
  async setupMfa() {
    return this.post<{ enabled: boolean; secret: string | null; otpauthUrl: string | null }>('/v1/auth/mfa/setup');
  }
  async verifyMfa(code: string) {
    const res = await this.post<{ accessToken: string; expiresIn: number; me: Me }>('/v1/auth/mfa/verify', { code });
    if (this.session) {
      this.session = { ...this.session, accessToken: res.accessToken, expiresAt: Date.now() + res.expiresIn * 1000 };
      writeSession(this.session);
    }
    return res.me;
  }

  /* ---------------------------------------------------------------- problems */

  getMap = (bbox: BBox, zoom: number) => this.get<MapResponse>(`/v1/map?bbox=${bbox.map((n) => n.toFixed(5)).join(',')}&zoom=${zoom.toFixed(2)}`);
  listNearby = () => this.get<ProblemCard[]>('/v1/problems/nearby');
  similarOpen = (categoryId: string, cell: string) => this.get<ProblemCard[]>(`/v1/problems/similar?cell=${cell}&category=${categoryId}`);
  getProblem = (id: string) => this.get<ProblemDetail>(`/v1/problems/${id}`);
  myProblems = () => this.get<ProblemCard[]>('/v1/me/problems');
  createProblem = (input: CreateProblemInput) => this.post<ProblemDetail>('/v1/problems', input);
  postUpdate = (id: string, input: PostUpdateInput) => this.post<ProblemDetail>(`/v1/problems/${id}/updates`, input);
  stillNeedHelp = (id: string) => this.post<ProblemDetail>(`/v1/problems/${id}/still-need-help`);
  withdrawProblem = (id: string, reason: string) => this.post<ProblemDetail>(`/v1/problems/${id}/withdraw`, { reason });
  confirmSolved = (id: string, creditedOfferIds: string[]) =>
    this.post<{ problem: ProblemDetail; credited: number; askerAward: number }>(`/v1/problems/${id}/confirm-solved`, { creditedOfferIds });
  creditAfterQuorum = (id: string, creditedOfferIds: string[]) =>
    this.post<{ problem: ProblemDetail; credited: number; askerAward: number }>(`/v1/problems/${id}/credit`, { creditedOfferIds });
  markSameHere = (id: string, on: boolean) => (on ? this.post<ProblemDetail>(`/v1/problems/${id}/affected`) : this.del<ProblemDetail>(`/v1/problems/${id}/affected`));
  fixedNow = (id: string) => this.post<ProblemDetail>(`/v1/problems/${id}/fixed`);
  shareToCommunity = (id: string, communityId: string) => this.post(`/v1/problems/${id}/share`, { communityId });

  /* ---------------------------------------------------------------- help */

  offerHelp = (problemId: string, message: string | null) => this.post<ProblemDetail>(`/v1/problems/${problemId}/offers`, { message });
  withdrawOffer = (offerId: string) => this.post<ProblemDetail>(`/v1/offers/${offerId}/withdraw`);
  acceptOffer = (offerId: string) => this.post<{ problem: ProblemDetail; conversationId: string }>(`/v1/offers/${offerId}/accept`);
  declineOffer = (offerId: string) => this.post<ProblemDetail>(`/v1/offers/${offerId}/decline`);
  claimSolved = (offerId: string) => this.post<ProblemDetail>(`/v1/offers/${offerId}/claim-solved`);

  /* ---------------------------------------------------------------- chat */

  listConversations = () => this.get<Conversation[]>('/v1/conversations');
  getConversation = (id: string) => this.get<{ conversation: Conversation; messages: Message[] }>(`/v1/conversations/${id}`);
  markConversationRead = (id: string) => this.post(`/v1/conversations/${id}/read`);
  sendMessage = (id: string, body: string) => this.post<Message>(`/v1/conversations/${id}/messages`, { type: 'text', body });
  sendImage = (id: string, mediaId: string) => this.post<Message>(`/v1/conversations/${id}/messages`, { type: 'image', mediaId });
  shareLocation = (id: string, point: LatLng | null) => this.post<Message>(`/v1/conversations/${id}/share-location`, { point });
  revealIdentity = (id: string) => this.post<Conversation>(`/v1/conversations/${id}/reveal-identity`);

  /* ---------------------------------------------------------------- media */

  /**
   * Uploads a photo through the media pipeline (Architecture §7): the browser shrinks it, the
   * server strips all metadata and makes WebP sizes before anyone else can see it (L-08).
   */
  async uploadPhoto(file: File | Blob, purpose: MediaPurpose): Promise<MediaStatus> {
    const blob = await shrink(file);
    const ticket = await this.post<UploadTicket>('/v1/media/upload-url', { purpose, contentType: blob.type, bytes: blob.size });
    const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: blob });
    if (!put.ok) throw new ApiError('UPLOAD_FAILED', 'The photo didn’t upload. Try again.');
    let status = await this.post<MediaStatus>(`/v1/media/${ticket.mediaId}/finalize`);
    for (let i = 0; i < 30 && status.status !== 'ready' && status.status !== 'rejected'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      status = await this.get<MediaStatus>(`/v1/media/${ticket.mediaId}`);
    }
    if (status.status === 'rejected') throw new ApiError('MEDIA_REJECTED', 'We couldn’t use that photo.');
    return status;
  }

  /* ---------------------------------------------------------------- social */

  getFeed = (cursor?: string) => this.get<{ items: Post[]; nextCursor: string | null }>(`/v1/feed${cursor ? `?cursor=${cursor}` : ''}`);
  createPost = (input: CreatePostInput) => this.post<Post>('/v1/posts', input);
  deletePost = (id: string) => this.del(`/v1/posts/${id}`);
  like = (id: string, on: boolean) => (on ? this.put<Post>(`/v1/posts/${id}/reaction`) : this.del<Post>(`/v1/posts/${id}/reaction`));
  decideTag = (postId: string, decision: 'approve' | 'decline') => this.post(`/v1/posts/${postId}/tags/${decision}`);
  getComments = (postId: string) => this.get<Comment[]>(`/v1/posts/${postId}/comments`);
  addComment = (postId: string, body: string) => this.post<Comment>(`/v1/posts/${postId}/comments`, { body });
  deleteComment = (id: string) => this.del(`/v1/comments/${id}`);
  listCommunities = () => this.get<Community[]>('/v1/communities');
  getCommunity = (idOrSlug: string) => this.get<CommunityDetail>(`/v1/communities/${idOrSlug}`);
  joinCommunity = (id: string, on: boolean) => (on ? this.post<Community>(`/v1/communities/${id}/members`) : this.del<Community>(`/v1/communities/${id}/members`));
  setCommunityAlerts = (id: string, alerts: boolean) => this.put(`/v1/communities/${id}/alerts`, { alerts });
  requestCommunity = (name: string, type: string, reason: string | null) => this.post('/v1/community-requests', { name, type, reason });

  /* ---------------------------------------------------------------- notifications & safety */

  listNotifications = () => this.get<AppNotification[]>('/v1/me/notifications');
  markAllRead = () => this.post('/v1/me/notifications/read', {});
  report = (input: ReportInput) => this.post('/v1/reports', input);
  block = (target: { userId?: string; problemId?: string; conversationId?: string }) => this.post('/v1/blocks', target);
  unblock = (userId: string) => this.del(`/v1/blocks/${userId}`);
  myBlocks = () => this.get<{ userId: string; displayName: string; createdAt: string }[]>('/v1/me/blocks');
  appeal = (moderationActionId: number, body: string) => this.post('/v1/appeals', { moderationActionId, body });

  /* ---------------------------------------------------------------- admin */

  admin = {
    reports: (status: 'open' | 'actioned' | 'dismissed' = 'open') => this.get<AdminReport[]>(`/v1/admin/reports?status=${status}`),
    reveal: (reportId: string) => this.post<{ userId: string | null; displayName: string | null }>(`/v1/admin/reports/${reportId}/reveal`),
    decide: (reportId: string, d: AdminDecision) => this.post(`/v1/admin/reports/${reportId}/decide`, d),
    appeals: () => this.get<AdminAppeal[]>('/v1/admin/appeals'),
    decideAppeal: (id: string, decision: 'upheld' | 'overturned', note: string) => this.post(`/v1/admin/appeals/${id}/decide`, { decision, note }),
    metrics: () => this.get<AdminMetrics>('/v1/admin/metrics'),
    users: (q: string) =>
      this.get<{ id: string; displayName: string | null; email: string | null; phone: string | null; status: string; role: string; karma: number; createdAt: string }[]>(
        `/v1/admin/users?q=${encodeURIComponent(q)}`,
      ),
    userKarma: (id: string) => this.get<{ id: number; amount: number; reason: string; problemId: string | null; createdAt: string; reversed: boolean }[]>(`/v1/admin/users/${id}/karma`),
    reverseKarma: (entryId: number, reason: string) => this.post(`/v1/admin/karma/${entryId}/reverse`, { reason }),
    restrict: (userId: string, action: 'restrict' | 'unrestrict', reason: string, statement: string | null) => this.post(`/v1/admin/users/${userId}/${action}`, { reason, statement }),
    createCommunity: (input: { name: string; slug: string; type: string; description: string; rules: string | null; requestId?: string }) => this.post('/v1/admin/communities', input),
    communityRequests: () => this.get<{ id: string; name: string; type: string; reason: string | null; requester: string; createdAt: string }[]>('/v1/admin/community-requests'),
  };

  /* ---------------------------------------------------------------- realtime */

  /**
   * Opens the server-sent event stream with the Authorization header (fetch, not EventSource)
   * and reconnects with backoff. Events are hints: the caller refetches (ADR-007).
   */
  subscribe(onEvent: (e: RealtimeEvent) => void, onReconnect: () => void): () => void {
    let stopped = false;
    let controller: AbortController | null = null;
    let delay = 1000;
    const loop = async () => {
      while (!stopped) {
        try {
          const token = await this.token();
          if (!token) return;
          controller = new AbortController();
          const res = await fetch(`${this.baseUrl}/v1/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
          if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
          delay = 1000;
          onReconnect();
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let i;
            while ((i = buffer.indexOf('\n\n')) >= 0) {
              const chunk = buffer.slice(0, i);
              buffer = buffer.slice(i + 2);
              const data = chunk.split('\n').find((l) => l.startsWith('data: '));
              if (data) {
                try {
                  onEvent(JSON.parse(data.slice(6)) as RealtimeEvent);
                } catch {
                  /* ignore malformed */
                }
              }
            }
          }
        } catch {
          if (stopped) return;
        }
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    };
    void loop();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }
}

/** Browser-side resize (≤ 2048 px, JPEG 0.8). The server strips metadata regardless. */
async function shrink(file: File | Blob): Promise<Blob> {
  if (typeof createImageBitmap === 'undefined' || !file.type.startsWith('image/') || file.type === 'image/heic') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
    return blob ?? file;
  } catch {
    return file;
  }
}
