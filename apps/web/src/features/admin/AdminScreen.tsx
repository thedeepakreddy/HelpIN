import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AdminDecision, AdminReport } from '@helpin/contracts';
import { api } from '../../api';
import { qk, useMe } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { Chip, ChoiceCard, EmptyState, Segmented, Skeleton, TextArea, TextField } from '../../components/ui/primitives';
import { errorMessage } from '../../lib/errors';
import { relativeTime } from '../../lib/time';

type Tab = 'reports' | 'appeals' | 'metrics' | 'communities' | 'users';

/** The founder's moderation console (ADR-023, Roadmap Phase 6). 2FA is required (S-10). */
export function AdminScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const [tab, setTab] = useState<Tab>('reports');
  if (!me.data) return null;
  if (me.data.role === 'user') return <EmptyState title={t('admin.forbidden')} />;
  if (!me.data.mfaVerified) return <MfaGate enabled={me.data.mfaEnabled} />;
  return (
    <div className="mx-auto max-w-3xl px-4 pt-[max(16px,env(safe-area-inset-top))] pb-10">
      <h1 className="flex items-center gap-2 font-display text-[28px] font-extrabold tracking-tight">
        <ShieldCheck className="text-brand" />
        {t('admin.title')}
      </h1>
      <div className="no-scrollbar mt-4 overflow-x-auto">
        <Segmented
          label={t('admin.title')}
          value={tab}
          onChange={setTab}
          className="min-w-[520px]"
          options={(['reports', 'appeals', 'metrics', 'communities', 'users'] as const).map((v) => ({ value: v, label: t(`admin.tabs.${v}`) }))}
        />
      </div>
      <div className="mt-5">
        {tab === 'reports' && <Reports />}
        {tab === 'appeals' && <Appeals />}
        {tab === 'metrics' && <Metrics />}
        {tab === 'communities' && <Communities />}
        {tab === 'users' && <Users />}
      </div>
    </div>
  );
}

function MfaGate({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ['mfa-setup'], queryFn: () => api.setupMfa(), enabled: !enabled });
  const [code, setCode] = useState('');
  const verify = useMutation({
    mutationFn: () => api.verifyMfa(code),
    onSuccess: (me) => qc.setQueryData(qk.me, me),
    onError: (e) => toast(errorMessage(e, t), 'error'),
  });
  return (
    <div className="mx-auto max-w-md px-5 pt-10">
      <span className="hex mb-4 flex h-14 w-12 items-center justify-center bg-brand-tint text-brand">
        <KeyRound size={24} />
      </span>
      <h1 className="font-display text-[28px] font-extrabold">{t('admin.mfaTitle')}</h1>
      <p className="mt-1.5 text-[15px] text-ink-2">{enabled ? t('admin.mfaEnter') : t('admin.mfaSetup')}</p>
      {!enabled && setup.data?.secret && (
        <div className="mt-4 rounded-2xl bg-white p-4 lip-card">
          <p className="text-[13px] font-bold">{t('admin.mfaSecret')}</p>
          <code className="mt-1 block font-mono text-[15px] break-all select-all">{setup.data.secret}</code>
          {setup.data.otpauthUrl && (
            <a href={setup.data.otpauthUrl} className="mt-2 inline-block text-[13px] font-bold text-brand">
              {t('admin.mfaOpenApp')}
            </a>
          )}
        </div>
      )}
      <form
        className="mt-5 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          verify.mutate();
        }}
      >
        <TextField label={t('admin.mfaCode')} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <Button type="submit" size="lg" block disabled={code.length !== 6} loading={verify.isPending}>
          {t('login.verify')}
        </Button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ Reports (S-04, S-05, A-06, A-07) */

function Reports() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'open' | 'actioned' | 'dismissed'>('open');
  const q = useQuery({ queryKey: ['admin', 'reports', status], queryFn: () => api.admin.reports(status) });
  return (
    <>
      <Segmented
        label={t('admin.status')}
        value={status}
        onChange={setStatus}
        className="mb-4 max-w-sm"
        options={(['open', 'actioned', 'dismissed'] as const).map((v) => ({ value: v, label: t(`admin.reportStatus.${v}`) }))}
      />
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : !q.data?.length ? (
        <EmptyState title={t('admin.noReports')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </ul>
      )}
    </>
  );
}

