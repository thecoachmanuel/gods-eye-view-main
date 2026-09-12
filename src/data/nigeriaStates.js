import { createLocalGeoJsonLayer } from './localGeojsonCore.js';

// GeoJSON Lines file with all 36 Nigerian states + FCT as Point features.
// Each feature has the state name, capital, geopolitical zone, and population.
// Resolved by Vite at build time; relative import in dev via import.meta.url.
const nigeriaStatesUrl = new URL(
  './local_data/nigeria_states/nigeria-states.geojsonl',
  import.meta.url,
).href;

/**
 * Create the Nigeria States overlay layer.
 *
 * Plots all 36 state capitals + FCT as labeled map pins. The label shows the
 * state name; selecting a pin shows the capital city and geopolitical region.
 *
 * The layer id 'local-nigeria-states' is registered in layerState.js (token
 * 'n') so it can be toggled via the layer panel and encoded in share links.
 *
 * @param {object} services Caller-owned context, overlay and render operations.
 * @returns {object} Layer object compatible with the localLayers export array.
 */
export function createNigeriaStatesLayer(services) {
  return createLocalGeoJsonLayer(
    {
      id: 'local-nigeria-states',
      url: nigeriaStatesUrl,
      name: 'Nigeria States',
      color: '#00e676',   // Vivid green — distinct from oil (amber) and incidents (red)
      icon: '◉',
      source: 'NGA Admin',
      labels: true,
      labelMax: 3000000, // Visible from state-level zoom (~3,000 km)
      labelGridPx: 120,
    },
    services,
  );
}
