import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUp, ChevronRight, EyeOff, ImagePlus, Loader2, Lock, MapPin, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LIMITS } from '@helpin/config';
import type { Conversation, Message } from '@helpin/contracts';
import { api, ApiError } from '../../api';
import { qk, useConversation, useConversations, useMe, useRevealIdentity, useSendMessage, useShareLocation } from '../../api/hooks';
import { Photo } from '../../components/domain/media';
import { MoreMenu } from '../../components/domain/SafetySheets';
import { Hexie } from '../../components/domain/Hexies';
import { AskerAvatar, askerName } from '../../components/domain/problem';
import { Button, buttonClass } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { EmptyState, Skeleton } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { clockTime, relativeTime } from '../../lib/time';

/* ------------------------------------------------------------------ List */

export function ChatListScreen() {
  const { t } = useTranslation();
  const list = useConversations();
  return (
    <div className="mx-auto max-w-2xl px-4 pt-[max(16px,env(safe-area-inset-top))] pb-6">
      <h1 className="px-1 pt-1 pb-4 font-display text-[28px] font-extrabold tracking-tight">{t('chat.title')}</h1>
      {list.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[76px]" />
          ))}
        </div>
      ) : !list.data?.length ? (
        <EmptyState
          art={<Hexie mood="sleepy" color="sapphire" />}
          title={t('chat.emptyTitle')}
          body={t('chat.emptyBody')}
          action={
            <Link to="/problems" search={{ view: 'map' }} className={buttonClass('primary')}>
              {t('chat.findSomeone')}
            </Link>
          }
        />
      ) : (
        <ul className="overflow-hidden rounded-[20px] bg-white lip-card">
          {list.data.map((c) => (
            <li key={c.id} className="border-b border-line last:border-0">
              <ConversationRow conversation={c} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-muted">
        <Lock size={14} className="mt-0.5 shrink-0" />
        {t('chat.privacy')}
      </p>
    </div>
  );
}

function ConversationRow({ conversation: c }: { conversation: Conversation }) {
  const { t } = useTranslation();
  return (
    <Link to="/chat/$conversationId" params={{ conversationId: c.id }} className="flex items-center gap-3 px-4 py-3.5 text-ink no-underline hover:bg-paper">
      <AskerAvatar asker={c.other} size={46} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-[15px]', c.unread ? 'font-extrabold' : 'font-bold')}>{askerName(c.other, t('problem.anonymous'))}</span>
          <span className={cn('shrink-0 text-[12px]', c.unread ? 'font-bold text-brand' : 'text-muted')}>{relativeTime(c.lastAt)}</span>
        </div>
        <p className="truncate text-[12px] font-semibold text-brand-ink">{c.problemTitle}</p>
        <div className="flex items-center gap-2">
          <p className={cn('min-w-0 flex-1 truncate text-[14px]', c.unread ? 'font-semibold text-ink' : 'text-ink-2')}>
            {c.readOnly ? t('chat.readOnly') : (c.lastMessage ?? t('chat.sayHello'))}
          </p>
          {c.unread > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-coral px-1.5 text-[11px] font-extrabold text-white">{c.unread}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ Conversation */

export function ConversationScreen({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const query = useConversation(conversationId);
  const send = useSendMessage(conversationId);
  const share = useShareLocation(conversationId);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const reveal = useRevealIdentity(conversationId);
  const [uploading, setUploading] = useState(false);
  const count = query.data?.messages.length ?? 0;
  const lastId = query.data?.messages[count - 1]?.id;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  // Opening the chat marks it read.
  useEffect(() => {
    if (lastId) void api.markConversationRead(conversationId).then(() => qc.invalidateQueries({ queryKey: qk.conversations }));
  }, [lastId, conversationId, qc]);

  /** L-04: the saved private spot if there is one, otherwise the device's current position. */
  function shareExact() {
    const onError = (e: unknown) => toast(errorMessage(e, t), 'error');
    share.mutate(null, {
      onSuccess: () => toast(t('chat.locationShared')),
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'NO_PRIVATE_LOCATION' && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => share.mutate({ lat: pos.coords.latitude, lng: pos.coords.longitude }, { onSuccess: () => toast(t('chat.locationShared')), onError }),
            () => toast(t('create.location.noGps'), 'error'),
          );
        } else onError(e);
      },
    });
  }

  async function sendPhoto(file: File) {
    setUploading(true);
    try {
      const media = await api.uploadPhoto(file, 'chat_image');
      await send.mutateAsync({ mediaId: media.id });
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    } finally {
      setUploading(false);
    }
  }

  if (query.isPending) return <Skeleton className="m-4 h-40" />;
  if (!query.data) {
    return <EmptyState art={<Hexie mood="sad" />} title={t('chat.notFound')} action={<Link to="/chat" className={buttonClass('primary')}>{t('chat.title')}</Link>} />;
  }

  const { conversation: c, messages } = query.data;
  const other = askerName(c.other, t('problem.anonymous'));

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    send.mutate({ body }, { onSuccess: () => setText(''), onError: (err) => toast(errorMessage(err, t), 'error') });
  }

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col bg-paper md:border-x md:border-line">
      <header className="shrink-0 border-b border-line bg-white px-2 pt-[max(8px,env(safe-area-inset-top))] pb-2.5">
        <div className="flex items-center gap-1.5">
          <Link to="/chat" aria-label={t('common.back')} className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-black/5">
            <ArrowLeft size={22} />
          </Link>
          <AskerAvatar asker={c.other} size={40} />
          <div className="ml-1 min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold">{other}</p>
            <p className="truncate text-[12px] text-ink-2">{c.viewerIsAsker ? t('chat.helper') : t('chat.asker')}</p>
          </div>
          <MoreMenu targetType={c.other.anonymous ? "problem" : "user"} targetId={c.other.anonymous ? c.problemId : c.other.user.id} block={{ conversationId: c.id, name: other }} />
        </div>
        <Link
          to="/p/$problemId"
          params={{ problemId: c.problemId }}
          className="mx-2 mt-2 flex items-center gap-2 rounded-xl bg-paper px-3 py-2 text-ink no-underline"
        >
          <span aria-hidden className="hex h-[26px] w-6 shrink-0 bg-brand-tint" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c.problemTitle}</span>
          <ChevronRight size={16} className="text-muted" />
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-2">
        <div className="mb-3 flex gap-2 rounded-2xl bg-sapphire-tint p-3 text-[13px] leading-relaxed text-sapphire-ink">
          <ShieldAlert size={17} className="mt-0.5 shrink-0" />
          {t('chat.safety')}
        </div>
        {c.viewerIsAsker && c.askerAnonymous && !c.identityRevealed && !c.readOnly && (
          <div className="mb-3 flex items-center gap-3 rounded-2xl bg-white p-3 lip-card">
            <EyeOff size={18} className="shrink-0 text-sapphire" />
            <p className="min-w-0 flex-1 text-[13px] text-ink-2">{t('chat.anonymousHint')}</p>
            <Button size="sm" variant="secondary" loading={reveal.isPending} onClick={() => reveal.mutate(undefined, { onError: (e) => toast(errorMessage(e, t), 'error') })}>
              {t('chat.reveal')}
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {messages.map((m) => (
            <Bubble key={m.id} message={m} mine={m.senderId === me.data?.id} />
          ))}
        </div>
        <div ref={bottom} />
      </div>

      {c.readOnly ? (
        <p className="shrink-0 border-t border-line bg-white px-4 py-4 text-center text-[14px] text-ink-2">{t('chat.readOnly')}</p>
      ) : (
        <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-line bg-white px-3 pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))]">
          {c.viewerIsAsker && (
            <button
              type="button"
              aria-label={t('chat.shareLocation')}
              title={t('chat.shareLocation')}
              onClick={() => shareExact()}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-paper text-ink-2 hover:text-brand"
            >
              <MapPin size={20} />
            </button>
          )}
          <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-paper text-ink-2 hover:text-brand" title={t('chat.sendPhoto')}>
            {uploading ? <Loader2 size={19} className="animate-spin" /> : <ImagePlus size={20} />}
            <span className="sr-only">{t('chat.sendPhoto')}</span>
            <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={(e) => e.target.files?.[0] && void sendPhoto(e.target.files[0])} />
          </label>
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t('chat.message')}</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={LIMITS.message}
              placeholder={t('chat.placeholder', { name: other.split(' ')[0] })}
              className="h-11 w-full rounded-full border-[1.5px] border-line bg-[#F9FAF7] px-4 text-[15px] focus:border-brand focus:bg-white focus:outline-none"
            />
          </label>
          <button
            type="submit"
            aria-label={t('chat.send')}
            disabled={!text.trim() || send.isPending}
            className="press lip-brand flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:bg-line disabled:text-muted disabled:shadow-none"
          >
            <ArrowUp size={21} strokeWidth={2.6} />
          </button>
        </form>
      )}
    </div>
  );
}

