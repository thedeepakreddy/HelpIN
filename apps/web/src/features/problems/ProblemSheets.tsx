import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { KARMA, LIMITS, type ProgressStatus } from '@helpin/config';
import type { Offer, ProblemDetail } from '@helpin/contracts';
import { UserCheck } from 'lucide-react';
import { useConfirmSolved, useOfferHelp, usePostUpdate, useWithdrawProblem } from '../../api/hooks';
import { PhotoGrid, usePhotoUploads } from '../../components/domain/media';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { ChoiceCard, HexAvatar, HexTile, TextArea } from '../../components/ui/primitives';
import { errorMessage } from '../../lib/errors';

/* ------------------------------------------------------------------ Offer help */

export function OfferSheet({
  problem,
  open,
  onOpenChange,
}: {
  problem: ProblemDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const offer = useOfferHelp(problem.id);
  const [message, setMessage] = useState('');
  const asker = problem.asker.anonymous
    ? t('problem.theAsker')
    : problem.asker.user.displayName.split(' ')[0];

  async function submit() {
    try {
      await offer.mutateAsync(message.trim() || null);
      toast(t('offer.sent'));
      onOpenChange(false);
      setMessage('');
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('offer.title')}
      description={t('offer.subtitle', { name: asker })}
      footer={
        <Button size="lg" block loading={offer.isPending} onClick={() => void submit()}>
          {t('offer.send')}
        </Button>
      }
    >
      <TextArea
        label={t('offer.messageLabel')}
        placeholder={t('offer.placeholder')}
        value={message}
        maxLength={LIMITS.offerMessage}
        onChange={(e) => setMessage(e.target.value)}
        hint={t('offer.hint')}
      />
      <div className="mt-4 rounded-2xl bg-tram-tint p-3.5 text-[13px] leading-relaxed text-tram-ink">
        <strong>{t('offer.freeTitle')}</strong> {t('offer.freeBody')}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Progress update */

const STATUSES: ProgressStatus[] = [
  'still_need_help',
  'making_progress',
  'partly_solved',
  'need_changed',
  'note',
];

export function UpdateSheet({
  problem,
  open,
  onOpenChange,
}: {
  problem: ProblemDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const post = usePostUpdate(problem.id);
  const [status, setStatus] = useState<ProgressStatus>('making_progress');
  const [body, setBody] = useState('');
  const photos = usePhotoUploads('problem_photo', LIMITS.updatePhotos);
  const needsBody = status === 'need_changed' || status === 'note';
  const options =
    problem.viewerRole === 'asker' ? STATUSES : STATUSES.filter((s) => s !== 'need_changed');

  async function submit() {
    try {
      await post.mutateAsync({
        progressStatus: status,
        body: body.trim() || null,
        mediaIds: photos.mediaIds,
      });
      toast(t('update.posted'));
      onOpenChange(false);
      setBody('');
      photos.reset();
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('update.title')}
      description={
        problem.viewerRole === 'asker' ? t('update.subtitleAsker') : t('update.subtitleHelper')
      }
      footer={
        <Button
          size="lg"
          block
          disabled={(needsBody && !body.trim()) || photos.uploading}
          loading={post.isPending}
          onClick={() => void submit()}
        >
          {t('update.post')}
        </Button>
      }
    >
      <div role="radiogroup" aria-label={t('update.statusLabel')} className="flex flex-wrap gap-2">
        {options.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={status === s}
            onClick={() => setStatus(s)}
            className={
              status === s
                ? 'h-10 rounded-full bg-ink px-4 text-[14px] font-bold text-white'
                : 'h-10 rounded-full border-[1.5px] border-line-strong bg-white px-4 text-[14px] font-semibold text-ink'
            }
          >
            {t(`progress.${s}`)}
          </button>
        ))}
      </div>
      <TextArea
        className="mt-4"
        label={needsBody ? t('update.whatChangedRequired') : t('update.whatChanged')}
        placeholder={t('update.placeholder')}
        value={body}
        maxLength={LIMITS.update}
        onChange={(e) => setBody(e.target.value)}
      />
      <p className="mt-4 mb-2 text-[13px] font-bold">{t('update.photos')}</p>
      <PhotoGrid uploads={photos} columns={4} />
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Confirm solved */

export function ConfirmSolvedSheet({
  problem,
  open,
  onOpenChange,
  mode = 'confirm',
}: {
  problem: ProblemDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode?: 'confirm' | 'credit';
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const confirm = useConfirmSolved(problem.id, mode);
  const candidates = problem.offers.filter((o) =>
    mode === 'credit'
      ? o.status === 'closed' || o.status === 'accepted'
      : o.status === 'accepted' || o.status === 'offered',
  );
  const credit = mode === 'credit';
  const [picked, setPicked] = useState<string[]>(() =>
    candidates
      .filter((o) => o.status === 'accepted')
      .slice(0, KARMA.maxCreditedHelpers)
      .map((o) => o.id),
  );
  const [nobody, setNobody] = useState(!credit && candidates.length === 0);
  const full = picked.length >= KARMA.maxCreditedHelpers;

  function toggle(o: Offer) {
    setNobody(false);
    setPicked((list) =>
      list.includes(o.id) ? list.filter((x) => x !== o.id) : full ? list : [...list, o.id],
    );
  }

  async function submit() {
    try {
      const res = await confirm.mutateAsync(nobody ? [] : picked);
      toast(
        res.askerAward > 0
          ? t('solved.toastWithAward', { count: res.credited, award: res.askerAward })
          : t('solved.toast'),
        'karma',
      );
      onOpenChange(false);
      // F-06: invite the asker to say thanks publicly.
      if (res.credited > 0)
        void navigate({ to: '/community/new', search: { kind: 'thank_you', problem: problem.id } });
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    }
  }

  const canConfirm = nobody || picked.length > 0;
  const karmaLine = nobody
    ? t('solved.karmaNobody')
    : t('solved.karmaLine', {
        count: picked.length,
        award: KARMA.solveAward,
        closing: KARMA.closingAward,
      });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={credit ? t('solved.creditTitle') : t('solved.title')}
      description={t('solved.subtitle', { max: KARMA.maxCreditedHelpers })}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            variant="tram"
            block
            disabled={!canConfirm}
            loading={confirm.isPending}
            onClick={() => void submit()}
          >
            {canConfirm
              ? nobody
                ? t('solved.confirmNobody')
                : t('solved.confirm', { count: picked.length })
              : t('solved.choose')}
          </Button>
          <Button variant="ghost" block onClick={() => onOpenChange(false)}>
            {t('solved.notYet')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        {candidates.map((o) => (
          <ChoiceCard
            key={o.id}
            type="checkbox"
            selected={!nobody && picked.includes(o.id)}
            disabled={!picked.includes(o.id) && full}
            onSelect={() => toggle(o)}
            icon={<HexAvatar initials={o.helper.initials} color={o.helper.color} photo={o.helper.avatar} size={40} />}
            title={o.helper.displayName}
            description={
              o.claimedSolved
                ? t('solved.saysSolved')
                : o.status === 'accepted'
                  ? t('solved.accepted')
                  : t('solved.offered')
            }
          />
        ))}
        {!credit && (
          <ChoiceCard
            type="checkbox"
            selected={nobody}
            onSelect={() => {
              setNobody((n) => !n);
              setPicked([]);
            }}
            icon={
              <HexTile color="tram" size={40}>
                <UserCheck size={19} />
              </HexTile>
            }
            title={t('solved.nobody')}
            description={t('solved.nobodyHint')}
          />
        )}
      </div>
      <p className="mt-4 rounded-2xl bg-brand-tint px-4 py-3 text-[13px] font-semibold text-brand-ink">
        {karmaLine}
      </p>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Withdraw */

const REASONS = ['solved_elsewhere', 'no_longer_needed', 'posted_by_mistake', 'other'] as const;

export function WithdrawSheet({
  problem,
  open,
  onOpenChange,
}: {
  problem: ProblemDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const withdraw = useWithdrawProblem(problem.id);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('no_longer_needed');

  async function submit() {
    try {
      await withdraw.mutateAsync(t(`withdraw.reasons.${reason}`));
      toast(t('withdraw.done'));
      onOpenChange(false);
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('withdraw.title')}
      description={t('withdraw.subtitle')}
      footer={
        <Button
          size="lg"
          variant="danger"
          block
          loading={withdraw.isPending}
          onClick={() => void submit()}
        >
          {t('withdraw.confirm')}
        </Button>
      }
    >
      <div className="flex flex-col gap-2.5">
        {REASONS.map((r) => (
          <ChoiceCard
            key={r}
            selected={reason === r}
            onSelect={() => setReason(r)}
            title={t(`withdraw.reasons.${r}`)}
          />
        ))}
      </div>
    </Sheet>
  );
}
