import { latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import {
  cellPolygon,
  cellsForBbox,
  distanceLabel,
  GeoRuleError,
  isInLaunchArea,
  resolutionForZoom,
  snapToArea,
} from './index';

const home = { lat: 47.47512, lng: 19.04971 }; // near Bartók Béla út, District XI

describe('snapToArea (L-01, L-02)', () => {
  it('is deterministic: the same point always gives the same public cell', () => {
    const a = snapToArea(home, 'standard', 'request');
    const b = snapToArea({ ...home }, 'standard', 'request');
    expect(a.areaCell).toBe(b.areaCell);
  });

  it('different points inside one cell are indistinguishable publicly', () => {
    const { center } = snapToArea(home, 'standard', 'request');
    const a = snapToArea({ lat: center.lat + 0.0008, lng: center.lng - 0.0008 }, 'standard', 'request');
    const b = snapToArea({ lat: center.lat - 0.0008, lng: center.lng + 0.0008 }, 'standard', 'request');
    expect(b.areaCell).toBe(a.areaCell);
    expect(b.center).toEqual(a.center);
  });

  it('never returns the exact point as the public centre', () => {
    const area = snapToArea(home, 'standard', 'request');
    expect(area.center.lat).not.toBe(home.lat);
    expect(area.center.lng).not.toBe(home.lng);
  });

  it('uses res 8 by default, res 7 for wider areas', () => {
    expect(snapToArea(home, 'standard', 'request').areaRes).toBe(8);
    const wider = snapToArea(home, 'wider', 'request');
    expect(wider.areaRes).toBe(7);
    expect(wider.cellR8).toBeNull();
  });

  it('allows an exact public spot (res 9) only for community problems', () => {
    expect(snapToArea(home, 'exact', 'issue').areaRes).toBe(9);
    expect(() => snapToArea(home, 'exact', 'request')).toThrow(GeoRuleError);
  });

  it('derives consistent parent cells', () => {
    const exact = snapToArea(home, 'exact', 'issue');
    const standard = snapToArea(home, 'standard', 'issue');
    expect(exact.cellR8).toBe(standard.areaCell);
    expect(exact.cellR7).toBe(standard.cellR7);
  });
});

describe('map helpers', () => {
  it('returns a closed GeoJSON ring', () => {
    const ring = cellPolygon(snapToArea(home, 'standard', 'request').areaCell);
    expect(ring.length).toBe(7);
    expect(ring[0]).toEqual(ring[6]);
  });

  it('picks resolution from zoom', () => {
    expect(resolutionForZoom(15)).toBe(8);
    expect(resolutionForZoom(12.5)).toBe(8);
    expect(resolutionForZoom(12)).toBe(7);
    expect(resolutionForZoom(9)).toBe(6);
  });

  it('caps oversized viewports', () => {
    expect(() => cellsForBbox([18.9, 47.3, 19.4, 47.7], 8, 400)).toThrow(GeoRuleError);
    expect(cellsForBbox([19.04, 47.47, 19.06, 47.48], 8).length).toBeGreaterThan(0);
    // Zoomed far in: a viewport smaller than one cell still maps to the cell under it.
    const tiny = cellsForBbox([19.0481, 47.4772, 19.0483, 47.4773], 8);
    expect(tiny).toEqual([latLngToCell(47.47725, 19.0482, 8)]);
    // Partly visible cells at the edges count too.
    const box: [number, number, number, number] = [19.04, 47.47, 19.06, 47.48];
    for (const [lat, lng] of [[47.47, 19.04], [47.48, 19.06]]) expect(cellsForBbox(box, 8)).toContain(latLngToCell(lat!, lng!, 8));
  });

  it('knows Budapest', () => {
    expect(isInLaunchArea(home)).toBe(true);
    expect(isInLaunchArea({ lat: 48.2082, lng: 16.3738 })).toBe(false); // Vienna
  });

  it('rounds distances for privacy', () => {
    expect(distanceLabel(420)).toBe('~400 m');
    expect(distanceLabel(30)).toBe('~100 m');
    expect(distanceLabel(1440)).toBe('~1.4 km');
  });
});
