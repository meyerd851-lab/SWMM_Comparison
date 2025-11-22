// map.js - Map functionality (Leaflet, geometry drawing, labels, popups, highlighting)
import { state } from './state.js';
import { escapeHtml, throttle } from './utils.js';
import { relabelHeaders } from './utils.js';

// Map initialization
export const map = L.map('map', { zoomControl: true, maxZoom: 22, renderer: L.canvas() }).setView([39.1031, -84.5120], 12);

// Create panes to control rendering order (subs < links < nodes)
map.createPane('subcatchmentPane').style.zIndex = 380;
map.createPane('linkPane').style.zIndex = 390;
map.createPane('nodePane').style.zIndex = 410;

// Basemap layers
const baseLayers = {
  street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: "&copy; OpenStreetMap"
  }),
  aerial: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri'
  })
};
let activeBase = null;

export function setBasemap(which) {
  if (activeBase) map.removeLayer(activeBase);
  if (which === 'none') { activeBase = null; return; }
  activeBase = baseLayers[which] || baseLayers.street;
  activeBase.addTo(map);
}
setBasemap('street');

// Add legend control
map.addControl(new (L.Control.extend({
  onAdd() { return document.getElementById('legend').content.firstElementChild.cloneNode(true); }
}))({ position: "bottomleft" }));

// Layer groups
export const layers = {
  nodes: { unchanged: L.layerGroup().addTo(map), changed: L.layerGroup().addTo(map), added: L.layerGroup().addTo(map), removed: L.layerGroup().addTo(map) },
  links: { unchanged: L.layerGroup().addTo(map), changed: L.layerGroup().addTo(map), added: L.layerGroup().addTo(map), removed: L.layerGroup().addTo(map) },
  subs: { unchanged: L.layerGroup().addTo(map), changed: L.layerGroup().addTo(map), added: L.layerGroup().addTo(map), removed: L.layerGroup().addTo(map) },
  select: L.layerGroup().addTo(map)
};

export const C = { unchanged: "#7f8c8d", changed: "#f39c12", added: "#2ecc71", removed: "#e74c3c", select: "#00FFFF" };

// Coordinate conversion
export function xyToLatLng(x, y) {
  const [lon, lat] = proj4(state.CURRENT_CRS, "EPSG:4326", [x, y]);
  return [lat, lon];
}

export function coordsToLatLng(coords) {
  return coords.map(p => xyToLatLng(p[0], p[1]));
}

// Section type helper
export const secType = (sec) => (
  ["JUNCTIONS", "OUTFALLS", "DIVIDERS", "STORAGE"].includes(sec) ? "nodes" :
  ["CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS"].includes(sec) ? "links" :
  sec === "SUBCATCHMENTS" ? "subs" : null
);

// Build sets for diff visualization
export function buildSets(diffs, renames) {
  const sets = {
    nodes: { added: new Set(), removed: new Set(), changed: new Set(), base: new Set() },
    links: { added: new Set(), removed: new Set(), changed: new Set(), base: new Set() },
    subs: { added: new Set(), removed: new Set(), changed: new Set(), base: new Set() }
  };
  for (const [sec, d] of Object.entries(diffs)) {
    const t = secType(sec); if (!t) continue;
    Object.keys(d.added || {}).forEach(id => sets[t].added.add(id));
    Object.keys(d.removed || {}).forEach(id => sets[t].removed.add(id));
    Object.keys(d.changed || {}).forEach(id => sets[t].changed.add(id));
  }
  for (const [sec, mapping] of Object.entries(renames || {})) {
    const t = secType(sec); if (!t) continue;
    Object.keys(mapping).forEach(oldId => sets[t].changed.add(oldId));
  }
  return sets;
}

// Labels
const labelsLayer = L.layerGroup().addTo(map);
const LABEL_ZOOM_THRESHOLD = 17;

function midOfLine(coords) {
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1) return coords[0];
  const segs = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    segs.push({ a, b, len });
    total += len;
  }
  const half = total / 2;
  let acc = 0;
  for (const s of segs) {
    if (acc + s.len >= half) {
      const t = (half - acc) / (s.len || 1);
      return [s.a[0] + t * (s.b[0] - s.a[0]), s.a[1] + t * (s.b[1] - s.a[1])];
    }
    acc += s.len;
  }
  return coords[Math.floor(coords.length / 2)];
}

function centroidOfPoly(coords) {
  if (!coords || coords.length === 0) return null;
  let x = 0, y = 0;
  for (const p of coords) { x += p[0]; y += p[1]; }
  return [x / coords.length, y / coords.length];
}

