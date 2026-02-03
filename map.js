// map.js - Map functionality (Leaflet, geometry drawing, labels, popups, highlighting)
import { state } from './state.js';
import { escapeHtml, throttle, relabelHeaders } from './utils.js';

// Map initialization
export const map = L.map('map', { zoomControl: true, maxZoom: 22, renderer: L.canvas() }).setView([39.1031, -84.5120], 12);

// Create panes to control rendering order (subs < links < nodes)
map.createPane('subcatchmentPane').style.zIndex = 380;
map.createPane('linkPane').style.zIndex = 390;
map.createPane('nodePane').style.zIndex = 410;

// Basemap layers
// Basemap layers
const baseLayers = {
  "Street": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: "&copy; OpenStreetMap"
  }),
  "Aerial": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri'
  }),
  "None": L.tileLayer('', { opacity: 0 }) // Dummy layer for "None"
};

// Default basemap
baseLayers["Street"].addTo(map);

// Remove manual setBasemap export, let Leaflet handle it via Control
export function setBasemap(which) {
  // Compatibility stub if called from elsewhere, but mostly unused now
}

// Add legend control
map.addControl(new (L.Control.extend({
  onAdd() { return document.getElementById('legend').content.firstElementChild.cloneNode(true); }
}))({ position: "bottomleft" }));

// Layer groups
// Layer groups
// Parent groups for toggling
const overlayGroups = {
  nodes: L.layerGroup().addTo(map),
  links: L.layerGroup().addTo(map),
  subs: L.layerGroup().addTo(map)
};

export const layers = {
  nodes: { unchanged: L.layerGroup().addTo(overlayGroups.nodes), changed: L.layerGroup().addTo(overlayGroups.nodes), added: L.layerGroup().addTo(overlayGroups.nodes), removed: L.layerGroup().addTo(overlayGroups.nodes) },
  links: { unchanged: L.layerGroup().addTo(overlayGroups.links), changed: L.layerGroup().addTo(overlayGroups.links), added: L.layerGroup().addTo(overlayGroups.links), removed: L.layerGroup().addTo(overlayGroups.links) },
  subs: { unchanged: L.layerGroup().addTo(overlayGroups.subs), changed: L.layerGroup().addTo(overlayGroups.subs), added: L.layerGroup().addTo(overlayGroups.subs), removed: L.layerGroup().addTo(overlayGroups.subs) },
  select: L.layerGroup().addTo(map)
};

export const C = { unchanged: "#7f8c8d", changed: "#f39c12", added: "#2ecc71", removed: "#e74c3c", select: "#00FFFF" };

// --- COORDINATE & GEOMETRY HELPERS ---

export function xyToLatLng(x, y) {
  const [lon, lat] = proj4(state.CURRENT_CRS, "EPSG:4326", [x, y]);
  return [lat, lon];
}

export function coordsToLatLng(coords) {
  return coords.map(p => xyToLatLng(p[0], p[1]));
}

// Helper: Calculate midpoint of a line string
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

// Helper: Calculate centroid of a polygon
function centroidOfPoly(coords) {
  if (!coords || coords.length === 0) return null;
  let x = 0, y = 0;
  for (const p of coords) { x += p[0]; y += p[1]; }
  return [x / coords.length, y / coords.length];
}

