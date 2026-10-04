import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Bell, BellOff, Camera, CircleCheck, Heart, Info, MessageCircle, Plus, Send, Star, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Community, Post } from '@helpin/contracts';
import { api } from '../../api';
import { useAddComment, useComments, useCommunities, useCommunity, useDeletePost, useFeed, useNotifications, useToggleJoin, useToggleLike } from '../../api/hooks';
import { Hexie } from '../../components/domain/Hexies';
import { Photo } from '../../components/domain/media';
import { AskerAvatar, ProblemCard, askerName } from '../../components/domain/problem';
import { MoreMenu } from '../../components/domain/SafetySheets';
import { Button, IconButton, buttonClass } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { ChoiceCard, EmptyState, Eyebrow, HexAvatar, Skeleton, TextArea, TextField } from '../../components/ui/primitives';
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
        <div className="flex gap-2">
          <Link to="/community/new" aria-label={t('community.newPost')} className={buttonClass('primary', 'sm', false, 'size-11 rounded-full px-0')}>
            <Plus size={20} strokeWidth={2.6} />
          </Link>
          <Link
            to="/notifications"
            aria-label={t('problems.notifications', { count: unread })}
            className="relative flex size-11 items-center justify-center rounded-full bg-white text-ink lip-card md:hidden"
          >
            <Bell size={20} />
            {unread > 0 && <span className="absolute top-2 right-2 size-2.5 rounded-full border-2 border-white bg-coral" />}
          </Link>
        </div>
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

export function FeedScreen({ focusPost }: { focusPost?: string }) {
  const { t } = useTranslation();
  const feed = useFeed();
  const posts = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const [commentsFor, setCommentsFor] = useState<string | null>(focusPost ?? null);

  // Deep links from notifications (/community?post=…) open that post's comments / tag prompt.
  const [seenFocus, setSeenFocus] = useState(focusPost);
  if (focusPost !== seenFocus) {
    setSeenFocus(focusPost);
    if (focusPost) setCommentsFor(focusPost);
  }

  return (
    <div className="mx-auto max-w-xl px-4 pt-[max(16px,env(safe-area-inset-top))] pb-6">
      <CommunityHeader tab="feed" />
      {feed.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-80" />
        </div>
      ) : !posts.length ? (
        <EmptyState
          art={<Hexie mood="sleepy" />}
          title={t('community.emptyTitle')}
          body={t('community.emptyBody')}
          action={
            <Link to="/community/new" className={buttonClass('primary')}>
              <Camera size={18} />
              {t('community.firstPost')}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3.5">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onComments={() => setCommentsFor(post.id)} />
          ))}
          {feed.hasNextPage && (
            <Button variant="secondary" loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
              {t('community.more')}
            </Button>
          )}
        </div>
      )}
      <CommentsSheet postId={commentsFor} onClose={() => setCommentsFor(null)} />
    </div>
  );
}

