import { createLocalGeoJsonLayer } from './localGeojsonCore.js';

// GeoJSON Lines file with major Nigerian security incident zones and hotspots:
// banditry corridors (NW Nigeria), Boko Haram/ISWAP zones (NE Nigeria),
// farmer-herder conflict areas (Middle Belt), Niger Delta militancy, and
// Gulf of Guinea maritime piracy zones.
//
// The dataset is bundled as a static snapshot for offline use. It can be
// replaced or supplemented with a live ACLED API fetch by swapping `url`
// for a server-side proxy endpoint (e.g. /api/nigeria-incidents) once an
// ACLED API key is obtained via acleddata.com/access-data.
const nigeriaIncidentsUrl = new URL(
  './local_data/nigeria_incidents/nigeria-incidents.geojsonl',
  import.meta.url,
).href;

/**
 * Create the Nigeria Security Incidents overlay layer.
 *
 * Plots major active security hotspots as red warning pins:
 *   - NW Banditry: Zamfara Forest, Birnin Gwari corridor, Gusau zone
 *   - NE Insurgency: Sambisa Forest, Gwoza Hills, Lake Chad ISWAP islands
 *   - Middle Belt: Benue farmer-herder clashes, Plateau State communal violence
 *   - South South: Niger Delta militancy, Warri creek piracy, Brass terminal
 *
 * Combine with the FIRMS fire layer to correlate farmland burning with
 * conflict events, and with the vessel tracking layer to watch suspicious
 * activity near offshore platforms.
 *
 * The layer id 'local-nigeria-incidents' is registered in layerState.js
 * (token 'j').
 *
 * @param {object} services Caller-owned context, overlay and render operations.
 * @returns {object} Layer object compatible with the localLayers export array.
 */
export function createNigeriaIncidentsLayer(services) {
  return createLocalGeoJsonLayer(
    {
      id: 'local-nigeria-incidents',
      url: nigeriaIncidentsUrl,
      name: 'Nigeria Security Zones',
      color: '#ff2244',   // Alert red — visually distinct and immediately recognizable
      icon: '▲',
      source: 'Open Intel',
      labels: true,
      labelMax: 4000000, // Visible from national zoom (~4,000 km) down to street
      labelGridPx: 140,
    },
    services,
  );
}
