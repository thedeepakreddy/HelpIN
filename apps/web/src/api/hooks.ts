import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProblemInput, PostUpdateInput, ProblemDetail } from '@helpin/contracts';
import type { BBox, LatLng } from '@helpin/geo';
import { api } from './index';

export const qk = {
  me: ['me'] as const,
  map: (bbox: BBox, zoom: number) => ['map', bbox.map((n) => n.toFixed(3)).join(','), Math.floor(zoom)] as const,
  nearby: ['nearby'] as const,
  problem: (id: string) => ['problem', id] as const,
  myProblems: ['my-problems'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  feed: ['feed'] as const,
  myPosts: ['my-posts'] as const,
  communities: ['communities'] as const,
  notifications: ['notifications'] as const,
  karma: ['karma'] as const,
  similar: (categoryId: string, point: LatLng) => ['similar', categoryId, point.lat.toFixed(3), point.lng.toFixed(3)] as const,
};

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api.getMe(), staleTime: 60_000 });
export const useMap = (bbox: BBox | null, zoom: number) =>
  useQuery({
    queryKey: bbox ? qk.map(bbox, zoom) : ['map', 'none'],
    queryFn: () => api.getMap(bbox!, zoom),
    enabled: !!bbox,
    placeholderData: (prev) => prev,
  });
export const useNearby = (center: LatLng) => useQuery({ queryKey: qk.nearby, queryFn: () => api.listNearby(center) });
export const useProblem = (id: string) => useQuery({ queryKey: qk.problem(id), queryFn: () => api.getProblem(id) });
export const useMyProblems = () => useQuery({ queryKey: qk.myProblems, queryFn: () => api.myProblems() });
export const useSimilar = (categoryId: string | null, point: LatLng) =>
  useQuery({
    queryKey: qk.similar(categoryId ?? '-', point),
    queryFn: () => api.similarOpen(categoryId!, point),
    enabled: !!categoryId,
  });
export const useConversations = () => useQuery({ queryKey: qk.conversations, queryFn: () => api.listConversations() });
export const useConversation = (id: string) =>
  useQuery({ queryKey: qk.conversation(id), queryFn: () => api.getConversation(id), refetchInterval: 4000 });
export const useFeed = () => useQuery({ queryKey: qk.feed, queryFn: () => api.getFeed() });
export const useMyPosts = () => useQuery({ queryKey: qk.myPosts, queryFn: () => api.myPosts() });
export const useCommunities = () => useQuery({ queryKey: qk.communities, queryFn: () => api.listCommunities() });
export const useNotifications = () => useQuery({ queryKey: qk.notifications, queryFn: () => api.listNotifications() });
export const useKarmaHistory = () => useQuery({ queryKey: qk.karma, queryFn: () => api.getKarmaHistory() });

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

export const useOfferHelp = (problemId: string) =>
  useProblemMutation((message: string | null) => api.offerHelp(problemId, message));
export const useWithdrawOffer = () => useProblemMutation((offerId: string) => api.withdrawOffer(offerId));
export const useDeclineOffer = () => useProblemMutation((offerId: string) => api.declineOffer(offerId));
export const useClaimSolved = () => useProblemMutation((offerId: string) => api.claimSolved(offerId));
export const usePostUpdate = (problemId: string) =>
  useProblemMutation((input: PostUpdateInput) => api.postUpdate(problemId, input));
export const useStillNeedHelp = (problemId: string) => useProblemMutation(() => api.stillNeedHelp(problemId));
export const useWithdrawProblem = (problemId: string) =>
  useProblemMutation((reason: string) => api.withdrawProblem(problemId, reason));
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

export function useConfirmSolved(problemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (offerIds: string[]) => api.confirmSolved(problemId, offerIds),
    onSuccess: ({ problem }) => {
      qc.setQueryData(qk.problem(problem.id), problem);
      void qc.invalidateQueries();
    },
  });
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.sendMessage(conversationId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.conversation(conversationId) });
      void qc.invalidateQueries({ queryKey: qk.conversations });
    },
  });
}

export function useShareLocation(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.shareLocation(conversationId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.conversation(conversationId) }),
  });
}

export function useToggleLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => api.toggleLike(postId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.feed });
      void qc.invalidateQueries({ queryKey: qk.myPosts });
    },
  });
}

export function useToggleJoin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (communityId: string) => api.toggleJoin(communityId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.communities }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllRead(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

export function useSession() {
  const qc = useQueryClient();
  const reset = () => qc.invalidateQueries();
  return {
    requestCode: (contact: string) => api.requestCode(contact),
    verifyCode: async (code: string) => {
      const me = await api.verifyCode(code);
      qc.setQueryData(qk.me, me);
      await reset();
      return me;
    },
    logout: async () => {
      await api.logout();
      qc.clear();
    },
    switchUser: async (userId: string) => {
      const me = await api.switchDemoUser(userId);
      qc.clear();
      qc.setQueryData(qk.me, me);
      return me;
    },
  };
}
