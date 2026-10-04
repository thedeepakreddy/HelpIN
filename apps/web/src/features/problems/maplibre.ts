import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// MapLibre 6 finds its worker next to its own module file, which no longer exists once Vite
// bundles it. Point it at the worker bundle Vite builds for us instead.
maplibregl.setWorkerUrl(workerUrl);

export { maplibregl };
