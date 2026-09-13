/**
 * @module incidentLayer
 *
 * Real-time incident detection layer for God's Eye View.
 *
 * Polls /api/incidents every INCIDENT_POLL_MS and renders each incident as:
 *   - A pulsing Cesium entity (point + animated outline) on the globe
 *   - A card entry in the #incident-alert-panel sidebar
 *
 * Supports regional scoping:
 *   - NIGERIA: Filters to threats and active fire hotspots across Nigerian States, LGAs, and Cities.
 *   - GLOBAL: Worldwide incidents.
 */

import * as Cesium from 'cesium';

const INCIDENT_POLL_MS = 5 * 60 * 1000; // 5 minutes
const INCIDENT_API = '/api/incidents';

const TYPE_META = {
  fire:      { color: '#ff3b30', icon: '🔥', label: 'Fire',     pulseColor: 'rgba(255, 59, 48, 0.4)' },
  banditry:  { color: '#ff9500', icon: '⚠️', label: 'Banditry', pulseColor: 'rgba(255, 149, 0, 0.4)' },
  conflict:  { color: '#ff6b35', icon: '💥', label: 'Conflict', pulseColor: 'rgba(255, 107, 53, 0.4)' },
  explosion: { color: '#ff2d55', icon: '💥', label: 'Explosion',pulseColor: 'rgba(255, 45, 85, 0.4)' },
  flood:     { color: '#0a84ff', icon: '🌊', label: 'Flood',    pulseColor: 'rgba(10, 132, 255, 0.4)' },
  epidemic:  { color: '#bf5af2', icon: '🦠', label: 'Epidemic', pulseColor: 'rgba(191, 90, 242, 0.4)' },
  alert:     { color: '#636366', icon: '🔔', label: 'Alert',    pulseColor: 'rgba(99, 99, 102, 0.4)' },
};

const SEVERITY_SIZE = {
  critical: 18,
  high:     13,
  medium:   10,
  low:      7,
};

let _viewer = null;
let _entities = [];
let _entityMap = new Map();
let _pollInterval = null;
let _activeFilter = 'all';
let _activeScope = 'nigeria'; // Default to Nigeria per user priority
let _latestIncidents = [];

/**
 * Initialise the incident layer.
 * @param {Cesium.Viewer} viewer
 */
export function initIncidentLayer(viewer) {
  _viewer = viewer;
  _fetchAndRender();
  _pollInterval = setInterval(_fetchAndRender, INCIDENT_POLL_MS);
  _installPanelListeners();
}

/** Remove all incident entities and stop polling. */
export function destroyIncidentLayer() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  _clearEntities();
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function _clearEntities() {
  for (const e of _entities) {
    try { _viewer?.entities.remove(e); } catch { /* ignore */ }
  }
  _entities = [];
  _entityMap.clear();
}

function _filterIncidents(incidents) {
  let list = incidents;
  if (_activeScope === 'nigeria') {
    list = list.filter((i) =>
      (i.country || '').toLowerCase() === 'nigeria' ||
      Boolean(i.state) ||
      (i.lat >= 4.15 && i.lat <= 13.92 && i.lon >= 2.65 && i.lon <= 14.70)
    );
  }
  if (_activeFilter !== 'all') {
    list = list.filter((i) => i.type === _activeFilter);
  }
  return list;
}

async function _fetchAndRender() {
  try {
    const resp = await fetch(INCIDENT_API);
    if (!resp.ok) return;
    const data = await resp.json();
    _latestIncidents = Array.isArray(data?.incidents) ? data.incidents : [];
    _renderIncidents(_latestIncidents);
    _updatePanel(_latestIncidents);
  } catch (err) {
    console.warn('[IncidentLayer] fetch error:', err?.message || err);
  }
}