const TEMPLATES: Record<AdminDecision['action'], string> = {
  dismiss: '',
  restore: '',
  remove: 'We removed this because it breaks the HelpIn community guidelines.',
  fake_problem: 'We removed this problem because it was not a real problem (community guidelines: no fake problems). This costs 20 karma and pauses anonymous posting for 90 days.',
  restrict_user: 'Your account is restricted because of repeated breaks of the community guidelines.',
};

function ReportCard({ report: r }: { report: AdminReport }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [action, setAction] = useState<AdminDecision['action'] | null>(null);
  const [reason, setReason] = useState('');
  const [statement, setStatement] = useState('');
  const [author, setAuthor] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: () => api.admin.decide(r.id, { action: action!, reason, statement: statement || null }),
    onSuccess: () => {
      toast(t('admin.done'));
      setAction(null);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast(errorMessage(e, t), 'error'),
  });
  const actions: AdminDecision['action'][] = ['dismiss', ...(r.preview.hidden ? (['restore'] as const) : []), 'remove', ...(r.targetType === 'problem' ? (['fake_problem'] as const) : []), 'restrict_user'];
  return (
    <li className="rounded-[20px] bg-white p-4 lip-card">
      <div className="flex flex-wrap items-center gap-1.5">
        {r.serious && (
          <Chip tone="coral" icon={<AlertTriangle size={12} />}>
            {t('admin.serious')}
          </Chip>
        )}
        <Chip tone="neutral">{t(`report.targets.${r.targetType}`)}</Chip>
        <Chip tone="amber">{t(`report.reasons.${r.reason}`)}</Chip>
        <Chip tone="sapphire">{t('admin.reportCount', { count: r.reportCount })}</Chip>
        {r.preview.hidden && <Chip tone="neutral">{t('admin.hidden')}</Chip>}
      </div>
      <p className="mt-2 text-[16px] font-bold">{r.preview.title}</p>
      {r.preview.body && <p className="mt-1 text-[14px] whitespace-pre-line text-ink-2">{r.preview.body}</p>}
      {r.details && <p className="mt-2 rounded-xl bg-paper p-2.5 text-[13px] text-ink-2">“{r.details}” — {r.reporterName}</p>}
      <p className="mt-2 text-[12px] text-muted">{relativeTime(r.createdAt)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {r.preview.link && (
          <Link to={r.preview.link as '/'} className="text-[13px] font-bold text-brand">
            {t('admin.open')}
          </Link>
        )}
        {r.targetType === 'problem' && !r.preview.authorId && !author && (
          <button
            type="button"
            className="text-[13px] font-bold text-sapphire-ink"
            onClick={async () => {
              const who = await api.admin.reveal(r.id);
              setAuthor(who.displayName ?? who.userId ?? '?');
            }}
          >
            {t('admin.reveal')}
          </button>
        )}
        {author && <span className="text-[13px] font-semibold">{t('admin.author', { name: author })}</span>}
      </div>
      {r.status === 'open' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button
              key={a}
              size="sm"
              variant={a === 'dismiss' || a === 'restore' ? 'secondary' : 'danger'}
              onClick={() => {
                setAction(a);
                setReason('');
                setStatement(TEMPLATES[a]);
              }}
            >
              {t(`admin.actions.${a}`)}
            </Button>
          ))}
        </div>
      )}
      <Sheet
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action ? t(`admin.actions.${action}`) : ''}
        description={t('admin.decisionHint')}
        footer={
          <Button size="lg" block disabled={reason.trim().length < 3} loading={decide.isPending} onClick={() => decide.mutate()}>
            {t('admin.confirm')}
          </Button>
        }
      >
        <TextField label={t('admin.reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('admin.reasonPlaceholder')} />
        {action && action !== 'dismiss' && action !== 'restore' && (
          <TextArea className="mt-4" label={t('admin.statement')} value={statement} rows={5} maxLength={2000} onChange={(e) => setStatement(e.target.value)} hint={t('admin.statementHint')} />
        )}
      </Sheet>
    </li>
  );
}

/* ------------------------------------------------------------------ Appeals (S-09) */

