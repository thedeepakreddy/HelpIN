import { useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MediaRef } from '@helpin/contracts';
import { api, type MediaPurpose } from '../../api';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { useToast } from '../ui/Toast';

/** A processed photo (always EXIF-free and served through a short-lived link). */
export function Photo({ media, alt, className, size = 'url' }: { media: MediaRef; alt: string; className?: string; size?: 'url' | 'thumbUrl' | 'fullUrl' }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={media[size]}
      alt={alt}
      loading="lazy"
      decoding="async"
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      onLoad={() => setLoaded(true)}
      className={cn('bg-line object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0', className)}
    />
  );
}

export interface PickedPhoto {
  key: string;
  preview: string;
  mediaId: string | null;
  failed: boolean;
}

/**
 * Picks photos and uploads each one right away, so posting is instant later. The preview is a
 * local object URL; what other people see is the server's cleaned copy.
 */
export function usePhotoUploads(purpose: MediaPurpose, max: number) {
  const { t } = useTranslation();
  const toast = useToast();
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);

  async function add(files: FileList | File[]) {
    const list = [...files].slice(0, Math.max(0, max - photos.length));
    const fresh = list.map((f) => ({ key: `${f.name}-${f.size}-${Math.random()}`, preview: URL.createObjectURL(f), mediaId: null, failed: false, file: f }));
    setPhotos((p) => [...p, ...fresh.map(({ file: _file, ...rest }) => rest)]);
    await Promise.all(
      fresh.map(async (p) => {
        try {
          const status = await api.uploadPhoto(p.file, purpose);
          setPhotos((all) => all.map((x) => (x.key === p.key ? { ...x, mediaId: status.id } : x)));
        } catch (e) {
          setPhotos((all) => all.map((x) => (x.key === p.key ? { ...x, failed: true } : x)));
          toast(errorMessage(e, t), 'error');
        }
      }),
    );
  }

  function remove(key: string) {
    setPhotos((all) => {
      const gone = all.find((p) => p.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return all.filter((p) => p.key !== key);
    });
  }

  const uploading = photos.some((p) => !p.mediaId && !p.failed);
  const mediaIds = photos.filter((p) => p.mediaId).map((p) => p.mediaId!);
  const reset = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
  };
  return { photos, add, remove, uploading, mediaIds, reset, full: photos.length >= max };
}

export function PhotoGrid({ uploads, label, columns = 3 }: { uploads: ReturnType<typeof usePhotoUploads>; label?: string; columns?: 3 | 4 }) {
  const { t } = useTranslation();
  return (
    <div className={cn('grid gap-2.5', columns === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
      {uploads.photos.map((p, i) => (
        <div key={p.key} className="relative aspect-square overflow-hidden rounded-2xl bg-line">
          <img src={p.preview} alt={t('create.photos.alt', { n: i + 1 })} className={cn('size-full object-cover', (!p.mediaId || p.failed) && 'opacity-60')} />
          {!p.mediaId && !p.failed && (
            <span className="absolute inset-0 flex items-center justify-center bg-ink/20 text-white">
              <Loader2 className="size-6 animate-spin" />
            </span>
          )}
          {p.failed && <span className="absolute inset-x-0 bottom-0 bg-coral px-2 py-1 text-center text-[11px] font-bold text-white">{t('media.failed')}</span>}
          <button
            type="button"
            aria-label={t('create.photos.remove')}
            onClick={() => uploads.remove(p.key)}
            className="absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full bg-ink/70 text-white"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {!uploads.full && (
        <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line-strong bg-white text-center text-[13px] font-bold text-ink-2 hover:border-brand hover:text-brand">
          <ImagePlus size={24} />
          {label ?? t('create.photos.add')}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) void uploads.add(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
}