export function drawLabels(json) {
  labelsLayer.clearLayers();
  if (!document.getElementById('labelsToggle').checked) return;
  if (map.getZoom() < LABEL_ZOOM_THRESHOLD) return;

  const geom = json.geometry;
  const bounds = map.getBounds();

  const nodeKeys = new Set([...(Object.keys(geom.nodes2 || {})), ...(Object.keys(geom.nodes1 || {}))]);
  nodeKeys.forEach(id => {
    const xy = (geom.nodes2 && geom.nodes2[id]) || (geom.nodes1 && geom.nodes1[id]);
    if (!xy) return;
    const ll = xyToLatLng(xy[0], xy[1]);
    if (bounds.contains(ll)) {
      L.tooltip({ permanent: true, direction: 'top', className: 'map-label', offset: [0, -5] })
        .setLatLng(ll).setContent(id).addTo(labelsLayer);
    }
  });

  const subKeys = new Set([...(Object.keys(geom.subs2 || {})), ...(Object.keys(geom.subs1 || {}))]);
  subKeys.forEach(id => {
    const coords = (geom.subs2 && geom.subs2[id]) || (geom.subs1 && geom.subs1[id]);
    if (!coords || coords.length < 3) return;
    const centerXY = centroidOfPoly(coords);
    const ll = xyToLatLng(centerXY[0], centerXY[1]);
    if (bounds.contains(ll)) {
      L.tooltip({ permanent: true, direction: 'center', className: 'map-label' }).setLatLng(ll).setContent(id).addTo(labelsLayer);
    }
  });
}

const throttledDrawLabels = throttle(() => {
  if (!state.LAST.json) return;
  drawLabels(state.LAST.json);
}, 200);

map.on('zoomend moveend', throttledDrawLabels);

// Geometry drawing
function resetLayers() {
  Object.values(layers).forEach(groupSet => {
    if (groupSet instanceof L.LayerGroup) { groupSet.clearLayers(); return; }
    Object.values(groupSet).forEach(g => g.clearLayers());
  });
}

export function drawGeometry(json) {
  resetLayers();
  const geom = json.geometry;
  const sets = buildSets(json.diffs, json.renames);

  const collectBase = (obj1, obj2) => new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);
  sets.nodes.base = collectBase(json.geometry.nodes1, json.geometry.nodes2);
  sets.links.base = collectBase(json.geometry.links1, json.geometry.links2);
  sets.subs.base = collectBase(json.geometry.subs1, json.geometry.subs2);

  const unchanged = {
    nodes: new Set([...sets.nodes.base].filter(x => !sets.nodes.added.has(x) && !sets.nodes.removed.has(x) && !sets.nodes.changed.has(x))),
    links: new Set([...sets.links.base].filter(x => !sets.links.added.has(x) && !sets.links.removed.has(x) && !sets.links.changed.has(x))),
    subs: new Set([...sets.subs.base].filter(x => !sets.subs.added.has(x) && !sets.subs.removed.has(x) && !sets.subs.changed.has(x)))
  };

  const nodeSections = ["JUNCTIONS", "OUTFALLS", "DIVIDERS", "STORAGE"];
  const nodeIdToSection = {};
  for (const sec of nodeSections) {
    if (json.sections1 && json.sections1[sec]) {
      for (const id in json.sections1[sec]) {
        nodeIdToSection[id] = sec;
      }
    }
  }

  const drawNode = (id, xy, color, target) => {
    const ll = xyToLatLng(xy[0], xy[1]);
    const sec = nodeIdToSection[id] || "JUNCTIONS";
    const marker = L.circleMarker(ll, {
      radius: 5, color: "#000", weight: 1, fillColor: color, fillOpacity: 1, pane: 'nodePane'
    });
    marker.swmmInfo = { id, section: sec, type: 'node' };
    marker.addTo(layers.nodes[target]);
  };

  const linkIdToSection = {};
  const linkSections = ["CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS"];
  for (const sec of linkSections) {
    if (json.sections1 && json.sections1[sec]) for (const id in json.sections1[sec]) linkIdToSection[id] = sec;
    if (json.sections2 && json.sections2[sec]) for (const id in json.sections2[sec]) linkIdToSection[id] = sec;
  }

  const drawLink = (id, coords, color, target) => {
    const ll = coords.map(p => xyToLatLng(p[0], p[1]));
    const polyline = L.polyline(ll, { color, weight: 3, opacity: .95, pane: 'linkPane' });
    const sec = linkIdToSection[id] || 'CONDUITS';
    polyline.swmmInfo = { id, section: sec, type: 'link' };
    polyline.addTo(layers.links[target]);
  };

  const drawSub = (id, coords, color, target) => {
    const ll = coords.map(p => xyToLatLng(p[0], p[1]));
    const polygon = L.polygon(ll, { color, weight: 2, fill: true, fillOpacity: .25, pane: 'subcatchmentPane' });
    polygon.swmmInfo = { id, section: 'SUBCATCHMENTS', type: 'sub' };
    polygon.addTo(layers.subs[target]);
  };

  for (const id of unchanged.nodes) if (geom.nodes1?.[id]) drawNode(id, geom.nodes1[id], C.unchanged, "unchanged");
  for (const id of sets.nodes.removed) if (geom.nodes1?.[id]) drawNode(id, geom.nodes1[id], C.removed, "removed");
  for (const id of unchanged.links) if (geom.links1?.[id]) drawLink(id, geom.links1[id], C.unchanged, "unchanged");
  for (const id of sets.links.removed) if (geom.links1?.[id]) drawLink(id, geom.links1[id], C.removed, "removed");
  for (const id of unchanged.subs) if (geom.subs1?.[id]) drawSub(id, geom.subs1[id], C.unchanged, "unchanged");
  for (const id of sets.subs.removed) if (geom.subs1?.[id]) drawSub(id, geom.subs1[id], C.removed, "removed");

  for (const id of sets.nodes.changed) { const xy = geom.nodes2?.[id]; if (xy) drawNode(id, xy, C.changed, "changed"); }
  for (const id of sets.nodes.added) if (geom.nodes2?.[id]) drawNode(id, geom.nodes2[id], C.added, "added");
  for (const id of sets.links.changed) { const ll = geom.links2?.[id]; if (ll) drawLink(id, ll, C.changed, "changed"); }
  for (const id of sets.links.added) if (geom.links2?.[id]) drawLink(id, geom.links2[id], C.added, "added");
  for (const id of sets.subs.changed) { const poly = geom.subs2?.[id]; if (poly) drawSub(id, poly, C.changed, "changed"); }
  for (const id of sets.subs.added) if (geom.subs2?.[id]) drawSub(id, geom.subs2[id], C.added, "added");

  const anyLL = [];
  const pushAll = (g) => {
    if (!g) return;
    Object.values(g).forEach(v => {
      if (Array.isArray(v) && v.length && Array.isArray(v[0])) {
        coordsToLatLng(v).forEach(p => anyLL.push(p));
      } else if (Array.isArray(v)) {
        anyLL.push(xyToLatLng(v[0], v[1]));
      }
    });
  };
  pushAll(geom.nodes1); pushAll(geom.nodes2); pushAll(geom.links1); pushAll(geom.links2); pushAll(geom.subs1); pushAll(geom.subs2);
  if (anyLL.length) map.fitBounds(L.latLngBounds(anyLL), { padding: [20, 20] });

  throttledDrawLabels();
}

