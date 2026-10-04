import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import {
  ArrowLeft,
  Camera,
  CircleCheck,
  Clock,
  Ellipsis,
  Flag,
  HandHeart,
  Lock,
  MessageCircle,
  PenLine,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FIXED_QUORUM, findCategory, languageName } from '@helpin/config';
import type { Offer, ProblemDetail } from '@helpin/contracts';
import { distanceLabel, distanceMeters } from '@helpin/geo';
import {
  useAcceptOffer,
  useClaimSolved,
  useDeclineOffer,
  useFixedNow,
  useProblem,
  useSameHere,
  useStillNeedHelp,
  useWithdrawOffer,
} from '../../api/hooks';
import { Hexie } from '../../components/domain/Hexies';
import {
  AskerAvatar,
  KindBadge,
  LanguageBadge,
  ProgressChip,
  StatusBadge,
  UrgencyBadge,
  CategoryIcon,
  categoryTone,
} from '../../components/domain/problem';
import { Button, IconButton, buttonClass } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { Card, Chip, EmptyState, HexAvatar, Skeleton } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { hoursLeft, relativeTime } from '../../lib/time';
import { tone } from '../../lib/tones';
import { DEFAULT_VIEW } from './mapStyle';
import { ConfirmSolvedSheet, OfferSheet, UpdateSheet, WithdrawSheet } from './ProblemSheets';

type SheetName = 'offer' | 'update' | 'solved' | 'withdraw' | null;

export function ProblemScreen({ problemId }: { problemId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const query = useProblem(problemId);
  const [sheet, setSheet] = useState<SheetName>(null);
  const back = () => (window.history.length > 1 ? router.history.back() : void router.navigate({ to: '/problems', search: { view: 'map' } }));

  if (query.isPending) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <Skeleton className="h-48" />
        <Skeleton className="mt-4 h-8 w-3/4" />
        <Skeleton className="mt-3 h-24" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <EmptyState
        art={<Hexie mood="sad" />}
        title={t('problem.notFound')}
        body={t('problem.notFoundBody')}
        action={
          <Link to="/problems" search={{ view: 'map' }} className={buttonClass('primary')}>
            {t('problem.backToMap')}
          </Link>
        }
      />
    );
  }

  const p = query.data;
  const isAsker = p.viewerRole === 'asker';
  const sheetProps = (name: Exclude<SheetName, null>) => ({ problem: p, open: sheet === name, onOpenChange: (o: boolean) => setSheet(o ? name : null) });

  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-white pb-28 md:my-6 md:min-h-0 md:overflow-hidden md:rounded-[28px] md:lip-card">
      <Hero problem={p} onBack={back} onMore={isAsker && p.status === 'open' ? () => setSheet('withdraw') : undefined} />

      <div className="px-5 pt-4">
        {isAsker && p.responseDueAt && <ResponseBanner problem={p} />}
        <Header problem={p} />
        {p.status !== 'open' && <ClosedBanner problem={p} />}
        <LatestUpdate problem={p} />

        {isAsker ? <OffersList problem={p} /> : <AskerRow problem={p} />}

        <h2 className="mt-6 font-display text-[19px] font-bold">{t('problem.details')}</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed whitespace-pre-line text-ink-2">{p.description || t('problem.noDescription')}</p>

        {findCategory(p.categoryId).category.paperworkTips && (
          <div className="mt-4 flex gap-2.5 rounded-2xl bg-tram-tint p-3.5 text-[13px] leading-relaxed text-tram-ink">
            <ShieldCheck size={18} className="mt-0.5 shrink-0" />
            <span>
              <strong>{t('problem.freeTitle')}</strong> {t('problem.freeBody')}
            </span>
          </div>
        )}

        <AreaPreview problem={p} />
        <Stats problem={p} />
        <Timeline problem={p} />
      </div>

      <ActionBar problem={p} onSheet={setSheet} />

      <OfferSheet {...sheetProps('offer')} />
      <UpdateSheet {...sheetProps('update')} />
      {isAsker && <ConfirmSolvedSheet key={p.offers.map((o) => o.id + o.status).join()} {...sheetProps('solved')} />}
      {isAsker && <WithdrawSheet {...sheetProps('withdraw')} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Sections */

function Hero({ problem: p, onBack, onMore }: { problem: ProblemDetail; onBack: () => void; onMore?: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const tn = tone(p.urgency === 'serious' ? 'coral' : categoryTone(p.categoryId));
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: p.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast(t('problem.linkCopied'));
      }
    } catch {
      /* share sheet dismissed */
    }
  }
  return (
    <div className={cn('relative h-[200px] overflow-hidden', tn.bg)}>
      <svg className="absolute inset-0 size-full" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <polygon points="330,-20 400,20 400,100 330,140 260,100 260,20" fill="#FFFFFF" opacity="0.35" />
        <polygon points="40,130 80,153 80,199 40,222 0,199 0,153" fill="#FFFFFF" opacity="0.3" />
        <polygon points="300,150 318,160 318,181 300,191 282,181 282,160" fill="#FFC531" opacity="0.9" />
      </svg>
      <div className={cn('absolute inset-0 flex items-center justify-center', tn.fg)}>
        <span className="hex flex size-24 items-center justify-center bg-white/70">
          <CategoryIcon categoryId={p.categoryId} size={44} strokeWidth={1.8} />
        </span>
      </div>
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 pt-[max(12px,env(safe-area-inset-top))]">
        <IconButton label={t('common.back')} tone="surface" onClick={onBack}>
          <ArrowLeft size={21} />
        </IconButton>
        <div className="flex gap-2">
          <IconButton label={t('problem.share')} tone="surface" onClick={() => void share()}>
            <Share2 size={19} />
          </IconButton>
          <IconButton label={onMore ? t('problem.withdraw') : t('problem.report')} tone="surface" onClick={onMore ?? (() => toast(t('problem.reported')))}>
            {onMore ? <Ellipsis size={20} /> : <Flag size={19} />}
          </IconButton>
        </div>
      </div>
      {p.photoCount > 0 && (
        <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-ink/75 px-2.5 py-1 text-[12px] font-bold text-white">
          <Camera size={14} />
          {t('problem.photos', { count: p.photoCount })}
        </span>
      )}
    </div>
  );
}