function Appeals() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'appeals'], queryFn: () => api.admin.appeals() });
  const [deciding, setDeciding] = useState<{ id: string; decision: 'upheld' | 'overturned' } | null>(null);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: () => api.admin.decideAppeal(deciding!.id, deciding!.decision, note),
    onSuccess: () => {
      toast(t('admin.done'));
      setDeciding(null);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast(errorMessage(e, t), 'error'),
  });
  if (q.isPending) return <Skeleton className="h-40" />;
  if (!q.data?.length) return <EmptyState title={t('admin.noAppeals')} />;
  return (
    <ul className="flex flex-col gap-3">
      {q.data.map((a) => (
        <li key={a.id} className="rounded-[20px] bg-white p-4 lip-card">
          <div className="flex flex-wrap gap-1.5">
            <Chip tone={a.status === 'open' ? 'amber' : 'neutral'}>{t(`admin.appealStatus.${a.status}`)}</Chip>
            <Chip tone="neutral">{a.action.action.replace(/_/g, ' ')}</Chip>
          </div>
          <p className="mt-2 text-[14px] text-ink-2">
            {t('admin.decisionWas')}: <strong>{a.action.reason}</strong>
          </p>
          <p className="mt-2 rounded-xl bg-paper p-3 text-[14px]">
            “{a.body}” — {a.userName}, {relativeTime(a.createdAt)}
          </p>
          {a.status === 'open' && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDeciding({ id: a.id, decision: 'upheld' })}>
                {t('admin.uphold')}
              </Button>
              <Button size="sm" onClick={() => setDeciding({ id: a.id, decision: 'overturned' })}>
                {t('admin.overturn')}
              </Button>
            </div>
          )}
        </li>
      ))}
      <Sheet
        open={!!deciding}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding?.decision === 'overturned' ? t('admin.overturn') : t('admin.uphold')}
        footer={
          <Button size="lg" block disabled={note.trim().length < 3} loading={decide.isPending} onClick={() => decide.mutate()}>
            {t('admin.confirm')}
          </Button>
        }
      >
        <TextArea label={t('admin.noteToUser')} value={note} rows={4} onChange={(e) => setNote(e.target.value)} />
      </Sheet>
    </ul>
  );
}

/* ------------------------------------------------------------------ Metrics (Architecture §14) */

