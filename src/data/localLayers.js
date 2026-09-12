import { localGeoJsonServices } from './localGeojson.js';
import { createInfrastructureLayers } from './infrastructure.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import submarineCablesLayer from './telegeographySubmarineCables.js';
import { createNigeriaStatesLayer } from './nigeriaStates.js';
import { createNigeriaOilLayer } from './nigeriaOil.js';
import { createNigeriaIncidentsLayer } from './nigeriaIncidents.js';

const [datacenters, dams] = createInfrastructureLayers(localGeoJsonServices);

// Live NASA FIRMS fires (VIIRS ×3 NRT via the /api/firms proxy). The id keeps
// the historical `local-` prefix for persistence + voice-tool-enum compat,
// but the data is NOT bundled anymore — it needs FIRMS_MAP_KEY server-side.
const fires = createFirmsHeatmapLayer({
  id: 'local-firms',
  name: 'FIRMS Active Fires',
  icon: '▲',
  source: 'NASA FIRMS · LIVE',
});

// ── Nigeria Intelligence Layers ──────────────────────────────────────────────
// Three toggleable data layers for Nigerian situational awareness:
//   local-nigeria-states    (token 'n') — 36 states + FCT state capital pins
//   local-nigeria-oil       (token 'o') — refineries, FPSOs, LNG terminals
//   local-nigeria-incidents (token 'j') — security hotspots and conflict zones
const nigeriaStates = createNigeriaStatesLayer(localGeoJsonServices);
const nigeriaOil = createNigeriaOilLayer(localGeoJsonServices);
const nigeriaIncidents = createNigeriaIncidentsLayer(localGeoJsonServices);

export default [
  datacenters,
  dams,
  submarineCablesLayer,
  fires,
  nigeriaStates,
  nigeriaOil,
  nigeriaIncidents,
];