export function PostCard({ post, onComments }: { post: Post; onComments: () => void }) {
  return post.kind === 'thank_you' ? <ThankYouPost post={post} onComments={onComments} /> : <PhotoPost post={post} onComments={onComments} />;
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .replace(/[^\p{L}]/gu, '')
    .slice(0, 2)
    .toUpperCase();

function PostMenu({ post }: { post: Post }) {
  const { t } = useTranslation();
  const toast = useToast();
  const del = useDeletePost();
  if (post.mine) {
    return (
      <IconButton label={t('community.delete')} onClick={() => del.mutate(post.id, { onSuccess: () => toast(t('community.deleted')), onError: (e) => toast(errorMessage(e, t), 'error') })}>
        <Trash2 size={18} />
      </IconButton>
    );
  }
  return <MoreMenu targetType="post" targetId={post.id} block={post.author.anonymous ? null : { userId: post.author.user.id, name: post.author.user.displayName }} />;
}

function AuthorLink({ post, children }: { post: Post; children: ReactNode }) {
  if (post.author.anonymous) return <>{children}</>;
  return (
    <Link to="/u/$userId" params={{ userId: post.author.user.id }} className="text-inherit no-underline">
      {children}
    </Link>
  );
}

function ThankYouPost({ post, onComments }: { post: Post; onComments: () => void }) {
  const { t } = useTranslation();
  const author = askerName(post.author, t('problem.anonymous'));
  const thanked = post.thanked[0];
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
            <HexAvatar initials={thanked ? initialsOf(thanked) : '♥'} color="brand" size={38} />
          </span>
        </span>
        <p className="min-w-0 flex-1 text-[14px] leading-snug">
          <AuthorLink post={post}>
            <strong>{author}</strong>
          </AuthorLink>{' '}
          {post.thanked.length ? (
            <>
              {t('community.thanked')} <strong>{post.thanked.join(', ')}</strong>
            </>
          ) : (
            t('community.saidThanks')
          )}
          <span className="block text-[12px] opacity-80">
            {post.district && `${t('community.district', { district: post.district })} · `}
            {relativeTime(post.createdAt)}
          </span>
        </p>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[11px] font-extrabold text-tram">
          <Star size={11} fill="currentColor" />
          {t('community.thankYou')}
        </span>
      </div>
      {post.caption && <p className="relative mt-3 font-display text-[18px] leading-snug font-semibold text-ink">“{post.caption}”</p>}
      {post.photos[0] && <Photo media={post.photos[0]} alt={post.caption ?? ''} className="relative mt-3 aspect-[4/3] w-full rounded-2xl" />}
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
      <div className="relative mt-1.5 flex items-center justify-between">
        <PostActions post={post} onComments={onComments} className="text-tram-ink" />
        <PostMenu post={post} />
      </div>
    </article>
  );
}

function PhotoPost({ post, onComments }: { post: Post; onComments: () => void }) {
  const { t } = useTranslation();
  const name = askerName(post.author, t('problem.anonymous'));
  return (
    <article className="overflow-hidden rounded-[22px] bg-white lip-card">
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2.5">
        <AuthorLink post={post}>
          <AskerAvatar asker={post.author} size={38} />
        </AuthorLink>
        <div className="min-w-0 flex-1">
          <AuthorLink post={post}>
            <p className="truncate text-[15px] font-bold">{name}</p>
          </AuthorLink>
          <p className="truncate text-[12px] text-ink-2">
            {post.community ? (
              <>
                {t('community.in')} <strong className="text-brand">{post.community.name}</strong>
              </>
            ) : (
              post.district && t('community.district', { district: post.district })
            )}{' '}
            · {relativeTime(post.createdAt)}
          </p>
        </div>
        <PostMenu post={post} />
      </div>
      {post.photos.length > 0 && (
        <div className="no-scrollbar flex aspect-[4/3] w-full snap-x snap-mandatory overflow-x-auto bg-line">
          {post.photos.map((m, i) => (
            <Photo key={m.id} media={m} alt={t('community.photoAlt', { n: i + 1, name })} className="size-full shrink-0 snap-center" />
          ))}
        </div>
      )}
      <div className="px-3.5 pt-1 pb-2">
        <PostActions post={post} onComments={onComments} />
        {post.caption && (
          <p className="pb-2 text-[15px] leading-relaxed">
            <strong>{name.split(' ')[0]}</strong> {post.caption}
          </p>
        )}
      </div>
    </article>
  );
}

