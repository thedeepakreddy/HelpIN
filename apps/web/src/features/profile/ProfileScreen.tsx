import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Grid3x3, HandHeart, MapPin, Menu, Send, ShieldCheck, Star, UserPlus, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { languageName } from '@helpin/config';
import type { MediaRef, Post, PublicUser } from '@helpin/contracts';
import { useKarmaHistory, useMe, useMyProblems, useUserPosts } from '../../api/hooks';
import { Hexie } from '../../components/domain/Hexies';
import { Illustration } from '../../components/domain/Illustration';
import { Photo } from '../../components/domain/media';
import { CategoryHex, StatusBadge } from '../../components/domain/problem';
import { IconButton, buttonClass } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { Chip, EmptyState, HexAvatar, Skeleton } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';
import { relativeTime } from '../../lib/time';

export type ProfileTab = 'posts' | 'helped' | 'problems';

/* ------------------------------------------------------------------ Shared pieces */

export function handleOf(name: string) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '').replace(/\.$/, '');
}

export function VerifiedHex({ label }: { label: string }) {
  return (
    <svg width="18" height="20" viewBox="0 0 32 36" role="img" aria-label={label}>
      <polygon points="16,1 31,9.5 31,26.5 16,35 1,26.5 1,9.5" fill="#0A7A56" />
      <path d="M10 18l4 4 8-8" stroke="#FFFFFF" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
export function ProfileAvatar({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  return (
    <div className="relative h-[106px] w-24 shrink-0">
      <svg width="96" height="106" viewBox="0 0 96 106" aria-hidden className="absolute inset-0">
        <polygon points="48,3 92,28.5 92,77.5 48,103 4,77.5 4,28.5" fill="none" stroke="#FFC531" strokeWidth="4" strokeLinejoin="round" />
        <polyline points="48,3 92,28.5 92,77.5 48,103" fill="none" stroke="#0A7A56" strokeWidth="4" strokeLinejoin="round" />
      </svg>
      <div className="hex absolute top-[11px] left-[10px] h-[84px] w-[76px] overflow-hidden" role="img" aria-label={t('profile.photo', { name: user.displayName })}>
        {user.avatar ? <Photo media={user.avatar} size="thumbUrl" alt="" className="size-full" /> : <HexAvatar initials={user.initials} color={user.color} size={76} className="h-full" />}
      </div>
      {user.neighboursHelped > 0 && (
        <span className="absolute right-[-6px] bottom-1.5 flex h-[22px] items-center rounded-full border-[2.5px] border-white bg-tram px-[7px] text-[11px] font-extrabold text-tram-ink">
          {t('profile.helping')}
        </span>
      )}
    </div>
  );
}

export function ProfileHeader({ user, bio, memberSince, postsCount, actions }: { user: PublicUser; bio: string; memberSince: string; postsCount: number; actions: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-center gap-[18px] px-[18px] pt-2">
        <ProfileAvatar user={user} />
        <dl className="grid flex-1 grid-cols-3 text-center">
          <Stat value={postsCount} label={t('profile.posts')} />
          <Stat value={user.neighboursHelped} label={t('profile.helped')} />
          <Stat
            value={
              <span className="inline-flex items-center gap-[3px]">
                {user.karma}
                <Star size={15} className="fill-tram text-tram-lip" strokeWidth={1.8} />
              </span>
            }
            label={t('profile.karma')}
          />
        </dl>
      </div>
      <div className="px-[18px] pt-2.5">
        <p className="text-[15px] font-extrabold">{user.displayName}</p>
        {bio && <p className="mt-0.5 text-[14px] leading-relaxed text-ink">{bio}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {user.isNewcomer && <Chip tone="tram">{t('problem.newcomer')}</Chip>}
          {user.languages.map((l) => (
            <Chip key={l} tone="sapphire">
              {languageName(l)}
            </Chip>
          ))}
          {user.reliability !== null && <Chip tone="brand">{t('profile.responds', { pct: Math.round(user.reliability * 100) })}</Chip>}
        </div>
        <p className="mt-2 flex items-center gap-1 text-[12px] text-muted">
          <MapPin size={13} />
          {t('profile.memberSince', { date: new Date(memberSince).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) })}
        </p>
      </div>
      <div className="flex gap-2 px-[18px] pt-3">{actions}</div>
    </>
  );
}

export function ProfileTabs({ tab, onTab, labels }: { tab: ProfileTab; onTab: (t: ProfileTab) => void; labels: Record<ProfileTab, string> }) {
  const { t } = useTranslation();
  const items: [ProfileTab, LucideIcon][] = [
    ['posts', Grid3x3],
    ['helped', HandHeart],
    ['problems', MapPin],
  ];
  return (
    <div role="tablist" aria-label={t('profile.sections')} className="mt-4 flex border-t border-line">
      {items.map(([id, Icon]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          aria-label={labels[id]}
          title={labels[id]}
          onClick={() => onTab(id)}
          className={cn('-mt-px flex h-11 flex-1 items-center justify-center border-t-2', tab === id ? 'border-ink text-ink' : 'border-transparent text-muted')}
        >
          <Icon size={22} />
        </button>
      ))}
    </div>
  );
}

/** Instagram-style grid of a person's posts. Thank-yous without a photo get the yellow card. */
export function PostsGrid({ posts, loading }: { posts: Post[] | undefined; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) return <Skeleton className="m-1 h-60 rounded-none" />;
  if (!posts?.length) return <EmptyState art={<Hexie mood="neutral" />} title={t('profile.noPosts')} body={t('profile.noPostsBody')} />;
  return (
    <ul className="grid grid-cols-3 gap-0.5">
      {posts.map((p) => (
        <li key={p.id} className="relative aspect-square overflow-hidden bg-line">
          <Link to="/community" search={{ post: p.id }} className="block size-full" aria-label={p.caption ?? t('profile.post')}>
            {p.photos[0] ? (
              <Photo media={p.photos[0]} size="thumbUrl" alt="" className="size-full" />
            ) : (
              <Illustration name="thanks" thanksTo={p.thanked[0] ?? t('profile.neighbour')} thanksFrom={p.author.anonymous ? undefined : p.author.user.displayName.split(' ')[0]} />
            )}
          </Link>
          {p.kind === 'thank_you' && (
            <span className="absolute top-1.5 right-1.5 flex size-[18px] items-center justify-center rounded-full bg-ink" aria-hidden>
              <Star size={11} className="fill-tram text-tram" />
            </span>
          )}
          {p.photos.length > 1 && (
            <svg viewBox="0 0 24 24" aria-hidden className="absolute top-1.5 right-1.5 size-4" fill="#FFFFFF">
              <rect x="7" y="2" width="15" height="15" rx="2" />
              <rect x="2" y="7" width="15" height="15" rx="2" stroke="#000" strokeOpacity="0.15" />
            </svg>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PhotoTiles({ items }: { items: { key: string; photo: MediaRef; problemId: string; status: string }[] }) {
  const { t } = useTranslation();
  if (!items.length) return <EmptyState art={<Hexie mood="sleepy" color="sapphire" />} title={t('profile.noProblemPhotos')} />;
  return (
    <ul className="grid grid-cols-3 gap-0.5">
      {items.map((i) => (
        <li key={i.key} className="relative aspect-square overflow-hidden bg-line">
          <Link to="/p/$problemId" params={{ problemId: i.problemId }} className="block size-full">
            <Photo media={i.photo} size="thumbUrl" alt="" className="size-full" />
          </Link>
          <span className="absolute bottom-1.5 left-1.5">
            <StatusBadge status={i.status} size="xs" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ My profile */

export function ProfileScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const me = useMe();
  const [tab, setTab] = useState<ProfileTab>('posts');
  const posts = useUserPosts(me.data?.id);

  if (!me.data) return <Skeleton className="m-4 h-72" />;
  const u = me.data;

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
          <span className="font-display text-[21px] font-extrabold tracking-tight">{handleOf(u.displayName)}</span>
          {u.phoneVerified && <VerifiedHex label={t('profile.verified')} />}
        </div>
        <div className="flex">
          {(u.role === 'admin' || u.role === 'moderator') && (
            <Link to="/admin" aria-label={t('nav.admin')} className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-black/5">
              <ShieldCheck size={21} />
            </Link>
          )}
          <IconButton label={t('profile.share')} onClick={() => void shareProfile()}>
            <Send size={21} />
          </IconButton>
          <Link to="/settings" aria-label={t('profile.settings')} className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-black/5">
            <Menu size={23} />
          </Link>
        </div>
      </header>

      <ProfileHeader
        user={u}
        bio={u.bio}
        memberSince={u.memberSince}
        postsCount={u.postsCount}
        actions={
          <>
            <Link to="/settings" className={buttonClass('secondary', 'sm', false, 'flex-1')}>
              {t('profile.edit')}
            </Link>
            <button type="button" className={buttonClass('secondary', 'sm', false, 'flex-1')} onClick={() => setTab('helped')}>
              {t('profile.activity')}
            </button>
            <button type="button" aria-label={t('profile.invite')} className={buttonClass('primary', 'sm', false, 'w-[42px] px-0')} onClick={() => void shareProfile()}>
              <UserPlus size={18} />
            </button>
          </>
        }
      />

      <ProfileTabs tab={tab} onTab={setTab} labels={{ posts: t('profile.tabs.posts'), helped: t('profile.tabs.helped'), problems: t('profile.tabs.problems') }} />
      {tab === 'posts' && <PostsGrid posts={posts.data} loading={posts.isPending} />}
      {tab === 'helped' && <KarmaList />}
      {tab === 'problems' && <MyProblems />}
    </div>
  );
}

function KarmaList() {
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

/** A-04: the asker's own private list, including anonymous problems. */
function MyProblems() {
  const { t } = useTranslation();
  const problems = useMyProblems();
  if (problems.isPending) return <Skeleton className="m-4 h-40" />;
  if (!problems.data?.length) {
    return (
      <EmptyState
        art={<Hexie mood="sleepy" color="sapphire" />}
        title={t('profile.noProblems')}
        body={t('profile.noProblemsBody')}
        action={
          <Link to="/create" className={buttonClass('primary')}>
            {t('problems.postOne')}
          </Link>
        }
      />
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-2 p-3.5 sm:grid-cols-3">
      {problems.data.map((p) => (
        <li key={p.id}>
          <Link to="/p/$problemId" params={{ problemId: p.id }} className="flex h-full flex-col gap-2 rounded-2xl bg-paper p-3 text-ink no-underline hover:bg-line/60">
            <div className="flex items-center justify-between">
              {p.coverPhoto ? <Photo media={p.coverPhoto} size="thumbUrl" alt="" className="hex h-[38px] w-[34px]" /> : <CategoryHex categoryId={p.categoryId} size={34} urgent={p.urgency === 'serious'} />}
              <StatusBadge status={p.status} size="xs" />
            </div>
            <span className="line-clamp-2 text-[13px] leading-snug font-bold">{p.title}</span>
            {p.asker.anonymous && <span className="text-[11px] font-semibold text-muted">{t('profile.postedAnonymously')}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