function Header({ problem: p }: { problem: ProblemDetail }) {
  const { t } = useTranslation();
  const { category, group } = findCategory(p.categoryId);
  const distance = distanceLabel(distanceMeters(DEFAULT_VIEW.center, p.area.center));
  return (
    <>
      <p className="text-[12px] font-extrabold tracking-[0.05em] text-muted uppercase">
        {group.label} · {category.label}
      </p>
      <h1 className="mt-1.5 font-display text-[26px] leading-[1.15] font-extrabold tracking-tight text-balance">{p.title}</h1>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <UrgencyBadge urgency={p.urgency} />
        {p.languageNeeded && <LanguageBadge need={p.languageNeeded} />}
        <KindBadge kind={p.kind} />
        {p.kind === 'request' && <Chip>{t('problem.personal')}</Chip>}
        {p.status !== 'open' && <StatusBadge status={p.status} />}
      </div>
      <p className="mt-3 text-[13px] text-ink-2">
        {t('problem.near', { place: p.area.locality, district: p.area.district })} · {distance}
      </p>
      <p className="mt-0.5 text-[13px] text-ink-2">
        {t('problem.posted', { when: relativeTime(p.createdAt) })} · <strong>{t('problem.updated', { when: relativeTime(p.lastActivityAt) })}</strong>
      </p>
    </>
  );
}

function AskerRow({ problem: p }: { problem: ProblemDetail }) {
  const { t } = useTranslation();
  const a = p.asker;
  const reliability = a.anonymous ? a.reliability : a.user.reliability;
  return (
    <div className="mt-5 flex items-center gap-3 rounded-2xl bg-paper p-3">
      <AskerAvatar asker={a} size={44} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-[15px] font-bold">
          {a.anonymous ? t('problem.anonymous') : a.user.displayName}
          {!a.anonymous && a.user.isNewcomer && <Chip tone="tram" size="xs">{t('problem.newcomer')}</Chip>}
        </p>
        <p className="mt-0.5 truncate text-[13px] text-ink-2">
          {!a.anonymous && t('problem.speaks', { languages: a.user.languages.map(languageName).join(', ') }) + ' · '}
          {reliability === null ? t('problem.newAsker') : t('problem.reliability', { pct: Math.round(reliability * 100) })}
        </p>
      </div>
    </div>
  );
}

