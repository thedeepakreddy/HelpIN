import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlertPrefs, CreatePostInput, CreateProblemInput, Me, PostUpdateInput, ProblemDetail, ProfileInput, SignupInput } from '@helpin/contracts';
import type { BBox } from '@helpin/geo';
import { api } from './index';

export const qk = {
  me: ['me'] as const,
  map: (bbox: BBox, zoom: number) => ['map', bbox.map((n) => n.toFixed(3)).join(','), Math.floor(zoom * 2) / 2] as const,
  nearby: ['nearby'] as const,
  problem: (id: string) => ['problem', id] as const,
  myProblems: ['my-problems'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  feed: ['feed'] as const,
  comments: (postId: string) => ['comments', postId] as const,
  communities: ['communities'] as const,
  community: (id: string) => ['community', id] as const,
  notifications: ['notifications'] as const,
  karma: ['karma'] as const,
  similar: (categoryId: string, cell: string) => ['similar', categoryId, cell] as const,
  user: (id: string) => ['user', id] as const,
  userPosts: (id: string) => ['user-posts', id] as const,
  userPhotos: (id: string) => ['user-photos', id] as const,
  solverHistory: (id: string) => ['solver-history', id] as const,
  blocks: ['blocks'] as const,
  config: ['config'] as const,
};

/* ------------------------------------------------------------------ Queries */

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api.getMe(), staleTime: 60_000 });
export const useConfig = () => useQuery({ queryKey: qk.config, queryFn: () => api.getConfig(), staleTime: Infinity });
export const useMap = (bbox: BBox | null, zoom: number) =>
  useQuery({
    queryKey: bbox ? qk.map(bbox, zoom) : ['map', 'none'],
    queryFn: () => api.getMap(bbox!, zoom),
    enabled: !!bbox,
    placeholderData: (prev) => prev,
  });
export const useNearby = () => useQuery({ queryKey: qk.nearby, queryFn: () => api.listNearby() });
export const useProblem = (id: string) => useQuery({ queryKey: qk.problem(id), queryFn: () => api.getProblem(id), enabled: !!id });
export const useMyProblems = () => useQuery({ queryKey: qk.myProblems, queryFn: () => api.myProblems() });
export const useSimilar = (categoryId: string | null, cell: string | null) =>
  useQuery({
    queryKey: qk.similar(categoryId ?? '-', cell ?? '-'),
    queryFn: () => api.similarOpen(categoryId!, cell!),
    enabled: !!categoryId && !!cell,
  });
export const useConversations = () => useQuery({ queryKey: qk.conversations, queryFn: () => api.listConversations(), refetchInterval: 60_000 });
export const useConversation = (id: string) => useQuery({ queryKey: qk.conversation(id), queryFn: () => api.getConversation(id), refetchInterval: 30_000 });
export const useFeed = () =>
  useInfiniteQuery({
    queryKey: qk.feed,
    queryFn: ({ pageParam }) => api.getFeed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
export const useComments = (postId: string | null) =>
  useQuery({ queryKey: qk.comments(postId ?? '-'), queryFn: () => api.getComments(postId!), enabled: !!postId });
export const useCommunities = () => useQuery({ queryKey: qk.communities, queryFn: () => api.listCommunities() });
export const useCommunity = (id: string) => useQuery({ queryKey: qk.community(id), queryFn: () => api.getCommunity(id) });
export const useNotifications = () => useQuery({ queryKey: qk.notifications, queryFn: () => api.listNotifications(), refetchInterval: 120_000 });
export const useKarmaHistory = () => useQuery({ queryKey: qk.karma, queryFn: () => api.getKarmaHistory() });
export const useUser = (id: string) => useQuery({ queryKey: qk.user(id), queryFn: () => api.getUser(id) });
export const useUserPosts = (id: string | undefined) => useQuery({ queryKey: qk.userPosts(id ?? '-'), queryFn: () => api.getUserPosts(id!), enabled: !!id });
export const useUserProblemPhotos = (id: string | undefined) =>
  useQuery({ queryKey: qk.userPhotos(id ?? '-'), queryFn: () => api.getUserProblemPhotos(id!), enabled: !!id });
export const useSolverHistory = (id: string | undefined) => useQuery({ queryKey: qk.solverHistory(id ?? '-'), queryFn: () => api.getSolverHistory(id!), enabled: !!id });
export const useBlocks = () => useQuery({ queryKey: qk.blocks, queryFn: () => api.myBlocks() });

/* ------------------------------------------------------------------ Problem commands */

/** Refresh everything a problem change can affect. */
function useProblemMutation<V>(fn: (vars: V) => Promise<ProblemDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      qc.setQueryData(qk.problem(detail.id), detail);
      void qc.invalidateQueries({ queryKey: ['map'] });
      void qc.invalidateQueries({ queryKey: qk.nearby });
      void qc.invalidateQueries({ queryKey: qk.myProblems });
      void qc.invalidateQueries({ queryKey: qk.conversations });
    },
  });
}

