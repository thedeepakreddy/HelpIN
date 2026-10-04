import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Bell, Map, MessageCircle, Plus, User, Users, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConversations, useMe, useNotifications } from '../api/hooks';
import { Logo } from '../components/domain/Hexies';
import { buttonClass } from '../components/ui/Button';
import { HexAvatar } from '../components/ui/primitives';
import { cn } from '../lib/cn';

interface Tab {
  to: '/problems' | '/community' | '/chat' | '/profile' | '/notifications';
  label: string;
  icon: LucideIcon;
  match: string[];
  badge?: number;
}

function useTabs(): Tab[] {
  const { t } = useTranslation();
  const conversations = useConversations();
  const notifications = useNotifications();
  const unreadChats = conversations.data?.reduce((n, c) => n + c.unread, 0) ?? 0;
  const unreadNotes = notifications.data?.filter((n) => !n.read).length ?? 0;
  return [
    { to: '/problems', label: t('nav.problems'), icon: Map, match: ['/problems', '/p/'] },
    { to: '/community', label: t('nav.community'), icon: Users, match: ['/community'] },
    { to: '/chat', label: t('nav.chat'), icon: MessageCircle, match: ['/chat'], badge: unreadChats },
    { to: '/notifications', label: t('nav.notifications'), icon: Bell, match: ['/notifications'], badge: unreadNotes },
    { to: '/profile', label: t('nav.profile'), icon: User, match: ['/profile'] },
  ];
}

function Badge({ count, className }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span
      className={cn(
        'flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-coral px-1 text-[10px] leading-none font-extrabold text-white',
        className,
      )}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

/** The raised 3D hexagon in the middle of the tab bar (docs/06-ui-spec.md §4.1b). */
function CreateHex() {
  return (
    <svg width="54" height="58" viewBox="0 0 54 58" aria-hidden className="drop-shadow-[0_8px_10px_rgb(10_122_86/0.35)] transition-transform group-active:translate-y-[3px]">
      <polygon points="27,5 49.5,18 49.5,44 27,57 4.5,44 4.5,18" fill="#065A3F" />
      <polygon points="27,1 49.5,14 49.5,40 27,53 4.5,40 4.5,14" fill="#0A7A56" />
      <polygon points="27,3 47.5,14.8 27,9 6.5,14.8" fill="#FFFFFF" opacity="0.16" />
      <path d="M27 18v18M18 27h18" stroke="#FFC531" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabs = useTabs();
  const me = useMe();
  const isActive = (tab: Tab) => tab.match.some((m) => pathname.startsWith(m));
  // Full-screen flows hide the tab bar on phones.
  const immersive = pathname.startsWith('/create') || /^\/chat\/.+/.test(pathname) || pathname.startsWith('/p/');
  const mobileTabs = tabs.filter((tab) => tab.to !== '/notifications');

  return (
    <div className="flex min-h-dvh bg-paper">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-1.5 border-r border-line bg-white px-4 py-6 md:flex">
        <Link to="/problems" className="mb-5 px-2 no-underline">
          <Logo />
        </Link>
        <Link to="/create" className={buttonClass('primary', 'md', true, 'mb-4')}>
          <Plus size={19} strokeWidth={2.6} />
          {t('nav.create')}
        </Link>
        <nav aria-label={t('nav.main')} className="flex flex-col gap-0.5">
          {tabs.map((tab) => {
            const active = isActive(tab);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] no-underline transition-colors',
                  active ? 'bg-brand-tint font-bold text-brand-ink' : 'font-semibold text-ink-2 hover:bg-paper',
                )}
              >
                <tab.icon size={20} strokeWidth={active ? 2.3 : 2} />
                {tab.label}
                <Badge count={tab.badge ?? 0} className="ml-auto border-0" />
              </Link>
            );
          })}
        </nav>
        {me.data && (
          <Link to="/profile" className="mt-auto flex items-center gap-2.5 border-t border-line px-2 pt-3 text-ink no-underline">
            <HexAvatar initials={me.data.initials} color={me.data.color} size={36} />
            <span>
              <span className="block text-[14px] font-bold">{me.data.displayName}</span>
              <span className="block text-[12px] text-ink-2">{t('profile.karmaCount', { count: me.data.karma })}</span>
            </span>
          </Link>
        )}
      </aside>

      <main className={cn('min-w-0 flex-1', !immersive && 'pb-[84px] md:pb-0')}>
        <Outlet />
      </main>

      {/* Phone tab bar */}
      {!immersive && (
        <nav
          aria-label={t('nav.main')}
          className="fixed inset-x-0 bottom-0 z-40 flex h-[76px] items-start justify-around border-t border-line bg-white/95 pt-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        >
          {mobileTabs.slice(0, 2).map((tab) => (
            <TabLink key={tab.to} tab={tab} active={isActive(tab)} />
          ))}
          <Link to="/create" aria-label={t('nav.create')} className="group -mt-[26px] flex w-16 flex-col items-center gap-px text-[11px] font-bold text-ink no-underline">
            <CreateHex />
            {t('nav.createShort')}
          </Link>
          {mobileTabs.slice(2).map((tab) => (
            <TabLink key={tab.to} tab={tab} active={isActive(tab)} />
          ))}
        </nav>
      )}
    </div>
  );
}

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <Link
      to={tab.to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex w-16 flex-col items-center gap-[3px] pt-0.5 text-[11px] no-underline',
        active ? 'font-bold text-brand' : 'font-semibold text-muted',
      )}
    >
      <tab.icon size={24} strokeWidth={active ? 2.3 : 2} />
      {tab.label}
      <Badge count={tab.badge ?? 0} className="absolute -top-1 left-9" />
    </Link>
  );
}
