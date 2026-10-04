/**
 * Location privacy helpers (Domain §5). The public location of a problem is always an H3
 * cell, drawn at the cell centre — never the exact point (L-01). Snapping to a fixed grid is
 * deterministic, so repeated posts can't be averaged back to a home address (ADR-003).
 */
import {
  cellToBoundary,
  cellToLatLng,
  cellToParent,
  getResolution,
  gridDisk,
  latLngToCell,
  polygonToCells,
} from 'h3-js';
import { AREA_RESOLUTION, LAUNCH_AREA, type Kind, type Precision } from '@helpin/config';

export interface LatLng {
  lat: number;
  lng: number;
}

/** [west, south, east, north] */
export type BBox = [number, number, number, number];

export interface PublicArea {
  areaCell: string;
  areaRes: 7 | 8 | 9;
  /** null when the public area is a (larger) res-7 cell */
  cellR8: string | null;
  cellR7: string;
  cellR6: string;
  /** Where the card is drawn: the cell centre, never the exact point. */
  center: LatLng;
}

export class GeoRuleError extends Error {
  constructor(
    public readonly code: 'EXACT_SPOT_ONLY_FOR_ISSUES' | 'BBOX_TOO_LARGE',
    message: string,
  ) {
    super(message);
  }
}

/** L-02: res 9 ("exact public spot") is only allowed for community problems. */
export function allowedPrecisions(kind: Kind): Precision[] {
  return kind === 'issue' ? ['standard', 'wider', 'exact'] : ['standard', 'wider'];
}

export function snapToArea(point: LatLng, precision: Precision, kind: Kind): PublicArea {
  if (!allowedPrecisions(kind).includes(precision)) {
    throw new GeoRuleError(
      'EXACT_SPOT_ONLY_FOR_ISSUES',
      'An exact public spot is only allowed for community problems (L-02).',
    );
  }
  const res = AREA_RESOLUTION[precision];
  const areaCell = latLngToCell(point.lat, point.lng, res);
  return describeCell(areaCell);
}

export function describeCell(areaCell: string): PublicArea {
  const res = getResolution(areaCell) as 7 | 8 | 9;
  const [lat, lng] = cellToLatLng(areaCell);
  return {
    areaCell,
    areaRes: res,
    cellR8: res >= 8 ? (res === 8 ? areaCell : cellToParent(areaCell, 8)) : null,
    cellR7: res === 7 ? areaCell : cellToParent(areaCell, 7),
    cellR6: cellToParent(areaCell, 6),
    center: { lat, lng },
  };
}

export function cellCenter(cell: string): LatLng {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}

export function parentCell(cell: string, res: number): string {
  return getResolution(cell) <= res ? cell : cellToParent(cell, res);
}

/** Closed GeoJSON ring ([lng, lat] pairs) for drawing a cell on the map. */
export function cellPolygon(cell: string): [number, number][] {
  const ring = cellToBoundary(cell, true) as [number, number][];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([...first]);
  return ring;
}

/**
 * Architecture §5.2: zoomed in → res-8 incidents, middle → res-7 clusters, far → res-6.
 * A res-8 area is ~1 km across, so individual problems already make sense from zoom 12.5
 * (a phone then shows a few neighbourhoods).
 */
export function resolutionForZoom(zoom: number): 6 | 7 | 8 {
  if (zoom >= 12.5) return 8;
  if (zoom >= 10) return 7;
  return 6;
}

export function cellsForBbox(bbox: BBox, res: number, maxCells = 400): string[] {
  const [w, s, e, n] = bbox;
  const polygon = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
  // polygonToCells only returns cells whose centre is inside the box. Add the cells under the
  // corners and the centre too, so partly visible cells count and a viewport smaller than one
  // cell (zoomed far in) still has a cell, never an empty list.
  const edge = [
    [s, w],
    [s, e],
    [n, e],
    [n, w],
    [(s + n) / 2, (w + e) / 2],
  ].map(([lat, lng]) => latLngToCell(lat!, lng!, res));
  const cells = [...new Set([...polygonToCells(polygon, res, true), ...edge])];
  if (cells.length > maxCells) {
    throw new GeoRuleError('BBOX_TOO_LARGE', `Viewport covers ${cells.length} cells at res ${res}.`);
  }
  return cells;
}

/** Cells within k rings of a cell (notification fan-out, "same here" suggestions). */
export function ringCells(cell: string, k: number): string[] {
  return gridDisk(cell, k);
}

export function isInLaunchArea(point: LatLng, bbox: BBox = LAUNCH_AREA.bbox): boolean {
  const [w, s, e, n] = bbox;
  return point.lng >= w && point.lng <= e && point.lat >= s && point.lat <= n;
}

/** Great-circle distance in metres (for "~400 m" labels). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rounded, privacy-friendly distance label: "~400 m", "~1.4 km". */
export function distanceLabel(meters: number): string {
  if (meters < 1000) return `~${Math.max(100, Math.round(meters / 100) * 100)} m`;
  return `~${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}
