import { type QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { api } from '../api';
import { qk } from '../api/hooks';
import { LoginScreen } from '../features/auth/LoginScreen';
import { WelcomeScreen } from '../features/auth/WelcomeScreen';
import { ChatListScreen, ConversationScreen } from '../features/chat/ChatScreens';
import { CommunitiesScreen, CommunityDetailScreen, FeedScreen } from '../features/community/CommunityScreens';
import { PostComposer } from '../features/community/PostComposer';
import { AdminScreen } from '../features/admin/AdminScreen';
import { LegalScreen } from '../features/legal/LegalScreen';
import { OnboardingScreen } from '../features/onboarding/OnboardingScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { UserProfileScreen } from '../features/profile/UserProfileScreen';
import { CreateWizard } from '../features/create/CreateWizard';
import { NotificationsScreen } from '../features/notifications/NotificationsScreen';
import { ProblemScreen } from '../features/problems/ProblemScreen';
import { ProblemsScreen, type ProblemsView } from '../features/problems/ProblemsScreen';
import { ProfileScreen } from '../features/profile/ProfileScreen';
import { AppShell } from './AppShell';

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet });

const loadMe = (qc: QueryClient) => qc.ensureQueryData({ queryKey: qk.me, queryFn: () => api.getMe() });

/** Signed-out routes; a signed-in person goes straight on. */
const publicLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'public',
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context.queryClient);
    if (me) throw redirect(me.onboarding.done ? { to: '/problems', search: { view: 'map' } } : { to: '/onboarding' });
  },
});
const welcomeRoute = createRoute({ getParentRoute: () => publicLayout, path: '/welcome', component: WelcomeScreen });
const loginRoute = createRoute({
  getParentRoute: () => publicLayout,
  path: '/login',
  validateSearch: (s: Record<string, unknown>): { mode?: 'signup' | 'login' } => ({
    mode: s.mode === 'signup' || s.mode === 'login' ? s.mode : undefined,
  }),
  component: LoginScreen,
});

/** Onboarding: signed in, but not finished setting up (ADR-018, S-01, L-05). */
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context.queryClient);
    if (!me) throw redirect({ to: '/welcome' });
  },
  component: OnboardingScreen,
});

/** Legal pages are public (DSA contact point, privacy notice, terms). */
const legalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/legal/$page',
  component: function Legal() {
    const { page } = legalRoute.useParams();
    return <LegalScreen page={page} />;
  },
});

/** Everything else needs a verified, onboarded account (ADR-018). */
const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context.queryClient);
    if (!me) throw redirect({ to: '/welcome' });
    if (!me.onboarding.done) throw redirect({ to: '/onboarding' });
  },
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/problems', search: { view: 'map' } });
  },
});
const problemsRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/problems',
  validateSearch: (s: Record<string, unknown>): { view?: ProblemsView } => ({ view: s.view === 'list' ? 'list' : undefined }),
  component: function Problems() {
    const { view } = problemsRoute.useSearch();
    return <ProblemsScreen view={view ?? 'map'} />;
  },
});
const problemRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/p/$problemId',
  validateSearch: (s: Record<string, unknown>): { action?: 'still' | 'solved' } => ({
    action: s.action === 'still' || s.action === 'solved' ? s.action : undefined,
  }),
  component: function Problem() {
    const { problemId } = problemRoute.useParams();
    const { action } = problemRoute.useSearch();
    return <ProblemScreen key={problemId} problemId={problemId} action={action} />;
  },
});
const createProblemRoute = createRoute({ getParentRoute: () => appLayout, path: '/create', component: CreateWizard });
const chatRoute = createRoute({ getParentRoute: () => appLayout, path: '/chat', component: ChatListScreen });
const conversationRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/chat/$conversationId',
  component: function Conversation() {
    const { conversationId } = conversationRoute.useParams();
    return <ConversationScreen key={conversationId} conversationId={conversationId} />;
  },
});
const feedRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/community',
  validateSearch: (s: Record<string, unknown>): { post?: string } => ({ post: typeof s.post === 'string' ? s.post : undefined }),
  component: function Feed() {
    const { post } = feedRoute.useSearch();
    return <FeedScreen focusPost={post} />;
  },
});
const newPostRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/community/new',
  validateSearch: (s: Record<string, unknown>): { kind?: 'photo' | 'thank_you' | 'welcome'; problem?: string; community?: string } => ({
    kind: s.kind === 'thank_you' || s.kind === 'welcome' ? s.kind : undefined,
    problem: typeof s.problem === 'string' ? s.problem : undefined,
    community: typeof s.community === 'string' ? s.community : undefined,
  }),
  component: function NewPost() {
    const search = newPostRoute.useSearch();
    return <PostComposer kind={search.kind ?? 'photo'} problemId={search.problem} communityId={search.community} />;
  },
});
const communityRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/community/c/$slug',
  component: function CommunityPage() {
    const { slug } = communityRoute.useParams();
    return <CommunityDetailScreen key={slug} slug={slug} />;
  },
});
const userRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/u/$userId',
  component: function UserPage() {
    const { userId } = userRoute.useParams();
    return <UserProfileScreen key={userId} userId={userId} />;
  },
});
const settingsRoute = createRoute({ getParentRoute: () => appLayout, path: '/settings', component: SettingsScreen });
const adminRoute = createRoute({ getParentRoute: () => appLayout, path: '/admin', component: AdminScreen });
const communitiesRoute = createRoute({ getParentRoute: () => appLayout, path: '/community/communities', component: CommunitiesScreen });
const notificationsRoute = createRoute({ getParentRoute: () => appLayout, path: '/notifications', component: NotificationsScreen });
const profileRoute = createRoute({ getParentRoute: () => appLayout, path: '/profile', component: ProfileScreen });

const routeTree = rootRoute.addChildren([
  publicLayout.addChildren([welcomeRoute, loginRoute]),
  onboardingRoute,
  legalRoute,
  appLayout.addChildren([
    indexRoute,
    problemsRoute,
    problemRoute,
    createProblemRoute,
    chatRoute,
    conversationRoute,
    feedRoute,
    newPostRoute,
    communityRoute,
    communitiesRoute,
    userRoute,
    settingsRoute,
    adminRoute,
    notificationsRoute,
    profileRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent', scrollRestoration: true });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
