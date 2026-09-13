/**
 * @module server/providers/incidents
 *
 * Real-time incident detection aggregator for God's Eye View.
 *
 * Aggregates live threat and hazard data from:
 *   1. NASA FIRMS (VIIRS NOAA-20)  — active fire hotspots (all Nigeria/Africa + global)
 *   2. USGS Earthquakes Feed       — real-time global seismic/disaster events
 *   3. Live Security & News Alerts — geotagged conflict, banditry, and disaster reports
 *
 * All sources are cached for INCIDENT_CACHE_MS to stay within upstream rate limits.
 * Each incident is normalised to a unified schema before being served via:
 *   GET /api/incidents             — all current incidents (optionally filtered by bbox)
 *
 * @example
 *   GET /api/incidents?lat=9.1&lon=7.4&radius=500   (radius in km)
 *   GET /api/incidents?types=fire,banditry
 *   GET /api/incidents?country=Nigeria
 */

import { resolveNigeriaLocation, isInsideNigeria } from './nigeria-geo.js';

const INCIDENT_CACHE_MS = 5 * 60 * 1000; // 5 minutes

/** @type {Array<object>} Cached incident list */
let _incidentCache = [];
let _incidentCacheAt = 0;
let _incidentInflight = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toFinite(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function haversineDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── NASA FIRMS ───────────────────────────────────────────────────────────────

/**
 * Fetch active fire hotspots from NASA FIRMS CSV feed.
 * Uses VIIRS_NOAA20_NRT (375m resolution) for the last 24h, globally.
 */
async function loadFirmsIncidents() {
  try {
    const mapKey = String(process.env.FIRMS_MAP_KEY || '').trim();
    const baseUrl = mapKey
      ? `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_NOAA20_NRT/-20,-35,55,40/1`
      : 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv';

    const resp = await fetch(baseUrl, {
      headers: { 'User-Agent': 'gods-eye-view-incidents/1.0' },
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      console.warn('[Incidents] FIRMS fetch failed:', resp.status);
      return [];
    }
    const text = await resp.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const latIdx = headers.indexOf('latitude');
    const lonIdx = headers.indexOf('longitude');
    const frpIdx = headers.indexOf('frp'); // Fire Radiative Power MW
    const dateIdx = headers.indexOf('acq_date');
    const timeIdx = headers.indexOf('acq_time');
    const confIdx = headers.indexOf('confidence');

    const incidents = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const lat = toFinite(cols[latIdx], NaN);
      const lon = toFinite(cols[lonIdx], NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const frp = toFinite(cols[frpIdx], 0);
      const conf = String(cols[confIdx] || '').trim().toLowerCase();
      if (conf === 'l' || conf === 'low') continue;

      // Always include all fires in Nigeria:
      const isNigeria = isInsideNigeria(lat, lon);
      // For the rest of the world, filter to higher FRP to keep dataset performant:
      if (!isNigeria && frp < 25.0) continue;

      const date = String(cols[dateIdx] || '').trim();
      const time = String(cols[timeIdx] || '').trim().padStart(4, '0');
      const detectedAt = date ? `${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z` : new Date().toISOString();

      const severity = frp > 100 ? 'critical' : frp > 30 ? 'high' : frp > 10 ? 'medium' : 'low';

      let geo = null;
      if (isNigeria) {
        geo = resolveNigeriaLocation(lat, lon);
      }

      let title = '';
      if (isNigeria && geo?.city) {
        title = `🔥 ${geo.city} Fire (${frp.toFixed(1)} MW) · ${geo.stateShort || geo.state}`;
      } else if (isNigeria) {
        title = `🔥 Nigeria Active Fire Hotspot (${frp.toFixed(1)} MW)`;
      } else {
        title = `Active Wildfire Hotspot (${frp.toFixed(0)} MW)`;
      }

      const description = isNigeria && geo?.area
        ? `Satellite thermal detection · FRP: ${frp.toFixed(1)} MW · Area: ${geo.area} · State: ${geo.state} · Confidence: ${conf}`
        : `Satellite thermal detection · Fire Radiative Power: ${frp.toFixed(1)} MW · Confidence: ${conf}`;

      incidents.push({
        id: `firms-${lat.toFixed(4)}-${lon.toFixed(4)}-${date}`,
        type: 'fire',
        severity,
        lat,
        lon,
        title,
        source: 'NASA FIRMS · VIIRS NOAA-20',
        detectedAt,
        description,
        country: isNigeria ? 'Nigeria' : null,
        state: isNigeria ? geo?.state : null,
        stateShort: isNigeria ? geo?.stateShort : null,
        city: isNigeria ? geo?.city : null,
        lga: isNigeria ? geo?.lga : null,
        area: isNigeria ? geo?.area : null,
        locationFull: isNigeria ? geo?.locationFull : null,
        frp,
        confidence: conf,
      });

      if (incidents.length >= 1500) break;
    }
    console.log(`[Incidents] FIRMS loaded ${incidents.length} fire hotspots`);
    return incidents;
  } catch (err) {
    console.warn('[Incidents] FIRMS error:', err?.message || err);
    return [];
  }
}

// ─── USGS Earthquakes Feed ───────────────────────────────────────────────────

/**
 * Fetch real-time global seismic disaster events from USGS.
 * Keyless, sub-second latency, 100% reliable.
 */
async function loadEarthquakeIncidents() {
  try {
    const resp = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', {
      headers: { 'User-Agent': 'gods-eye-view-incidents/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const features = Array.isArray(data?.features) ? data.features : [];

    const incidents = features.map((f) => {
      const coords = f.geometry?.coordinates || [];
      const lon = coords[0];
      const lat = coords[1];
      const depth = coords[2];
      const props = f.properties || {};
      const mag = toFinite(props.mag, 0);
      const severity = mag >= 6.5 ? 'critical' : mag >= 5.0 ? 'high' : mag >= 3.5 ? 'medium' : 'low';

      return {
        id: `usgs-${f.id || props.code}`,
        type: 'explosion',
        severity,
        lat,
        lon,
        title: props.title || `M ${mag.toFixed(1)} Earthquake`,
        source: 'USGS · Earthquake Hazards Program',
        detectedAt: new Date(props.time || Date.now()).toISOString(),
        description: `${props.title} · Depth: ${depth?.toFixed(1) || '0'} km · Status: ${props.status || 'reviewed'}`,
        url: props.url || null,
        country: props.place ? props.place.split(',').pop().trim() : null,
      };
    }).filter((inc) => Number.isFinite(inc.lat) && Number.isFinite(inc.lon));

    console.log(`[Incidents] USGS loaded ${incidents.length} seismic events`);
    return incidents;
  } catch (err) {
    console.warn('[Incidents] USGS error:', err?.message || err);
    return [];
  }
}

// ─── Live Security & Conflict News Feed ───────────────────────────────────────

/**
 * Fetch breaking security, conflict, and disaster alerts from live news RSS feeds.
 * Geoparses locations across Nigeria and Africa. Keyless.
 */
async function loadNewsAlertIncidents() {
  try {
    const resp = await fetch('https://feeds.bbci.co.uk/news/world/africa/rss.xml', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const xml = await resp.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

    const REGION_CENTROIDS = {
      'Lagos': { lat: 6.5244, lon: 3.3792 },
      'Abuja': { lat: 9.0765, lon: 7.3986 },
      'Kano': { lat: 12.0022, lon: 8.5920 },
      'Port Harcourt': { lat: 4.8156, lon: 7.0498 },
      'Ibadan': { lat: 7.3775, lon: 3.9470 },
      'Kaduna': { lat: 10.5105, lon: 7.4165 },
      'Maiduguri': { lat: 11.8333, lon: 13.1500 },
      'Benin': { lat: 6.3350, lon: 5.6037 },
      'Enugu': { lat: 6.4584, lon: 7.5464 },
      'Jos': { lat: 9.8965, lon: 8.8583 },
      'Sokoto': { lat: 13.0609, lon: 5.2340 },
      'Nigeria': { lat: 9.0820, lon: 8.6753 },
      'Sudan': { lat: 12.8628, lon: 30.2176 },
      'Congo': { lat: -4.0383, lon: 21.7587 },
      'Somalia': { lat: 5.1521, lon: 46.1996 },
      'Kenya': { lat: -1.2921, lon: 36.8219 },
    };

    const incidents = [];
    for (const item of items) {
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
      const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/);
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      const dateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);

      const title = titleMatch ? titleMatch[1].trim() : '';
      const description = descMatch ? descMatch[1].trim() : '';
      const link = linkMatch ? linkMatch[1].trim() : '';
      const pubDate = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();

      const text = `${title} ${description}`.toLowerCase();
      let type = null;
      if (/bandit|kidnap|hostage|abduct|gunmen/i.test(text)) type = 'banditry';
      else if (/attack|clash|militan|rebel|soldier|army|blast|bomb|explosion|war/i.test(text)) type = 'conflict';
      else if (/flood|deluge|storm|rain|cyclone/i.test(text)) type = 'flood';
      else if (/disease|cholera|outbreak|mpox|ebola|virus/i.test(text)) type = 'epidemic';
      else if (/crisis|emergency|death|kill/i.test(text)) type = 'alert';

      if (!type) continue;

      let matchedLoc = null;
      let matchedName = null;
      for (const [name, coords] of Object.entries(REGION_CENTROIDS)) {
        const regex = new RegExp(`\\b${name}\\b`, 'i');
        if (regex.test(title) || regex.test(description)) {
          matchedLoc = coords;
          matchedName = name;
          break;
        }
      }

      if (!matchedLoc) continue;

      const jitter = () => (Math.random() - 0.5) * 0.08;
      const lat = matchedLoc.lat + jitter();
      const lon = matchedLoc.lon + jitter();

      const isNg = ['Lagos','Abuja','Kano','Port Harcourt','Ibadan','Kaduna','Maiduguri','Benin','Enugu','Jos','Sokoto','Nigeria'].includes(matchedName);
      const geo = isNg ? resolveNigeriaLocation(lat, lon) : null;

      incidents.push({
        id: `news-${Buffer.from(title.slice(0, 30)).toString('base64').replace(/[^a-zA-Z0-9]/g, '')}`,
        type,
        severity: type === 'banditry' || type === 'conflict' ? 'high' : 'medium',
        lat,
        lon,
        title,
        source: 'Live News · Security Monitor',
        detectedAt: pubDate,
        description,
        url: link || null,
        country: isNg ? 'Nigeria' : matchedName,
        state: geo?.state || null,
        stateShort: geo?.stateShort || null,
        city: geo?.city || (isNg ? matchedName : null),
        lga: geo?.lga || null,
        area: geo?.area || null,
        locationFull: geo?.locationFull || (isNg ? `${matchedName}, Nigeria` : null),
      });
    }
    console.log(`[Incidents] News monitor loaded ${incidents.length} security alerts`);
    return incidents;
  } catch (err) {
    console.warn('[Incidents] News monitor error:', err?.message || err);
    return [];
  }
}

// ─── Aggregator ───────────────────────────────────────────────────────────────

async function refreshIncidents() {
  const [firmsResult, eqResult, newsResult] = await Promise.allSettled([
    loadFirmsIncidents(),
    loadEarthquakeIncidents(),
    loadNewsAlertIncidents(),
  ]);

  const merged = [
    ...(firmsResult.status === 'fulfilled' ? firmsResult.value : []),
    ...(eqResult.status === 'fulfilled' ? eqResult.value : []),
    ...(newsResult.status === 'fulfilled' ? newsResult.value : []),
  ];

  // Deduplicate by id
  const byId = new Map();
  for (const inc of merged) {
    if (inc?.id) byId.set(inc.id, inc);
  }

  _incidentCache = Array.from(byId.values());
  _incidentCacheAt = Date.now();
  console.log(`[Incidents] Total incidents cached: ${_incidentCache.length}`);
  return _incidentCache;
}

async function getIncidents() {
  const now = Date.now();
  if (_incidentCache.length > 0 && now - _incidentCacheAt <= INCIDENT_CACHE_MS) {
    return _incidentCache;
  }
  if (_incidentInflight) return _incidentInflight;
  _incidentInflight = refreshIncidents().finally(() => { _incidentInflight = null; });
  return _incidentInflight;
}

// ─── Vite Plugin ──────────────────────────────────────────────────────────────

/**
 * Vite plugin: real-time incident detection API proxy.
 *
 * Endpoint:
 *   GET /api/incidents
 *     ?lat=&lon=&radius=  filter by km radius from a point
 *     ?types=fire,banditry,flood  comma-separated type filter
 *     ?country=Nigeria  filter by country name (case-insensitive)
 *     ?region=Nigeria   alias for country=Nigeria
 *     ?state=Borno      filter by specific Nigerian state
 *
 * @returns {import('vite').Plugin}
 */
export function incidentsProxy() {
  return {
    name: 'incidents-proxy',
    configureServer(server) {
      // Eagerly pre-warm cache on plugin startup
      refreshIncidents().catch((err) => {
        console.warn('[Incidents] Pre-warm error:', err?.message || err);
      });

      server.middlewares.use('/api/incidents', async (req, res) => {
        try {
          console.log('[Incidents API hit] req.url:', req.url, 'cached count:', _incidentCache.length, 'cachedAt:', _incidentCacheAt);
          const url = new URL(req.url || '/', 'http://localhost');
          const filterLat = toFinite(url.searchParams.get('lat'), NaN);
          const filterLon = toFinite(url.searchParams.get('lon'), NaN);
          const filterRadius = toFinite(url.searchParams.get('radius'), NaN);
          const filterTypes = url.searchParams.get('types')
            ? url.searchParams.get('types').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean)
            : null;
          const filterCountry = (url.searchParams.get('country') || '').toLowerCase().trim();
          const filterRegion = (url.searchParams.get('region') || '').toLowerCase().trim();
          const filterState = (url.searchParams.get('state') || '').toLowerCase().trim();

          let incidents = await getIncidents();

          // Apply filters
          if (filterTypes?.length) {
            incidents = incidents.filter((inc) => filterTypes.includes(inc.type));
          }
          if (filterCountry === 'nigeria' || filterCountry === 'ng' || filterRegion === 'nigeria') {
            incidents = incidents.filter((inc) =>
              (inc.country || '').toLowerCase() === 'nigeria' || Boolean(inc.state)
            );
          } else if (filterCountry) {
            incidents = incidents.filter((inc) =>
              (inc.country || '').toLowerCase().includes(filterCountry)
            );
          }
          if (filterState) {
            incidents = incidents.filter((inc) =>
              (inc.state || '').toLowerCase().includes(filterState) ||
              (inc.stateShort || '').toLowerCase().includes(filterState)
            );
          }
          if (Number.isFinite(filterLat) && Number.isFinite(filterLon) && Number.isFinite(filterRadius)) {
            incidents = incidents.filter((inc) =>
              haversineDist(filterLat, filterLon, inc.lat, inc.lon) <= filterRadius
            );
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(JSON.stringify({
            incidents,
            count: incidents.length,
            cachedAt: new Date(_incidentCacheAt).toISOString(),
          }));
        } catch (err) {
          console.error('[Incidents]', err?.message || err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Incident fetch failed' }));
        }
      });
    },
  };
}
