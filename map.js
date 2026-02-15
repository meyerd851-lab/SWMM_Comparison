// map.js - Map functionality (Leaflet, geometry drawing, labels, popups, highlighting)
import { state } from './state.js';
import { escapeHtml, throttle, relabelHeaders } from './utils.js';
import { ShapeMarker } from './ShapeMarker.js';

// Map initialization
export const map = L.map('map', { zoomControl: true, maxZoom: 22, renderer: L.canvas() }).setView([39.1031, -84.5120], 12);

// Create panes to control rendering order (subs < links < nodes)
map.createPane('subcatchmentPane').style.zIndex = 380;
map.createPane('linkPane').style.zIndex = 390;
map.createPane('nodePane').style.zIndex = 410;
map.createPane('selectPane').style.zIndex = 420; // Above nodes

// Create Renderers to enforce Canvas usage
const subRenderer = L.canvas({ pane: 'subcatchmentPane' });
const linkRenderer = L.canvas({ pane: 'linkPane' });
const nodeRenderer = L.canvas({ pane: 'nodePane' });
const selectRenderer = L.canvas({ pane: 'selectPane' });

// Basemap layers
const baseLayers = {
  "Street": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: "&copy; OpenStreetMap"
  }),
  "Aerial": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri'
  }),
  "None": L.tileLayer('', { opacity: 0 })
};

// Default basemap
baseLayers["Street"].addTo(map);

export function setBasemap(which) {
  // Compatibility stub
}

// Add legend control container
const legendControl = L.Control.extend({
  onAdd: function () {
    const lg = L.DomUtil.create('div', 'map-legend legend leaflet-control');
    lg.id = 'map-legend';
    // Initial content
    lg.innerHTML = '<div style="font-weight:700; margin-bottom:8px;">Legend</div>';
    return lg;
  }
});
map.addControl(new legendControl({ position: "bottomleft" }));


// Layer groups
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

export const C = { unchanged: "#9ca3af", changed: "#f59e0b", added: "#10b981", removed: "#ef4444", select: "#00FFFF" };

// --- COORDINATE & GEOMETRY HELPERS ---

export function xyToLatLng(x, y) {
  // Use projection from state, default to EPSG:4326 if not set (or if raw coords)
  // Assuming projections are handled by proj4 if loaded
  if (state.CURRENT_CRS && state.CURRENT_CRS !== "EPSG:4326" && window.proj4) {
    try {
      const [lon, lat] = proj4(state.CURRENT_CRS, "EPSG:4326", [x, y]);
      return [lat, lon];
    } catch (e) {
      return [y, x];
    }
  }
  return [y, x];
}

export function coordsToLatLng(coords) {
  return coords.map(p => xyToLatLng(p[0], p[1]));
}

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
  // Handle MultiPolygon (list of rings)
  // If first item is array, it's a ring.
  let points = [];
  if (Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
    // Flatten
    coords.forEach(ring => points.push(...ring));
  } else {
    points = coords;
  }

  if (points.length === 0) return null;

  let x = 0, y = 0;
  for (const p of points) { x += p[0]; y += p[1]; }
  return [x / points.length, y / points.length];
}