// Helper: Ray-casting algorithm for Point-in-Polygon selection
function isPointInPoly(pt, poly) {
  let x = pt.lat, y = pt.lng;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    let xi = poly[i].lat, yi = poly[i].lng;
    let xj = poly[j].lat, yj = poly[j].lng;
    let intersect = ((yi > y) != (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Helper: Get closest point on segment in pixels
function getClosestPointOnSegment(p, a, b) {
  let x = p.x, y = p.y;
  let x1 = a.x, y1 = a.y;
  let x2 = b.x, y2 = b.y;
  let C = x2 - x1, D = y2 - y1;
  let dot = (x - x1) * C + (y - y1) * D;
  let len_sq = C * C + D * D;
  let param = -1;
  if (len_sq !== 0) param = dot / len_sq;
  let xx, yy;
  if (param < 0) { xx = x1; yy = y1; param = 0; }
  else if (param > 1) { xx = x2; yy = y2; param = 1; }
  else { xx = x1 + param * C; yy = y1 + param * D; }
  return { x: xx, y: yy, t: param, distSq: (x - xx) ** 2 + (y - yy) ** 2 };
}

// Helper: Check if a click is on a link (pixel-based + middle 80% rule)
function isClickOnLink(containerPoint, layer, tolerancePx) {
  const pts = layer.getLatLngs();
  const segments = Array.isArray(pts[0]) ? pts : [pts];

  for (const line of segments) {
    const pxPoints = line.map(ll => map.latLngToContainerPoint(ll));

    // 1. Calculate total length
    let totalLen = 0;
    const segLens = [];
    for (let i = 0; i < pxPoints.length - 1; i++) {
      const d = pxPoints[i].distanceTo(pxPoints[i + 1]);
      segLens.push(d);
      totalLen += d;
    }

    if (totalLen === 0) continue;

    // 2. Find closest point and its station
    let minDstSq = Infinity;
    let bestStation = -1;
    let currentStation = 0;

    for (let i = 0; i < pxPoints.length - 1; i++) {
      const res = getClosestPointOnSegment(containerPoint, pxPoints[i], pxPoints[i + 1]);
      if (res.distSq < minDstSq) {
        minDstSq = res.distSq;
        bestStation = currentStation + res.t * segLens[i];
      }
      currentStation += segLens[i];
    }

    // 3. Check tolerance and range (10% buffer on each end)
    if (Math.sqrt(minDstSq) <= tolerancePx) {
      const ratio = bestStation / totalLen;
      if (ratio >= 0.1 && ratio <= 0.9) return true;
    }
  }
  return false;
}

// --- LOGIC HELPERS ---

export const secType = (sec) => (
  ["JUNCTIONS", "OUTFALLS", "DIVIDERS", "STORAGE"].includes(sec) ? "nodes" :
    ["CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS"].includes(sec) ? "links" :
      sec === "SUBCATCHMENTS" ? "subs" : null
);

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

// --- DRAWING & LABELS ---

const labelsLayer = L.layerGroup().addTo(map);
const LABEL_ZOOM_THRESHOLD = 17;

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
      for (const id in json.sections1[sec]) nodeIdToSection[id] = sec;
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

// --- HIGHLIGHTING ---

export function highlightElement(section, id, shouldZoom = false) {
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
    if (shouldZoom) map.flyTo(ll, 18, { duration: 0.5 });
  } else if (t === 'links') {
    const ll = geo.map(p => xyToLatLng(p[0], p[1]));
    L.polyline(ll, { color: C.select, weight: 8, opacity: .8 }).addTo(layers.select);
    if (shouldZoom) map.fitBounds(L.latLngBounds(ll), { padding: [50, 50], maxZoom: 18 });
  } else if (t === 'subs') {
    const ll = geo.map(p => xyToLatLng(p[0], p[1]));
    L.polygon(ll, { color: C.select, weight: 5, fill: false, opacity: .95 }).addTo(layers.select);
    if (shouldZoom) map.fitBounds(L.latLngBounds(ll), { padding: [50, 50], maxZoom: 18 });
  }
}

// --- POPUPS & SELECTION ---

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
  const isChanged = d.changed && Object.prototype.hasOwnProperty.call(d.changed, id);

  let changeType = 'Unchanged';
  if (isAdded) changeType = 'Added';
  else if (isRemoved) changeType = 'Removed';
  else if (isChanged) changeType = 'Changed';

  const renameTo = renames?.[section]?.[id];
  let html = `<div style="font-weight:bold;font-size:14px;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:6px;">${escapeHtml(section)}: ${escapeHtml(id)}</div>`;
  html += `<div style="margin-bottom:6px;"><span class="pill ${changeType.toLowerCase()}">${changeType}</span>`;
  if (renameTo) {
    html += `<span style="margin-left:4px;font-size:12px;color:#555;">(Renamed to ${escapeHtml(renameTo)})</span>`;
  }
  html += `</div>`;

  if (changeType === 'Changed') {
    const hdrs = relabelHeaders(section, headers?.[section] || []);

    // Handle both array (old style) and object (new style) formats
    const changedObj = d.changed[id];
    const oldArr = Array.isArray(changedObj) ? changedObj[0] : (changedObj?.values?.[0] || []);
    const newArr = Array.isArray(changedObj) ? changedObj[1] : (changedObj?.values?.[1] || []);

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

function showMapPopup(clickLatlng, elements, isNewClick = true) {
  if (!elements || elements.length === 0) return;

  if (isNewClick) {
    const isSameSet = JSON.stringify(elements) === JSON.stringify(lastClickedElements);

    if (isSameSet) {
      lastClickIndex = (lastClickIndex + 1) % elements.length;
    } else {
      lastClickIndex = 0;
      lastClickedElements = elements;
    }
    lastClickLatLng = clickLatlng;
  }

  const selected = elements[lastClickIndex];
  const { id, section } = selected;

  // Calculate Centroid
  let targetLatLng = lastClickLatLng;
  const t = secType(section);

  if (t && state.LAST.json) {
    const g1 = state.LAST.json.geometry[t === 'nodes' ? 'nodes1' : t === 'links' ? 'links1' : 'subs1'];
    const g2 = state.LAST.json.geometry[t === 'nodes' ? 'nodes2' : t === 'links' ? 'links2' : 'subs2'];
    const geo = (g2 && g2[id] !== undefined) ? g2[id] : (g1 ? g1[id] : undefined);

    if (geo) {
      if (t === 'nodes') {
        targetLatLng = xyToLatLng(geo[0], geo[1]);
      } else if (t === 'links') {
        const mid = midOfLine(geo);
        if (mid) targetLatLng = xyToLatLng(mid[0], mid[1]);
      } else if (t === 'subs') {
        const cent = centroidOfPoly(geo);
        if (cent) targetLatLng = xyToLatLng(cent[0], cent[1]);
      }
    }
  }

  const content = generatePopupContent(section, id);
  const cycleText = elements.length > 1 ? `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#777;margin-top:8px;padding-top:4px;border-top:1px solid #f0f0f0;">
    <button onclick="cycleMapPopup(-1)" style="padding:2px 6px;font-size:14px;">‹</button>
    <span>${lastClickIndex + 1} of ${elements.length}</span>
    <button onclick="cycleMapPopup(1)" style="padding:2px 6px;font-size:14px;">›</button>
  </div>` : "";

  L.popup({ minWidth: 250, maxWidth: 400 })
    .setLatLng(targetLatLng)
    .setContent(content + cycleText)
    .openOn(map);

  highlightElement(section, id);
}

// Updated: Pixel-based selection with Conduit Trimming and Explicit Priority
function findNearbyElements(latlng) {
  const nodes = [];
  const links = [];
  const subs = [];

  const P = map.latLngToContainerPoint(latlng);

  const LINK_TOLERANCE_PX = 10;
  const NODE_TOLERANCE_PX = 10;

  map.eachLayer(layer => {
    if (!layer.swmmInfo) return;

    if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
      const pLoc = map.latLngToContainerPoint(layer.getLatLng());
      if (P.distanceTo(pLoc) < NODE_TOLERANCE_PX) {
        nodes.push(layer.swmmInfo);
      }
    }
    else if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
      if (isClickOnLink(P, layer, LINK_TOLERANCE_PX)) {
        links.push(layer.swmmInfo);
      }
    }
    else if (layer instanceof L.Polygon) {
      const latlngs = layer.getLatLngs();
      const shell = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
      if (isPointInPoly(latlng, shell)) {
        subs.push(layer.swmmInfo);
      }
    }
  });

  // Explicit Priority: Nodes > Links > Subs
  return [...nodes, ...links, ...subs];
}

// Fast check for cursor hover
function hasHoverElement(latlng) {
  const P = map.latLngToContainerPoint(latlng);
  const LINK_TOLERANCE_PX = 10;
  const NODE_TOLERANCE_PX = 10;

  let found = false;
  map.eachLayer(layer => {
    if (found || !layer.swmmInfo) return;

    if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
      const pLoc = map.latLngToContainerPoint(layer.getLatLng());
      if (P.distanceTo(pLoc) < NODE_TOLERANCE_PX) found = true;
    }
    else if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
      if (isClickOnLink(P, layer, LINK_TOLERANCE_PX)) found = true;
    }
    else if (layer instanceof L.Polygon) {
      const latlngs = layer.getLatLngs();
      const shell = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
      if (isPointInPoly(latlng, shell)) found = true;
    }
  });
  return found;
}