export const useOfferHelp = (problemId: string) => useProblemMutation((message: string | null) => api.offerHelp(problemId, message));
export const useWithdrawOffer = () => useProblemMutation((offerId: string) => api.withdrawOffer(offerId));
export const useDeclineOffer = () => useProblemMutation((offerId: string) => api.declineOffer(offerId));
export const useClaimSolved = () => useProblemMutation((offerId: string) => api.claimSolved(offerId));
export const usePostUpdate = (problemId: string) => useProblemMutation((input: PostUpdateInput) => api.postUpdate(problemId, input));
export const useStillNeedHelp = (problemId: string) => useProblemMutation(() => api.stillNeedHelp(problemId));
export const useWithdrawProblem = (problemId: string) => useProblemMutation((reason: string) => api.withdrawProblem(problemId, reason));
export const useSameHere = (problemId: string) => useProblemMutation((on: boolean) => api.markSameHere(problemId, on));
export const useFixedNow = (problemId: string) => useProblemMutation(() => api.fixedNow(problemId));
export const useCreateProblem = () => useProblemMutation((input: CreateProblemInput) => api.createProblem(input));

export function useAcceptOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (offerId: string) => api.acceptOffer(offerId),
    onSuccess: ({ problem }) => {
      qc.setQueryData(qk.problem(problem.id), problem);
      void qc.invalidateQueries({ queryKey: qk.conversations });
    },
  });
}

export function useConfirmSolved(problemId: string, mode: 'confirm' | 'credit' = 'confirm') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (offerIds: string[]) => (mode === 'credit' ? api.creditAfterQuorum(problemId, offerIds) : api.confirmSolved(problemId, offerIds)),
    onSuccess: ({ problem }) => {
      qc.setQueryData(qk.problem(problem.id), problem);
      void qc.invalidateQueries();
    },
  });
}

/* ------------------------------------------------------------------ Chat */

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (msg: { body: string } | { mediaId: string }) => ('mediaId' in msg ? api.sendImage(conversationId, msg.mediaId) : api.sendMessage(conversationId, msg.body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
      void qc.invalidateQueries({ queryKey: qk.conversations });
    },
  });
}

export function useShareLocation(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (point: { lat: number; lng: number } | null) => api.shareLocation(conversationId, point),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.conversation(conversationId) }),
  });
}

export function useRevealIdentity(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.revealIdentity(conversationId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.conversation(conversationId) }),
  });
}

/* ------------------------------------------------------------------ Social */

export function useToggleLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, on }: { postId: string; on: boolean }) => api.like(postId, on),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.feed });
      void qc.invalidateQueries({ queryKey: ['user-posts'] });
      void qc.invalidateQueries({ queryKey: ['community'] });
    },
  });
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePostInput) => api.createPost(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.feed });
      void qc.invalidateQueries({ queryKey: ['user-posts'] });
      void qc.invalidateQueries({ queryKey: ['community'] });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePost(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.feed });
      void qc.invalidateQueries({ queryKey: ['user-posts'] });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useAddComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.addComment(postId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.comments(postId) });
      void qc.invalidateQueries({ queryKey: qk.feed });
    },
  });
}

export function useToggleJoin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.joinCommunity(id, on),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.communities });
      void qc.invalidateQueries({ queryKey: ['community'] });
      void qc.invalidateQueries({ queryKey: qk.feed });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllRead(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

/* ------------------------------------------------------------------ Me */

export function useMeMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (me) => {
      if (me && typeof me === 'object' && 'onboarding' in me) qc.setQueryData(qk.me, me);
      else void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export const useUpdateProfile = () => useMeMutation((input: ProfileInput) => api.updateProfile(input));
export const useSetAlertPrefs = () => useMeMutation((prefs: AlertPrefs) => api.setAlertPrefs(prefs));
export const useSetHomeArea = () => useMeMutation((cell: string) => api.setHomeArea(cell));

export function useSession() {
  const qc = useQueryClient();
  const signedIn = (me: Me) => {
    qc.clear();
    qc.setQueryData(qk.me, me);
    return me;
  };
  return {
    requestCode: (channel: 'sms' | 'email', destination: string) => api.requestCode(channel, destination),
    verifyCode: async (challengeId: string, code: string) => signedIn(await api.verifyCode(challengeId, code)),
    signup: async (input: SignupInput) => signedIn(await api.signup(input)),
    login: async (email: string, password: string) => signedIn(await api.login(email, password)),
    resetPassword: async (challengeId: string, code: string, password: string) => signedIn(await api.resetPassword(challengeId, code, password)),
    logout: async () => {
      await api.logout();
      qc.clear();
      qc.setQueryData(qk.me, null);
    },
  };
}

/** Keeps the screen fresh: server events invalidate the queries they name (ADR-007). */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    return api.subscribe(
      (e) => {
        switch (e.type) {
          case 'notification':
            void qc.invalidateQueries({ queryKey: qk.notifications });
            break;
          case 'message':
            void qc.invalidateQueries({ queryKey: qk.conversations });
            if (e.id) void qc.invalidateQueries({ queryKey: qk.conversation(e.id) });
            break;
          case 'conversation':
            void qc.invalidateQueries({ queryKey: qk.conversations });
            break;
          case 'problem':
            if (e.id) void qc.invalidateQueries({ queryKey: qk.problem(e.id) });
            void qc.invalidateQueries({ queryKey: qk.myProblems });
            void qc.invalidateQueries({ queryKey: qk.nearby });
            void qc.invalidateQueries({ queryKey: ['map'] });
            break;
          case 'feed':
            void qc.invalidateQueries({ queryKey: qk.feed });
            if (e.id) void qc.invalidateQueries({ queryKey: qk.comments(e.id) });
            break;
          case 'me':
            void qc.invalidateQueries({ queryKey: qk.me });
            break;
        }
      },
      // Healing: on (re)connect, refetch what may have been missed.
      () => {
        void qc.invalidateQueries({ queryKey: qk.notifications });
        void qc.invalidateQueries({ queryKey: qk.conversations });
      },
    );
  }, [enabled, qc]);
}