function isPointInPoly(pt, poly) {
  // poly can be LatLng[] (single ring) or LatLng[][] (multi ring / holes)
  // L.Polygon.getLatLngs() usually returns:
  // - [LatLng, LatLng...] for simple polygon (Passed as [pts] to constructor)
  // - [[LatLng...], [LatLng...]] for multipolygon/holes
  // BUT Leaflet normalizes simple polygons to [ [LatLng...] ] sometimes?
  // Let's iterate all rings.

  let rings = [];
  if (poly.length > 0 && Array.isArray(poly[0])) {
    // It is likely a list of rings (or points? LatLng is object, not array).
    // LatLng is {lat, lng}, not array.
    // So if poly[0] is array, it's list of rings.
    // If poly[0] is LatLng (object), it's single ring (Legacy Leaflet structure).
    // Wait, checks:
    if ('lat' in poly[0]) {
      rings = [poly];
    } else {
      rings = poly;
    }
  } else {
    return false;
  }

  let inside = false;

  // Ray casting algorithm check
  // For MultiPolygon, odd total crossings = inside? 
  // Or Check if inside Any outer ring and outside Any hole?
  // SWMM "Segmented Polygons" are usually disjoint islands (MultiPolygon), not holes.
  // So standard even-odd rule for all rings effectively unions them if they are disjoint.

  let x = pt.lat, y = pt.lng;

  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      let xi = ring[i].lat, yi = ring[i].lng;
      let xj = ring[j].lat, yj = ring[j].lng;
      let intersect = ((yi > y) != (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

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

function isClickOnLink(containerPoint, layer, tolerancePx) {
  const pts = layer.getLatLngs();
  const segments = Array.isArray(pts[0]) ? pts : [pts];

  for (const line of segments) {
    const pxPoints = line.map(ll => map.latLngToContainerPoint(ll));
    let totalLen = 0;
    const segLens = [];
    for (let i = 0; i < pxPoints.length - 1; i++) {
      const d = pxPoints[i].distanceTo(pxPoints[i + 1]);
      segLens.push(d);
      totalLen += d;
    }
    if (totalLen === 0) continue;

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

// --- DRAWING & LABELS ---

const labelsLayer = L.layerGroup().addTo(map);
const LABEL_ZOOM_THRESHOLD = 16; // Slightly lowered threshold

export function drawLabels(json) {
  labelsLayer.clearLayers();
  if (map.getZoom() < LABEL_ZOOM_THRESHOLD) return;

  const showNodes = document.getElementById('lblNodes')?.checked;
  const showSubs = document.getElementById('lblSubs')?.checked;
  const showLinks = document.getElementById('lblLinks')?.checked;

  if (!showNodes && !showSubs && !showLinks) return;

  const geom = json.geometry;
  const bounds = map.getBounds();

  // Filter Logic
  let validNodes = null;
  let validSubs = null;
  let validLinks = null;

  if (currentFilterMode !== 'Default') {
    const sets = buildSets(json.diffs, json.renames);
    const modeKey = currentFilterMode.toLowerCase(); // 'added', 'removed', 'changed'
    validNodes = sets.nodes[modeKey];
    validSubs = sets.subs[modeKey];
    validLinks = sets.links[modeKey];
  }

  // Draw Node Labels
  if (showNodes) {
    const nodeKeys = new Set([...(Object.keys(geom.nodes2 || {})), ...(Object.keys(geom.nodes1 || {}))]);
    nodeKeys.forEach(id => {
      if (validNodes && !validNodes.has(id)) return;
      const xy = (geom.nodes2 && geom.nodes2[id]) || (geom.nodes1 && geom.nodes1[id]);
      if (!xy) return;
      const ll = xyToLatLng(xy[0], xy[1]);
      if (bounds.contains(ll)) {
        L.tooltip({ permanent: true, direction: 'top', className: 'map-label', offset: [0, -5] })
          .setLatLng(ll).setContent(id).addTo(labelsLayer);
      }
    });
  }

  // Draw Subcatchment Labels
  if (showSubs) {
    const subKeys = new Set([...(Object.keys(geom.subs2 || {})), ...(Object.keys(geom.subs1 || {}))]);
    subKeys.forEach(id => {
      if (validSubs && !validSubs.has(id)) return;
      const coords = (geom.subs2 && geom.subs2[id]) || (geom.subs1 && geom.subs1[id]);
      if (!coords || coords.length < 3) return;
      const centerXY = centroidOfPoly(coords); // Use centroid
      if (!centerXY) return;
      const ll = xyToLatLng(centerXY[0], centerXY[1]);
      if (bounds.contains(ll)) {
        L.tooltip({ permanent: true, direction: 'center', className: 'map-label' }).setLatLng(ll).setContent(id).addTo(labelsLayer);
      }
    });
  }

  // Draw Link Labels (Conduits)
  if (showLinks) {
    const linkKeys = new Set([...(Object.keys(geom.links2 || {})), ...(Object.keys(geom.links1 || {}))]);
    linkKeys.forEach(id => {
      if (validLinks && !validLinks.has(id)) return;
      const coords = (geom.links2 && geom.links2[id]) || (geom.links1 && geom.links1[id]);
      if (!coords) return;
      // Calculate midpoint for label
      const mid = midOfLine(coords);
      if (!mid) return;
      const ll = xyToLatLng(mid[0], mid[1]);

      if (bounds.contains(ll)) {
        L.tooltip({ permanent: true, direction: 'center', className: 'map-label' })
          .setLatLng(ll).setContent(id).addTo(labelsLayer);
      }
    });
  }
}


const throttledDrawLabels = throttle(() => {
  if (!state.LAST.json) return;
  drawLabels(state.LAST.json);
}, 200);

map.on('zoomend moveend', throttledDrawLabels);

document.getElementById('lblNodes').addEventListener('change', throttledDrawLabels);
document.getElementById('lblSubs').addEventListener('change', throttledDrawLabels);
document.getElementById('lblLinks').addEventListener('change', throttledDrawLabels);

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
  const idToSec1 = {};
  const idToSec2 = {};

  for (const sec of nodeSections) {
    if (json.sections1 && json.sections1[sec]) {
      for (const id in json.sections1[sec]) idToSec1[id] = sec;
    }
    if (json.sections2 && json.sections2[sec]) {
      for (const id in json.sections2[sec]) idToSec2[id] = sec;
    }
  }

  const drawNode = (id, xy, color, target, sourceNum) => {
    const ll = xyToLatLng(xy[0], xy[1]);

    // Choose correct section lookup based on source state
    let sec;
    if (sourceNum === 1) sec = idToSec1[id];
    else if (sourceNum === 2) sec = idToSec2[id];

    // Fallback? Should exist if valid ID.
    if (!sec) sec = (idToSec1[id] || idToSec2[id] || "JUNCTIONS");

    let shape = 'circle';
    let radius = 5;

    if (sec === 'STORAGE') {
      shape = 'square';
      radius = 6; // Slightly larger for visibility
    } else if (sec === 'OUTFALLS') {
      shape = 'triangle';
      radius = 6;
    } else if (sec === 'DIVIDERS') {
      shape = 'diamond';
      radius = 5.5;
    }

    const marker = new ShapeMarker(ll, {
      radius: radius,
      color: "#000",
      weight: 1,
      fillColor: color,
      fillOpacity: 1,
      pane: 'nodePane',
      renderer: nodeRenderer,
      shape: shape
    });
    const isRemoved = target === 'removed';
    marker.swmmInfo = { id, section: sec, type: 'node', isRemoved };
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
    const polyline = L.polyline(ll, {
      color,
      weight: 3,
      opacity: .95,
      pane: 'linkPane',
      renderer: linkRenderer
    });
    const sec = linkIdToSection[id] || 'CONDUITS';
    const isRemoved = target === 'removed';
    polyline.swmmInfo = { id, section: sec, type: 'link', isRemoved };
    polyline.addTo(layers.links[target]);
  };

  const drawSub = (id, coords, color, target) => {
    // coords is List[List[x,y]] (MultiPolygon)
    // Map to LatLngs
    const latlngs = coords.map(ring => ring.map(p => xyToLatLng(p[0], p[1])));

    const polygon = L.polygon(latlngs, {
      color,
      weight: 2,
      fill: true,
      fillOpacity: .25,
      pane: 'subcatchmentPane',
      renderer: subRenderer
    });
    const isRemoved = target === 'removed';
    polygon.swmmInfo = { id, section: 'SUBCATCHMENTS', type: 'sub', isRemoved };
    polygon.addTo(layers.subs[target]);
  };

  for (const id of unchanged.nodes) if (geom.nodes1?.[id]) drawNode(id, geom.nodes1[id], C.unchanged, "unchanged", 1);
  for (const id of sets.nodes.removed) if (geom.nodes1?.[id]) drawNode(id, geom.nodes1[id], C.removed, "removed", 1);
  for (const id of unchanged.links) if (geom.links1?.[id]) drawLink(id, geom.links1[id], C.unchanged, "unchanged");
  for (const id of sets.links.removed) if (geom.links1?.[id]) drawLink(id, geom.links1[id], C.removed, "removed");
  for (const id of unchanged.subs) if (geom.subs1?.[id]) drawSub(id, geom.subs1[id], C.unchanged, "unchanged");
  for (const id of sets.subs.removed) if (geom.subs1?.[id]) drawSub(id, geom.subs1[id], C.removed, "removed");

  for (const id of sets.nodes.changed) { const xy = geom.nodes2?.[id]; if (xy) drawNode(id, xy, C.changed, "changed", 2); }
  for (const id of sets.nodes.added) if (geom.nodes2?.[id]) drawNode(id, geom.nodes2[id], C.added, "added", 2);
  for (const id of sets.links.changed) { const ll = geom.links2?.[id]; if (ll) drawLink(id, ll, C.changed, "changed"); }
  for (const id of sets.links.added) if (geom.links2?.[id]) drawLink(id, geom.links2[id], C.added, "added");
  for (const id of sets.subs.changed) { const poly = geom.subs2?.[id]; if (poly) drawSub(id, poly, C.changed, "changed"); }
  for (const id of sets.subs.added) if (geom.subs2?.[id]) drawSub(id, geom.subs2[id], C.added, "added");

  const anyLL = [];
  const pushAll = (g) => {
    if (!g) return;
    Object.values(g).forEach(v => {
      if (Array.isArray(v) && v.length && Array.isArray(v[0])) {
        // Check depth: Array[Array[x,y]] (Single Ring) vs Array[Array[Array[x,y]]] (List of Rings)
        if (Array.isArray(v[0][0])) {
          // MultiPolygon / List of Rings
          v.forEach(ring => coordsToLatLng(ring).forEach(p => anyLL.push(p)));
        } else {
          // Single Ring (Line or simple poly)
          coordsToLatLng(v).forEach(p => anyLL.push(p));
        }
      } else if (Array.isArray(v)) {
        anyLL.push(xyToLatLng(v[0], v[1]));
      }
    });
  };
  pushAll(geom.nodes1); pushAll(geom.nodes2); pushAll(geom.links1); pushAll(geom.links2); pushAll(geom.subs1); pushAll(geom.subs2);
  if (anyLL.length) map.fitBounds(L.latLngBounds(anyLL), { padding: [20, 20] });

  throttledDrawLabels();
  setMapFilter(currentFilterMode);
}

// --- HIGHLIGHTING ---

export function highlightElement(section, id, shouldZoom = false, isRemoved = false, skipScroll = false) {
  layers.select.clearLayers();

  // Highlight table row
  document.querySelectorAll('#table tr.selected').forEach(r => r.classList.remove('selected'));
  const safeId = id.replace(/[^a-zA-Z0-9]/g, '_');
  const row = document.querySelector(`#table .row-id-${safeId}`);

  if (row) {
    row.classList.add('selected');
    // Only dispatch the event (which triggers scroll) if we NOT skipping scroll
    if (!skipScroll) {
      row.dispatchEvent(new Event('highlight'));
    }
  }

  const t = secType(section);
  if (!t) return;

  const g1 = state.LAST.json.geometry[t === 'nodes' ? 'nodes1' : t === 'links' ? 'links1' : 'subs1'];
  const g2 = state.LAST.json.geometry[t === 'nodes' ? 'nodes2' : t === 'links' ? 'links2' : 'subs2'];

  // If isRemoved, prefer g1. If not, prefer g2 but fallback to g1.
  let geo;
  if (isRemoved) {
    geo = g1 ? g1[id] : undefined;
  } else {
    geo = (g2 && g2[id] !== undefined) ? g2[id] : (g1 ? g1[id] : undefined);
  }

  if (!geo) return;
  if (t === 'nodes') {
    const ll = xyToLatLng(geo[0], geo[1]);

    let shape = 'circle';
    if (section === 'STORAGE') shape = 'square';
    else if (section === 'OUTFALLS') shape = 'triangle';
    else if (section === 'DIVIDERS') shape = 'diamond';

    new ShapeMarker(ll, {
      radius: 12,
      color: C.select,
      weight: 4,
      fill: false,
      opacity: .95,
      shape: shape,
      pane: 'selectPane',
      renderer: selectRenderer
    }).addTo(layers.select);

    if (shouldZoom) map.flyTo(ll, 18, { duration: 0.5 });
  } else if (t === 'links') {
    const ll = geo.map(p => xyToLatLng(p[0], p[1]));
    L.polyline(ll, {
      color: C.select,
      weight: 8,
      opacity: .8,
      pane: 'selectPane',
      renderer: selectRenderer
    }).addTo(layers.select);
    if (shouldZoom) map.fitBounds(L.latLngBounds(ll), { padding: [50, 50], maxZoom: 18 });
  } else if (t === 'subs') {
    // geo is List[List[x,y]]
    const latlngs = geo.map(ring => ring.map(p => xyToLatLng(p[0], p[1])));

    L.polygon(latlngs, {
      color: C.select,
      weight: 5,
      fill: false,
      opacity: .95,
      pane: 'selectPane',
      renderer: selectRenderer
    }).addTo(layers.select);

    if (shouldZoom) {
      // Flatten for bounds
      const allPts = [];
      latlngs.forEach(r => allPts.push(...r));
      map.fitBounds(L.latLngBounds(allPts), { padding: [50, 50], maxZoom: 18 });
    }
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


function generatePopupContent(section, id, expectedState) {
  const { diffs, headers, renames } = state.LAST.json || {};
  const d = diffs?.[section] || { added: {}, removed: {}, changed: {} };

  const isAdded = d.added && Object.prototype.hasOwnProperty.call(d.added, id);
  const isRemoved = d.removed && Object.prototype.hasOwnProperty.call(d.removed, id);
  const isChanged = d.changed && Object.prototype.hasOwnProperty.call(d.changed, id);

  let changeType = 'Unchanged';

  // If we know the expected state (e.g. from the clicked layer), prioritize it
  if (expectedState === 'removed' && isRemoved) changeType = 'Removed';
  else if (expectedState === 'added' && isAdded) changeType = 'Added';
  else if (isAdded) changeType = 'Added';
  else if (isRemoved) changeType = 'Removed';
  else if (isChanged) changeType = 'Changed';

  const renameTo = renames?.[section]?.[id];
  let html = `<div style="font-weight:700;font-size:14px;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:8px;">${escapeHtml(section)}: ${escapeHtml(id)}</div>`;
  html += `<div style="margin-bottom:8px;"><span class="badge ${changeType.toLowerCase()}">${changeType}</span>`;
  if (renameTo) {
    html += `<span style="margin-left:6px;font-size:12px;color:#6b7280;">(Renamed to ${escapeHtml(renameTo)})</span>`;
  }
  html += `</div>`;

  if (changeType === 'Changed') {
    const hdrs = relabelHeaders(section, headers?.[section] || []);

    // Handle both array (old style) and object (new style) formats
    const changedObj = d.changed[id];
    const oldArr = Array.isArray(changedObj) ? changedObj[0] : (changedObj?.values?.[0] || []);
    const newArr = Array.isArray(changedObj) ? changedObj[1] : (changedObj?.values?.[1] || []);

    const maxLen = Math.max(oldArr.length, newArr.length);
    let changesHtml = '<ul style="margin:0;padding-left:14px;font-size:12px;">';
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
      html += '<div style="font-size:12px;color:#6b7280;">No parameter changes found.</div>';
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
  const { id, section, isRemoved } = selected;

  // Calculate Centroid
  let targetLatLng = lastClickLatLng;
  const t = secType(section);

  if (t && state.LAST.json) {
    const KEY = isRemoved ? 1 : 2; // geometry source key
    const g = state.LAST.json.geometry[t === 'nodes' ? `nodes${KEY}` : t === 'links' ? `links${KEY}` : `subs${KEY}`];

    // Fallback if not found in specific geometry (e.g. unchanged)
    const geo = (g && g[id] !== undefined) ? g[id] : undefined;

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

  // Derive Expected State
  const expectedState = isRemoved ? 'removed' : 'added';

  const content = generatePopupContent(section, id, expectedState);
  const cycleText = elements.length > 1 ? `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#777;margin-top:8px;padding-top:4px;border-top:1px solid #f0f0f0;">
    <button onclick="cycleMapPopup(-1)" style="padding:2px 6px;font-size:14px;">‹</button>
    <span>${lastClickIndex + 1} of ${elements.length}</span>
    <button onclick="cycleMapPopup(1)" style="padding:2px 6px;font-size:14px;">›</button>
  </div>` : "";

  L.popup({ minWidth: 250, maxWidth: 400 })
    .setLatLng(targetLatLng)
    .setContent(content + cycleText)
    .openOn(map);

  highlightElement(section, id, false, isRemoved);
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
      if (isPointInPoly(latlng, latlngs)) {
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
      // getLatLngs() returns [[LatLng...], [LatLng...]] for MultiPoly
      // isPointInPoly now handles list of rings
      if (isPointInPoly(latlng, latlngs)) found = true;
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
}, 40));

// CRS Selection
document.getElementById('crsSelect').addEventListener('change', (e) => {
  state.CURRENT_CRS = e.target.value;
  if (window.proj4) {
    proj4.defs(state.CURRENT_CRS, state.PROJECTIONS[state.CURRENT_CRS]);
  }
  state.XY_LATLNG_CACHE.clear();
  if (state.LAST.json) {
    drawGeometry(state.LAST.json);
  }
});


// --- MAP VIEW FILTER SETTINGS ---

const FILTER_MODES = {
  "Default": { label: "Default View", color: null },
  "Changed": { label: "Focus: Changed", color: C.changed },
  "Added": { label: "Focus: Added", color: C.added },
  "Removed": { label: "Focus: Removed", color: C.removed }
};

let currentFilterMode = "Default";

export function setMapFilter(mode) {
  const settings = FILTER_MODES[mode];
  if (!settings) return;
  if (!settings) return;
  currentFilterMode = mode;

  // Re-draw labels immediately to reflect filter
  throttledDrawLabels();

  // 1. Update Layer Styles
  const targetColor = settings.color;

  const categories = ['unchanged', 'changed', 'added', 'removed'];

  categories.forEach(cat => {
    const isTarget = (mode === 'Default') || (cat.toLowerCase() === mode.toLowerCase());
    let colorToUse;

    // Determine color and opacity base
    if (mode === 'Default') {
      colorToUse = C[cat];
    } else {
      if (isTarget) {
        colorToUse = targetColor;
      } else {
        colorToUse = C.unchanged; // Grey out non-targets
      }
    }

    // Apply to nodes
    layers.nodes[cat].eachLayer(layer => {
      layer.setStyle({
        fillColor: colorToUse,
        color: "#000",
        opacity: isTarget ? 1.0 : 0.5,
        fillOpacity: isTarget ? 1.0 : 0.5
      });
      if (isTarget && mode !== 'Default') layer.bringToFront();
    });

    // Apply to links
    layers.links[cat].eachLayer(layer => {
      layer.setStyle({
        color: colorToUse,
        opacity: 0.95,
        weight: isTarget ? 3 : 2
      });
      if (isTarget && mode !== 'Default') layer.bringToFront();
    });

    // Apply to subs
    layers.subs[cat].eachLayer(layer => {
      layer.setStyle({
        color: colorToUse,
        fillColor: colorToUse,
        fillOpacity: 0.25,
        opacity: 1.0,
        weight: 2
      });
      if (isTarget && mode !== 'Default') layer.bringToFront();
    });
  });

  updateLegend(mode);
}

function updateLegend(mode) {
  const legendDiv = document.getElementById('map-legend');
  if (!legendDiv) return;

  const buildItem = (colorVar, label) => {
    return `<div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;"><span class="dot" style="background:${colorVar}"></span> ${label}</div>`;
  };

  let html = `<div style="font-weight:700; margin-bottom:8px;">Legend</div>`;

  if (mode === 'Default') {
    html += buildItem('var(--text-tertiary)', 'Unchanged'); // var(--muted) from old css might not exist, using text-tertiary
    html += buildItem('var(--changed)', 'Changed');
    html += buildItem('var(--added)', 'Added');
    html += buildItem('var(--removed)', 'Removed');
  } else {
    // Focus Mode
    const focusColor = (mode === 'Changed') ? 'var(--changed)' : (mode === 'Added' ? 'var(--added)' : 'var(--removed)');
    html += buildItem(focusColor, mode);
    html += buildItem('var(--text-tertiary)', 'Others');
  }

  html += `<div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;"><span class="dot" style="background:#0ff; border:1px solid cyan;"></span> Selected</div>`;

  // Add Node Types Key
  html += `<div style="margin-top:8px; border-top:1px solid var(--border-medium); padding-top:6px;">`;
  html += `<div style="font-size:10px; font-weight:600; margin-bottom:4px; color:var(--text-secondary);">NODE TYPES</div>`;
  // Junction (Circle)
  html += `<div style="display:flex; align-items:center; gap:8px; font-size:11px; margin-bottom:2px;"><span style="display:inline-block; width:8px; height:8px; background:var(--text-tertiary); border-radius:50%"></span> Junction</div>`;
  // Storage (Square)
  html += `<div style="display:flex; align-items:center; gap:8px; font-size:11px; margin-bottom:2px;"><span style="display:inline-block; width:8px; height:8px; background:var(--text-tertiary);"></span> Storage</div>`;
  // Outfall (Triangle Up)
  html += `<div style="display:flex; align-items:center; gap:8px; font-size:11px; margin-bottom:2px;"><div style="width:0; height:0; border-left:4px solid transparent; border-right:4px solid transparent; border-bottom:7px solid var(--text-tertiary);"></div> Outfall</div>`;
  // Divider (Diamond)
  html += `<div style="display:flex; align-items:center; gap:8px; font-size:11px; margin-bottom:2px;"><span style="display:inline-block; width:6px; height:6px; background:var(--text-tertiary); transform:rotate(45deg);"></span> Divider</div>`;
  html += `</div>`;

  legendDiv.innerHTML = html;
}

// --- LAYERS CONTROL & INTEGRATION ---

const overlays = {
  "Nodes": overlayGroups.nodes,
  "Links": overlayGroups.links,
  "Subcatchments": overlayGroups.subs
};

// Create the standard layers control
const layersControl = L.control.layers(baseLayers, overlays, { position: 'topright' }).addTo(map);

// New Map Mode Selection Logic
const mapModeSelect = document.getElementById('mapModeSelect');
if (mapModeSelect) {
  mapModeSelect.addEventListener('change', (e) => {
    setMapFilter(e.target.value);
  });
}

// Labels Toggle
// Labels Toggle
const addLabelListener = (id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', throttledDrawLabels);
};

addLabelListener('lblNodes');
addLabelListener('lblSubs');
addLabelListener('lblLinks');
