import { Suspense, lazy, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Bell, ChevronDown, LocateFixed, MapPin, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProblemCard as Card } from '@helpin/contracts';
import { distanceLabel, distanceMeters, type BBox, type LatLng } from '@helpin/geo';
import { useMap, useMe, useNearby, useNotifications } from '../../api/hooks';
import { Hexie } from '../../components/domain/Hexies';
import { ProblemCard } from '../../components/domain/problem';
import { buttonClass } from '../../components/ui/Button';
import { EmptyState, Skeleton } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';
import { DEFAULT_VIEW } from './mapStyle';

const ProblemMap = lazy(() => import('./ProblemMap').then((m) => ({ default: m.ProblemMap })));

export type ProblemsView = 'map' | 'list';
type Filter = 'all' | 'request' | 'issue' | 'urgent';

function applyFilter(list: Card[], filter: Filter) {
  if (filter === 'request' || filter === 'issue') return list.filter((p) => p.kind === filter);
  if (filter === 'urgent') return list.filter((p) => p.urgency !== 'basic');
  return list;
}

export function ProblemsScreen({ view }: { view: ProblemsView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const unread = useNotifications().data?.filter((n) => !n.read).length ?? 0;

  const [filter, setFilter] = useState<Filter>('all');
  const [viewport, setViewport] = useState<{ bbox: BBox; zoom: number } | null>(null);
  const [selected, setSelected] = useState<Card | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [myPosition, setMyPosition] = useState<LatLng | null>(null);
  const [flyTo, setFlyTo] = useState<{ center: LatLng; zoom?: number; key: number } | null>(null);

  const origin = myPosition ?? DEFAULT_VIEW.center;
  const mapData = useMap(viewport?.bbox ?? null, viewport?.zoom ?? DEFAULT_VIEW.zoom);
  const nearby = useNearby(DEFAULT_VIEW.center);

  const filteredMap = useMemo(() => {
    const d = mapData.data;
    if (!d || d.mode !== 'incidents') return d;
    return { ...d, problems: applyFilter(d.problems, filter) };
  }, [mapData.data, filter]);
  const list = useMemo(() => applyFilter(nearby.data ?? [], filter), [nearby.data, filter]);
  const distance = (p: Card) => distanceLabel(distanceMeters(origin, p.area.center));

  function locate() {
    const fallback = () => setFlyTo({ center: DEFAULT_VIEW.center, zoom: 15, key: Date.now() });
    if (!('geolocation' in navigator)) return fallback();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyPosition(p);
        setFlyTo({ center: p, zoom: 15, key: Date.now() });
      },
      fallback,
      { timeout: 5000, maximumAge: 60_000 },
    );
  }

  const setView = (v: ProblemsView) =>
    void navigate({ to: '/problems', search: { view: v }, replace: true });

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('problems.filter.all') },
    { id: 'urgent', label: t('problems.filter.urgent') },
    { id: 'request', label: t('problems.filter.personal') },
    { id: 'issue', label: t('problems.filter.community') },
  ];

  const header = (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full bg-white px-4 text-left shadow-[0_4px_16px_rgb(20_32_27/0.14)]"
      >
        <MapPin size={18} className="shrink-0 text-brand" strokeWidth={2.2} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] leading-none font-semibold text-muted">
            {t('problems.near')}
          </span>
          <span className="block truncate text-[15px] leading-snug font-bold">
            Bartók Béla út · XI
          </span>
        </span>
        <ChevronDown size={18} className="text-ink-2" />
      </button>
      <Link
        to="/notifications"
        aria-label={t('problems.notifications', { count: unread })}
        className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-white text-ink shadow-[0_4px_16px_rgb(20_32_27/0.14)] md:hidden"
      >
        <Bell size={21} />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-coral px-1 text-[10px] font-extrabold text-white">
            {unread}
          </span>
        )}
      </Link>
    </div>
  );

  const chips = (
    <div className="flex items-center gap-2">
      <div className="no-scrollbar -mx-1 -my-1.5 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'h-9 shrink-0 rounded-full px-3.5 text-[13px] whitespace-nowrap shadow-[0_2px_6px_rgb(20_32_27/0.12)] transition-colors',
              filter === f.id ? 'bg-ink font-bold text-white' : 'bg-white font-semibold text-ink',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div
        role="group"
        aria-label={t('problems.view')}
        className="flex h-9 shrink-0 rounded-full bg-white p-[3px] shadow-[0_4px_12px_rgb(20_32_27/0.12)] md:hidden"
      >
        {(['map', 'list'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn(
              'rounded-full px-3 text-[12px]',
              view === v ? 'bg-brand-tint font-bold text-brand-ink' : 'font-semibold text-ink-2',
            )}
          >
            {t(`problems.${v}`)}
          </button>
        ))}
      </div>
    </div>
  );

  const listBody = nearby.isPending ? (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[92px]" />
      ))}
    </div>
  ) : list.length === 0 ? (
    <EmptyState
      art={<Hexie mood="sleepy" />}
      title={t('problems.emptyTitle')}
      body={t('problems.emptyBody')}
      action={
        <Link to="/create" className={buttonClass('primary', 'md')}>
          {t('problems.postOne')}
        </Link>
      }
    />
  ) : (
    <ul className="flex flex-col gap-2.5">
      {list.map((p) => (
        <li key={p.id}>
          <ProblemCard
            problem={p}
            distance={distance(p)}
            myLanguages={me.data?.languages}
            className={cn(selected?.id === p.id && 'ring-2 ring-brand')}
          />
        </li>
      ))}
    </ul>
  );

  const listTitle = (
    <div className="mb-2.5 flex items-baseline justify-between">
      <h2 className="font-display text-[19px] font-bold tracking-tight">
        {t('problems.openNearby', { count: list.length })}
      </h2>
      <span className="text-[12px] font-semibold text-muted">{t('problems.mostUrgent')}</span>
    </div>
  );

  return (
    <div className="relative flex h-[calc(100dvh-84px)] md:h-dvh">
      {/* Desktop list column */}
      <section
        aria-label={t('problems.listLabel')}
        className="hidden w-[420px] shrink-0 flex-col border-r border-line bg-paper md:flex"
      >
        <div className="flex flex-col gap-3 px-5 pt-5 pb-3">
          {header}
          {chips}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          {listTitle}
          {listBody}
        </div>
      </section>

      {/* Map (always on desktop; on phones unless list view) */}
      <div className={cn('relative min-w-0 flex-1', view === 'list' && 'hidden md:block')}>
        <Suspense fallback={<div className="absolute inset-0 bg-[#ECEEE6]" />}>
          <ProblemMap
            data={filteredMap}
            selectedId={selected?.id ?? null}
            onSelect={(p) => {
              setSelected(p);
              setExpanded(false);
            }}
            onViewChange={(bbox, zoom) => setViewport({ bbox, zoom })}
            me={myPosition}
            flyTo={flyTo}
          />
        </Suspense>
        {mapData.data?.mode === 'clusters' && (
          <p className="pointer-events-none absolute top-[132px] left-1/2 -translate-x-1/2 rounded-full bg-ink/85 px-3.5 py-1.5 text-[12px] font-bold text-white md:top-5">
            {t('problems.zoomIn')}
          </p>
        )}
        <button
          type="button"
          onClick={locate}
          aria-label={t('problems.locate')}
          className="absolute right-4 bottom-[calc(42%+14px)] flex size-[46px] items-center justify-center rounded-full bg-white text-sapphire shadow-[0_4px_14px_rgb(20_32_27/0.18)] md:bottom-6"
        >
          <LocateFixed size={21} />
        </button>
      </div>

      {/* Phone overlays */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2.5 px-4 pt-[max(16px,env(safe-area-inset-top))] md:hidden">
        <div className="pointer-events-auto">{header}</div>
        <div className="pointer-events-auto">{chips}</div>
      </div>

      {view === 'list' ? (
        <section
          aria-label={t('problems.listLabel')}
          className="absolute inset-0 overflow-y-auto bg-paper px-4 pt-[140px] pb-6 md:hidden"
        >
          {listTitle}
          {listBody}
        </section>
      ) : selected ? (
        <div className="absolute inset-x-3 bottom-3 z-10 md:hidden">
          <div className="relative">
            <ProblemCard
              problem={selected}
              distance={distance(selected)}
              myLanguages={me.data?.languages}
              className="pr-11 shadow-[0_12px_32px_-6px_rgb(14_26_20/0.35)]"
            />
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label={t('common.close')}
              className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full text-ink-2 hover:bg-black/5"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      ) : (
        <section
          aria-label={t('problems.listLabel')}
          className={cn(
            'absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-[24px] bg-paper shadow-[0_-8px_24px_rgb(20_32_27/0.12)] transition-[height] duration-300 md:hidden',
            expanded ? 'h-[82%]' : 'h-[42%]',
          )}
        >
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? t('problems.collapse') : t('problems.expand')}
            aria-expanded={expanded}
            className="flex h-6 shrink-0 items-center justify-center"
          >
            <span className="h-[5px] w-10 rounded-full bg-line-strong" />
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {listTitle}
            {listBody}
          </div>
        </section>
      )}
    </div>
  );
}
