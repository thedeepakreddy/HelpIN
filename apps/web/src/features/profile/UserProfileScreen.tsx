import { useState } from 'react';
import { Link, useRouter } from '@tanstack/react-router';
import { ArrowLeft, CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMe, useSolverHistory, useUser, useUserPosts, useUserProblemPhotos } from '../../api/hooks';
import { Hexie } from '../../components/domain/Hexies';
import { CategoryHex } from '../../components/domain/problem';
import { MoreMenu } from '../../components/domain/SafetySheets';
import { IconButton, buttonClass } from '../../components/ui/Button';
import { EmptyState, Skeleton } from '../../components/ui/primitives';
import { relativeTime } from '../../lib/time';
import { PhotoTiles, PostsGrid, ProfileHeader, ProfileTabs, VerifiedHex, handleOf, type ProfileTab } from './ProfileScreen';

/** Someone else's profile (F-04: Posts · Solved history · Problem photos; A-04 applies). */
export function UserProfileScreen({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const me = useMe();
  const profile = useUser(userId);
  const [tab, setTab] = useState<ProfileTab>('posts');
  const posts = useUserPosts(userId);
  const photos = useUserProblemPhotos(tab === 'problems' ? userId : undefined);
  const history = useSolverHistory(tab === 'helped' ? userId : undefined);

  if (me.data?.id === userId) {
    return (
      <div className="p-6 text-center">
        <Link to="/profile" className={buttonClass('primary')}>
          {t('profile.openMine')}
        </Link>
      </div>
    );
  }
  if (profile.isPending) return <Skeleton className="m-4 h-72" />;
  if (!profile.data) return <EmptyState art={<Hexie mood="sad" />} title={t('profile.notFound')} />;
  const { user, bio, memberSince, postsCount } = profile.data;

  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-white pb-6 md:my-6 md:min-h-0 md:rounded-[28px] md:lip-card">
      <header className="flex items-center justify-between pt-[max(12px,env(safe-area-inset-top))] pr-2.5 pb-1 pl-1.5">
        <div className="flex items-center gap-1">
          <IconButton label={t('common.back')} onClick={() => router.history.back()}>
            <ArrowLeft size={22} />
          </IconButton>
          <span className="font-display text-[21px] font-extrabold tracking-tight">{handleOf(user.displayName)}</span>
          {user.verified && <VerifiedHex label={t('profile.verified')} />}
        </div>
        <MoreMenu targetType="user" targetId={user.id} block={{ userId: user.id, name: user.displayName }} onBlocked={() => router.history.back()} />
      </header>
      <ProfileHeader user={user} bio={bio} memberSince={memberSince} postsCount={postsCount} actions={null} />
      <ProfileTabs tab={tab} onTab={setTab} labels={{ posts: t('profile.tabs.posts'), helped: t('profile.tabs.solved'), problems: t('profile.tabs.problemPhotos') }} />
      {tab === 'posts' && <PostsGrid posts={posts.data} loading={posts.isPending} />}
      {tab === 'problems' &&
        (photos.isPending ? <Skeleton className="m-1 h-40" /> : <PhotoTiles items={(photos.data ?? []).map((p) => ({ key: p.photo.id, photo: p.photo, problemId: p.problemId, status: p.status }))} />)}
      {tab === 'helped' &&
        (history.isPending ? (
          <Skeleton className="m-4 h-40" />
        ) : !history.data?.length ? (
          <EmptyState art={<Hexie mood="neutral" color="mint" />} title={t('profile.noSolved')} />
        ) : (
          <ul className="flex flex-col gap-2 px-3.5 pt-2.5">
            {history.data.map((h) => (
              <li key={h.problemId}>
                <Link to="/p/$problemId" params={{ problemId: h.problemId }} className="flex items-center gap-3 rounded-2xl bg-paper px-3 py-2.5 text-ink no-underline">
                  <CategoryHex categoryId={h.categoryId} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{h.title}</span>
                    <span className="block text-[12px] text-ink-2">
                      {h.askerName ? t('profile.helpedWho', { name: h.askerName }) : t('profile.helpedAnon')} · {relativeTime(h.solvedAt)}
                    </span>
                  </span>
                  <CircleCheck size={18} className="text-brand" />
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