function ResponseBanner({ problem: p }: { problem: ProblemDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const still = useStillNeedHelp(p.id);
  const left = hoursLeft(p.responseDueAt!);
  const waiting = p.offers.find((o) => o.status === 'offered');
  return (
    <div className="mb-4 flex gap-3 rounded-[20px] bg-amber-tint p-4">
      <span className="hex flex h-11 w-10 shrink-0 items-center justify-center bg-amber text-white">
        <Clock size={20} strokeWidth={2.4} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-amber-ink">
          {waiting ? t('response.waiting', { name: waiting.helper.displayName.split(' ')[0] }) : t('response.title')}
        </p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
          {t('response.body', { hours: left })}
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2.5"
          loading={still.isPending}
          onClick={() =>
            still.mutate(undefined, {
              onSuccess: () => toast(t('response.thanks')),
              onError: (e) => toast(errorMessage(e, t), 'error'),
            })
          }
        >
          {t('progress.still_need_help')}
        </Button>
      </div>
    </div>
  );
}

function ClosedBanner({ problem: p }: { problem: ProblemDetail }) {
  const { t } = useTranslation();
  const solved = p.status === 'solved';
  return (
    <div className={cn('mt-4 flex items-center gap-3 rounded-2xl p-3.5', solved ? 'bg-brand text-white' : 'bg-paper text-ink-2')}>
      {solved ? <CircleCheck size={22} className="shrink-0 text-tram" /> : <Lock size={20} className="shrink-0" />}
      <p className="text-[14px] font-semibold">
        {solved
          ? p.creditedHelperNames.length
            ? t('problem.solvedThanks', { names: p.creditedHelperNames.join(', ') })
            : t('problem.solvedPlain')
          : t(`problem.closed.${p.status}`)}
      </p>
    </div>
  );
}

function LatestUpdate({ problem: p }: { problem: ProblemDetail }) {
  const { t } = useTranslation();
  const latest = p.updates[0];
  if (!latest) return null;
  return (
    <div className="mt-4 rounded-2xl border-l-4 border-brand bg-brand-tint/60 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-brand-ink">
          {t('problem.latestUpdate', { when: relativeTime(latest.createdAt) })}
        </span>
        <ProgressChip status={latest.progressStatus} size="xs" />
      </div>
      {latest.body && <p className="mt-1.5 text-[15px] leading-relaxed">{latest.body}</p>}
    </div>
  );
}

function OffersList({ problem: p }: { problem: ProblemDetail }) {
  const { t } = useTranslation();
  if (p.kind === 'issue' && p.offers.length === 0) return null;
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-[19px] font-bold">{t('offers.title', { count: p.offers.length })}</h2>
        <span className="text-[12px] font-semibold text-muted">{t('offers.hint')}</span>
      </div>
      {p.offers.length === 0 ? (
        <div className="mt-2.5 flex items-center gap-3 rounded-2xl bg-paper p-4">
          <Hexie size={52} mood="sleepy" />
          <p className="text-[14px] text-ink-2">{t('offers.none')}</p>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-col gap-2.5">
          {p.offers.map((o) => (
            <OfferCard key={o.id} offer={o} open={p.status === 'open'} />
          ))}
        </div>
      )}
    </section>
  );
}