function _renderIncidents(incidents) {
  if (!_viewer) return;
  _clearEntities();

  const filtered = _filterIncidents(incidents);

  let pulseCount = 0;
  for (const inc of filtered) {
    if (!Number.isFinite(inc.lat) || !Number.isFinite(inc.lon)) continue;
    const meta = TYPE_META[inc.type] || TYPE_META.alert;
    const size = SEVERITY_SIZE[inc.severity] || 10;
    const color = Cesium.Color.fromCssColorString(meta.color);
    const pulseColor = Cesium.Color.fromCssColorString(meta.pulseColor);

    // Only pulse critical / high incidents (up to 25) to maintain 60 FPS in Cesium
    if ((inc.severity === 'critical' || inc.severity === 'high') && pulseCount < 25) {
      pulseCount++;
      const pulseEntity = _viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(inc.lon, inc.lat),
        ellipse: {
          semiMajorAxis: new Cesium.CallbackProperty((time) => {
            const t = (time.secondsOfDay % 2) / 2;
            return (size * 1200) * (1 + t * 1.5);
          }, false),
          semiMinorAxis: new Cesium.CallbackProperty((time) => {
            const t = (time.secondsOfDay % 2) / 2;
            return (size * 1200) * (1 + t * 1.5);
          }, false),
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty((time) => {
              const t = (time.secondsOfDay % 2) / 2;
              return pulseColor.withAlpha(0.6 * (1 - t));
            }, false)
          ),
          outline: false,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
      _entities.push(pulseEntity);
    }

    // Label on globe: show City + State if available
    let labelText = `${meta.icon} ${inc.title}`;
    if (inc.city && inc.stateShort) {
      labelText = `${meta.icon} ${inc.city} (${inc.stateShort})`;
    } else if (inc.title.length > 34) {
      labelText = `${meta.icon} ${inc.title.slice(0, 34)}…`;
    }

    // Rich tactical surveillance HUD popup description
    const popupHtml = `
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#fff;background:#060d15;padding:14px;border-radius:8px;border:1px solid rgba(78,205,231,0.4);box-shadow:0 8px 32px rgba(0,0,0,0.8);line-height:1.5;min-width:280px;max-width:360px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;border-bottom:1px solid rgba(78,205,231,0.2);padding-bottom:6px">
          <span style="color:${meta.color};font-size:13px;font-weight:700;letter-spacing:1px">${meta.icon} ${meta.label.toUpperCase()} DETECTION</span>
          <span style="background:rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700">${(inc.severity || 'LOW').toUpperCase()}</span>
        </div>
        <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:8px;line-height:1.3">${inc.title}</div>
        ${inc.state ? `
          <div style="display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap">
            <span style="background:rgba(78,205,231,0.15);color:#4ecde7;border:1px solid rgba(78,205,231,0.4);padding:2px 7px;border-radius:3px;font-size:10px;font-weight:700">🇳🇬 ${inc.state.toUpperCase()}</span>
            ${inc.lga ? `<span style="background:rgba(255,149,0,0.15);color:#ff9500;border:1px solid rgba(255,149,0,0.4);padding:2px 7px;border-radius:3px;font-size:10px;font-weight:700">${inc.lga.toUpperCase()}</span>` : ''}
            ${inc.city ? `<span style="background:rgba(255,59,48,0.15);color:#ff3b30;border:1px solid rgba(255,59,48,0.4);padding:2px 7px;border-radius:3px;font-size:10px;font-weight:700">${inc.city.toUpperCase()}</span>` : ''}
          </div>
        ` : ''}
        <div style="color:#aaa;margin-bottom:3px">📍 <strong>Area:</strong> <span style="color:#eee">${inc.area || inc.locationFull || 'Sector Coordinates'}</span></div>
        ${inc.locationFull ? `<div style="color:#aaa;margin-bottom:3px">🗺️ <strong>Full Location:</strong> <span style="color:#eee">${inc.locationFull}</span></div>` : ''}
        <div style="color:#aaa;margin-bottom:3px">🌐 <strong>GPS Coordinates:</strong> <span style="color:#4ecde7">${inc.lat.toFixed(4)}°N, ${inc.lon.toFixed(4)}°E</span></div>
        ${inc.frp ? `<div style="color:#aaa;margin-bottom:3px">🔥 <strong>Fire Radiative Power:</strong> <span style="color:#ff3b30;font-weight:700">${inc.frp.toFixed(1)} MW</span></div>` : ''}
        <div style="color:#aaa;margin-bottom:3px">🛰️ <strong>Sensor Feed:</strong> <span style="color:#ccc">${inc.source}</span></div>
        <div style="color:#aaa;margin-bottom:8px">🕐 <strong>Detected At:</strong> <span style="color:#ccc">${new Date(inc.detectedAt).toLocaleString()}</span></div>
        <div style="background:rgba(78,205,231,0.06);border-left:2px solid ${meta.color};padding:6px 8px;border-radius:0 4px 4px 0;color:#bbb;font-size:10px">${inc.description}</div>
        ${inc.url ? `<div style="margin-top:10px"><a href="${inc.url}" target="_blank" style="color:#4ecde7;text-decoration:none;font-weight:700">Open Intelligence Report →</a></div>` : ''}
      </div>
    `;

    // Core point entity with distance display condition
    const pointEntity = _viewer.entities.add({
      id: `incident-${inc.id}`,
      name: `${meta.icon} ${inc.title}`,
      position: Cesium.Cartesian3.fromDegrees(inc.lon, inc.lat),
      point: {
        pixelSize: size,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 15000000),
      },
      label: {
        text: labelText,
        font: '11px "JetBrains Mono", monospace',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -size - 8),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2500000),
        scaleByDistance: new Cesium.NearFarScalar(100000, 1.1, 1500000, 0.6),
      },
      description: popupHtml,
      properties: { incidentData: inc },
    });

    _entities.push(pointEntity);
    _entityMap.set(inc.id, pointEntity);
  }
}

