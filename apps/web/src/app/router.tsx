import { type QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { api } from '../api';
import { qk } from '../api/hooks';
import { LoginScreen } from '../features/auth/LoginScreen';
import { WelcomeScreen } from '../features/auth/WelcomeScreen';
import { ChatListScreen, ConversationScreen } from '../features/chat/ChatScreens';
import { CommunitiesScreen, FeedScreen } from '../features/community/CommunityScreens';
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

/** Signed-out routes; a signed-in person goes straight to the map. */
const publicLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'public',
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData({ queryKey: qk.me, queryFn: () => api.getMe() });
    if (me) throw redirect({ to: '/problems', search: { view: 'map' } });
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

/** Everything else needs a verified account (ADR-022). */
const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData({ queryKey: qk.me, queryFn: () => api.getMe() });
    if (!me) throw redirect({ to: '/welcome' });
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
  component: function Problem() {
    const { problemId } = problemRoute.useParams();
    return <ProblemScreen key={problemId} problemId={problemId} />;
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
const feedRoute = createRoute({ getParentRoute: () => appLayout, path: '/community', component: FeedScreen });
const communitiesRoute = createRoute({ getParentRoute: () => appLayout, path: '/community/communities', component: CommunitiesScreen });
const notificationsRoute = createRoute({ getParentRoute: () => appLayout, path: '/notifications', component: NotificationsScreen });
const profileRoute = createRoute({ getParentRoute: () => appLayout, path: '/profile', component: ProfileScreen });

const routeTree = rootRoute.addChildren([
  publicLayout.addChildren([welcomeRoute, loginRoute]),
  appLayout.addChildren([
    indexRoute,
    problemsRoute,
    problemRoute,
    createProblemRoute,
    chatRoute,
    conversationRoute,
    feedRoute,
    communitiesRoute,
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
