import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Bell, CircleCheck, Heart, Info, MessageCircle, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Community, Post } from '@helpin/contracts';
import { useCommunities, useFeed, useNotifications, useToggleJoin, useToggleLike } from '../../api/hooks';
import { Hexie } from '../../components/domain/Hexies';
import { Illustration } from '../../components/domain/Illustration';
import { AskerAvatar, askerName } from '../../components/domain/problem';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { EmptyState, Eyebrow, HexAvatar, Skeleton } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { relativeTime } from '../../lib/time';
import { tone } from '../../lib/tones';

function CommunityHeader({ tab }: { tab: 'feed' | 'communities' }) {
  const { t } = useTranslation();
  const unread = useNotifications().data?.filter((n) => !n.read).length ?? 0;
  return (
    <>
      <header className="flex items-center justify-between pt-1 pb-3">
        <h1 className="font-display text-[28px] font-extrabold tracking-tight">{t('community.title')}</h1>
        <Link
          to="/notifications"
          aria-label={t('problems.notifications', { count: unread })}
          className="relative flex size-11 items-center justify-center rounded-full bg-white text-ink lip-card md:hidden"
        >
          <Bell size={20} />
          {unread > 0 && <span className="absolute top-2 right-2 size-2.5 rounded-full border-2 border-white bg-coral" />}
        </Link>
      </header>
      <div role="tablist" aria-label={t('community.view')} className="mb-4 flex rounded-2xl bg-[#E7EAE2] p-1">
        {(['feed', 'communities'] as const).map((id) => (
          <Link
            key={id}
            to={id === 'feed' ? '/community' : '/community/communities'}
            role="tab"
            aria-selected={tab === id}
            className={cn(
              'flex h-9 flex-1 items-center justify-center rounded-xl text-[14px] no-underline',
              tab === id ? 'bg-white font-bold text-ink shadow-[0_1px_0_#D3D7CC]' : 'font-semibold text-ink-2',
            )}
          >
            {t(`community.${id}`)}
          </Link>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Feed */

export function FeedScreen() {
  const { t } = useTranslation();
  const feed = useFeed();
  return (
    <div className="mx-auto max-w-xl px-4 pt-[max(16px,env(safe-area-inset-top))] pb-6">
      <CommunityHeader tab="feed" />
      {feed.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-80" />
        </div>
      ) : !feed.data?.length ? (
        <EmptyState art={<Hexie mood="sleepy" />} title={t('community.emptyTitle')} body={t('community.emptyBody')} />
      ) : (
        <div className="flex flex-col gap-3.5">
          {feed.data.map((post) => (post.kind === 'thank_you' ? <ThankYouPost key={post.id} post={post} /> : <PhotoPost key={post.id} post={post} />))}
        </div>
      )}
    </div>
  );
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .replace(/[^\p{L}]/gu, '')
    .slice(0, 2)
    .toUpperCase();

function ThankYouPost({ post }: { post: Post }) {
  const { t } = useTranslation();
  const author = askerName(post.author, t('problem.anonymous'));
  const thanked = post.thanked[0] ?? '';
  return (
    <article className="relative overflow-hidden rounded-[22px] bg-tram p-4 text-tram-ink shadow-[0_4px_0_var(--color-tram-lip),0_14px_28px_-14px_rgb(217_155_0/0.7)]">
      <svg aria-hidden viewBox="0 0 100 100" className="absolute -top-6 -right-6 size-32 opacity-40">
        <polygon points="50,0 93.3,25 93.3,75 50,100 6.7,75 6.7,25" fill="#FFFFFF" />
      </svg>
      <div className="relative flex items-center gap-2.5">
        <span className="relative h-10 w-[58px] shrink-0">
          <span className="absolute top-0 left-0">
            <AskerAvatar asker={post.author} size={38} />
          </span>
          <span className="absolute top-0 left-5">
            <HexAvatar initials={initialsOf(thanked)} color="brand" size={38} className="ring-2 ring-tram" />
          </span>
        </span>
        <p className="min-w-0 flex-1 text-[14px] leading-snug">
          <strong>{author}</strong> {t('community.thanked')} <strong>{post.thanked.join(', ')}</strong>
          <span className="block text-[12px] opacity-80">
            {t('community.district', { district: post.district })} · {relativeTime(post.createdAt)}
          </span>
        </p>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[11px] font-extrabold text-tram">
          <Star size={11} fill="currentColor" />
          {t('community.thankYou')}
        </span>
      </div>
      {post.caption && <p className="relative mt-3 font-display text-[18px] leading-snug font-semibold text-ink">“{post.caption}”</p>}
      {post.problem && (
        <Link
          to="/p/$problemId"
          params={{ problemId: post.problem.id }}
          className="relative mt-3 flex items-center gap-2 rounded-xl bg-white/60 px-3 py-2 text-ink no-underline hover:bg-white/80"
        >
          <CircleCheck size={18} className="shrink-0 text-brand" />
          <span className="min-w-0 truncate text-[13px] font-semibold">
            {t('community.solved')}: {post.problem.title}
          </span>
        </Link>
      )}
      <PostActions post={post} className="relative mt-1.5 text-tram-ink" />
    </article>
  );
}

function PhotoPost({ post }: { post: Post }) {
  const { t } = useTranslation();
  return (
    <article className="overflow-hidden rounded-[22px] bg-white lip-card">
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2.5">
        <AskerAvatar asker={post.author} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{askerName(post.author, t('problem.anonymous'))}</p>
          <p className="truncate text-[12px] text-ink-2">
            {post.community ? (
              <>
                {t('community.in')} <strong className="text-brand">{post.community.name}</strong>
              </>
            ) : (
              t('community.district', { district: post.district })
            )}{' '}
            · {relativeTime(post.createdAt)}
          </p>
        </div>
      </div>
      {post.image && (
        <div className="aspect-[4/3] w-full overflow-hidden bg-line">
          <Illustration name={post.image} thanksTo={post.thanked[0]} />
        </div>
      )}
      <div className="px-3.5 pb-2 pt-1">
        <PostActions post={post} />
        {post.caption && (
          <p className="pb-2 text-[15px] leading-relaxed">
            <strong>{askerName(post.author, t('problem.anonymous')).split(' ')[0]}</strong> {post.caption}
          </p>
        )}
      </div>
    </article>
  );
}

function PostActions({ post, className }: { post: Post; className?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const like = useToggleLike();
  return (
    <div className={cn('-ml-2 flex items-center gap-1', className)}>
      <button
        type="button"
        aria-pressed={post.liked}
        aria-label={post.liked ? t('community.unlike') : t('community.like')}
        onClick={() => like.mutate(post.id, { onError: (e) => toast(errorMessage(e, t), 'error') })}
        className="flex h-10 items-center gap-1.5 rounded-full px-2 text-[14px] font-bold"
      >
        <Heart size={22} className={cn('transition-transform active:scale-125', post.liked && 'fill-coral text-coral')} />
        {post.likes}
      </button>
      <span className="flex h-10 items-center gap-1.5 px-2 text-[14px] font-bold" aria-label={t('community.comments', { count: post.comments })}>
        <MessageCircle size={21} />
        {post.comments}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ Communities */

export function CommunitiesScreen() {
  const { t } = useTranslation();
  const query = useCommunities();
  const joined = query.data?.filter((c) => c.joined) ?? [];
  const suggested = query.data?.filter((c) => !c.joined) ?? [];
  return (
    <div className="mx-auto max-w-xl px-4 pt-[max(16px,env(safe-area-inset-top))] pb-6">
      <CommunityHeader tab="communities" />
      {query.isPending ? (
        <Skeleton className="h-60" />
      ) : (
        <>
          {joined.length > 0 && (
            <>
              <Eyebrow className="mb-2 px-0.5">{t('community.yours')}</Eyebrow>
              <div className="grid grid-cols-2 gap-2.5">
                {joined.map((c) => (
                  <CommunityTile key={c.id} community={c} />
                ))}
              </div>
            </>
          )}
          <div className="mt-6 mb-2 flex items-baseline justify-between px-0.5">
            <Eyebrow>{t('community.suggested')}</Eyebrow>
            <span className="text-[12px] font-semibold text-muted">{t('community.suggestedHint')}</span>
          </div>
          <ul className="overflow-hidden rounded-[20px] bg-white lip-card">
            {suggested.map((c) => (
              <li key={c.id} className="border-b border-line last:border-0">
                <CommunityRow community={c} />
              </li>
            ))}
            {suggested.length === 0 && <li className="p-4 text-[14px] text-ink-2">{t('community.allJoined')}</li>}
          </ul>
          <p className="mt-3 flex gap-2 px-0.5 text-[12px] leading-relaxed text-muted">
            <Info size={14} className="mt-0.5 shrink-0" />
            {t('community.privateNote')}
          </p>
        </>
      )}
    </div>
  );
}

function CommunityBanner({ color, children }: { color: string; children?: ReactNode }) {
  const tn = tone(color);
  return (
    <div className={cn('relative h-[68px] overflow-hidden', tn.solid)}>
      <svg aria-hidden viewBox="0 0 200 68" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        <polygon points="160,-10 186,5 186,35 160,50 134,35 134,5" fill="#FFFFFF" opacity="0.18" />
        <polygon points="30,40 48,50.5 48,71.5 30,82 12,71.5 12,50.5" fill="#FFFFFF" opacity="0.14" />
        <polygon points="110,30 118,34.6 118,43.8 110,48.4 102,43.8 102,34.6" fill="#FFC531" opacity="0.9" />
      </svg>
      {children}
    </div>
  );
}

function CommunityTile({ community: c }: { community: Community }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-[18px] bg-white lip-card">
      <CommunityBanner color={c.color}>
        {c.newPosts > 0 && <span className="absolute top-2.5 right-2.5 size-2.5 rounded-full bg-tram ring-2 ring-white" />}
      </CommunityBanner>
      <div className="px-3 pt-2.5 pb-3">
        <p className="text-[14px] leading-tight font-bold">{c.name}</p>
        <p className="mt-1 text-[12px] text-ink-2">
          {t(`community.types.${c.type}`)}
          {c.newPosts > 0 && ` · ${t('community.newPosts', { count: c.newPosts })}`}
        </p>
      </div>
    </div>
  );
}

function CommunityRow({ community: c }: { community: Community }) {
  const { t } = useTranslation();
  const toast = useToast();
  const join = useToggleJoin();
  const tn = tone(c.color);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={cn('hex flex h-12 w-11 shrink-0 items-center justify-center text-[13px] font-extrabold', tn.bg, tn.fg)}>{initialsOf(c.name)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-tight font-bold">{c.name}</p>
        <p className="mt-0.5 text-[12px] text-ink-2">
          {t(`community.types.${c.type}`)} · {t('community.members', { count: c.memberCount })}
        </p>
      </div>
      <Button
        size="sm"
        variant={c.joined ? 'secondary' : 'primary'}
        aria-pressed={c.joined}
        loading={join.isPending}
        onClick={() =>
          join.mutate(c.id, {
            onSuccess: (r) => r.joined && toast(t('community.joinedToast', { name: c.name })),
            onError: (e) => toast(errorMessage(e, t), 'error'),
          })
        }
      >
        {c.joined ? t('community.joined') : t('community.join')}
      </Button>
    </div>
  );
}