function _updatePanel(incidents) {
  const panel = document.getElementById('incident-feed-list');
  if (!panel) return;

  const filtered = _filterIncidents(incidents);

  // Update counter badge
  const badge = document.getElementById('incident-count-badge');
  if (badge) badge.textContent = filtered.length;

  if (filtered.length === 0) {
    panel.innerHTML = `
      <div class="incident-empty">
        <span>✅</span>
        <p>No active ${(_activeScope === 'nigeria' ? 'Nigerian' : 'global')} threats detected</p>
      </div>
    `;
    return;
  }

  // Sort: critical first, then by time
  const sorted = [...filtered].sort((a, b) => {
    const sev = { critical: 4, high: 3, medium: 2, low: 1 };
    const sv = (sev[b.severity] || 0) - (sev[a.severity] || 0);
    if (sv !== 0) return sv;
    return new Date(b.detectedAt) - new Date(a.detectedAt);
  });

  panel.innerHTML = sorted.slice(0, 60).map((inc) => {
    const meta = TYPE_META[inc.type] || TYPE_META.alert;
    const time = new Date(inc.detectedAt);
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const sevClass = `sev-${inc.severity || 'low'}`;
    const stateBadge = inc.stateShort || inc.state
      ? `<span class="incident-state-badge">🇳🇬 ${(inc.stateShort || inc.state).toUpperCase()}</span>`
      : '';

    return `
      <div class="incident-card ${sevClass}" data-lat="${inc.lat}" data-lon="${inc.lon}" data-id="${inc.id}">
        <div class="incident-card-header">
          <span class="incident-type-icon">${meta.icon}</span>
          <span class="incident-type-label" style="color:${meta.color}">${meta.label.toUpperCase()}</span>
          ${stateBadge}
          <span class="incident-severity ${sevClass}">${(inc.severity || '').toUpperCase()}</span>
        </div>
        <div class="incident-title">${inc.title}</div>
        ${(inc.area || inc.locationFull) ? `
          <div class="incident-location-line">
            <span class="incident-location-pin">📍</span>
            <span class="incident-location-text">
              ${inc.city ? `<strong class="incident-city-tag">${inc.city}</strong> · ` : ''}
              ${inc.area || inc.locationFull}
            </span>
          </div>
        ` : ''}
        ${(inc.state || inc.lga) ? `
          <div class="incident-hierarchy-line">
            ${inc.state ? `<span class="incident-tag-state">🏛️ ${inc.state}</span>` : ''}
            ${inc.lga ? `<span class="incident-tag-lga">📍 ${inc.lga}</span>` : ''}
          </div>
        ` : ''}
        <div class="incident-coords-line">
          <span>🌐 ${inc.lat.toFixed(4)}°N, ${inc.lon.toFixed(4)}°E</span>
          ${inc.frp ? `<span class="incident-frp-tag">🔥 ${inc.frp.toFixed(1)} MW</span>` : ''}
        </div>
        <div class="incident-meta">
          <span>📡 ${inc.source}</span>
          <span>🕐 ${dateStr} ${timeStr}</span>
        </div>
      </div>
    `;
  }).join('');

  // Click-to-fly on incident cards + open tactical HUD popup
  panel.querySelectorAll('.incident-card').forEach((card) => {
    card.addEventListener('click', () => {
      const lat = parseFloat(card.dataset.lat);
      const lon = parseFloat(card.dataset.lon);
      const id = card.dataset.id;
      if (_viewer && Number.isFinite(lat) && Number.isFinite(lon)) {
        _viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 45000),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-55),
            roll: 0.0,
          },
          duration: 1.8,
        });

        // Trigger Cesium InfoBox popup for this entity
        const entity = _entityMap.get(id);
        if (entity) {
          _viewer.selectedEntity = entity;
        }
      }
    });
  });
}

function _installPanelListeners() {
  // Scope buttons (NIGERIA vs GLOBAL)
  document.querySelectorAll('[data-incident-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _activeScope = btn.dataset.incidentScope;
      document.querySelectorAll('[data-incident-scope]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      if (_activeScope === 'nigeria' && _viewer) {
        // Smoothly fly camera to high vantage over Nigeria
        _viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(8.6753, 9.0820, 1600000),
          duration: 2.2,
        });
      }

      _renderIncidents(_latestIncidents);
      _updatePanel(_latestIncidents);
    });
  });

  // Filter buttons (ALL, FIRE, CONFLICT, BANDITRY, FLOOD)
  document.querySelectorAll('[data-incident-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _activeFilter = btn.dataset.incidentFilter;
      document.querySelectorAll('[data-incident-filter]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      _renderIncidents(_latestIncidents);
      _updatePanel(_latestIncidents);
    });
  });

  // Toggle panel visibility
  const toggleBtn = document.getElementById('incident-panel-toggle');
  const panel = document.getElementById('incident-alert-panel');
  if (toggleBtn && panel) {
    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      toggleBtn.classList.toggle('active');
    });
  }
}