// Highlight element on map
export function highlightElement(section, id) {
  layers.select.clearLayers();

  // Highlight table row
  document.querySelectorAll('#table .row.highlighted').forEach(r => r.classList.remove('highlighted'));
  const safeId = id.replace(/[^a-zA-Z0-9]/g, '_');
  const row = document.querySelector(`#table .row-id-${safeId}`);
  if (row) { row.classList.add('highlighted'); row.dispatchEvent(new Event('highlight')); }

  const t = secType(section);
  if (!t) return;

  const g1 = state.LAST.json.geometry[t === 'nodes' ? 'nodes1' : t === 'links' ? 'links1' : 'subs1'];
  const g2 = state.LAST.json.geometry[t === 'nodes' ? 'nodes2' : t === 'links' ? 'links2' : 'subs2'];

  const geo = (g2 && g2[id] !== undefined) ? g2[id] : (g1 ? g1[id] : undefined);

  if (!geo) return;
  if (t === 'nodes') {
    const ll = xyToLatLng(geo[0], geo[1]);
    L.circleMarker(ll, { radius: 10, color: C.select, weight: 4, fill: false, opacity: .95 }).addTo(layers.select);
    map.panTo(ll, { animate: true });
  } else if (t === 'links') {
    const ll = geo.map(p => xyToLatLng(p[0], p[1]));
    L.polyline(ll, { color: C.select, weight: 8, opacity: .8 }).addTo(layers.select);
    map.fitBounds(L.latLngBounds(ll), { padding: [20, 20] });
  } else if (t === 'subs') {
    const ll = geo.map(p => xyToLatLng(p[0], p[1]));
    L.polygon(ll, { color: C.select, weight: 5, fill: false, opacity: .95 }).addTo(layers.select);
    map.fitBounds(L.latLngBounds(ll), { padding: [20, 20] });
  }
}

// Map popup functionality
let lastClickedElements = [];
let lastClickIndex = 0;
let lastClickLatLng = null;

window.cycleMapPopup = function (direction) {
  lastClickIndex = (lastClickIndex + direction + lastClickedElements.length) % lastClickedElements.length;
  map.closePopup();
  showMapPopup(lastClickLatLng, lastClickedElements, false);
};