function Bubble({ message: m, mine }: { message: Message; mine: boolean }) {
  const { t } = useTranslation();
  if (m.type === 'system') {
    return <p className="self-center rounded-full bg-[#E7EAE2] px-3 py-1.5 text-center text-[12px] font-semibold text-ink-2">{m.body}</p>;
  }
  if (m.type === 'image' && m.media) {
    return (
      <a href={m.media.fullUrl} target="_blank" rel="noreferrer" className={cn('w-[220px] overflow-hidden rounded-[18px] bg-white lip-card', mine ? 'self-end' : 'self-start')}>
        <Photo media={m.media} alt={t('chat.photo')} className="h-[220px] w-full" />
        <span className="block px-3 py-1.5 text-right text-[11px] text-muted">{clockTime(m.createdAt)}</span>
      </a>
    );
  }
  if (m.type === 'location' && m.location) {
    const { lat, lng } = m.location;
    return (
      <a
        href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`}
        target="_blank"
        rel="noreferrer"
        className={cn('w-[220px] overflow-hidden rounded-[18px] bg-white text-ink no-underline lip-card', mine ? 'self-end' : 'self-start')}
      >
        <svg viewBox="0 0 220 96" className="block h-24 w-full" aria-hidden>
          <rect width="220" height="96" fill="#ECEEE6" />
          <path d="M0,70 L220,30" stroke="#fff" strokeWidth="8" />
          <path d="M70,0 L100,96" stroke="#fff" strokeWidth="5" />
          <path d="M110,58 C110,58 98,45 98,37 a12,12 0 0 1 24,0 C122,45 110,58 110,58 Z" fill="#0E1A14" />
          <circle cx="110" cy="37" r="4.5" fill="#FFC531" />
        </svg>
        <span className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-bold">
          <MapPin size={14} className="text-brand" />
          {t('chat.exactLocation')}
          <span className="ml-auto text-[11px] font-normal text-muted">{clockTime(m.createdAt)}</span>
        </span>
      </a>
    );
  }
  return (
    <div
      className={cn(
        'max-w-[80%] px-3.5 py-2.5',
        mine ? 'self-end rounded-[18px_18px_6px_18px] bg-brand text-white' : 'self-start rounded-[18px_18px_18px_6px] bg-white text-ink lip-card',
      )}
    >
      <p className="text-[15px] leading-snug whitespace-pre-line">{m.body}</p>
      <p className={cn('mt-1 text-right text-[11px]', mine ? 'text-white/70' : 'text-muted')}>{clockTime(m.createdAt)}</p>
    </div>
  );
}