// Map Event Listeners

map.on('click', (e) => {
  const clickedElements = findNearbyElements(e.latlng);
  if (clickedElements.length > 0) {
    showMapPopup(e.latlng, clickedElements, true);
  } else {
    // Deselect
    map.closePopup();
    layers.select.clearLayers();
    document.querySelectorAll('#table .row.highlighted').forEach(r => r.classList.remove('highlighted'));
  }
});

// Cursor Hover Effect
map.on('mousemove', throttle((e) => {
  const hit = hasHoverElement(e.latlng);
  document.getElementById('map').style.cursor = hit ? 'pointer' : '';
}, 40)); // Throttle to 40ms (~25fps) for performance

document.getElementById('crsSelect').addEventListener('change', (e) => {
  state.CURRENT_CRS = e.target.value;
  proj4.defs(state.CURRENT_CRS, state.PROJECTIONS[state.CURRENT_CRS]);
  state.XY_LATLNG_CACHE.clear();
  if (state.LAST.json) {
    drawGeometry(state.LAST.json);
  }
});


// Add Leaflet Layers Control
// This replaces the manual checkboxes for Nodes/Links/Subs and Basemap dropdown
const overlays = {
  "Nodes": overlayGroups.nodes,
  "Links": overlayGroups.links,
  "Subcatchments": overlayGroups.subs
  // Labels could also go here if we wanted: "Labels": labelsLayer
};

L.control.layers(baseLayers, overlays, { position: 'topright' }).addTo(map);

// Labels Toggle (kept separate as requested, or could move to control)
document.getElementById('labelsToggle').addEventListener('change', () => {
  if (!state.LAST.json) return;
  throttledDrawLabels();
});
