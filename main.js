proj4.defs("EPSG:3735",
  "+proj=lcc +lat_1=38.73333333333333 +lat_2=40.03333333333333 +lat_0=38 +lon_0=-82.5 +x_0=1968500 +y_0=0 +datum=NAD83 +units=us-ft +no_defs"
);

const map = L.map('map', { zoomControl:true }).setView([39.1031, -84.5120], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:"&copy; OpenStreetMap" }).addTo(map);
map.addControl(new (L.Control.extend({ onAdd(){ return document.getElementById('legend').content.firstElementChild.cloneNode(true); } }))({ position:"bottomleft" }));

let layers = {
  nodes: { unchanged: L.layerGroup().addTo(map), changed: L.layerGroup().addTo(map), added: L.layerGroup().addTo(map), removed: L.layerGroup().addTo(map) },
  links: { unchanged: L.layerGroup().addTo(map), changed: L.layerGroup().addTo(map), added: L.layerGroup().addTo(map), removed: L.layerGroup().addTo(map) },
  subs:  { unchanged: L.layerGroup().addTo(map), changed: L.layerGroup().addTo(map), added: L.layerGroup().addTo(map), removed: L.layerGroup().addTo(map) },
  select: L.layerGroup().addTo(map)
};
const C = { unchanged:"#7f8c8d", changed:"#f39c12", added:"#2ecc71", removed:"#e74c3c", select:"#00FFFF" };

function resetLayers() {
  Object.values(layers).forEach(groupSet=>{
    if (groupSet instanceof L.LayerGroup) { groupSet.clearLayers(); return; }
    Object.values(groupSet).forEach(g=>g.clearLayers());
  });
}

function xyToLatLng(x, y) { const [lon, lat] = proj4("EPSG:3735","EPSG:4326",[x,y]); return [lat, lon]; }

let LAST = { json:null, currentSection:null };

const secType = (sec) => (["JUNCTIONS","OUTFALLS","DIVIDERS","STORAGE"].includes(sec) ? "nodes" :
                          ["CONDUITS","PUMPS","ORIFICES","WEIRS","OUTLETS"].includes(sec) ? "links" :
                          sec==="SUBCATCHMENTS" ? "subs" : null);

function buildSets(diffs, renames) {
  const sets = {
    nodes:{added:new Set(), removed:new Set(), changed:new Set(), base:new Set()},
    links:{added:new Set(), removed:new Set(), changed:new Set(), base:new Set()},
    subs:{added:new Set(), removed:new Set(), changed:new Set(), base:new Set()}
  };
  for (const [sec, d] of Object.entries(diffs)) {
    const t = secType(sec); if (!t) continue;
    Object.keys(d.added || {}).forEach(id => sets[t].added.add(id));
    Object.keys(d.removed || {}).forEach(id => sets[t].removed.add(id));
    Object.keys(d.changed || {}).forEach(id => sets[t].changed.add(id));
  }
  for (const [sec, mapping] of Object.entries(renames||{})) {
    const t = secType(sec); if (!t) continue;
    Object.keys(mapping).forEach(oldId => sets[t].changed.add(oldId));
  }
  return sets;
}