function generatePopupContent(section, id) {
  const { diffs, headers, renames } = state.LAST.json || {};
  const d = diffs?.[section] || { added: {}, removed: {}, changed: {} };

  const isAdded = d.added && Object.prototype.hasOwnProperty.call(d.added, id);
  const isRemoved = d.removed && Object.prototype.hasOwnProperty.call(d.removed, id);
  const changeType = isAdded ? 'Added' : isRemoved ? 'Removed' : 'Changed';

  const renameTo = renames?.[section]?.[id];
  let html = `<div style="font-weight:bold;font-size:14px;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:6px;">${escapeHtml(section)}: ${escapeHtml(id)}</div>`;
  html += `<div style="margin-bottom:6px;"><span class="pill ${changeType.toLowerCase()}">${changeType}</span>`;
  if (renameTo) {
    html += `<span style="margin-left:4px;font-size:12px;color:#555;">(Renamed to ${escapeHtml(renameTo)})</span>`;
  }
  html += `</div>`;

  if (changeType === 'Changed') {
    const hdrs = relabelHeaders(section, headers?.[section] || []);
    const oldArr = d.changed[id]?.[0] || [];
    const newArr = d.changed[id]?.[1] || [];
    const maxLen = Math.max(oldArr.length, newArr.length);
    let changesHtml = '<ul style="margin:0;padding-left:18px;font-size:12px;">';
    let changeCount = 0;
    for (let i = 0; i < maxLen; i++) {
      const ov = oldArr[i] ?? "";
      const nv = newArr[i] ?? "";
      if (ov !== nv) {
        changeCount++;
        const fieldName = hdrs[i + 1] || `Field ${i + 1}`;
        changesHtml += `<li style="margin-bottom:4px;"><strong>${escapeHtml(fieldName)}:</strong> ${escapeHtml(ov)} → ${escapeHtml(nv)}</li>`;
      }
    }
    if (changeCount > 0) {
      html += changesHtml + '</ul>';
    } else {
      html += '<div style="font-size:12px;color:#666;">No parameter changes found.</div>';
    }
  }

  return html;
}

function showMapPopup(latlng, elements, isNewClick = true) {
  if (!elements || elements.length === 0) return;

  if (isNewClick) {
    lastClickIndex = 0;
    lastClickedElements = elements;
    lastClickLatLng = latlng;
  }

  if (isNewClick && JSON.stringify(elements) === JSON.stringify(lastClickedElements)) {
    lastClickIndex = (lastClickIndex + 1) % elements.length;
  }

  const selected = elements[lastClickIndex];
  const { id, section } = selected;

  const content = generatePopupContent(section, id);
  const cycleText = elements.length > 1 ? `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#777;margin-top:8px;padding-top:4px;border-top:1px solid #f0f0f0;">
    <button onclick="cycleMapPopup(-1)" style="padding:2px 6px;font-size:14px;">‹</button>
    <span>${lastClickIndex + 1} of ${elements.length}</span>
    <button onclick="cycleMapPopup(1)" style="padding:2px 6px;font-size:14px;">›</button>
  </div>` : "";

  L.popup({ minWidth: 250, maxWidth: 400 })
    .setLatLng(latlng)
    .setContent(content + cycleText)
    .openOn(map);

  highlightElement(section, id);
}

function findNearbyElements(latlng) {
  const nearby = [];
  const toleranceInFeet = 20;
  const toleranceInMeters = toleranceInFeet * 0.3048;

  map.eachLayer(layer => {
    if (!layer.swmmInfo) return;

    let distance = Infinity;
    if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
      distance = latlng.distanceTo(layer.getLatLng());
    } else if (layer instanceof L.Polyline) {
      const latlngs = layer.getLatLngs();
      for (const p of (Array.isArray(latlngs[0]) ? latlngs.flat() : latlngs)) {
        distance = Math.min(distance, latlng.distanceTo(p));
      }
    } else if (layer instanceof L.Polygon) {
      if (layer.getBounds().contains(latlng)) distance = 0;
    }

    if (distance < toleranceInMeters) {
      nearby.push(layer.swmmInfo);
    }
  });
  return nearby;
}

map.on('click', (e) => {
  const clickedElements = findNearbyElements(e.latlng);
  if (clickedElements.length > 0) showMapPopup(e.latlng, clickedElements, true);
});

// Initialize CRS change handler
document.getElementById('crsSelect').addEventListener('change', (e) => {
  state.CURRENT_CRS = e.target.value;
  proj4.defs(state.CURRENT_CRS, state.PROJECTIONS[state.CURRENT_CRS]);
  state.XY_LATLNG_CACHE.clear();
  if (state.LAST.json) {
    drawGeometry(state.LAST.json);
  }
});

// Initialize basemap selector
document.getElementById('basemapSelect').addEventListener('change', (e) => setBasemap(e.target.value));

// Initialize labels toggle
document.getElementById('labelsToggle').addEventListener('change', () => {
  if (!state.LAST.json) return;
  throttledDrawLabels();
});

