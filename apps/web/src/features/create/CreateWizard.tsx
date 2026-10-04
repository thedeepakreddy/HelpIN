import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Camera, EyeOff, ImagePlus, LocateFixed, Phone, ShieldAlert, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CATEGORY_GROUPS,
  EMERGENCY_NUMBER,
  LANGUAGES,
  LIMITS,
  findCategory,
  type Kind,
  type Precision,
  type Urgency,
} from '@helpin/config';
import type { ProblemCard } from '@helpin/contracts';
import { allowedPrecisions, type LatLng } from '@helpin/geo';
import { useCreateProblem, useMe, useSameHere, useSimilar } from '../../api/hooks';
import { CategoryHex, GROUP_TONE, LanguageBadge, UrgencyBadge, categoryIcon } from '../../components/domain/problem';
import { Button, IconButton } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { ChoiceCard, HexTile, TextArea, TextField } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { DEFAULT_VIEW } from '../problems/mapStyle';

// MapLibre is large; load it only when the wizard reaches the map step.
const LocationPicker = lazy(() => import('./LocationPicker').then((m) => ({ default: m.LocationPicker })));

const STEPS = ['category', 'location', 'similar', 'describe', 'photos', 'urgency', 'review'] as const;
type Step = (typeof STEPS)[number];

interface Draft {
  groupId: string;
  categoryId: string | null;
  point: LatLng;
  precision: Precision;
  saveExact: boolean;
  title: string;
  description: string;
  langFrom: string;
  /** null until chosen: defaults to a language the person speaks. */
  langTo: string | null;
  wantsLanguage: boolean;
  photos: string[];
  urgency: Urgency;
  noDanger: boolean;
  anonymous: boolean;
}

const GROUP_ICON: Record<string, string> = {
  everyday: 'need_a_hand',
  newcomers: 'language_translation',
  environment: 'water_bodies',
  roads: 'potholes',
  utilities: 'water_supply',
  safety: 'safety_concern',
  other: 'other',
};

const AREA_SIZE: Record<Precision, string> = { wider: '~5 km²', standard: '~0.7 km²', exact: '~0.1 km²' };