function PostActions({ post, onComments, className }: { post: Post; onComments: () => void; className?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const like = useToggleLike();
  return (
    <div className={cn('-ml-2 flex items-center gap-1', className)}>
      <button
        type="button"
        aria-pressed={post.liked}
        aria-label={post.liked ? t('community.unlike') : t('community.like')}
        onClick={() => like.mutate({ postId: post.id, on: !post.liked }, { onError: (e) => toast(errorMessage(e, t), 'error') })}
        className="flex h-10 items-center gap-1.5 rounded-full px-2 text-[14px] font-bold"
      >
        <Heart size={22} className={cn('transition-transform active:scale-125', post.liked && 'fill-coral text-coral')} />
        {post.likes}
      </button>
      <button type="button" onClick={onComments} className="flex h-10 items-center gap-1.5 rounded-full px-2 text-[14px] font-bold" aria-label={t('community.comments', { count: post.comments })}>
        <MessageCircle size={21} />
        {post.comments}
      </button>
    </div>
  );
}

function CommentsSheet({ postId, onClose }: { postId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const comments = useComments(postId);
  const add = useAddComment(postId ?? '');
  const [text, setText] = useState('');
  return (
    <Sheet
      open={!!postId}
      onOpenChange={(o) => !o && onClose()}
      title={t('community.commentsTitle')}
      footer={
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            add.mutate(text.trim(), { onSuccess: () => setText(''), onError: (err) => toast(errorMessage(err, t), 'error') });
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t('community.addComment')}</span>
            <input
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('community.addComment')}
              className="h-11 w-full rounded-full border-[1.5px] border-line bg-[#F9FAF7] px-4 text-[15px] focus:border-brand focus:bg-white focus:outline-none"
            />
          </label>
          <button type="submit" aria-label={t('chat.send')} disabled={!text.trim() || add.isPending} className="press lip-brand flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:bg-line disabled:text-muted disabled:shadow-none">
            <Send size={18} />
          </button>
        </form>
      }
    >
      <TagPrompt postId={postId} />
      {comments.isPending ? (
        <Skeleton className="h-20" />
      ) : !comments.data?.length ? (
        <p className="py-6 text-center text-[14px] text-ink-2">{t('community.noComments')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.data.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <HexAvatar initials={c.author.initials} color={c.author.color} photo={c.author.avatar} size={32} />
              <div className="min-w-0 flex-1 rounded-2xl bg-white px-3 py-2 lip-card">
                <p className="text-[13px]">
                  <strong>{c.author.displayName}</strong> <span className="text-muted">· {relativeTime(c.createdAt)}</span>
                </p>
                <p className="text-[14px] leading-relaxed">{c.body}</p>
              </div>
              {!c.mine && <MoreMenu targetType="comment" targetId={c.id} block={{ userId: c.author.id, name: c.author.displayName }} />}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** F-06: a helper who was thanked chooses whether their name appears. */
function TagPrompt({ postId }: { postId: string | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const notes = useNotifications();
  const [done, setDone] = useState(false);
  const pending = !!postId && notes.data?.some((n) => n.type === 'tag_request' && n.link.endsWith(postId));
  if (!pending || done) return null;
  const decide = async (d: 'approve' | 'decline') => {
    try {
      await api.decideTag(postId!, d);
      setDone(true);
      toast(d === 'approve' ? t('community.tagApproved') : t('community.tagDeclined'));
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    }
  };
  return (
    <div className="mb-4 rounded-2xl bg-tram-tint p-4">
      <p className="text-[14px] font-bold text-tram-ink">{t('community.tagQuestion')}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="tram" onClick={() => void decide('approve')}>
          {t('community.tagYes')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void decide('decline')}>
          {t('community.tagNo')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Communities */

export function CommunitiesScreen() {
  const { t } = useTranslation();
  const query = useCommunities();
  const [requesting, setRequesting] = useState(false);
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
            <Eyebrow>{joined.length ? t('community.suggested') : t('community.all')}</Eyebrow>
            <span className="text-[12px] font-semibold text-muted">{t('community.suggestedHint')}</span>
          </div>
          <ul className="overflow-hidden rounded-[20px] bg-white lip-card">
            {suggested.map((c) => (
              <li key={c.id} className="border-b border-line last:border-0">
                <CommunityRow community={c} />
              </li>
            ))}
            {suggested.length === 0 && <li className="p-4 text-[14px] text-ink-2">{query.data?.length ? t('community.allJoined') : t('community.none')}</li>}
          </ul>
          <p className="mt-3 flex gap-2 px-0.5 text-[12px] leading-relaxed text-muted">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>
              {t('community.privateNote')}{' '}
              <button type="button" onClick={() => setRequesting(true)} className="font-bold text-brand">
                {t('community.request')}
              </button>
            </span>
          </p>
        </>
      )}
      <RequestCommunitySheet open={requesting} onOpenChange={setRequesting} />
    </div>
  );
}

function CommunityBanner({ color, children, tall }: { color: string; children?: ReactNode; tall?: boolean }) {
  const tn = tone(color);
  return (
    <div className={cn('relative overflow-hidden', tall ? 'h-[140px]' : 'h-[68px]', tn.solid)}>
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
    <Link to="/community/c/$slug" params={{ slug: c.slug }} className="overflow-hidden rounded-[18px] bg-white text-ink no-underline lip-card">
      <CommunityBanner color={c.color}>{c.newPosts > 0 && <span className="absolute top-2.5 right-2.5 size-2.5 rounded-full bg-tram ring-2 ring-white" />}</CommunityBanner>
      <div className="px-3 pt-2.5 pb-3">
        <p className="text-[14px] leading-tight font-bold">{c.name}</p>
        <p className="mt-1 text-[12px] text-ink-2">
          {t(`community.types.${c.type}`)}
          {c.newPosts > 0 && ` · ${t('community.newPosts', { count: c.newPosts })}`}
        </p>
      </div>
    </Link>
  );
}

function JoinButton({ community: c }: { community: Community }) {
  const { t } = useTranslation();
  const toast = useToast();
  const join = useToggleJoin();
  return (
    <Button
      size="sm"
      variant={c.joined ? 'secondary' : 'primary'}
      aria-pressed={c.joined}
      loading={join.isPending}
      onClick={() =>
        join.mutate(
          { id: c.id, on: !c.joined },
          {
            onSuccess: (r) => r.joined && toast(t('community.joinedToast', { name: c.name })),
            onError: (e) => toast(errorMessage(e, t), 'error'),
          },
        )
      }
    >
      {c.joined ? t('community.joined') : t('community.join')}
    </Button>
  );
}

function CommunityRow({ community: c }: { community: Community }) {
  const { t } = useTranslation();
  const tn = tone(c.color);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Link to="/community/c/$slug" params={{ slug: c.slug }} className="flex min-w-0 flex-1 items-center gap-3 text-ink no-underline">
        <span className={cn('hex flex h-12 w-11 shrink-0 items-center justify-center text-[13px] font-extrabold', tn.bg, tn.fg)}>{initialsOf(c.name)}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] leading-tight font-bold">{c.name}</span>
          <span className="mt-0.5 block text-[12px] text-ink-2">
            {t(`community.types.${c.type}`)} · {t('community.members', { count: c.memberCount })}
          </span>
        </span>
      </Link>
      <JoinButton community={c} />
    </div>
  );
}

export function CommunityDetailScreen({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useCommunity(slug);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<boolean | null>(null);
  if (q.isPending) return <Skeleton className="m-4 h-60" />;
  if (!q.data) return <EmptyState art={<Hexie mood="sad" />} title={t('community.notFound')} />;
  const c = q.data;
  const alertsOn = alerts ?? c.alerts;
  return (
    <div className="mx-auto max-w-xl pb-8">
      <CommunityBanner color={c.color} tall>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/60 to-transparent px-4 pt-10 pb-3 text-white">
          <h1 className="font-display text-[26px] leading-tight font-extrabold">{c.name}</h1>
          <p className="text-[13px] opacity-90">
            {t(`community.types.${c.type}`)} · {t('community.members', { count: c.memberCount })}
          </p>
        </div>
      </CommunityBanner>
      <div className="px-4 pt-4">
        {c.description && <p className="text-[15px] leading-relaxed text-ink-2">{c.description}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <JoinButton community={c} />
          {c.joined && (
            <Button
              size="sm"
              variant="secondary"
              icon={alertsOn ? <Bell size={16} /> : <BellOff size={16} />}
              onClick={async () => {
                try {
                  await api.setCommunityAlerts(c.id, !alertsOn);
                  setAlerts(!alertsOn);
                } catch (e) {
                  toast(errorMessage(e, t), 'error');
                }
              }}
            >
              {alertsOn ? t('community.alertsOn') : t('community.alertsOff')}
            </Button>
          )}
          <MoreMenu targetType="community" targetId={c.id} />
        </div>
        {c.rules && (
          <details className="mt-4 rounded-2xl bg-white p-4 lip-card">
            <summary className="cursor-pointer text-[14px] font-bold">{t('community.rules')}</summary>
            <p className="mt-2 text-[14px] leading-relaxed whitespace-pre-line text-ink-2">{c.rules}</p>
          </details>
        )}

        {/* COM-05: the welcome thread */}
        <section className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <Eyebrow>{t('community.welcomeThread')}</Eyebrow>
            {c.joined && (
              <Link to="/community/new" search={{ kind: 'welcome', community: c.id }} className="text-[13px] font-bold text-brand">
                {t('community.sayHello')}
              </Link>
            )}
          </div>
          {c.welcome.length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-[14px] text-ink-2 lip-card">{t('community.noWelcomes')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {c.welcome.slice(0, 6).map((p) => (
                <li key={p.id} className="flex gap-2.5 rounded-2xl bg-white p-3 lip-card">
                  <AskerAvatar asker={p.author} size={34} />
                  <p className="min-w-0 flex-1 text-[14px]">
                    <strong>{askerName(p.author, t('problem.anonymous'))}</strong> <span className="text-muted">· {relativeTime(p.createdAt)}</span>
                    <span className="block leading-relaxed">{p.caption}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {c.sharedProblems.length > 0 && (
          <section className="mt-6">
            <Eyebrow className="mb-2">{t('community.sharedProblems')}</Eyebrow>
            <div className="flex flex-col gap-2.5">
              {c.sharedProblems.map((p) => (
                <ProblemCard key={p.id} problem={p} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <Eyebrow>{t('community.posts')}</Eyebrow>
            {c.joined && (
              <Link to="/community/new" search={{ community: c.id }} className="text-[13px] font-bold text-brand">
                {t('community.newPost')}
              </Link>
            )}
          </div>
          {c.posts.length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-[14px] text-ink-2 lip-card">{t('community.noPosts')}</p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {c.posts.map((p) => (
                <PostCard key={p.id} post={p} onComments={() => setCommentsFor(p.id)} />
              ))}
            </div>
          )}
        </section>
      </div>
      <CommentsSheet postId={commentsFor} onClose={() => setCommentsFor(null)} />
    </div>
  );
}

const TYPES = ['district', 'language_culture', 'students', 'civic_environment', 'interest'] as const;

function RequestCommunitySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('interest');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('community.requestTitle')}
      description={t('community.requestBody')}
      footer={
        <Button
          size="lg"
          block
          loading={busy}
          disabled={name.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            try {
              await api.requestCommunity(name.trim(), type, reason.trim() || null);
              toast(t('community.requestSent'));
              onOpenChange(false);
            } catch (e) {
              toast(errorMessage(e, t), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('community.requestSend')}
        </Button>
      }
    >
      <TextField label={t('community.requestName')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <div className="mt-4 flex flex-col gap-2">
        {TYPES.map((ty) => (
          <ChoiceCard key={ty} selected={type === ty} onSelect={() => setType(ty)} title={t(`community.types.${ty}`)} />
        ))}
      </div>
      <TextArea className="mt-4" label={t('community.requestWhy')} value={reason} maxLength={1000} rows={3} onChange={(e) => setReason(e.target.value)} />
    </Sheet>
  );
}