function drawGeometry(json) {
  resetLayers();
  const geom = json.geometry;
  const sets = buildSets(json.diffs, json.renames);

  const collectBase = (obj1,obj2)=> new Set([...Object.keys(obj1||{}), ...Object.keys(obj2||{})]);
  sets.nodes.base = collectBase(geom.nodes1, geom.nodes2);
  sets.links.base = collectBase(geom.links1, geom.links2);
  sets.subs.base  = collectBase(geom.subs1,  geom.subs2);

  const unchanged = {
    nodes:new Set([...sets.nodes.base].filter(x=>!sets.nodes.added.has(x)&&!sets.nodes.removed.has(x)&&!sets.nodes.changed.has(x))),
    links:new Set([...sets.links.base].filter(x=>!sets.links.added.has(x)&&!sets.links.removed.has(x)&&!sets.links.changed.has(x))),
    subs: new Set([...sets.subs.base ].filter(x=>!sets.subs.added.has(x) &&!sets.subs.removed.has(x) &&!sets.subs.changed.has(x)))
  };

  const drawNode=(id,xy,color,target)=>{ const ll=xyToLatLng(xy[0],xy[1]); L.circleMarker(ll,{radius:4,color,fill:true,fillOpacity:.9}).bindPopup(`${target.toUpperCase()} NODE ${id}`).addTo(layers.nodes[target]); };
  const drawLink=(id,coords,color,target)=>{ const ll=coords.map(p=>xyToLatLng(p[0],p[1])); L.polyline(ll,{color,weight:3,opacity:.95}).bindPopup(`${target.toUpperCase()} LINK ${id}`).addTo(layers.links[target]); };
  const drawSub=(id,coords,color,target)=>{ const ll=coords.map(p=>xyToLatLng(p[0],p[1])); L.polygon(ll,{color,weight:2,fill:true,fillOpacity:.25}).bindPopup(`${target.toUpperCase()} SUB ${id}`).addTo(layers.subs[target]); };

  for (const id of unchanged.nodes) if (geom.nodes1?.[id]) drawNode(id, geom.nodes1[id], C.unchanged, "unchanged");
  for (const id of sets.nodes.removed) if (geom.nodes1?.[id]) drawNode(id, geom.nodes1[id], C.removed, "removed");
  for (const id of unchanged.links) if (geom.links1?.[id]) drawLink(id, geom.links1[id], C.unchanged, "unchanged");
  for (const id of sets.links.removed) if (geom.links1?.[id]) drawLink(id, geom.links1[id], C.removed, "removed");
  for (const id of unchanged.subs) if (geom.subs1?.[id]) drawSub(id, geom.subs1[id], C.unchanged, "unchanged");
  for (const id of sets.subs.removed) if (geom.subs1?.[id]) drawSub(id, geom.subs1[id], C.removed, "removed");

  for (const id of sets.nodes.changed) { const xy=geom.nodes2?.[id]; if (xy) drawNode(id, xy, C.changed, "changed"); }
  for (const id of sets.nodes.added) if (geom.nodes2?.[id]) drawNode(id, geom.nodes2[id], C.added, "added");
  for (const id of sets.links.changed) { const ll=geom.links2?.[id]; if (ll) drawLink(id, ll, C.changed, "changed"); }
  for (const id of sets.links.added) if (geom.links2?.[id]) drawLink(id, geom.links2[id], C.added, "added");
  for (const id of sets.subs.changed) { const poly=geom.subs2?.[id]; if (poly) drawSub(id, poly, C.changed, "changed"); }
  for (const id of sets.subs.added) if (geom.subs2?.[id]) drawSub(id, geom.subs2[id], C.added, "added");

  const anyLL=[];
  const pushAll=(g)=>{ if(!g) return; Object.values(g).forEach(v=>{ if(Array.isArray(v)&&v.length&&Array.isArray(v[0])){ v.forEach(p=>anyLL.push(xyToLatLng(p[0],p[1])));} else if(Array.isArray(v)){ anyLL.push(xyToLatLng(v[0],v[1])); }}); };
  pushAll(geom.nodes1); pushAll(geom.nodes2); pushAll(geom.links1); pushAll(geom.links2); pushAll(geom.subs1); pushAll(geom.subs2);
  if (anyLL.length) map.fitBounds(L.latLngBounds(anyLL), { padding:[20,20] });
}


