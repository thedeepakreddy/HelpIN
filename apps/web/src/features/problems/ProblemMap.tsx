import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { maplibregl } from './maplibre';
import type { FeatureCollection } from 'geojson';
import { LAUNCH_AREA } from '@helpin/config';
import type { MapResponse, ProblemCard } from '@helpin/contracts';
import { cellPolygon, type BBox, type LatLng } from '@helpin/geo';
import { Languages, TriangleAlert, Users } from 'lucide-react';
import { CategoryIcon, languagePair } from '../../components/domain/problem';
import { cn } from '../../lib/cn';
import { DEFAULT_VIEW, MAP_STYLE } from './mapStyle';

const URGENCY_COLOR = { basic: '#2352E0', medium: '#F28C00', serious: '#E8452C' } as const;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function areasGeoJson(data: MapResponse | undefined, selectedId: string | null): FeatureCollection {
  if (!data || data.mode !== 'incidents') return EMPTY;
  return {
    type: 'FeatureCollection',
    features: data.problems.map((p) => ({
      type: 'Feature',
      // Wider (res 7) areas are big; draw them quietly so they don't swamp the map.
      properties: { color: URGENCY_COLOR[p.urgency], selected: p.id === selectedId ? 1 : 0, wide: p.area.areaRes === 7 ? 1 : 0 },
      geometry: { type: 'Polygon', coordinates: [cellPolygon(p.area.areaCell)] },
    })),
  };
}

export function ProblemMap({
  data,
  selectedId,
  onSelect,
  onViewChange,
  me,
  flyTo,
  className,
}: {
  data: MapResponse | undefined;
  selectedId: string | null;
  onSelect: (problem: ProblemCard) => void;
  onViewChange: (bbox: BBox, zoom: number) => void;
  me?: LatLng | null;
  flyTo?: { center: LatLng; zoom?: number; key: number } | null;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const viewChange = useRef(onViewChange);
  useLayoutEffect(() => {
    viewChange.current = onViewChange;
  });

  useEffect(() => {
    if (!container.current) return;
    const [w, s, e, n] = LAUNCH_AREA.bbox;
    const m = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE,
      center: [DEFAULT_VIEW.center.lng, DEFAULT_VIEW.center.lat],
      zoom: DEFAULT_VIEW.zoom,
      minZoom: 9.5,
      maxZoom: 17.5,
      maxBounds: [
        [w - 0.08, s - 0.05],
        [e + 0.08, n + 0.05],
      ],
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    // On phones the problem list covers the lower part of the map.
    if (window.matchMedia('(max-width: 767px)').matches) m.setPadding({ top: 120, bottom: Math.round(window.innerHeight * 0.36), left: 0, right: 0 });
    const emit = () => {
      const b = m.getBounds();
      viewChange.current([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], m.getZoom());
    };
    m.on('load', () => {
      m.addSource('areas', { type: 'geojson', data: EMPTY });
      m.addLayer({
        id: 'areas-fill',
        type: 'fill',
        source: 'areas',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['==', ['get', 'selected'], 1], 0.26, ['==', ['get', 'wide'], 1], 0.05, 0.14],
        },
      });
      m.addLayer({
        id: 'areas-line',
        type: 'line',
        source: 'areas',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['==', ['get', 'selected'], 1], 3, ['==', ['get', 'wide'], 1], 1.2, 2],
          'line-opacity': ['case', ['==', ['get', 'wide'], 1], 0.6, 1],
        },
      });
      setMap(m);
      emit();
    });
    m.on('moveend', emit);
    return () => m.remove();
  }, []);

  useEffect(() => {
    const src = map?.getSource('areas') as maplibregl.GeoJSONSource | undefined;
    src?.setData(areasGeoJson(data, selectedId));
  }, [map, data, selectedId]);

  useEffect(() => {
    if (map && flyTo) map.flyTo({ center: [flyTo.center.lng, flyTo.center.lat], zoom: flyTo.zoom ?? map.getZoom(), duration: 700 });
  }, [map, flyTo]);

  return (
    <div ref={container} className={cn('absolute inset-0', className)} role="region" aria-label="Map of problems">
      {map && data?.mode === 'incidents' &&
        data.problems.map((p, i) => (
          <MapMarker key={p.id} map={map} at={p.area.center} offsetY={stackOffset(data.problems, i)}>
            <ProblemPin problem={p} selected={p.id === selectedId} onClick={() => onSelect(p)} />
          </MapMarker>
        ))}
      {map && data?.mode === 'clusters' &&
        data.clusters.map((c) => (
          <MapMarker key={c.cell} map={map} at={c.center}>
            <button
              type="button"
              aria-label={`${c.count} problems here. Zoom in`}
              onClick={() => map.flyTo({ center: [c.center.lng, c.center.lat], zoom: Math.max(map.getZoom() + 2, 12.8) })}
              className="hex flex size-12 items-center justify-center text-[16px] font-extrabold text-white"
              style={{ background: URGENCY_COLOR[c.maxUrgency] }}
            >
              {c.count}
            </button>
          </MapMarker>
        ))}
      {map && me && (
        <MapMarker map={map} at={me}>
          <span aria-label="You are here" role="img" className="relative flex size-9 items-center justify-center">
            <span className="absolute inset-0 rounded-full bg-sapphire/20" />
            <span className="size-3.5 rounded-full border-[3px] border-white bg-sapphire shadow" />
          </span>
        </MapMarker>
      )}
    </div>
  );
}

