import { useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { ArrowLeft, Bell, CircleCheck, Clock, HandHeart, MapPin, MessageCircle, PenLine, ShieldAlert, Star, Users, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppNotification } from '@helpin/contracts';
import { api } from '../../api';
import { useMarkAllRead, useNotifications, useStillNeedHelp } from '../../api/hooks';
import { Sheet } from '../../components/ui/Sheet';
import { Hexie } from '../../components/domain/Hexies';
import { Button, IconButton } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { EmptyState, Eyebrow, HexTile, Skeleton, TextArea } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { relativeTime } from '../../lib/time';

const TYPE: Record<AppNotification['type'], { icon: LucideIcon; color: string }> = {
  response_due: { icon: Clock, color: 'amber' },
  solve_claimed: { icon: CircleCheck, color: 'brand' },
  karma: { icon: Star, color: 'tram' },
  nearby_problem: { icon: MapPin, color: 'sapphire' },
  offer_received: { icon: HandHeart, color: 'brand' },
  offer_accepted: { icon: HandHeart, color: 'brand' },
  problem_updated: { icon: PenLine, color: 'sapphire' },
  community: { icon: Users, color: 'mint' },
  message: { icon: MessageCircle, color: 'sapphire' },
  offer_declined: { icon: HandHeart, color: 'tram' },
  problem_closed: { icon: CircleCheck, color: 'brand' },
  penalty: { icon: Clock, color: 'coral' },
  tag_request: { icon: Star, color: 'tram' },
  comment: { icon: MessageCircle, color: 'brand' },
  content_removed: { icon: ShieldAlert, color: 'coral' },
  system: { icon: Bell, color: 'sapphire' },
};

const DAY = 24 * 3_600_000;

export function NotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const query = useNotifications();
  const markAll = useMarkAllRead();
  const [now] = useState(() => Date.now());
  const list = query.data ?? [];
  const today = list.filter((n) => now - new Date(n.createdAt).getTime() < DAY);
  const earlier = list.filter((n) => !today.includes(n));
  const unread = list.some((n) => !n.read);

  // Opening the screen counts as seeing them, but keep the dots visible on this visit.
  useEffect(() => {
    return () => {
      if (unread) markAll.mutate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on leave
  }, [unread]);

  return (
    <div className="mx-auto max-w-xl px-4 pt-[max(12px,env(safe-area-inset-top))] pb-6">
      <header className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-1">
          <IconButton label={t('common.back')} className="-ml-2 md:hidden" onClick={() => router.history.back()}>
            <ArrowLeft size={22} />
          </IconButton>
          <h1 className="font-display text-[28px] font-extrabold tracking-tight">{t('notifications.title')}</h1>
        </div>
        {unread && (
          <button type="button" onClick={() => markAll.mutate()} className="px-1 text-[14px] font-bold text-brand">
            {t('notifications.markAll')}
          </button>
        )}
      </header>

      {query.isPending ? (
        <Skeleton className="h-60" />
      ) : list.length === 0 ? (
        <EmptyState art={<Hexie mood="sleepy" />} title={t('notifications.emptyTitle')} body={t('notifications.emptyBody')} />
      ) : (
        <>
          {today.length > 0 && <Group title={t('notifications.today')} items={today} />}
          {earlier.length > 0 && <Group title={t('notifications.earlier')} items={earlier} />}
        </>
      )}
    </div>
  );
}

function Group({ title, items }: { title: string; items: AppNotification[] }) {
  return (
    <section className="mt-3">
      <Eyebrow className="mb-2 px-1">{title}</Eyebrow>
      <div className="flex flex-col gap-2">
        {items.map((n) => (
          <NotificationCard key={n.id} n={n} />
        ))}
      </div>
    </section>
  );
}

function NotificationCard({ n }: { n: AppNotification }) {
  const { t } = useTranslation();
  const router = useRouter();
  const kind = TYPE[n.type] ?? { icon: Bell, color: 'brand' };
  const open = () => void router.navigate({ href: n.link });
  return (
    <article
      className={cn('flex cursor-pointer gap-3 rounded-[18px] p-3.5 transition-colors', n.read ? 'bg-white/60' : 'bg-white lip-card')}
      onClick={open}
    >
      <HexTile color={kind.color} size={40}>
        <kind.icon size={19} strokeWidth={2.2} />
      </HexTile>
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2">
          <a
            href={n.link}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              open();
            }}
            className={cn('text-[15px] leading-snug text-ink no-underline', n.read ? 'font-semibold' : 'font-extrabold')}
          >
            {n.title}
          </a>
          {!n.read && <span aria-label={t('notifications.unread')} className="mt-1.5 size-2.5 shrink-0 rounded-full bg-coral" />}
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-2">
          {n.body} · {relativeTime(n.createdAt)}
        </p>
        {n.type === 'response_due' && n.problemId && <ResponseActions problemId={n.problemId} onOpen={open} />}
        {n.type === 'content_removed' && n.moderationActionId !== null && <AppealAction actionId={n.moderationActionId} />}
        {n.type === 'solve_claimed' && (
          <Button size="sm" className="mt-2.5" onClick={(e) => (e.stopPropagation(), open())}>
            {t('actions.confirmSolved')}
          </Button>
        )}
      </div>
    </article>
  );
}

/** S-09 / DSA: every decision can be appealed once. */
function AppealAction({ actionId }: { actionId: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="secondary" className="mt-2.5" onClick={() => setOpen(true)}>
        {t('appeal.cta')}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t('appeal.title')}
        description={t('appeal.body')}
        footer={
          <Button
            size="lg"
            block
            loading={busy}
            disabled={!text.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.appeal(actionId, text.trim());
                toast(t('appeal.sent'));
                setOpen(false);
              } catch (e) {
                toast(errorMessage(e, t), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('appeal.send')}
          </Button>
        }
      >
        <TextArea label={t('appeal.label')} value={text} maxLength={2000} rows={5} onChange={(e) => setText(e.target.value)} />
      </Sheet>
    </div>
  );
}

function ResponseActions({ problemId, onOpen }: { problemId: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const still = useStillNeedHelp(problemId);
  return (
    <div className="mt-2.5 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        loading={still.isPending}
        onClick={() => still.mutate(undefined, { onSuccess: () => toast(t('response.thanks')), onError: (e) => toast(errorMessage(e, t), 'error') })}
      >
        {t('progress.still_need_help')}
      </Button>
      <Button size="sm" variant="secondary" onClick={onOpen}>
        {t('notifications.itsSolved')}
      </Button>
    </div>
  );
}