function Metrics() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['admin', 'metrics'], queryFn: () => api.admin.metrics() });
  if (q.isPending || !q.data) return <Skeleton className="h-60" />;
  const m = q.data;
  const totals: [string, number][] = [
    [t('admin.metrics.users'), m.totals.users],
    [t('admin.metrics.openProblems'), m.totals.openProblems],
    [t('admin.metrics.openReports'), m.totals.openReports],
    [t('admin.metrics.openAppeals'), m.totals.openAppeals],
    [t('admin.metrics.flags'), m.totals.flags],
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {totals.map(([label, n]) => (
          <div key={label} className="rounded-2xl bg-white p-3 text-center lip-card">
            <div className="font-display text-[26px] font-extrabold">{n}</div>
            <div className="text-[12px] font-semibold text-ink-2">{label}</div>
          </div>
        ))}
      </div>
      <h2 className="mt-6 mb-2 font-display text-[18px] font-bold">{t('admin.metrics.liquidity')}</h2>
      <Table
        head={[t('admin.metrics.district'), t('admin.metrics.week'), t('admin.metrics.problems'), t('admin.metrics.liquidityPct')]}
        rows={m.liquidityByDistrict.map((r) => [r.district, r.week.slice(0, 10), String(r.problems), r.liquidityPct === null ? '—' : `${r.liquidityPct}%`])}
      />
      <h2 className="mt-6 mb-2 font-display text-[18px] font-bold">{t('admin.metrics.solveRate')}</h2>
      <Table
        head={[t('admin.metrics.week'), t('admin.metrics.closed'), t('admin.metrics.solved'), t('admin.metrics.solvePct'), t('admin.metrics.abandonPct')]}
        rows={m.solveRate.map((r) => [r.week.slice(0, 10), String(r.closed), String(r.solved), r.solveRatePct === null ? '—' : `${r.solveRatePct}%`, r.abandonmentRatePct === null ? '—' : `${r.abandonmentRatePct}%`])}
      />
    </>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  const { t } = useTranslation();
  if (!rows.length) return <p className="rounded-2xl bg-white p-4 text-[14px] text-ink-2 lip-card">{t('admin.metrics.empty')}</p>;
  return (
    <div className="overflow-x-auto rounded-2xl bg-white lip-card">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-paper">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ Communities (COM-02) */

const TYPES = ['district', 'language_culture', 'students', 'civic_environment', 'interest'] as const;

function Communities() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const requests = useQuery({ queryKey: ['admin', 'community-requests'], queryFn: () => api.admin.communityRequests() });
  const [form, setForm] = useState({ name: '', slug: '', type: 'district' as (typeof TYPES)[number], description: '', rules: '', requestId: undefined as string | undefined });
  const create = useMutation({
    mutationFn: () => api.admin.createCommunity({ ...form, rules: form.rules || null }),
    onSuccess: () => {
      toast(t('admin.communityCreated'));
      setForm({ name: '', slug: '', type: 'district', description: '', rules: '', requestId: undefined });
      void qc.invalidateQueries();
    },
    onError: (e) => toast(errorMessage(e, t), 'error'),
  });
  const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return (
    <>
      {!!requests.data?.length && (
        <>
          <h2 className="mb-2 font-display text-[18px] font-bold">{t('admin.requests')}</h2>
          <ul className="mb-6 flex flex-col gap-2">
            {requests.data.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 lip-card">
                <span className="min-w-0 flex-1 text-[14px]">
                  <strong>{r.name}</strong> · {r.requester}
                  {r.reason && <span className="block text-[13px] text-ink-2">{r.reason}</span>}
                </span>
                <Button size="sm" variant="secondary" onClick={() => setForm((f) => ({ ...f, name: r.name, slug: slugify(r.name), type: (TYPES as readonly string[]).includes(r.type) ? (r.type as (typeof TYPES)[number]) : 'interest', requestId: r.id }))}>
                  {t('admin.useRequest')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2 className="mb-2 font-display text-[18px] font-bold">{t('admin.newCommunity')}</h2>
      <div className="flex flex-col gap-3 rounded-[20px] bg-white p-4 lip-card">
        <TextField label={t('community.requestName')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugify(e.target.value) })} />
        <TextField label={t('admin.slug')} value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} />
        <div className="grid gap-2">
          {TYPES.map((ty) => (
            <ChoiceCard key={ty} selected={form.type === ty} onSelect={() => setForm({ ...form, type: ty })} title={t(`community.types.${ty}`)} />
          ))}
        </div>
        <TextArea label={t('admin.description')} value={form.description} maxLength={1000} rows={3} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <TextArea label={t('community.rules')} value={form.rules} maxLength={2000} rows={3} onChange={(e) => setForm({ ...form, rules: e.target.value })} />
        <Button block disabled={form.name.trim().length < 3 || form.slug.length < 3} loading={create.isPending} onClick={() => create.mutate()}>
          {t('admin.create')}
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Users (K-08, S-09) */

function Users() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const users = useQuery({ queryKey: ['admin', 'users', q], queryFn: () => api.admin.users(q), enabled: q.trim().length >= 2 });
  const karma = useQuery({ queryKey: ['admin', 'karma', selected], queryFn: () => api.admin.userKarma(selected!), enabled: !!selected });
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast(t('admin.done'));
      void qc.invalidateQueries({ queryKey: ['admin'] });
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    }
  };
  return (
    <>
      <TextField label={t('admin.searchUsers')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.searchHint')} />
      <ul className="mt-4 flex flex-col gap-2">
        {users.data?.map((u) => (
          <li key={u.id} className="rounded-2xl bg-white p-3 lip-card">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-[15px]">{u.displayName ?? '—'}</strong>
              <Chip tone={u.status === 'active' ? 'brand' : 'coral'} size="xs">
                {u.status}
              </Chip>
              <Chip tone="tram" size="xs">
                {u.karma} karma
              </Chip>
            </div>
            <p className="mt-1 text-[12px] text-muted">
              {u.email ?? ''} {u.phone ?? ''} · {relativeTime(u.createdAt)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setSelected(selected === u.id ? null : u.id)}>
                {t('admin.karmaLedger')}
              </Button>
              {u.status === 'active' ? (
                <Button size="sm" variant="danger" onClick={() => void act(() => api.admin.restrict(u.id, 'restrict', 'Restricted by admin', TEMPLATES.restrict_user))}>
                  {t('admin.actions.restrict_user')}
                </Button>
              ) : (
                u.status === 'restricted' && (
                  <Button size="sm" variant="secondary" onClick={() => void act(() => api.admin.restrict(u.id, 'unrestrict', 'Restriction lifted', null))}>
                    {t('admin.unrestrict')}
                  </Button>
                )
              )}
            </div>
            {selected === u.id && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {karma.data?.map((k) => (
                  <li key={k.id} className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-[13px]">
                    <span>
                      <strong>{k.amount > 0 ? `+${k.amount}` : k.amount}</strong> · {t(`karma.${k.reason}`)} · {relativeTime(k.createdAt)}
                    </span>
                    {k.reason !== 'reversal' && (
                      <button type="button" className="font-bold text-coral-ink" onClick={() => void act(() => api.admin.reverseKarma(k.id, 'Reversed by admin'))}>
                        {t('admin.reverse')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
