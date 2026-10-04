import type { StyleSpecification } from 'maplibre-gl';

/** Where the map opens: around Bartók Béla út, District XI (the demo neighbourhood). */
export const DEFAULT_VIEW = { center: { lat: 47.4738, lng: 19.0515 }, zoom: 12.8 };

/**
 * Our own "Tram & Danube" basemap on OpenFreeMap vector tiles (no API key, no tracking). Only the
 * layers we need, in brand colours, so the hexagons and pins are the loudest thing on the map.
 */
export const MAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenStreetMap contributors · OpenFreeMap' },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#ECEEE6' } },
    { id: 'green', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#D6E5CB' } },
    {
      id: 'wood',
      type: 'fill',
      source: 'omt',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood']]],
      paint: { 'fill-color': '#DCE8D2', 'fill-opacity': 0.8 },
    },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#B9D3E3' } },
    { id: 'buildings', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': '#E2E4DA' } },
    {
      id: 'roads-minor',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]],
      paint: { 'line-color': '#F9F9F5', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 6] },
    },
    {
      id: 'roads-major',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
      paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 11] },
    },
    {
      id: 'tram',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      filter: ['==', ['get', 'subclass'], 'tram'],
      paint: { 'line-color': '#FFC531', 'line-width': 1.6, 'line-opacity': 0.8 },
    },
    {
      id: 'street-names',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'transportation_name',
      minzoom: 14,
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
      paint: { 'text-color': '#6F7A73', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.2 },
    },
    {
      id: 'places',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'quarter']]],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08 },
      paint: { 'text-color': '#8A948D', 'text-halo-color': '#ECEEE6', 'text-halo-width': 1.5 },
    },
  ],
};