export function CreateWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const me = useMe();
  const create = useCreateProblem();

  const [step, setStep] = useState<Step>('category');
  const [flyTo, setFlyTo] = useState<{ center: LatLng; key: number } | null>(null);
  const [draft, setDraft] = useState<Draft>({
    groupId: 'everyday',
    categoryId: null,
    point: DEFAULT_VIEW.center,
    precision: 'standard',
    saveExact: true,
    title: '',
    description: '',
    langFrom: 'hu',
    langTo: null,
    wantsLanguage: false,
    photos: [],
    urgency: 'basic',
    noDanger: false,
    anonymous: false,
  });
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const category = draft.categoryId ? findCategory(draft.categoryId).category : null;
  const kind: Kind = category?.defaultKind ?? 'request';
  // Fetched while choosing the spot, so the "similar nearby" step is ready (R-31).
  const similar = useSimilar(['location', 'similar', 'describe'].includes(step) ? draft.categoryId : null, draft.point);
  const similarList = similar.data ?? [];
  const langTo = draft.langTo ?? me.data?.languages.find((l) => l !== draft.langFrom) ?? 'en';
  const languageNeeded = draft.wantsLanguage || category?.requiresLanguage ? `${draft.langFrom}>${langTo}` : null;

  // Free the object URLs for photo previews when leaving the wizard.
  const photoUrls = useRef<string[]>([]);
  useEffect(() => {
    photoUrls.current = draft.photos;
  }, [draft.photos]);
  useEffect(() => () => photoUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const index = STEPS.indexOf(step);
  const visibleSteps = STEPS.length;
  const shownIndex = index + 1;

  function go(to: Step) {
    setStep(to);
    window.scrollTo({ top: 0 });
  }
  function next() {
    if (step === 'location') return go(similarList.length > 0 ? 'similar' : 'describe');
    go(STEPS[index + 1]!);
  }
  function back() {
    if (index === 0) return void navigate({ to: '/problems', search: { view: 'map' } });
    if (step === 'describe' && similarList.length === 0) return go('location');
    go(STEPS[index - 1]!);
  }

  const canNext: Record<Step, boolean> = {
    category: !!draft.categoryId,
    location: true,
    similar: true,
    describe: draft.title.trim().length >= LIMITS.titleMin && (!languageNeeded || draft.langFrom !== langTo),
    photos: true,
    urgency: draft.urgency !== 'serious' || draft.noDanger,
    review: true,
  };

  async function submit() {
    if (!draft.categoryId) return;
    try {
      const detail = await create.mutateAsync({
        categoryId: draft.categoryId,
        kind,
        title: draft.title.trim(),
        description: draft.description.trim(),
        urgency: draft.urgency,
        precision: draft.precision,
        point: draft.point,
        saveExactPrivately: draft.saveExact,
        languageNeeded,
        anonymous: draft.anonymous,
        photoCount: draft.photos.length,
        communityId: null,
      });
      toast(t('create.posted'));
      void navigate({ to: '/p/$problemId', params: { problemId: detail.id }, replace: true });
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-paper">
      <header className="sticky top-0 z-20 bg-paper/95 px-3 pt-[max(8px,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex h-14 items-center justify-between">
          {index === 0 ? (
            <Link to="/problems" search={{ view: 'map' }} aria-label={t('common.close')} className="flex size-11 items-center justify-center rounded-full hover:bg-black/5">
              <X size={22} />
            </Link>
          ) : (
            <IconButton label={t('common.back')} onClick={back}>
              <ArrowLeft size={22} />
            </IconButton>
          )}
          <span className="text-[15px] font-bold">{t('create.title')}</span>
          <span className="w-11 text-right text-[13px] font-semibold text-muted">
            {shownIndex} / {visibleSteps}
          </span>
        </div>
        <div className="mx-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={1} aria-valuemax={visibleSteps} aria-valuenow={shownIndex}>
          <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${(shownIndex / visibleSteps) * 100}%` }} />
        </div>
      </header>

      <main className="flex-1 px-5 pt-5 pb-32">
        {step === 'category' && (
          <>
            <StepTitle title={t('create.category.title')} body={t('create.category.body')} />
            <div className="grid grid-cols-2 gap-2.5">
              {CATEGORY_GROUPS.map((g) => {
                const Icon = categoryIcon(GROUP_ICON[g.id] ?? 'other');
                const on = draft.groupId === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ groupId: g.id, categoryId: null })}
                    className={cn(
                      'flex items-center gap-2.5 rounded-2xl border-2 bg-white p-3 text-left transition-colors',
                      on ? 'border-brand' : 'border-white lip-card',
                      g.id === 'other' && 'col-span-2',
                    )}
                  >
                    <HexTile color={GROUP_TONE[g.id] ?? 'brand'} size={38}>
                      <Icon size={18} />
                    </HexTile>
                    <span className="min-w-0">
                      <span className="block text-[14px] leading-tight font-bold">{g.label}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-muted">{g.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <h2 className="mt-6 mb-2.5 font-display text-[18px] font-bold">{CATEGORY_GROUPS.find((g) => g.id === draft.groupId)?.label}</h2>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_GROUPS.find((g) => g.id === draft.groupId)?.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={draft.categoryId === c.id}
                  onClick={() => set({ categoryId: c.id, urgency: c.defaultUrgency, precision: 'standard', wantsLanguage: !!c.requiresLanguage })}
                  className={cn(
                    'h-10 rounded-full px-4 text-[14px] transition-colors',
                    draft.categoryId === c.id ? 'bg-ink font-bold text-white' : 'border-[1.5px] border-line-strong bg-white font-semibold',
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {category?.defaultKind === 'issue' && <p className="mt-4 rounded-2xl bg-sapphire-tint p-3.5 text-[13px] text-sapphire-ink">{t('create.category.communityHint')}</p>}
          </>
        )}

        {step === 'location' && (
          <>
            <StepTitle title={t('create.location.title')} body={t('create.location.body')} />
            <Suspense fallback={<div className="h-[260px] animate-pulse rounded-[20px] bg-[#ECEEE6]" />}>
              <LocationPicker point={draft.point} precision={draft.precision} kind={kind} onChange={(point) => set({ point })} flyTo={flyTo} />
            </Suspense>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              icon={<LocateFixed size={16} />}
              onClick={() =>
                navigator.geolocation?.getCurrentPosition(
                  (pos) => setFlyTo({ center: { lat: pos.coords.latitude, lng: pos.coords.longitude }, key: Date.now() }),
                  () => toast(t('create.location.noGps'), 'error'),
                )
              }
            >
              {t('create.location.useMine')}
            </Button>
            <p className="mt-4 mb-2.5 text-[13px] font-semibold text-ink-2">{t('create.location.privacy')}</p>
            <div role="radiogroup" aria-label={t('create.location.precision')} className="flex flex-col gap-2.5">
              {(['standard', 'wider', 'exact'] as const).map((p) => {
                const allowed = allowedPrecisions(kind).includes(p);
                return (
                  <ChoiceCard
                    key={p}
                    selected={draft.precision === p}
                    disabled={!allowed}
                    onSelect={() => set({ precision: p })}
                    title={`${t(`create.location.${p}`)} · ${AREA_SIZE[p]}`}
                    description={allowed ? t(`create.location.${p}Hint`) : t('create.location.exactOnlyIssues')}
                  />
                );
              })}
            </div>
            {kind === 'request' && (
              <label className="mt-4 flex items-start gap-3 rounded-2xl bg-white p-3.5 lip-card">
                <input type="checkbox" checked={draft.saveExact} onChange={(e) => set({ saveExact: e.target.checked })} className="mt-0.5 size-5 accent-brand" />
                <span className="text-[14px] text-ink-2">{t('create.location.saveExact')}</span>
              </label>
            )}
          </>
        )}

        {step === 'similar' && <SimilarStep list={similarList} onNone={() => go('describe')} />}

        {step === 'describe' && (
          <>
            <StepTitle title={t('create.describe.title')} body={t('create.describe.body')} />
            <TextField
              label={t('create.describe.titleLabel')}
              placeholder={t(kind === 'issue' ? 'create.describe.titlePlaceholderIssue' : 'create.describe.titlePlaceholder')}
              value={draft.title}
              maxLength={LIMITS.titleMax}
              counter
              onChange={(e) => set({ title: e.target.value })}
            />
            <TextArea
              className="mt-4"
              label={t('create.describe.detailsLabel')}
              placeholder={t('create.describe.detailsPlaceholder')}
              value={draft.description}
              maxLength={LIMITS.description}
              rows={5}
              onChange={(e) => set({ description: e.target.value })}
            />
            {kind === 'request' && (
              <div className="mt-5 rounded-[20px] bg-white p-4 lip-card">
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-[15px] font-bold">{t('create.describe.languageToggle')}</span>
                    <span className="block text-[13px] text-ink-2">{t('create.describe.languageHint')}</span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={draft.wantsLanguage || !!category?.requiresLanguage}
                    disabled={!!category?.requiresLanguage}
                    onChange={(e) => set({ wantsLanguage: e.target.checked })}
                    className="size-6 accent-brand"
                  />
                </label>
                {languageNeeded && (
                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <LanguageSelect label={t('create.describe.from')} value={draft.langFrom} onChange={(v) => set({ langFrom: v })} />
                    <LanguageSelect label={t('create.describe.to')} value={langTo} onChange={(v) => set({ langTo: v })} />
                  </div>
                )}
              </div>
            )}
            {category?.paperworkTips && (
              <p className="mt-4 flex gap-2.5 rounded-2xl bg-tram-tint p-3.5 text-[13px] leading-relaxed text-tram-ink">
                <ShieldAlert size={18} className="shrink-0" />
                {t('create.describe.paperworkTip')}
              </p>
            )}
          </>
        )}

        {step === 'photos' && (
          <>
            <StepTitle title={t('create.photos.title')} body={t('create.photos.body')} />
            <div className="grid grid-cols-3 gap-2.5">
              {draft.photos.map((url, i) => (
                <div key={url} className="relative aspect-square overflow-hidden rounded-2xl bg-line">
                  <img src={url} alt={t('create.photos.alt', { n: i + 1 })} className="size-full object-cover" />
                  <button
                    type="button"
                    aria-label={t('create.photos.remove')}
                    onClick={() => {
                      URL.revokeObjectURL(url);
                      set({ photos: draft.photos.filter((u) => u !== url) });
                    }}
                    className="absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full bg-ink/70 text-white"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {draft.photos.length < LIMITS.problemPhotos && (
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line-strong bg-white text-[13px] font-bold text-ink-2 hover:border-brand hover:text-brand">
                  <ImagePlus size={24} />
                  {t('create.photos.add')}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])].slice(0, LIMITS.problemPhotos - draft.photos.length);
                      set({ photos: [...draft.photos, ...files.map((f) => URL.createObjectURL(f))] });
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
            <p className="mt-4 flex gap-2.5 rounded-2xl bg-sapphire-tint p-3.5 text-[13px] leading-relaxed text-sapphire-ink">
              <Camera size={18} className="shrink-0" />
              {t('create.photos.privacy')}
            </p>
          </>
        )}

        {step === 'urgency' && (
          <>
            <StepTitle title={t('create.urgency.title')} body={t('create.urgency.body')} />
            <div role="radiogroup" aria-label={t('create.urgency.title')} className="flex flex-col gap-2.5">
              {(['basic', 'medium', 'serious'] as const).map((u) => (
                <ChoiceCard
                  key={u}
                  selected={draft.urgency === u}
                  onSelect={() => set({ urgency: u, noDanger: false })}
                  icon={<UrgencyBadge urgency={u} />}
                  title={t(`create.urgency.${u}`)}
                  description={t(`create.urgency.${u}Hint`)}
                />
              ))}
            </div>
            {draft.urgency === 'serious' && (
              <div className="mt-4 rounded-[20px] bg-coral p-4 text-white">
                <p className="flex items-center gap-2 font-display text-[18px] font-extrabold">
                  <Phone size={20} />
                  {t('create.urgency.emergencyTitle', { number: EMERGENCY_NUMBER })}
                </p>
                <p className="mt-1 text-[14px] leading-relaxed text-white/90">{t('create.urgency.emergencyBody')}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a href={`tel:${EMERGENCY_NUMBER}`} className="inline-flex h-10 items-center rounded-xl bg-white px-4 text-[14px] font-extrabold text-coral-ink no-underline">
                    {t('create.urgency.call', { number: EMERGENCY_NUMBER })}
                  </a>
                  <label className="flex items-center gap-2 text-[14px] font-semibold">
                    <input type="checkbox" checked={draft.noDanger} onChange={(e) => set({ noDanger: e.target.checked })} className="size-5 accent-white" />
                    {t('create.urgency.noDanger')}
                  </label>
                </div>
              </div>
            )}
          </>
        )}

        {step === 'review' && (
          <>
            <StepTitle title={t('create.review.title')} body={t('create.review.body')} />
            <div className="rounded-[20px] bg-white p-4 lip-card">
              <div className="flex items-start gap-3">
                {draft.categoryId && <CategoryHex categoryId={draft.categoryId} urgent={draft.urgency === 'serious'} />}
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[19px] leading-tight font-bold">{draft.title}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <UrgencyBadge urgency={draft.urgency} />
                    {languageNeeded && <LanguageBadge need={languageNeeded} />}
                  </div>
                </div>
              </div>
              {draft.description && <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{draft.description}</p>}
              <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-[13px]">
                <dt className="text-muted">{t('create.review.category')}</dt>
                <dd className="font-semibold">{category?.label}</dd>
                <dt className="text-muted">{t('create.review.area')}</dt>
                <dd className="font-semibold">
                  {t(`create.location.${draft.precision}`)} · {AREA_SIZE[draft.precision]}
                </dd>
                <dt className="text-muted">{t('create.review.photos')}</dt>
                <dd className="font-semibold">{draft.photos.length}</dd>
              </dl>
            </div>
            <label className="mt-4 flex items-start gap-3 rounded-[20px] bg-white p-4 lip-card">
              <HexTile color="sapphire" size={38}>
                <EyeOff size={18} />
              </HexTile>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold">{t('create.review.anonymous')}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">{t('create.review.anonymousHint')}</span>
              </span>
              <input type="checkbox" role="switch" checked={draft.anonymous} onChange={(e) => set({ anonymous: e.target.checked })} className="mt-1 size-6 accent-brand" />
            </label>
            <p className="mt-4 text-[12px] leading-relaxed text-muted">{t('create.review.guidelines')}</p>
          </>
        )}
      </main>

      {step !== 'similar' && (
        <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] backdrop-blur md:left-[248px]">
          <div className="mx-auto max-w-xl">
            {step === 'review' ? (
              <Button size="lg" block loading={create.isPending} onClick={() => void submit()}>
                {t('create.review.post')}
              </Button>
            ) : (
              <Button size="lg" block disabled={!canNext[step]} onClick={next}>
                {canNext[step] ? t('common.next') : t(`create.${step}.blocked`)}
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

function StepTitle({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-5">
      <h1 className="font-display text-[28px] leading-tight font-extrabold tracking-tight">{title}</h1>
      <p className="mt-1 text-[15px] text-ink-2">{body}</p>
    </div>
  );
}

function LanguageSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-bold text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border-2 border-line bg-[#F9FAF7] px-3 text-[15px] font-semibold focus:border-brand focus:outline-none"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SimilarStep({ list, onNone }: { list: ProblemCard[]; onNone: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <StepTitle title={t('create.similar.title')} body={t('create.similar.body')} />
      <div className="flex flex-col gap-2.5">
        {list.slice(0, 3).map((p) => (
          <SimilarItem key={p.id} problem={p} />
        ))}
      </div>
      <Button variant="secondary" size="lg" block className="mt-5" onClick={onNone}>
        {t('create.similar.different')}
      </Button>
    </>
  );
}

function SimilarItem({ problem: p }: { problem: ProblemCard }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const same = useSameHere(p.id);
  return (
    <div className="rounded-[20px] bg-white p-4 lip-card">
      <div className="flex items-start gap-3">
        <CategoryHex categoryId={p.categoryId} urgent={p.urgency === 'serious'} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold">{p.title}</p>
          <p className="mt-0.5 text-[12px] text-ink-2">
            {p.area.locality} · {t('problem.affected', { count: p.affectedCount })}
          </p>
        </div>
      </div>
      {p.kind === 'issue' ? (
        <Button
          size="sm"
          className="mt-3"
          block
          loading={same.isPending}
          onClick={() =>
            same.mutate(true, {
              onSuccess: () => {
                toast(t('create.similar.joined'));
                void navigate({ to: '/p/$problemId', params: { problemId: p.id } });
              },
              onError: (e) => toast(errorMessage(e, t), 'error'),
            })
          }
        >
          {t('create.similar.sameHere')}
        </Button>
      ) : (
        <Link to="/p/$problemId" params={{ problemId: p.id }} className="mt-3 block text-center text-[14px] font-bold text-brand">
          {t('create.similar.view')}
        </Link>
      )}
    </div>
  );
}
