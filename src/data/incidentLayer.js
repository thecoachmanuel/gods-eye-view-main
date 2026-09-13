/**
 * @module incidentLayer
 *
 * Real-time incident detection layer for God's Eye View.
 *
 * Polls /api/incidents every INCIDENT_POLL_MS and renders each incident as:
 *   - A pulsing Cesium entity (point + animated outline) on the globe
 *   - A card entry in the #incident-alert-panel sidebar
 *
 * Incident types:
 *   fire      → red pulsing dot
 *   banditry  → amber triangle
 *   conflict  → orange diamond
 *   flood     → blue wave dot
 *   epidemic  → purple cross
 *   alert     → grey bell
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
let _pollInterval = null;
let _activeFilter = 'all';

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
}

async function _fetchAndRender() {
  try {
    const resp = await fetch(INCIDENT_API);
    if (!resp.ok) return;
    const data = await resp.json();
    const incidents = Array.isArray(data?.incidents) ? data.incidents : [];
    _renderIncidents(incidents);
    _updatePanel(incidents);
  } catch (err) {
    console.warn('[IncidentLayer] fetch error:', err?.message || err);
  }
}

function _renderIncidents(incidents) {
  if (!_viewer) return;
  _clearEntities();

  const filtered = _activeFilter === 'all'
    ? incidents
    : incidents.filter((i) => i.type === _activeFilter);

  let pulseCount = 0;
  for (const inc of filtered) {
    if (!Number.isFinite(inc.lat) || !Number.isFinite(inc.lon)) continue;
    const meta = TYPE_META[inc.type] || TYPE_META.alert;
    const size = SEVERITY_SIZE[inc.severity] || 10;
    const color = Cesium.Color.fromCssColorString(meta.color);
    const pulseColor = Cesium.Color.fromCssColorString(meta.pulseColor);

    // Only pulse critical incidents (up to 20) to maintain 60 FPS in Cesium WebGL
    if (inc.severity === 'critical' && pulseCount < 20) {
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
        text: `${meta.icon} ${inc.title.length > 36 ? inc.title.slice(0, 36) + '…' : inc.title}`,
        font: '11px "JetBrains Mono", monospace',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -size - 8),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2000000),
        scaleByDistance: new Cesium.NearFarScalar(100000, 1.1, 1500000, 0.6),
      },
      description: `
        <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#fff;background:#0a0f14;padding:12px;border-radius:6px;border:1px solid rgba(78,205,231,0.3)">
          <div style="color:${meta.color};font-size:14px;font-weight:700;margin-bottom:6px">${meta.icon} ${inc.title}</div>
          <div style="color:#aaa;margin-bottom:4px">📡 Source: ${inc.source}</div>
          <div style="color:#aaa;margin-bottom:4px">🕐 ${new Date(inc.detectedAt).toLocaleString()}</div>
          <div style="color:#ccc;margin-top:8px">${inc.description}</div>
          ${inc.url ? `<div style="margin-top:8px"><a href="${inc.url}" target="_blank" style="color:#4ecde7">Read more →</a></div>` : ''}
        </div>
      `,
      properties: { incidentData: inc },
    });

    _entities.push(pointEntity);
  }
}

function _updatePanel(incidents) {
  const panel = document.getElementById('incident-feed-list');
  if (!panel) return;

  const filtered = _activeFilter === 'all'
    ? incidents
    : incidents.filter((i) => i.type === _activeFilter);

  // Update counter badge
  const badge = document.getElementById('incident-count-badge');
  if (badge) badge.textContent = filtered.length;

  if (filtered.length === 0) {
    panel.innerHTML = `
      <div class="incident-empty">
        <span>✅</span>
        <p>No active incidents detected</p>
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

  panel.innerHTML = sorted.slice(0, 40).map((inc) => {
    const meta = TYPE_META[inc.type] || TYPE_META.alert;
    const time = new Date(inc.detectedAt);
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const sevClass = `sev-${inc.severity || 'low'}`;
    return `
      <div class="incident-card ${sevClass}" data-lat="${inc.lat}" data-lon="${inc.lon}" data-id="${inc.id}">
        <div class="incident-card-header">
          <span class="incident-type-icon">${meta.icon}</span>
          <span class="incident-type-label" style="color:${meta.color}">${meta.label.toUpperCase()}</span>
          <span class="incident-severity ${sevClass}">${(inc.severity || '').toUpperCase()}</span>
        </div>
        <div class="incident-title">${inc.title.length > 70 ? inc.title.slice(0, 70) + '…' : inc.title}</div>
        <div class="incident-meta">
          <span>📡 ${inc.source}</span>
          <span>🕐 ${dateStr} ${timeStr}</span>
        </div>
        ${inc.country ? `<div class="incident-country">📍 ${inc.country}</div>` : ''}
      </div>
    `;
  }).join('');

  // Click-to-fly on incident cards
  panel.querySelectorAll('.incident-card').forEach((card) => {
    card.addEventListener('click', () => {
      const lat = parseFloat(card.dataset.lat);
      const lon = parseFloat(card.dataset.lon);
      if (_viewer && Number.isFinite(lat) && Number.isFinite(lon)) {
        _viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 200000),
          duration: 2.0,
        });
      }
    });
  });
}

function _installPanelListeners() {
  // Filter buttons
  document.querySelectorAll('[data-incident-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _activeFilter = btn.dataset.incidentFilter;
      document.querySelectorAll('[data-incident-filter]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      _fetchAndRender();
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