document.addEventListener('DOMContentLoaded', function() {
  const worker = new Worker("worker.js");
  function setStatus(s){ document.getElementById('status').textContent = s; }
  worker.onmessage = (ev)=>{
    const { type, payload, error } = ev.data || {};
    if (type === "ready") { setStatus("Ready."); return; }
    if (type === "progress") { setStatus(payload); return; }
    if (type === "error") { setStatus(error || "Error"); alert(error); return; }
    if (type === "result") {
      try {
        // Log the payload for debugging
        console.log("Worker result payload:", payload);
        const json = JSON.parse(payload);
        LAST.json = json;
        renderSummary(json.summary);
        renderSections(json);
        drawGeometry(json);
        setStatus("Done.");
      } catch (e) {
        console.error("JSON parse error:", e, "Payload:", payload);
        setStatus("Failed to parse result.");
        alert("Failed to parse result JSON. See console for details.");
      }
    }
  };
  worker.postMessage({ type:"init" });

  document.getElementById('go').addEventListener('click', async ()=>{
    const f1 = document.getElementById('f1').files?.[0];
    const f2 = document.getElementById('f2').files?.[0];
    if (!f1 || !f2) { alert("Please choose both INP files."); return; }
    setStatus("Reading files…");
    const [b1, b2] = await Promise.all([f1.arrayBuffer(), f2.arrayBuffer()]);
    setStatus("Running comparison…");
    worker.postMessage({ type:"compare", file1: b1, file2: b2 }, [b1, b2]);
  });

  ["fAdded","fRemoved","fChanged","search"].forEach(id=>{
    document.getElementById(id).addEventListener(id==="search"?"input":"change", ()=>{
      if (!LAST.currentSection) return;
      renderTableFor(LAST.currentSection);
    });
  });

  window.openDetail = function(section, id){
    const { diffs, headers, renames, hydrographs } = LAST.json || {};
    const d = diffs?.[section] || { added:{}, removed:{}, changed:{} };
    const titleEl = document.getElementById('modalTitle');
    const metaEl = document.getElementById('modalMeta');
    const grid = document.getElementById('modalGrid');
    const onlyChangedBox = document.getElementById('onlyChangedBox');

    // === HYDROGRAPHS drill-down (pivot Short/Medium/Long × params) ===
    if (section === "HYDROGRAPHS" && id.includes(" ")) {
      const [hydro, month] = id.split(" ");
      titleEl.textContent = `HYDROGRAPH · ${hydro} · ${month}`;
      // Build a tiny table in place of the kv grid
      grid.innerHTML = ""; // we'll render our own table below

      const params = ["R","T","K","Dmax","Drecov","Dinit"];
      const responses = ["Short","Medium","Long"];

      // Fetch full values from both files (falls back to blanks if missing)
      const h1 = (hydrographs?.file1 || {});
      const h2 = (hydrographs?.file2 || {});
      function getVals(dict, resp) {
        return (dict[`${hydro} ${month} ${resp}`] || ["","","","","",""]).slice(0,6);
      }

      // Decide which cells changed using the diffs
      function changed(resp, colIdx) {
        const key = `${hydro} ${month} ${resp}`;
        const ch = d.changed?.[key];
        if (!ch) return false;
        const oldArr = ch[0] || [], newArr = ch[1] || [];
        return (oldArr[colIdx] || "") !== (newArr[colIdx] || "");
      }

      function fmtNum(x){
        const v = Number(x);
        if (!isFinite(v)) return (x && x !== "") ? escapeHtml(x) : "—";
        const s = v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
        return s === "-0.000" ? "0.000" : s;
      }

      function deltaCell(ov, nv){
        if ((ov ?? "") === (nv ?? "")) return `<span class="num">${fmtNum(nv)}</span>`;
        const vo = Number(ov), vn = Number(nv);
        const hasNums = isFinite(vo) && isFinite(vn);
        const delta = hasNums ? vn - vo : null;
        const dTxt = hasNums ? ` <span class="plusminus">(${delta >= 0 ? "+" : ""}${fmtNum(delta)})</span>` : "";
        const oTxt = (ov !== "" && ov !== undefined) ? fmtNum(ov) : "—";
        const nTxt = (nv !== "" && nv !== undefined) ? fmtNum(nv) : "—";
        return `<span class="delta"><span class="old">${oTxt}</span><span class="arrow">→</span><span class="diff">${nTxt}</span>${dTxt}</span>`;
      }

      // Build HTML table
      const tbl = document.createElement("table");
      tbl.className = "modal-hydro";
      tbl.innerHTML = `<thead>
        <tr><th class="resp">Response</th>${params.map(p=>`<th>${p}</th>`).join("")}</tr>
      </thead><tbody></tbody>`;
      const tbody = tbl.querySelector("tbody");

      const showOnlyChanged = () => onlyChangedBox.checked;

      for (const resp of responses) {
        const oldVals = getVals(hydrographs?.file1 || {}, resp);
        const newVals = getVals(hydrographs?.file2 || {}, resp);
        // Skip entire row if "only changed" and no cell differs
        const rowHasChange = oldVals.some((ov,i)=> (ov||"") !== (newVals[i]||""));
        if (showOnlyChanged() && !rowHasChange) continue;

        const tr = document.createElement("tr");
        tr.innerHTML = `<td style="padding:6px 8px;font-weight:600;">${resp}</td>` +
          params.map((_,i)=>{
            const ov = oldVals[i] || "";
            const nv = newVals[i] || "";
            const isCh = (ov !== nv);
            return `<td>${deltaCell(ov, nv)}</td>`;
          }).join("");
        tbody.appendChild(tr);
      }

      metaEl.innerHTML = `<span class="tag">Hydrograph</span>`;
      grid.appendChild(tbl);
      onlyChangedBox.onchange = ()=> openDetail(section, id);
      document.getElementById('modalBackdrop').style.display = 'flex';
      return;
    }

    // === Default (unchanged) path for non-HYDROGRAPHS ===
    const hdrs = (headers?.[section] || []).slice();
    const isAdded   = d.added && Object.prototype.hasOwnProperty.call(d.added, id);
    const isRemoved = d.removed && Object.prototype.hasOwnProperty.call(d.removed, id);
    const changeType = isAdded ? 'Added' : isRemoved ? 'Removed' : 'Changed';

    let oldArr = isAdded   ? [] : isRemoved ? (d.removed[id] || []) : (d.changed[id]?.[0] || []);
    let newArr = isRemoved ? [] : isAdded   ? (d.added[id]   || []) : (d.changed[id]?.[1] || []);

    titleEl.textContent = `${section} · ${id}`;
    const renameTo = renames?.[section]?.[id];
    metaEl.innerHTML = `<span class="tag">${changeType}</span>${renameTo ? `<span class="tag" style="margin-left:6px">Renamed ↦ ${renameTo}</span>`:''}`;

    const maxLen = Math.max(oldArr.length, newArr.length) + 1;
    while (hdrs.length < maxLen) hdrs.push(`Field ${hdrs.length+1}`);

    grid.innerHTML = `
      <div class="hdr">Field</div>
      <div class="hdr">Old</div>
      <div class="hdr">New</div>
    `;
    const showOnlyChanged = () => onlyChangedBox.checked;
    const pushRow = (label, oldV, newV)=>{
      const changed = (oldV||"") !== (newV||"");
      if (showOnlyChanged() && !changed) return;
      const oldCell = changed ? `<span class="cell-changed">${escapeHtml(oldV||"")}</span>` : escapeHtml(oldV||"");
      const newCell = changed ? `<span class="cell-changed">${escapeHtml(newV||"")}</span>` : escapeHtml(newV||"");
      grid.insertAdjacentHTML('beforeend', `<div>${escapeHtml(label)}</div><div>${oldCell}</div><div>${newCell}</div>`);
    };
    pushRow(hdrs[0] || "ID", id, id);
    for (let i=1;i<maxLen;i++) pushRow(hdrs[i] || `Field ${i}`, oldArr[i-1], newArr[i-1]);

    onlyChangedBox.onchange = ()=> openDetail(section, id);
    document.getElementById('modalBackdrop').style.display = 'flex';
  }

  window.closeModal = function(){ document.getElementById('modalBackdrop').style.display='none'; };

  window.copyRowJSON = function(){
    const section = LAST.currentSection;
    if (!section) return;
    const d = LAST.json?.diffs?.[section] || {};
    const rawTitle = document.getElementById('modalTitle').textContent;
    const parts = rawTitle.split('·').map(s=>s.trim());
    const id = parts[parts.length-1];

    let oldArr = [], newArr = [];
    if (d.added && Object.prototype.hasOwnProperty.call(d.added, id)) {
      newArr = d.added[id] || [];
    } else if (d.removed && Object.prototype.hasOwnProperty.call(d.removed, id)) {
      oldArr = d.removed[id] || [];
    } else if (d.changed && Object.prototype.hasOwnProperty.call(d.changed, id)) {
      oldArr = d.changed[id]?.[0] || [];
      newArr = d.changed[id]?.[1] || [];
    }

    const entry = {
      section,
      id,
      headers: LAST.json?.headers?.[section] || [],
      old: oldArr,
      new: newArr,
    };
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
    alert("Row JSON copied.");
  }
});
