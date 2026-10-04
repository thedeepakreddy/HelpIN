import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Grid3x3, HandHeart, Languages, Leaf, LogOut, MapPin, Menu, PartyPopper, Plus, Send, Star, UserPlus, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { languageName } from '@helpin/config';
import type { Me } from '@helpin/contracts';
import { useKarmaHistory, useMe, useMyPosts, useMyProblems, useSession } from '../../api/hooks';
import { Hexie } from '../../components/domain/Hexies';
import { Illustration } from '../../components/domain/Illustration';
import { CategoryHex, StatusBadge } from '../../components/domain/problem';
import { Button, IconButton } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { Chip, ChoiceCard, EmptyState, HexAvatar, Skeleton } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';
import { relativeTime } from '../../lib/time';

type Tab = 'posts' | 'helped' | 'problems';

const DEMO_PEOPLE = [
  { id: 'u_zsofi', name: 'Zsófi K.', initials: 'ZK', color: 'brand' },
  { id: 'u_arjun', name: 'Arjun S.', initials: 'AS', color: 'amber' },
] as const;

export function ProfileScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const me = useMe();
  const [tab, setTab] = useState<Tab>('posts');
  const [settings, setSettings] = useState(false);

  if (!me.data) return <Skeleton className="m-4 h-72" />;
  const u = me.data;
  const handle = u.displayName.toLowerCase().replace(/\s+/g, '.').replace(/\.$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '');

  async function shareProfile() {
    const url = `${window.location.origin}/u/${u.id}`;
    try {
      if (navigator.share) await navigator.share({ title: `${u.displayName} on HelpIn`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast(t('problem.linkCopied'));
      }
    } catch {
      /* dismissed */
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-white pb-6 md:my-6 md:min-h-0 md:rounded-[28px] md:lip-card">
      <header className="flex items-center justify-between pt-[max(12px,env(safe-area-inset-top))] pr-2.5 pb-1 pl-[18px]">
        <div className="flex items-center gap-1.5">
          <span className="font-display text-[21px] font-extrabold tracking-tight">{handle}</span>
          {u.phoneVerified && (
            <svg width="18" height="20" viewBox="0 0 32 36" role="img" aria-label={t('profile.verified')}>
              <polygon points="16,1 31,9.5 31,26.5 16,35 1,26.5 1,9.5" fill="#0A7A56" />
              <path d="M10 18l4 4 8-8" stroke="#FFFFFF" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <div className="flex">
          <IconButton label={t('profile.share')} onClick={() => void shareProfile()}>
            <Send size={21} />
          </IconButton>
          <IconButton label={t('profile.settings')} onClick={() => setSettings(true)}>
            <Menu size={23} />
          </IconButton>
        </div>
      </header>

      <div className="flex items-center gap-[18px] px-[18px] pt-2">
        <ProfileAvatar me={u} />
        <dl className="grid flex-1 grid-cols-3 text-center">
          <Stat value={u.postsCount} label={t('profile.posts')} />
          <Stat value={u.neighboursHelped} label={t('profile.helped')} />
          <Stat
            value={
              <span className="inline-flex items-center gap-[3px]">
                {u.karma}
                <Star size={15} className="fill-tram text-tram-lip" strokeWidth={1.8} />
              </span>
            }
            label={t('profile.karma')}
          />
        </dl>
      </div>

      <div className="px-[18px] pt-2.5">
        <p className="text-[15px] font-extrabold">{u.displayName}</p>
        {u.bio && <p className="mt-0.5 text-[14px] leading-relaxed text-ink">{u.bio}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {u.isNewcomer && <Chip tone="tram">{t('problem.newcomer')}</Chip>}
          {u.languages.map((l) => (
            <Chip key={l} tone="sapphire">
              {languageName(l)}
            </Chip>
          ))}
          {u.reliability !== null && <Chip tone="brand">{t('profile.responds', { pct: Math.round(u.reliability * 100) })}</Chip>}
        </div>
        <p className="mt-2 flex items-center gap-1 text-[12px] text-muted">
          <MapPin size={13} />
          {t('profile.memberSince', { date: new Date(u.memberSince).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) })}
        </p>
      </div>

      <div className="flex gap-2 px-[18px] pt-3">
        <Button variant="secondary" size="sm" className="flex-1" onClick={() => toast(t('profile.soon'))}>
          {t('profile.edit')}
        </Button>
        <Button variant="secondary" size="sm" className="flex-1" onClick={() => setTab('helped')}>
          {t('profile.activity')}
        </Button>
        <Button size="sm" aria-label={t('profile.invite')} className="w-[42px] px-0" onClick={() => void shareProfile()}>
          <UserPlus size={18} />
        </Button>
      </div>

      <Highlights />

      <div role="tablist" aria-label={t('profile.sections')} className="mt-3 flex border-t border-line">
        {(
          [
            ['posts', Grid3x3, t('profile.tabs.posts')],
            ['helped', HandHeart, t('profile.tabs.helped')],
            ['problems', MapPin, t('profile.tabs.problems')],
          ] as [Tab, LucideIcon, string][]
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-label={label}
            onClick={() => setTab(id)}
            className={cn('-mt-px flex h-11 flex-1 items-center justify-center border-t-2', tab === id ? 'border-ink text-ink' : 'border-transparent text-muted')}
          >
            <Icon size={22} />
          </button>
        ))}
      </div>

      {tab === 'posts' && <PostsGrid />}
      {tab === 'helped' && <HelpedList />}
      {tab === 'problems' && <ProblemsGrid />}

      <SettingsSheet open={settings} onOpenChange={setSettings} me={u} />
    </div>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="font-display text-[22px] leading-tight font-extrabold">{value}</dd>
    </div>
  );
}

/** Hexagon avatar with the two-tone "helping" ring (tram yellow + emerald). */
function ProfileAvatar({ me }: { me: Me }) {
  const { t } = useTranslation();
  return (
    <div className="relative h-[106px] w-24 shrink-0">
      <svg width="96" height="106" viewBox="0 0 96 106" aria-hidden className="absolute inset-0">
        <polygon points="48,3 92,28.5 92,77.5 48,103 4,77.5 4,28.5" fill="none" stroke="#FFC531" strokeWidth="4" strokeLinejoin="round" />
        <polyline points="48,3 92,28.5 92,77.5 48,103" fill="none" stroke="#0A7A56" strokeWidth="4" strokeLinejoin="round" />
      </svg>
      <div className="hex absolute top-[11px] left-[10px] h-[84px] w-[76px] overflow-hidden" role="img" aria-label={t('profile.photo', { name: me.displayName })}>
        <Portrait userId={me.id} initials={me.initials} color={me.color} />
      </div>
      {me.neighboursHelped > 0 && (
        <span className="absolute right-[-6px] bottom-1.5 flex h-[22px] items-center rounded-full border-[2.5px] border-white bg-tram px-[7px] text-[11px] font-extrabold text-tram-ink">
          {t('profile.helping')}
        </span>
      )}
    </div>
  );
}

const PORTRAITS: Record<string, { bg: string; hair: string; skin: string; shirt: string; long?: boolean }> = {
  u_zsofi: { bg: '#2352E0', hair: '#6B3A1F', skin: '#F2C7A5', shirt: '#0A7A56', long: true },
  u_arjun: { bg: '#F28C00', hair: '#1E1A17', skin: '#C68B59', shirt: '#2352E0' },
};

function Portrait({ userId, initials, color }: { userId: string; initials: string; color: string }) {
  const p = PORTRAITS[userId];
  if (!p) return <HexAvatar initials={initials} color={color} size={76} className="h-full" />;
  return (
    <svg width="76" height="84" viewBox="0 0 76 84" aria-hidden>
      <rect width="76" height="84" fill={p.bg} />
      <circle cx="62" cy="16" r="9" fill="#FFC531" />
      <path d="M8,84 C10,62 24,56 38,56 C52,56 66,62 68,84 Z" fill={p.shirt} />
      <rect x="33" y="46" width="10" height="12" rx="4" fill={p.skin} />
      {p.long && <path d="M20,38 C18,20 28,14 38,14 C50,14 58,22 56,38 C56,46 54,52 50,54 L26,54 C22,52 20,46 20,38 Z" fill={p.hair} />}
      <ellipse cx="38" cy="36" rx="13" ry="15" fill={p.skin} />
      <path d={p.long ? 'M25,30 C28,20 46,18 51,30 C46,26 34,25 25,30 Z' : 'M24,32 C24,18 52,16 52,32 C48,25 30,24 24,32 Z'} fill={p.hair} />
      <circle cx="33" cy="36" r="1.8" fill="#0E1A14" />
      <circle cx="43" cy="36" r="1.8" fill="#0E1A14" />
      <path d="M33,43 Q38,47 43,43" stroke="#7A2E1F" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <circle cx="29" cy="41" r="2.4" fill="#F28C00" opacity="0.25" />
      <circle cx="47" cy="41" r="2.4" fill="#F28C00" opacity="0.25" />
    </svg>
  );
}

function Highlights() {
  const { t } = useTranslation();
  const items: [string, LucideIcon, string, string][] = [
    ['thanks', Star, 'bg-tram', 'text-tram-ink'],
    ['cleanups', Leaf, 'bg-brand', 'text-white'],
    ['language', Languages, 'bg-sapphire', 'text-white'],
    ['welcomes', PartyPopper, 'bg-coral', 'text-white'],
    ['new', Plus, 'bg-paper', 'text-ink-2'],
  ];
  return (
    <ul aria-label={t('profile.highlights')} className="no-scrollbar flex gap-3.5 overflow-x-auto px-[18px] pt-3.5">
      {items.map(([key, Icon, bg, fg]) => (
        <li key={key} className="flex w-[60px] shrink-0 flex-col items-center gap-1.5">
          <span className="hex flex h-16 w-[58px] items-center justify-center bg-line-strong">
            <span className={cn('hex flex h-[58px] w-[52px] items-center justify-center', bg, fg)}>
              <Icon size={23} strokeWidth={2} fill={key === 'thanks' ? '#FFFFFF' : 'none'} />
            </span>
          </span>
          <span className="text-[11px] font-semibold">{t(`profile.hl.${key}`)}</span>
        </li>
      ))}
    </ul>
  );
}

function PostsGrid() {
  const { t } = useTranslation();
  const posts = useMyPosts();
  if (posts.isPending) return <Skeleton className="m-1 h-60 rounded-none" />;
  if (!posts.data?.length) {
    return <EmptyState art={<Hexie mood="neutral" />} title={t('profile.noPosts')} body={t('profile.noPostsBody')} />;
  }
  return (
    <ul className="grid grid-cols-3 gap-0.5">
      {posts.data.map((p) => (
        <li key={p.id} className="relative aspect-square overflow-hidden bg-line">
          <Link to="/community" className="block size-full" aria-label={p.caption ?? t('profile.post')}>
            <Illustration name={p.image ?? 'thanks'} thanksTo={p.thanked[0]} thanksFrom={p.author.anonymous ? undefined : p.author.user.displayName.split(' ')[0]} />
          </Link>
          {p.kind === 'thank_you' && (
            <span className="absolute top-1.5 right-1.5 flex size-[18px] items-center justify-center rounded-full bg-ink" aria-hidden>
              <Star size={11} className="fill-tram text-tram" />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function HelpedList() {
  const { t } = useTranslation();
  const history = useKarmaHistory();
  if (history.isPending) return <Skeleton className="m-4 h-40" />;
  const rows = history.data ?? [];
  if (!rows.length) return <EmptyState art={<Hexie mood="neutral" color="mint" />} title={t('profile.noHelped')} body={t('profile.noHelpedBody')} />;
  return (
    <ul className="flex flex-col gap-2 px-3.5 pt-2.5">
      {rows.map((k) => (
        <li key={k.id} className="flex items-center gap-3 rounded-2xl bg-paper px-3 py-2.5">
          <span className={cn('hex flex h-11 w-10 shrink-0 items-center justify-center', k.amount > 0 ? 'bg-tram-tint text-tram-ink' : 'bg-line text-muted')}>
            <Star size={18} className={k.amount > 0 ? 'fill-tram text-tram-lip' : undefined} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{k.label}</span>
            <span className="mt-0.5 block text-[12px] text-ink-2">
              {t(`karma.${k.reason}`)} · {relativeTime(k.createdAt)}
            </span>
          </span>
          <span className={cn('rounded-full px-2 py-1 text-[12px] font-extrabold', k.amount > 0 ? 'bg-tram text-tram-ink' : k.amount < 0 ? 'bg-coral-tint text-coral-ink' : 'bg-line text-ink-2')}>
            {k.amount > 0 ? `+${k.amount}` : k.amount}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProblemsGrid() {
  const { t } = useTranslation();
  const problems = useMyProblems();
  if (problems.isPending) return <Skeleton className="m-4 h-40" />;
  if (!problems.data?.length) {
    return <EmptyState art={<Hexie mood="sleepy" color="sapphire" />} title={t('profile.noProblems')} body={t('profile.noProblemsBody')} />;
  }
  return (
    <ul className="grid grid-cols-2 gap-2 p-3.5 sm:grid-cols-3">
      {problems.data.map((p) => (
        <li key={p.id}>
          <Link to="/p/$problemId" params={{ problemId: p.id }} className="flex h-full flex-col gap-2 rounded-2xl bg-paper p-3 text-ink no-underline hover:bg-line/60">
            <div className="flex items-center justify-between">
              <CategoryHex categoryId={p.categoryId} size={34} urgent={p.urgency === 'serious'} />
              <StatusBadge status={p.status} size="xs" />
            </div>
            <span className="line-clamp-2 text-[13px] leading-snug font-bold">{p.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SettingsSheet({ open, onOpenChange, me }: { open: boolean; onOpenChange: (o: boolean) => void; me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const session = useSession();
  const [busy, setBusy] = useState(false);

  async function switchTo(id: string, name: string) {
    if (id === me.id) return;
    setBusy(true);
    try {
      await session.switchUser(id);
      toast(t('profile.switched', { name }));
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('profile.settings')} description={t('profile.demoNote')}>
      <p className="mb-2 text-[13px] font-bold">{t('profile.viewAs')}</p>
      <div className="flex flex-col gap-2.5">
        {DEMO_PEOPLE.map((p) => (
          <ChoiceCard
            key={p.id}
            selected={me.id === p.id}
            disabled={busy}
            onSelect={() => void switchTo(p.id, p.name)}
            icon={<HexAvatar initials={p.initials} color={p.color} size={40} />}
            title={p.name}
            description={t(`profile.persona.${p.id}`)}
          />
        ))}
      </div>
      <Button
        variant="secondary"
        block
        className="mt-6"
        icon={<LogOut size={18} />}
        onClick={async () => {
          await session.logout();
          void navigate({ to: '/welcome' });
        }}
      >
        {t('profile.logout')}
      </Button>
    </Sheet>
  );
}
