import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Ellipsis, Flag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReportInput } from '@helpin/contracts';
import { api } from '../../api';
import { errorMessage } from '../../lib/errors';
import { Button, IconButton } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';
import { ChoiceCard, TextArea } from '../ui/primitives';

const REASONS: ReportInput['reason'][] = ['fake_problem', 'scam', 'paid_work', 'harassment', 'dangerous', 'spam', 'privacy', 'inappropriate', 'other'];

/** S-04: anything user-generated can be reported, including "Fake problem" (A-06). */
export function ReportSheet({
  open,
  onOpenChange,
  targetType,
  targetId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  targetType: ReportInput['targetType'];
  targetId: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [reason, setReason] = useState<ReportInput['reason']>(targetType === 'problem' ? 'fake_problem' : 'spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const reasons = targetType === 'problem' ? REASONS : REASONS.filter((r) => r !== 'fake_problem');

  async function submit() {
    setBusy(true);
    try {
      await api.report({ targetType, targetId, reason, details: details.trim() || null });
      toast(t('report.thanks'));
      onOpenChange(false);
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('report.title')}
      description={t('report.subtitle')}
      footer={
        <Button size="lg" variant="danger" block loading={busy} onClick={() => void submit()}>
          {t('report.send')}
        </Button>
      }
    >
      <div role="radiogroup" aria-label={t('report.reason')} className="flex flex-col gap-2">
        {reasons.map((r) => (
          <ChoiceCard key={r} selected={reason === r} onSelect={() => setReason(r)} title={t(`report.reasons.${r}`)} />
        ))}
      </div>
      <TextArea className="mt-4" label={t('report.details')} value={details} maxLength={1000} onChange={(e) => setDetails(e.target.value)} rows={3} />
    </Sheet>
  );
}

/** "⋯" menu with Report and Block (S-03, S-04). */
export function MoreMenu({
  targetType,
  targetId,
  block,
  tone = 'plain',
  onBlocked,
}: {
  targetType: ReportInput['targetType'];
  targetId: string;
  block?: { userId?: string; problemId?: string; conversationId?: string; name: string } | null;
  tone?: 'plain' | 'surface' | 'onDark';
  onBlocked?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doBlock() {
    if (!block) return;
    setBusy(true);
    try {
      const { name: _name, ...target } = block;
      await api.block(target);
      toast(t('block.done', { name: block.name }));
      setConfirmBlock(false);
      void qc.invalidateQueries();
      onBlocked?.();
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <IconButton label={t('common.more')} tone={tone} onClick={() => setMenu(true)}>
        <Ellipsis size={20} />
      </IconButton>
      <Sheet open={menu} onOpenChange={setMenu} title={t('common.options')}>
        <div className="flex flex-col gap-2 pb-2">
          <Button
            variant="secondary"
            block
            icon={<Flag size={18} />}
            onClick={() => {
              setMenu(false);
              setReport(true);
            }}
          >
            {t('report.title')}
          </Button>
          {block && (
            <Button
              variant="secondary"
              block
              icon={<Ban size={18} />}
              onClick={() => {
                setMenu(false);
                setConfirmBlock(true);
              }}
            >
              {t('block.title', { name: block.name })}
            </Button>
          )}
        </div>
      </Sheet>
      <ReportSheet open={report} onOpenChange={setReport} targetType={targetType} targetId={targetId} />
      {block && (
        <Sheet
          open={confirmBlock}
          onOpenChange={setConfirmBlock}
          title={t('block.title', { name: block.name })}
          description={t('block.body')}
          footer={
            <Button size="lg" variant="danger" block loading={busy} onClick={() => void doBlock()}>
              {t('block.confirm')}
            </Button>
          }
        >
          <span />
        </Sheet>
      )}
    </>
  );
}