/** Problems can share a public centre (same hexagon); stack their pins instead of hiding one. */
function stackOffset(list: ProblemCard[], index: number): number {
  const key = (p: ProblemCard) => `${p.area.center.lat.toFixed(4)},${p.area.center.lng.toFixed(4)}`;
  const k = key(list[index]!);
  return -38 * list.slice(0, index).filter((p) => key(p) === k).length;
}

/** Renders React children into a MapLibre marker element via a portal. */
function MapMarker({ map, at, offsetY = 0, children }: { map: maplibregl.Map; at: LatLng; offsetY?: number; children: ReactNode }) {
  const [el] = useState(() => document.createElement('div'));
  const marker = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    marker.current = new maplibregl.Marker({ element: el, offset: [0, offsetY] }).setLngLat([at.lng, at.lat]).addTo(map);
    return () => {
      marker.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- position updates are handled below
  }, [map, el, offsetY]);
  useEffect(() => {
    marker.current?.setLngLat([at.lng, at.lat]);
  }, [at.lat, at.lng]);
  return createPortal(children, el);
}

function ProblemPin({ problem, selected, onClick }: { problem: ProblemCard; selected: boolean; onClick: () => void }) {
  const serious = problem.urgency === 'serious';
  const label = problem.languageNeeded
    ? `${languagePair(problem.languageNeeded).from.toUpperCase()}→${languagePair(problem.languageNeeded).to.toUpperCase()}`
    : problem.kind === 'issue'
      ? String(problem.affectedCount)
      : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={problem.title}
      aria-pressed={selected}
      className={cn(
        'flex items-center gap-1.5 rounded-full font-bold whitespace-nowrap transition-transform',
        serious
          ? 'h-10 bg-coral pr-3.5 pl-2.5 text-[14px] text-white shadow-[0_6px_14px_rgb(232_69_44/0.4)]'
          : 'h-8 bg-white px-2 text-[12px] shadow-[0_4px_10px_rgb(20_32_27/0.22)]',
        !serious && (problem.urgency === 'medium' ? 'text-amber-ink' : 'text-sapphire-ink'),
        !label && !serious && 'w-8 justify-center px-0',
        selected && 'scale-115 ring-3 ring-ink',
      )}
    >
      {problem.languageNeeded ? (
        <Languages size={16} strokeWidth={2.3} />
      ) : serious ? (
        <TriangleAlert size={18} strokeWidth={2.3} />
      ) : problem.kind === 'issue' ? (
        <Users size={16} strokeWidth={2.3} />
      ) : (
        <CategoryIcon categoryId={problem.categoryId} size={16} strokeWidth={2.3} />
      )}
      {label}
    </button>
  );
}
