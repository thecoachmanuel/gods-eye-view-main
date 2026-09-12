import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { readResponseTextCapped } from '../common/http.js';

/** In-memory geocode cache: query -> { payload, cachedAt }. */
const GEOCODE_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_GEOCODE_CACHE = 500;
const GEOCODE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

const _geocodeCache = new Map();

const _geocodeRateLimiter = makeRateLimiter({
  windowMs: 60_000,
  max: 60,
  globalMax: 120,
});

/**
 * Map OpenStreetMap type/class/addresstype to standard Google-compatible types
 * so downstream framing and navigation mode selection work transparently.
 */
export function osmToGeocodeTypes(item) {
  const addresstype = String(item?.addresstype || '').toLowerCase();
  const osmType = String(item?.type || '').toLowerCase();
  const osmClass = String(item?.class || '').toLowerCase();

  if (addresstype === 'country' || osmType === 'country') {
    return ['country', 'political'];
  }
  if (['state', 'province', 'region', 'administrative'].includes(addresstype) || ['state', 'province'].includes(osmType)) {
    return ['administrative_area_level_1', 'political'];
  }
  if (['county', 'district'].includes(addresstype)) {
    return ['administrative_area_level_2', 'political'];
  }
  if (['city', 'town', 'municipality', 'village'].includes(addresstype) || ['city', 'town', 'village'].includes(osmType)) {
    return ['locality', 'political'];
  }
  if (['suburb', 'neighbourhood', 'neighborhood', 'quarter'].includes(addresstype)) {
    return ['neighborhood', 'political'];
  }
  if (osmClass === 'natural' || ['mountain', 'peak', 'volcano', 'lake', 'river', 'bay', 'water'].includes(osmType)) {
    return ['natural_feature', 'establishment'];
  }
  if (osmClass === 'highway' || ['road', 'street', 'motorway', 'primary', 'secondary', 'residential'].includes(osmType)) {
    return ['route'];
  }
  if (['park', 'national_park', 'nature_reserve'].includes(osmType) || ['park', 'forest'].includes(addresstype)) {
    return ['park', 'point_of_interest', 'establishment'];
  }
  if (['aerodrome', 'airport'].includes(osmType) || osmClass === 'aeroway') {
    return ['airport', 'point_of_interest', 'establishment'];
  }
  if (['university', 'college', 'school'].includes(osmType) || ['amenity'].includes(osmClass)) {
    return ['point_of_interest', 'establishment'];
  }
  if (osmClass === 'historic' || osmClass === 'tourism' || ['monument', 'memorial', 'castle', 'attraction'].includes(osmType)) {
    return ['tourist_attraction', 'point_of_interest', 'establishment'];
  }
  return ['point_of_interest', 'establishment'];
}

/**
 * Project a raw OpenStreetMap Nominatim result to standard geocode result format.
 */
export function projectOsmNominatimResult(item) {
  if (!item) return null;
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let viewport = null;
  if (Array.isArray(item.boundingbox) && item.boundingbox.length === 4) {
    const south = Number(item.boundingbox[0]);
    const north = Number(item.boundingbox[1]);
    const west = Number(item.boundingbox[2]);
    const east = Number(item.boundingbox[3]);
    if ([south, north, west, east].every(Number.isFinite)) {
      viewport = {
        southwest: { lat: south, lng: west },
        northeast: { lat: north, lng: east },
      };
    }
  }

  const types = osmToGeocodeTypes(item);

  return {
    formatted_address: item.display_name || item.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    geometry: {
      location: { lat, lng },
      viewport: viewport || {
        southwest: { lat: lat - 0.05, lng: lng - 0.05 },
        northeast: { lat: lat + 0.05, lng: lng + 0.05 },
      },
    },
    types,
  };
}

/**
 * Register geocoding middleware on a server.
 * GET /api/geocode?q=query[&bias=south,west,north,east]
 */
export function installGeocodeMiddleware(middlewares) {
  middlewares.use('/api/geocode', async (req, res) => {
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': statusCode === 200 ? 'public, max-age=86400' : 'no-store',
      });
      res.end(JSON.stringify(data));
    };

    if (req.method !== 'GET') {
      return sendJson(405, { ok: false, error: 'Method Not Allowed', results: [] });
    }

    try {
      if (!_geocodeRateLimiter(clientKey(req))) {
        res.writeHead(429, {
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': '5',
        });
        res.end(JSON.stringify({ ok: false, error: 'Rate limit exceeded', results: [] }));
        return;
      }

      const url = new URL(req.url || '', 'http://localhost');
      const query = String(url.searchParams.get('q') || '').trim();
      const bias = String(url.searchParams.get('bias') || '').trim();

      if (!query) {
        return sendJson(400, { ok: false, error: 'Missing query parameter q', results: [] });
      }

      const cacheKey = `${query.toLowerCase()}|${bias}`;
      const now = Date.now();
      const cached = _geocodeCache.get(cacheKey);
      if (cached && now - cached.cachedAt <= GEOCODE_CACHE_MS) {
        return sendJson(200, cached.payload);
      }

      let upstreamUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`;
      if (bias) {
        // bias format: south,west,north,east or minLon,minLat,maxLon,maxLat
        const parts = bias.split(',').map(Number);
        if (parts.length === 4 && parts.every(Number.isFinite)) {
          // viewbox=<left>,<top>,<right>,<bottom> in Nominatim is minLon, maxLat, maxLon, minLat
          const [south, west, north, east] = parts;
          upstreamUrl += `&viewbox=${west},${north},${east},${south}&bounded=0`;
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      let items = [];
      try {
        const upstreamRes = await fetch(upstreamUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'gods-eye-view/0.1.1 (https://github.com/bilawalsidhu/gods-eye-view)',
            'Accept': 'application/json',
          },
        });

        if (!upstreamRes.ok) {
          return sendJson(200, { ok: true, results: [] });
        }

        const text = await readResponseTextCapped(upstreamRes, GEOCODE_MAX_RESPONSE_BYTES);
        items = JSON.parse(text);
      } finally {
        clearTimeout(timer);
      }

      const results = Array.isArray(items)
        ? items.map(projectOsmNominatimResult).filter(Boolean)
        : [];

      const payload = { ok: true, results };
      _geocodeCache.set(cacheKey, { payload, cachedAt: now });
      if (_geocodeCache.size > MAX_GEOCODE_CACHE) {
        _geocodeCache.delete(_geocodeCache.keys().next().value);
      }

      sendJson(200, payload);
    } catch (err) {
      console.warn('[Geocode Proxy]', err?.message || err);
      sendJson(200, { ok: false, error: err?.message || 'Geocoding failed', results: [] });
    }
  });
}

/** Vite plugin wrapper for geocode middleware. */
export function geocodeProxy() {
  return {
    name: 'geocode-proxy',
    configureServer(server) {
      installGeocodeMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installGeocodeMiddleware(server.middlewares);
    },
  };
}