function OfferCard({ offer: o, open }: { offer: Offer; open: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const accept = useAcceptOffer();
  const decline = useDeclineOffer();
  const accepted = o.status === 'accepted' || o.status === 'credited';
  return (
    <Card className={cn('p-3.5', accepted && 'ring-2 ring-brand')}>
      <div className="flex items-center gap-3">
        <HexAvatar initials={o.helper.initials} color={o.helper.color} size={42} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-bold">
            {o.helper.displayName}
            {o.sharesLanguage && <Chip tone="sapphire" size="xs">{t('offers.sharesLanguage')}</Chip>}
          </p>
          <p className="truncate text-[12px] text-ink-2">
            {t('offers.meta', { languages: o.helper.languages.map(languageName).join(', '), count: o.helper.neighboursHelped })} ·{' '}
            {relativeTime(o.createdAt)}
          </p>
        </div>
        {accepted ? (
          <Chip tone="solidBrand" size="xs">
            {o.claimedSolved ? t('offers.saysSolved') : t('offers.accepted')}
          </Chip>
        ) : (
          <Chip tone="tram" size="xs">
            {t('offers.new')}
          </Chip>
        )}
      </div>
      {o.message && <p className="mt-2.5 text-[14px] leading-relaxed text-ink-2">“{o.message}”</p>}
      {accepted && o.conversationId ? (
        <Link to="/chat/$conversationId" params={{ conversationId: o.conversationId }} className={buttonClass('soft', 'sm', false, 'mt-3')}>
          <MessageCircle size={16} />
          {t('offers.openChat')}
        </Link>
      ) : (
        open && (
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              loading={accept.isPending}
              onClick={() =>
                accept.mutate(o.id, {
                  onSuccess: (r) => {
                    toast(t('offers.acceptedToast', { name: o.helper.displayName.split(' ')[0] }));
                    void navigate({ to: '/chat/$conversationId', params: { conversationId: r.conversationId } });
                  },
                  onError: (e) => toast(errorMessage(e, t), 'error'),
                })
              }
            >
              {t('offers.accept')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              loading={decline.isPending}
              onClick={() => decline.mutate(o.id, { onError: (e) => toast(errorMessage(e, t), 'error') })}
            >
              {t('offers.decline')}
            </Button>
          </div>
        )
      )}
    </Card>
  );
}

function AreaPreview({ problem: p }: { problem: ProblemDetail }) {
  const { t } = useTranslation();
  const color = p.urgency === 'serious' ? '#E8452C' : p.urgency === 'medium' ? '#F28C00' : '#2352E0';
  const sizeKey = p.area.areaRes === 7 ? 'wider' : p.area.areaRes === 9 ? 'exact' : 'standard';
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-line">
      <svg viewBox="0 0 350 110" className="block h-[110px] w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <rect width="350" height="110" fill="#ECEEE6" />
        <path d="M290,0 C280,40 310,80 300,110 L350,110 L350,0 Z" fill="#B9D3E3" />
        <path d="M300,20 L0,100" stroke="#FFFFFF" strokeWidth="9" fill="none" />
        <path d="M140,0 L170,110" stroke="#FFFFFF" strokeWidth="6" fill="none" />
        <path d="M30,0 L60,110" stroke="#F9F9F5" strokeWidth="3" fill="none" />
        <polygon points="160,18 192,36 192,74 160,92 128,74 128,36" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="2.5" />
        {p.area.areaRes === 9 && <circle cx="160" cy="55" r="5" fill={color} stroke="#fff" strokeWidth="2" />}
      </svg>
      <p className="flex items-center gap-2 bg-white px-3.5 py-2.5 text-[13px] text-ink-2">
        <Lock size={14} className="shrink-0 text-brand" />
        {t(`problem.area.${sizeKey}`)}
      </p>
    </div>
  );
}

function Stats({ problem: p }: { problem: ProblemDetail }) {
  const { t } = useTranslation();
  const items: { n: number; label: string }[] =
    p.kind === 'issue'
      ? [
          { n: p.affectedCount, label: t('problem.stat.affected') },
          { n: p.helpingCount, label: t('problem.stat.helping') },
          { n: p.fixedVotes, label: t('problem.stat.fixedVotes', { quorum: FIXED_QUORUM }) },
        ]
      : [
          { n: p.helpingCount, label: t('problem.stat.helping') },
          { n: p.offersCount, label: t('problem.stat.offers') },
        ];
  return (
    <div className="mt-4 flex gap-2.5">
      {items.map((s) => (
        <div key={s.label} className="flex-1 rounded-2xl bg-paper px-3 py-3 text-center">
          <div className="font-display text-[24px] leading-none font-extrabold">{s.n}</div>
          <div className="mt-1 text-[12px] font-semibold text-ink-2">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ problem: p }: { problem: ProblemDetail }) {
  const { t } = useTranslation();
  const rows: { key: string; title: ReactNode; body?: string | null; dot: string }[] = [
    ...p.updates.map((u) => ({
      key: u.id,
      title: (
        <>
          {relativeTime(u.createdAt)} · {u.authorName} ({t(`roles.${u.authorRole}`)}) · {t(`progress.${u.progressStatus}`)}
        </>
      ),
      body: u.body,
      dot: u.authorRole === 'asker' ? 'bg-brand' : u.authorRole === 'helper' ? 'bg-sapphire' : 'bg-amber',
    })),
    { key: 'posted', title: relativeTime(p.createdAt), body: t('problem.postedEvent'), dot: 'bg-line-strong' },
  ];
  return (
    <section className="mt-6">
      <h2 className="font-display text-[19px] font-bold">{t('problem.progress')}</h2>
      <ol className="mt-3">
        {rows.map((r, i) => (
          <li key={r.key} className="flex gap-3">
            <div className="flex w-3 flex-col items-center">
              <span className={cn('mt-1.5 size-3 shrink-0 rounded-full ring-4 ring-white', r.dot)} />
              {i < rows.length - 1 && <span className="w-0.5 flex-1 bg-line" />}
            </div>
            <div className="pb-4">
              <p className="text-[12px] font-semibold text-muted">{r.title}</p>
              {r.body && <p className="mt-0.5 text-[14px] leading-relaxed">{r.body}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ Actions */

function ActionBar({ problem: p, onSheet }: { problem: ProblemDetail; onSheet: (s: SheetName) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const sameHere = useSameHere(p.id);
  const fixed = useFixedNow(p.id);
  const withdrawOffer = useWithdrawOffer();
  const claim = useClaimSolved();
  const onError = (e: unknown) => toast(errorMessage(e, t), 'error');

  if (p.status !== 'open') return null;

  let content: ReactNode;
  switch (p.viewerRole) {
    case 'asker':
      content = (
        <>
          <Button variant="secondary" size="lg" className="flex-1" icon={<PenLine size={18} />} onClick={() => onSheet('update')}>
            {t('actions.postUpdate')}
          </Button>
          <Button variant="tram" size="lg" className="flex-1" icon={<CircleCheck size={19} />} onClick={() => onSheet('solved')}>
            {t('actions.confirmSolved')}
          </Button>
        </>
      );
      break;
    case 'helper_accepted': {
      const offer = p.myOffer!;
      content = (
        <>
          {offer.conversationId && (
            <Link to="/chat/$conversationId" params={{ conversationId: offer.conversationId }} className={buttonClass('secondary', 'lg', false, 'flex-1')}>
              <MessageCircle size={18} />
              {t('actions.chat')}
            </Link>
          )}
          {offer.claimedSolved ? (
            <Button size="lg" className="flex-1" variant="soft" icon={<PenLine size={18} />} onClick={() => onSheet('update')}>
              {t('actions.postUpdate')}
            </Button>
          ) : (
            <Button size="lg" className="flex-1" loading={claim.isPending} onClick={() => claim.mutate(offer.id, { onSuccess: () => toast(t('actions.claimedToast')), onError })}>
              {t('actions.markSolved')}
            </Button>
          )}
        </>
      );
      break;
    }
    case 'helper_offered':
      content = (
        <>
          <p className="flex-1 text-[14px] font-semibold text-ink-2">{t('actions.offerPending')}</p>
          <Button variant="secondary" loading={withdrawOffer.isPending} onClick={() => withdrawOffer.mutate(p.myOffer!.id, { onError })}>
            {t('actions.withdrawOffer')}
          </Button>
        </>
      );
      break;
    case 'affected':
      content = (
        <>
          <Button variant="secondary" size="lg" className="flex-1" loading={sameHere.isPending} onClick={() => sameHere.mutate(false, { onError })}>
            {t('actions.notAffected')}
          </Button>
          <Button
            size="lg"
            className="flex-1"
            loading={fixed.isPending}
            onClick={() => fixed.mutate(undefined, { onSuccess: (d) => toast(d.status === 'solved' ? t('actions.fixedSolved') : t('actions.fixedVoted')), onError })}
          >
            {t('actions.fixedNow', { votes: p.fixedVotes, quorum: FIXED_QUORUM })}
          </Button>
        </>
      );
      break;
    default:
      content =
        p.kind === 'issue' ? (
          <>
            <Button variant="secondary" size="lg" className="flex-1 px-3" loading={sameHere.isPending} onClick={() => sameHere.mutate(true, { onSuccess: () => toast(t('actions.sameHereToast')), onError })}>
              {t('actions.sameHere')}
            </Button>
            <Button size="lg" className="flex-1" icon={<HandHeart size={19} />} onClick={() => onSheet('offer')}>
              {t('actions.canHelp')}
            </Button>
          </>
        ) : (
          <Button size="lg" block icon={<HandHeart size={20} />} onClick={() => onSheet('offer')}>
            {t('actions.canHelp')}
          </Button>
        );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 pt-3 pb-[max(14px,env(safe-area-inset-bottom))] backdrop-blur md:left-[248px]">
      <div className="mx-auto flex max-w-2xl items-center gap-2.5">{content}</div>
    </div>
  );
}

