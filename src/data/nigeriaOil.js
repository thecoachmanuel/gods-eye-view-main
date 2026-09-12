import { createLocalGeoJsonLayer } from './localGeojsonCore.js';

// GeoJSON Lines file with key oil & gas infrastructure in Nigeria:
// refineries, LNG terminals, offshore FPSOs, gas plants, and oil terminals.
// Covers both onshore Niger Delta and deep-water offshore Gulf of Guinea assets.
const nigeriaOilUrl = new URL(
  './local_data/nigeria_oil/nigeria-oil.geojsonl',
  import.meta.url,
).href;

/**
 * Create the Nigeria Oil & Gas Infrastructure overlay layer.
 *
 * Plots refineries, FPSO vessels, oil terminals, LNG terminals, and gas plants
 * as amber-colored pins. Useful for monitoring the Nigerian oil sector,
 * tracking vessel activity near offshore platforms, and correlating FIRMS
 * fire data with gas flaring sites.
 *
 * The layer id 'local-nigeria-oil' is registered in layerState.js (token 'o').
 *
 * @param {object} services Caller-owned context, overlay and render operations.
 * @returns {object} Layer object compatible with the localLayers export array.
 */
export function createNigeriaOilLayer(services) {
  return createLocalGeoJsonLayer(
    {
      id: 'local-nigeria-oil',
      url: nigeriaOilUrl,
      name: 'Nigeria Oil & Gas',
      color: '#ffaa00',   // Amber/petroleum orange — instantly recognizable
      icon: '⬡',
      source: 'NNPCL / Open',
      labels: true,
      labelMax: 1500000, // Visible from regional zoom (~1,500 km)
      labelGridPx: 130,
    },
    services,
  );
}
