import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { maplibregl } from '../problems/maplibre';
import type { Kind, Precision } from '@helpin/config';
import { cellPolygon, snapToArea, type LatLng } from '@helpin/geo';
import { MAP_STYLE } from '../problems/mapStyle';

/**
 * Pick a spot by moving the map under a fixed pin. The shaded hexagon is exactly what other
 * people will see (L-01), so the privacy trade-off is visible while choosing.
 */
export function LocationPicker({
  point,
  precision,
  kind,
  onChange,
  flyTo,
}: {
  point: LatLng;
  precision: Precision;
  kind: Kind;
  onChange: (p: LatLng) => void;
  flyTo: { center: LatLng; key: number } | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const changed = useRef(onChange);
  useLayoutEffect(() => {
    changed.current = onChange;
  });

  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE,
      center: [point.lng, point.lat],
      zoom: 13.2,
      minZoom: 12,
      maxZoom: 17.5,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.on('load', () => {
      m.addSource('area', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#0A7A56', 'fill-opacity': 0.16 } });
      m.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#0A7A56', 'line-width': 2.5, 'line-dasharray': [3, 2] } });
      setMap(m);
    });
    m.on('moveend', () => {
      const c = m.getCenter();
      changed.current({ lat: c.lat, lng: c.lng });
    });
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is created once
  }, []);

  useEffect(() => {
    const src = map?.getSource('area') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const area = snapToArea(point, kind === 'request' && precision === 'exact' ? 'standard' : precision, kind);
    src.setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [cellPolygon(area.areaCell)] } });
  }, [map, point, precision, kind]);

  useEffect(() => {
    if (map && flyTo) map.flyTo({ center: [flyTo.center.lng, flyTo.center.lat], zoom: 13.6, duration: 700 });
  }, [map, flyTo]);

  return (
    <div className="relative h-[260px] overflow-hidden rounded-[20px] border border-line bg-[#ECEEE6]">
      <div ref={container} className="absolute inset-0" />
      {/* fixed centre pin */}
      <svg aria-hidden width="34" height="42" viewBox="0 0 34 42" className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full drop-shadow-md">
        <path d="M17,41 C17,41 2,25 2,15 a15,15 0 0 1 30,0 C32,25 17,41 17,41 Z" fill="#0E1A14" />
        <circle cx="17" cy="15" r="5.5" fill="#FFC531" />
      </svg>
    </div>
  );
}
