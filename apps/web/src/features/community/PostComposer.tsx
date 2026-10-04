import { useState } from 'react';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import { ArrowLeft, Heart, Images, PartyPopper } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LIMITS } from '@helpin/config';
import { useCommunities, useCreatePost, useProblem } from '../../api/hooks';
import { PhotoGrid, usePhotoUploads } from '../../components/domain/media';
import { Button, IconButton } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { TextArea } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';

type Kind = 'photo' | 'thank_you' | 'welcome';

/**
 * Create a feed post (F-01), a thank-you for a solved problem (F-06) or a hello in a
 * community's welcome thread (COM-05). Feed photos never mix with problem photos (F-03).
 */
export function PostComposer({ kind, problemId, communityId: initialCommunity }: { kind: Kind; problemId?: string; communityId?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const navigate = useNavigate();
  const create = useCreatePost();
  const communities = useCommunities();
  const photos = usePhotoUploads('post_photo', kind === 'thank_you' ? 1 : LIMITS.postPhotos);
  const [caption, setCaption] = useState('');
  const [communityId, setCommunityId] = useState<string | null>(initialCommunity ?? null);
  const problem = useProblem(problemId ?? '');
  const joined = communities.data?.filter((c) => c.joined) ?? [];

  const canPost =
    !photos.uploading && (kind === 'photo' ? photos.mediaIds.length > 0 : caption.trim().length > 0) && (kind !== 'thank_you' || !!problemId) && (kind !== 'welcome' || !!communityId);

  async function submit() {
    try {
      await create.mutateAsync({ kind, caption: caption.trim() || null, mediaIds: photos.mediaIds, communityId, problemId: kind === 'thank_you' ? problemId! : null });
      toast(kind === 'thank_you' ? t('composer.thanksPosted') : t('composer.posted'));
      const slug = joined.find((c) => c.id === communityId)?.slug;
      if (kind === 'welcome' && slug) void navigate({ to: '/community/c/$slug', params: { slug } });
      else void navigate({ to: '/community' });
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    }
  }

  const Icon = kind === 'thank_you' ? Heart : kind === 'welcome' ? PartyPopper : Images;

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-paper">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 bg-paper/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur">
        <IconButton label={t('common.back')} onClick={() => router.history.back()}>
          <ArrowLeft size={22} />
        </IconButton>
        <span className="flex-1 text-[16px] font-bold">{t(`composer.title.${kind}`)}</span>
      </header>
      <main className="flex-1 px-5 pt-3 pb-32">
        <div className="mb-5 flex items-center gap-3">
          <span className={cn('hex flex h-14 w-12 items-center justify-center', kind === 'thank_you' ? 'bg-tram text-tram-ink' : 'bg-brand-tint text-brand')}>
            <Icon size={24} />
          </span>
          <p className="text-[15px] text-ink-2">{t(`composer.hint.${kind}`)}</p>
        </div>

        {kind === 'thank_you' && problem.data && (
          <p className="mb-4 rounded-2xl bg-white p-3.5 text-[14px] lip-card">
            {t('composer.forProblem')} <strong>{problem.data.title}</strong>
            {problem.data.creditedHelperNames.length > 0 && <span className="mt-1 block text-[13px] text-ink-2">{t('composer.tagNote', { names: problem.data.creditedHelperNames.join(', ') })}</span>}
          </p>
        )}

        <TextArea
          label={kind === 'photo' ? t('composer.caption') : t('composer.message')}
          placeholder={t(`composer.placeholder.${kind}`)}
          value={caption}
          maxLength={LIMITS.caption}
          rows={4}
          onChange={(e) => setCaption(e.target.value)}
        />

        <p className="mt-5 mb-2 text-[13px] font-bold">{kind === 'photo' ? t('composer.photos') : t('composer.photoOptional')}</p>
        <PhotoGrid uploads={photos} />
        <p className="mt-2 text-[12px] text-muted">{t('composer.photoPrivacy')}</p>

        {kind !== 'thank_you' && joined.length > 0 && (
          <>
            <p className="mt-5 mb-2 text-[13px] font-bold">{t('composer.shareTo')}</p>
            <div className="flex flex-wrap gap-2">
              {kind === 'photo' && (
                <button
                  type="button"
                  aria-pressed={!communityId}
                  onClick={() => setCommunityId(null)}
                  className={cn('h-9 rounded-full px-3.5 text-[13px]', !communityId ? 'bg-ink font-bold text-white' : 'border-[1.5px] border-line-strong bg-white font-semibold')}
                >
                  {t('composer.myArea')}
                </button>
              )}
              {joined.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={communityId === c.id}
                  onClick={() => setCommunityId(c.id)}
                  className={cn('h-9 rounded-full px-3.5 text-[13px]', communityId === c.id ? 'bg-ink font-bold text-white' : 'border-[1.5px] border-line-strong bg-white font-semibold')}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </>
        )}
        {kind === 'welcome' && !joined.length && (
          <p className="mt-4 text-[14px] text-ink-2">
            {t('composer.joinFirst')}{' '}
            <Link to="/community/communities" className="font-bold text-brand">
              {t('community.communities')}
            </Link>
          </p>
        )}
        <p className="mt-6 text-[12px] leading-relaxed text-muted">{t('composer.rules')}</p>
      </main>
      <footer className="fixed inset-x-0 bottom-0 border-t border-line bg-white/95 px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] backdrop-blur md:left-[248px]">
        <div className="mx-auto max-w-xl">
          <Button size="lg" variant={kind === 'thank_you' ? 'tram' : 'primary'} block disabled={!canPost} loading={create.isPending} onClick={() => void submit()}>
            {t(`composer.submit.${kind}`)}
          </Button>
        </div>
      </footer>
    </div>
  );
}
