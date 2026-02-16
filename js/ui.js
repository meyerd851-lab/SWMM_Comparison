// ui.js — UI interactions, modals, session management, export

import { state } from './state.js';
import { abToB64, b64ToAb, escapeHtml, relabelHeaders } from './utils.js';
import { renderSections } from './table.js';
import { drawGeometry } from './map.js';

// --- Module-scoped state & helpers ---

let setStatusCallback = null;
export function setSetStatusCallback(callback) {
  setStatusCallback = callback;
}
function setStatus(s) {
  if (setStatusCallback) setStatusCallback(s);
  else document.getElementById('status').textContent = s;
}

export function initTheme() {
  const storedTheme = localStorage.getItem('swmm_theme');
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const theme = storedTheme || (prefersLight ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', theme);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('swmm_theme', next);
}

let workerRef = null;
export function setWorker(worker) {
  workerRef = worker;
}

// --- Resizable panels ---

export function makeResizable() {
  const mapSplitter = document.getElementById('map-v-splitter');
  if (!mapSplitter) return;

  mapSplitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.style.cursor = 'col-resize';

    const detailsWrap = document.getElementById('detailsWrap');
    const mapWrapper = document.getElementById('map-wrapper');

    // Calculate initial values
    const startX = e.clientX;
    const startMapWidth = mapWrapper.getBoundingClientRect().width;
    const totalWidth = detailsWrap.getBoundingClientRect().width;

    const onMouseMove = (moveEvent) => {
      // Delta x: moving right (positive) decreases map width, moving left increases it
      const delta = moveEvent.clientX - startX;
      let newMapWidth = startMapWidth - delta;

      // Constraints (min 100px)
      if (newMapWidth < 100) newMapWidth = 100;
      if (newMapWidth > totalWidth - 200) newMapWidth = totalWidth - 200;

      mapWrapper.style.width = `${newMapWidth}px`;

      // Force map resize event
      window.dispatchEvent(new Event('resize'));
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// --- Modal management ---

export function openHelpModal() {
  const el = document.getElementById('helpModalBackdrop');
  el.classList.add('open');
  el.style.display = 'flex'; // Ensure flex for centering
}
export function closeHelpModal() {
  const el = document.getElementById('helpModalBackdrop');
  el.classList.remove('open');
  setTimeout(() => { if (!el.classList.contains('open')) el.style.display = 'none'; }, 200);
}

export function openCompareModal() {
  const el = document.getElementById('compareModalBackdrop');
  el.classList.add('open');
  el.style.display = 'flex';
}
export function closeCompareModal() {
  const el = document.getElementById('compareModalBackdrop');
  el.classList.remove('open');
  setTimeout(() => { if (!el.classList.contains('open')) el.style.display = 'none'; }, 200);
}


const diffToggle = document.getElementById('toggleTolerances');
if (diffToggle) {
  diffToggle.onclick = () => {
    const opts = document.getElementById('toleranceOptions');
    const arrow = document.getElementById('tolArrow');
    if (opts.style.display === 'none') {
      opts.style.display = 'grid';
      arrow.textContent = '▼';
    } else {
      opts.style.display = 'none';
      arrow.textContent = '▶';
    }
  };
}

// Labels Menu Toggle (Click-based)
document.querySelectorAll('.menu').forEach(menu => {
  const btn = menu.querySelector('.btn');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();

      document.querySelectorAll('.menu.open').forEach(m => {
        if (m !== menu) m.classList.remove('open');
      });
      menu.classList.toggle('open');
    });
  }
});


window.addEventListener('click', (e) => {
  document.querySelectorAll('.menu.open').forEach(menu => {
    if (!menu.contains(e.target)) {
      menu.classList.remove('open');
    }
  });
});

// --- Detail view ---

export function openDetail(section, id) {
  const { diffs, headers, renames, hydrographs } = state.LAST.json || {};
  const d = diffs?.[section] || { added: {}, removed: {}, changed: {} };
  const titleEl = document.getElementById('modalTitle');
  const metaEl = document.getElementById('modalMeta');
  const grid = document.getElementById('modalGrid');
  const onlyChangedBox = document.getElementById('onlyChangedBox');


  const fmtNum = (x) => {
    const v = Number(x);
    if (!isFinite(v)) return (x && x !== "") ? escapeHtml(x) : "—";
    const s = v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    return s === "-0.000" ? "0.000" : s;
  };

  // --- HYDROGRAPH SPECIAL HANDLING ---
  if (section === "HYDROGRAPHS" && id.includes(" ")) {
    const [hydro, month] = id.split(" ");
    titleEl.textContent = `HYDROGRAPH · ${hydro} · ${month}`;
    grid.innerHTML = "";
    // Reset grid styling for table mode
    grid.style.display = 'block';
    grid.style.border = 'none';
    grid.style.background = 'transparent';

    const params = ["R", "T", "K", "Dmax", "Drecov", "Dinit", "RainGage"];
    const responses = ["Short", "Medium", "Long"];

    const h1 = (hydrographs?.file1 || {});
    const h2 = (hydrographs?.file2 || {});
    function getVals(dict, resp) {
      return (dict[`${hydro} ${month} ${resp}`] || ["", "", "", "", "", "", ""]).slice(0, 7);
    }

    function deltaCell(ov, nv, isNumeric = true) {
      if ((ov ?? "") === (nv ?? "")) return `<span class="num">${fmtNum(nv)}</span>`;

      const vo = Number(ov), vn = Number(nv);
      // Only calc delta if both are present, numeric, and isNumeric flag is true
      const bothPresent = (ov !== "" && ov !== undefined) && (nv !== "" && nv !== undefined);
      const hasNums = isNumeric && bothPresent && isFinite(vo) && isFinite(vn);
      const delta = hasNums ? vn - vo : null;
      const dTxt = hasNums ? ` <span class="plusminus" style="font-size:0.8em; opacity:0.8;">(${delta >= 0 ? "+" : ""}${fmtNum(delta)})</span>` : "";

      const oTxt = (ov !== "" && ov !== undefined) ? fmtNum(ov) : "—";
      const nTxt = (nv !== "" && nv !== undefined) ? fmtNum(nv) : "—";

      // If one is missing, treat as Added/Removed without arrow
      if (ov === "" || ov === undefined) {
        return `<span style="color:var(--added)">${nTxt}</span>`;
      }
      if (nv === "" || nv === undefined) {
        return `<span style="color:var(--removed)">${oTxt}</span>`;
      }

      return `<div>
        <span class="old" style="text-decoration:line-through; opacity:0.6; font-size:0.9em;">${oTxt}</span>
        <span class="arrow">→</span>
        <span class="new" style="color:var(--changed)">${nTxt}</span>
        ${dTxt}
      </div>`;
    }

    const tbl = document.createElement("table");
    tbl.className = "data-table"; // Reuse table styles
    tbl.innerHTML = `<thead>
      <tr><th>Response</th>${params.map(p => `<th>${p}</th>`).join("")}</tr>
    </thead><tbody></tbody>`;
    const tbody = tbl.querySelector("tbody");

    const showOnlyChanged = () => onlyChangedBox.checked;

    for (const resp of responses) {
      const oldVals = getVals(h1, resp);
      const newVals = getVals(h2, resp);
      const rowHasChange = oldVals.some((ov, i) => (ov || "") !== (newVals[i] || ""));
      if (showOnlyChanged() && !rowHasChange) continue;

      const tr = document.createElement("tr");
      tr.innerHTML = `<td style="font-weight:600;">${resp}</td>` +
        params.map((_, i) => {
          const ov = oldVals[i] || "";
          const nv = newVals[i] || "";
          // RainGage (index 6, last param) is not numeric for deltas
          const isNum = i !== 6;
          return `<td>${deltaCell(ov, nv, isNum)}</td>`;
        }).join("");
      tbody.appendChild(tr);
    }

    metaEl.innerHTML = `<span class="badge" style="background:var(--primary-light); color:var(--primary);">Hydrograph</span>`;
    grid.appendChild(tbl);
    onlyChangedBox.onchange = () => openDetail(section, id);

    document.getElementById('modalBackdrop').classList.add('open');
    document.getElementById('modalBackdrop').style.display = 'flex';
    return;
  }

  // --- VERTICES & POLYGONS SPECIAL HANDLING ---
  if (section && (section.trim() === "VERTICES" || section.trim() === "POLYGONS")) {
    titleEl.textContent = `${section} · ${id}`;
    grid.innerHTML = "";
    grid.style.display = 'block';

    const dDiff = diffs?.[section] || {};
    let oldData = null, newData = null;

    if (d.added && d.added[id]) {
      newData = d.added[id];
    } else if (d.removed && d.removed[id]) {
      oldData = d.removed[id];
    } else if (d.changed && d.changed[id]) {
      const cObj = d.changed[id];
      oldData = Array.isArray(cObj) ? cObj[0] : (cObj?.values?.[0] || []);
      newData = Array.isArray(cObj) ? cObj[1] : (cObj?.values?.[1] || []);
    }

    const parsePoints = (arr) => {
      // For VERTICES/POLYGONS, arr is [JSON_String]
      if (!arr || arr.length < 1) return [];
      try {
        return JSON.parse(arr[0]);
      } catch (e) { return []; }
    };

    const pts1 = parsePoints(oldData);
    const pts2 = parsePoints(newData);

    let badge = 'Changed';
    if (!oldData) badge = 'Added';
    if (!newData) badge = 'Removed';
    metaEl.innerHTML = `<span class="badge ${badge.toLowerCase()}">${badge}</span>`;


    const allRows = Math.max(pts1.length, pts2.length);
    let rowsHTML = "";

    for (let i = 0; i < allRows; i++) {
      const p1 = pts1[i]; // [x, y]
      const p2 = pts2[i]; // [x, y]

      let xCell = "", yCell = "";

      if (p1 && p2) {
        // Compare
        const xMatch = p1[0] == p2[0];
        const yMatch = p1[1] == p2[1];

        xCell = xMatch ? fmtNum(p2[0]) : `<span style="text-decoration:line-through;opacity:0.6">${fmtNum(p1[0])}</span> <span style="color:var(--changed)">${fmtNum(p2[0])}</span>`;
        yCell = yMatch ? fmtNum(p2[1]) : `<span style="text-decoration:line-through;opacity:0.6">${fmtNum(p1[1])}</span> <span style="color:var(--changed)">${fmtNum(p2[1])}</span>`;
      } else if (p1) {
        // Removed point (or just end of list)
        xCell = `<span style="color:var(--removed)">${fmtNum(p1[0])}</span>`;
        yCell = `<span style="color:var(--removed)">${fmtNum(p1[1])}</span>`;
      } else if (p2) {
        // Added point
        xCell = `<span style="color:var(--added)">${fmtNum(p2[0])}</span>`;
        yCell = `<span style="color:var(--added)">${fmtNum(p2[1])}</span>`;
      }

      rowsHTML += `<tr><td style="color:#888;font-size:0.8em;">${i + 1}</td><td>${xCell}</td><td>${yCell}</td></tr>`;
    }

    const tbl = document.createElement("table");
    tbl.className = "data-table";
    tbl.innerHTML = `<thead><tr><th style="width:30px">#</th><th>X</th><th>Y</th></tr></thead><tbody>${rowsHTML}</tbody>`;

    grid.appendChild(tbl);


    document.getElementById('modalBackdrop').classList.add('open');
    document.getElementById('modalBackdrop').style.display = 'flex';
    return;
  }

  // --- CURVES SPECIAL HANDLING --- //
  if (section && section.trim() === "CURVES") {
    titleEl.textContent = `CURVE · ${id}`;
    grid.innerHTML = "";
    grid.style.display = 'block';
    grid.style.border = 'none';
    grid.style.background = 'transparent';

    const dDiff = diffs?.[section] || {};

    let oldData = null, newData = null;

    if (d.added && d.added[id]) {
      newData = d.added[id]; // [Type, JSON_Points]
    } else if (d.removed && d.removed[id]) {
      oldData = d.removed[id];
    } else if (d.changed && d.changed[id]) {

      const cObj = d.changed[id];
      oldData = Array.isArray(cObj) ? cObj[0] : (cObj?.values?.[0] || []);
      newData = Array.isArray(cObj) ? cObj[1] : (cObj?.values?.[1] || []);
    }


    const parseCurve = (arr) => {
      if (!arr || arr.length < 2) return { type: "—", points: [] };
      try {
        return { type: arr[0], points: JSON.parse(arr[1]) };
      } catch (e) { return { type: arr[0], points: [] }; }
    };

    const c1 = parseCurve(oldData);
    const c2 = parseCurve(newData);


    let metaHTML = ``;
    if (c1.type !== c2.type && c1.type !== "—" && c2.type !== "—") {
      metaHTML += `<div style="margin-top:8px"><strong>Type:</strong> <span style="text-decoration:line-through;opacity:0.6">${escapeHtml(c1.type)}</span> → <span style="color:var(--changed)">${escapeHtml(c2.type)}</span></div>`;
    } else {
      metaHTML += `<div style="margin-top:8px"><strong>Type:</strong> ${escapeHtml(c2.type !== "—" ? c2.type : c1.type)}</div>`;
    }


    let badge = 'Changed';
    if (!oldData) badge = 'Added';
    if (!newData) badge = 'Removed';
    metaEl.innerHTML = `<span class="badge ${badge.toLowerCase()}">${badge}</span>` + metaHTML;





    const len = Math.max(c1.points.length, c2.points.length);

    const tbl = document.createElement("table");
    tbl.className = "data-table";
    tbl.innerHTML = `
      <thead>
        <tr>
          <th colspan="2" style="text-align:center; border-right:1px solid var(--border-medium)">Old Points (X, Y)</th>
          <th colspan="2" style="text-align:center;">New Points (X, Y)</th>
        </tr>
        <tr>
          <th>X</th><th>Y</th>
          <th style="border-left:1px solid var(--border-medium)">X</th><th>Y</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = tbl.querySelector("tbody");

    const showOnlyChanged = () => onlyChangedBox.checked;

    for (let i = 0; i < len; i++) {
      const p1 = c1.points[i]; // [x, y] or undefined
      const p2 = c2.points[i];

      let isDiff = false;
      if (p1 && p2) {
        if (p1[0] !== p2[0] || p1[1] !== p2[1]) isDiff = true;
      } else {
        isDiff = true; // Added or removed point
      }

      if (showOnlyChanged() && !isDiff) continue;

      const row = document.createElement("tr");

      const cell = (val, isChanged) => `<td style="${isChanged ? 'background:var(--bg-highlight); color:var(--text-primary);' : ''}">${val !== undefined ? val : ''}</td>`;

      // P1
      if (p1) {
        // Check if P1 is strictly removed (no P2)
        const style = (!p2) ? `background:var(--removed-light); color:var(--removed);` : (isDiff ? `opacity:0.6;` : ``);
        row.innerHTML += `<td style="${style}">${p1[0]}</td><td style="${style}; border-right:1px solid var(--border-medium);">${p1[1]}</td>`;
      } else {
        row.innerHTML += `<td></td><td style="border-right:1px solid var(--border-medium)"></td>`;
      }

      // P2
      if (p2) {
        const style = (!p1) ? `background:var(--added-light); color:var(--added);` : (isDiff ? `background:var(--changed-light); color:var(--changed);` : ``);
        row.innerHTML += `<td style="${style}">${p2[0]}</td><td style="${style}">${p2[1]}</td>`;
      } else {
        row.innerHTML += `<td></td><td></td>`;
      }

      tbody.appendChild(row);
    }

    grid.appendChild(tbl);
    onlyChangedBox.onchange = () => openDetail(section, id);

    document.getElementById('modalBackdrop').classList.add('open');
    document.getElementById('modalBackdrop').style.display = 'flex';
    return;
  }

  // --- LID_CONTROLS SPECIAL HANDLING ---
  if (section === "LID_CONTROLS") {
    titleEl.textContent = `LID CONTROL · ${id}`;
    grid.innerHTML = "";
    grid.style.display = 'block';
    grid.style.border = 'none';
    grid.style.background = 'transparent';

    const d = diffs.LID_CONTROLS;
    let oldData = [], newData = [];

    if (d.added && d.added[id]) newData = d.added[id];
    else if (d.removed && d.removed[id]) oldData = d.removed[id];
    else if (d.changed && d.changed[id]) {
      const cObj = d.changed[id];
      const pair = (cObj && cObj.values) ? cObj.values : cObj;
      oldData = pair[0] || [];
      newData = pair[1] || [];
    }

    const LID_TYPE_NAMES = { BC: "Bio-Retention Cell", IT: "Infiltration Trench", PP: "Permeable Pavement", VS: "Vegetative Swale", RG: "Rain Garden", RD: "Rooftop Disconnection" };

    const LAYER_PARAMS = {
      SURFACE: ["Berm Height (in)", "Veg Volume (frac)", "Roughness (n)", "Slope (%)", "Swale Side Slope"],
      SOIL: ["Thickness (in)", "Porosity", "Field Capacity", "Wilting Point", "Conductivity (in/hr)", "Cond. Slope", "Suction Head (in)"],
      PAVEMENT: ["Thickness (in)", "Void Ratio", "Imperv. Surface (frac)", "Permeability (in/hr)", "Clog Factor", "Regen Interval (days)", "Regen Fraction"],
      STORAGE: ["Thickness (in)", "Void Ratio", "Seepage Rate (in/hr)", "Clog Factor", "Covered"],
      DRAIN: ["Coeff (in/hr)", "Exponent", "Offset Height (in)", "Open Level (in)", "Closed Level (in)", "Control Curve"],
      DRAINMAT: ["Thickness (in)", "Void Fraction", "Roughness"]
    };

    const parseLID = (arr) => {
      if (!arr || arr.length < 2) return { type: "—", layers: {} };
      try { return { type: arr[0], layers: JSON.parse(arr[1]) }; }
      catch (e) { return { type: arr[0], layers: {} }; }
    };

    const l1 = parseLID(oldData);
    const l2 = parseLID(newData);

    // Badge
    let badge = 'Changed';
    if (!oldData.length) badge = 'Added';
    if (!newData.length) badge = 'Removed';

    // Type meta
    let metaHTML = '';
    const t1Name = LID_TYPE_NAMES[l1.type] || l1.type;
    const t2Name = LID_TYPE_NAMES[l2.type] || l2.type;
    if (l1.type !== l2.type && l1.type !== "—" && l2.type !== "—") {
      metaHTML += `<div style="margin-top:8px"><strong>Type:</strong> <span style="text-decoration:line-through;opacity:0.6">${escapeHtml(t1Name)}</span> → <span style="color:var(--changed)">${escapeHtml(t2Name)}</span></div>`;
    } else {
      metaHTML += `<div style="margin-top:8px"><strong>Type:</strong> ${escapeHtml(l2.type !== "—" ? t2Name : t1Name)}</div>`;
    }
    metaEl.innerHTML = `<span class="badge ${badge.toLowerCase()}">${badge}</span>` + metaHTML;

    // Collect all layer names
    const allLayers = new Set([...Object.keys(l1.layers), ...Object.keys(l2.layers)]);
    const layerOrder = ["SURFACE", "SOIL", "PAVEMENT", "STORAGE", "DRAIN", "DRAINMAT", "REMOVALS"];
    const sortedLayers = layerOrder.filter(l => allLayers.has(l));
    // Add any layers not in the predefined order
    for (const l of allLayers) { if (!sortedLayers.includes(l)) sortedLayers.push(l); }

    let html = '';

    for (const layerName of sortedLayers) {
      const params1 = l1.layers[layerName];
      const params2 = l2.layers[layerName];
      const paramLabels = LAYER_PARAMS[layerName] || [];

      html += `<div style="margin-bottom:12px; margin-top:16px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; font-size:0.85em; letter-spacing:0.5px;">${escapeHtml(layerName)}</div>`;

      if (layerName === "REMOVALS") {
        // REMOVALS: array of [pollutant, percent] pairs
        const r1 = Array.isArray(params1) ? params1 : [];
        const r2 = Array.isArray(params2) ? params2 : [];
        const map1 = {};
        r1.forEach(p => { if (p.length >= 2) map1[p[0]] = p[1]; });
        const map2 = {};
        r2.forEach(p => { if (p.length >= 2) map2[p[0]] = p[1]; });
        const allPollutants = new Set([...Object.keys(map1), ...Object.keys(map2)]);

        html += `<table class="data-table" style="margin-bottom:16px;"><thead><tr><th>Pollutant</th><th>Old %</th><th>New %</th></tr></thead><tbody>`;
        for (const pollut of allPollutants) {
          const ov = map1[pollut] ?? "";
          const nv = map2[pollut] ?? "";
          const isDiff = ov !== nv;
          const oldStyle = isDiff ? 'style="text-decoration:line-through; opacity:0.6"' : '';
          const newStyle = isDiff ? 'style="color:var(--changed); font-weight:600"' : '';
          if (!ov) {
            html += `<tr><td>${escapeHtml(pollut)}</td><td></td><td style="color:var(--added)">${escapeHtml(nv)}</td></tr>`;
          } else if (!nv) {
            html += `<tr><td>${escapeHtml(pollut)}</td><td style="color:var(--removed)">${escapeHtml(ov)}</td><td></td></tr>`;
          } else {
            html += `<tr><td>${escapeHtml(pollut)}</td><td ${oldStyle}>${escapeHtml(ov)}</td><td ${newStyle}>${escapeHtml(nv)}</td></tr>`;
          }
        }
        html += `</tbody></table>`;
        continue;
      }

      // Standard layer: array of parameter values
      const p1 = Array.isArray(params1) ? params1 : [];
      const p2 = Array.isArray(params2) ? params2 : [];
      const maxLen = Math.max(p1.length, p2.length, paramLabels.length);

      html += `<table class="data-table" style="margin-bottom:16px;"><thead><tr><th>Parameter</th><th>Old</th><th>New</th></tr></thead><tbody>`;
      for (let i = 0; i < maxLen; i++) {
        const label = paramLabels[i] || `Param ${i + 1}`;
        const ov = p1[i] ?? "";
        const nv = p2[i] ?? "";
        const isDiff = ov !== nv;

        if (onlyChangedBox.checked && !isDiff) continue;

        const oldStyle = isDiff ? 'style="text-decoration:line-through; opacity:0.6"' : '';
        const newStyle = isDiff ? 'style="color:var(--changed); font-weight:600"' : '';

        if (!params1 && params2) {
          // Entire layer added
          html += `<tr><td>${escapeHtml(label)}</td><td></td><td style="color:var(--added)">${escapeHtml(nv)}</td></tr>`;
        } else if (params1 && !params2) {
          // Entire layer removed
          html += `<tr><td>${escapeHtml(label)}</td><td style="color:var(--removed)">${escapeHtml(ov)}</td><td></td></tr>`;
        } else {
          html += `<tr><td>${escapeHtml(label)}</td><td ${oldStyle}>${escapeHtml(ov)}</td><td ${newStyle}>${escapeHtml(nv)}</td></tr>`;
        }
      }
      html += `</tbody></table>`;
    }

    grid.innerHTML = html;
    onlyChangedBox.onchange = () => openDetail(section, id);

    document.getElementById('modalBackdrop').classList.add('open');
    document.getElementById('modalBackdrop').style.display = 'flex';
    return;
  }

  // --- TRANSECTS SPECIAL HANDLING ---
  if (section === "TRANSECTS") {
    titleEl.textContent = `TRANSECT · ${id}`;
    grid.innerHTML = "";
    grid.style.display = 'block';
    grid.style.border = 'none';
    grid.style.background = 'transparent';

    const d = diffs.TRANSECTS;
    let oldData = [], newData = [];

    if (d.added && d.added[id]) newData = d.added[id];
    else if (d.removed && d.removed[id]) oldData = d.removed[id];
    else if (d.changed && d.changed[id]) {
      const cObj = d.changed[id];
      const pair = (cObj && cObj.values) ? cObj.values : cObj;
      oldData = pair[0] || [];
      newData = pair[1] || [];
    }


    const getData = (arr) => {
      if (!arr || arr.length < 9) return {
        nc: ["-", "-", "-"],
        x1: ["-", "-", "-", "-", "-"],
        gr: []
      };
      // array index map: 0-2=NC, 3-7=X1 params, 8=JSON
      return {
        nc: [arr[0], arr[1], arr[2]],
        x1: [arr[3], arr[4], arr[5], arr[6], arr[7]],
        gr: JSON.parse(arr[8] || "[]")
      };
    };

    const d1 = getData(oldData);
    const d2 = getData(newData);


    const renderRow = (label, v1, v2) => {
      const isDiff = v1 !== v2 && v1 !== "-" && v2 !== "-";
      const c1 = isDiff ? `<span style="text-decoration:line-through; opacity:0.6">${escapeHtml(v1)}</span>` : escapeHtml(v1);
      const c2 = isDiff ? `<span style="color:var(--changed); font-weight:600;">${escapeHtml(v2)}</span>` : escapeHtml(v2);
      return `<tr><td>${label}</td><td>${c1}</td><td>${c2}</td></tr>`;
    };

    const renderGeomRows = (g1, g2) => {
      const len = Math.max(g1.length, g2.length);
      let html = "";

      const diff = (a, b) => Math.abs(Number(a) - Number(b)) > 0.0001;

      for (let i = 0; i < len; i++) {
        const p1 = g1[i]; // [sta, elev]
        const p2 = g2[i];

        let c1 = "", c2 = "";
        let style = "";

        if (p1 && p2) {
          // Check station
          const staChanged = diff(p1[0], p2[0]);
          const elevChanged = diff(p1[1], p2[1]);

          if (staChanged || elevChanged) style = "background:var(--bg-highlight);";

          const fmt = (v, isChanged) => isChanged ? `<span style="color:var(--changed); font-weight:600;">${v}</span>` : v;
          const fmtOld = (v, isChanged) => isChanged ? `<span style="text-decoration:line-through; opacity:0.6">${v}</span>` : v;

          c1 = `<td>${fmtOld(p1[0], staChanged)}</td><td style="border-right:1px solid var(--border-medium)">${fmtOld(p1[1], elevChanged)}</td>`;
          c2 = `<td>${fmt(p2[0], staChanged)}</td><td>${fmt(p2[1], elevChanged)}</td>`;
        }
        else if (p1 && !p2) {
          style = "background:var(--removed-light);";
          c1 = `<td>${p1[0]}</td><td style="border-right:1px solid var(--border-medium)">${p1[1]}</td>`;
          c2 = `<td></td><td></td>`;
        }
        else if (!p1 && p2) {
          style = "background:var(--added-light);";
          c1 = `<td></td><td style="border-right:1px solid var(--border-medium)"></td>`;
          c2 = `<td>${p2[0]}</td><td>${p2[1]}</td>`;
        }

        html += `<tr style="${style}">${c1}${c2}</tr>`;
      }
      return html;
    };

    // 1. Properties Table (Manning's N + X1)
    const propsHTML = `
        <div style="margin-bottom:12px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; font-size:0.85em; letter-spacing:0.5px;">Transect Properties</div>
        <table class="data-table" style="margin-bottom:24px;">
           <thead><tr><th>Property</th><th>Old</th><th>New</th></tr></thead>
           <tbody>
             ${renderRow("Left Bank N", d1.nc[0], d2.nc[0])}
             ${renderRow("Right Bank N", d1.nc[1], d2.nc[1])}
             ${renderRow("Channel N", d1.nc[2], d2.nc[2])}
             ${renderRow("Left Station", d1.x1[0], d2.x1[0])}
             ${renderRow("Right Station", d1.x1[1], d2.x1[1])}
             ${renderRow("L-Factor", d1.x1[2], d2.x1[2])}
             ${renderRow("W-Factor", d1.x1[3], d2.x1[3])}
             ${renderRow("E-Offset", d1.x1[4], d2.x1[4])}
           </tbody>
        </table>
      `;

    // 2. Geometry Table
    const grHTML = `
        <div style="margin-bottom:12px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; font-size:0.85em; letter-spacing:0.5px;">Geometry Points</div>
        <table class="data-table">
          <thead>
            <tr><th colspan="2" style="text-align:center; border-right:1px solid var(--border-medium)">Old (Sta, Elev)</th><th colspan="2" style="text-align:center;">New (Sta, Elev)</th></tr>
            <tr><th>Sta</th><th style="border-right:1px solid var(--border-medium)">Elev</th><th>Sta</th><th>Elev</th></tr>
          </thead>
          <tbody>
             ${renderGeomRows(d1.gr, d2.gr)}
          </tbody>
        </table>
      `;

    grid.innerHTML = propsHTML + grHTML;


    let badge = 'Changed';
    if (!oldData.length) badge = 'Added';
    if (!newData.length) badge = 'Removed';
    metaEl.innerHTML = `<span class="badge ${badge.toLowerCase()}">${badge}</span>`;

    document.getElementById('modalBackdrop').classList.add('open');
    document.getElementById('modalBackdrop').style.display = 'flex';
    return;
  }

  // --- PATTERNS ---
  if (section === "PATTERNS") {
    grid.innerHTML = '';
    grid.style.display = 'block';

    const d = diffs.PATTERNS;
    let oldData = null;
    let newData = null;


    if (d.added && d.added[id]) {
      newData = d.added[id];
    } else if (d.removed && d.removed[id]) {
      oldData = d.removed[id];
    } else if (d.changed && d.changed[id]) {
      const cObj = d.changed[id];

      oldData = Array.isArray(cObj) ? cObj[0] : (cObj?.values?.[0] || []);
      newData = Array.isArray(cObj) ? cObj[1] : (cObj?.values?.[1] || []);
    }


    const parsePattern = (arr) => {
      if (!arr || arr.length < 2) return { type: "—", values: [] };
      try { return { type: arr[0], values: JSON.parse(arr[1]) }; }
      catch (e) { return { type: arr[0], values: [] }; }
    }

    const p1 = parsePattern(oldData);
    const p2 = parsePattern(newData);


    let metaHTML = ``;
    if (p1.type !== p2.type && p1.type !== "—" && p2.type !== "—") {
      metaHTML += `<div style="margin-top:8px"><strong>Type:</strong> <span style="text-decoration:line-through;opacity:0.6">${escapeHtml(p1.type)}</span> → <span style="color:var(--changed)">${escapeHtml(p2.type)}</span></div>`;
    } else {
      metaHTML += `<div style="margin-top:8px"><strong>Type:</strong> ${escapeHtml(p2.type !== "—" ? p2.type : p1.type)}</div>`;
    }

    let badge = 'Changed';
    if (!oldData) badge = 'Added';
    if (!newData) badge = 'Removed';
    metaEl.innerHTML = `<span class="badge ${badge.toLowerCase()}">${badge}</span>` + metaHTML;


    const len = Math.max(p1.values.length, p2.values.length);
    const type = p2.type !== "—" ? p2.type : p1.type;


    const getLabel = (i) => {
      if (type === "MONTHLY") {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return months[i] || `M${i + 1}`;
      }
      if (type === "DAILY") {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return days[i] || `D${i + 1}`;
      }
      // Hourly / Weekend
      const h = i % 24;
      return `${h}:00`;
    };

    const tbl = document.createElement("table");
    tbl.className = "data-table";
    tbl.style.width = "100%";
    tbl.innerHTML = `
      <thead>
        <tr>
          <th style="width:80px">Time/Cat</th>
          <th style="text-align:left;">Old Factor</th>
          <th style="text-align:left;">New Factor</th>
          <th style="text-align:left;">Diff</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = tbl.querySelector("tbody");

    for (let i = 0; i < len; i++) {
      const v1 = p1.values[i];
      const v2 = p2.values[i];

      const n1 = parseFloat(v1);
      const n2 = parseFloat(v2);

      const isNum = !isNaN(n1) && !isNaN(n2);
      const diff = isNum ? n2 - n1 : null;
      const isDiff = v1 !== v2;

      if (onlyChangedBox.checked && !isDiff) continue;

      const row = document.createElement("tr");

      let cell1 = `<td>${v1 !== undefined ? v1 : ""}</td>`;
      let cell2 = `<td>${v2 !== undefined ? v2 : ""}</td>`;
      let cellDiff = `<td></td>`;

      if (isDiff) {
        cell1 = `<td style="color:var(--removed); text-decoration:line-through; opacity:0.7">${v1 !== undefined ? v1 : ""}</td>`;
        cell2 = `<td style="color:var(--changed); font-weight:600;">${v2 !== undefined ? v2 : ""}</td>`;
        if (isNum && diff !== 0) {
          const color = diff > 0 ? "var(--added)" : "var(--removed)";
          cellDiff = `<td style="color:${color}; font-size:0.9em;">${diff > 0 ? "+" : ""}${diff.toFixed(3)}</td>`;
        }
      } else if (!v1 && v2) {
        cell2 = `<td style="color:var(--added);">${v2}</td>`;
      } else if (v1 && !v2) {
        cell1 = `<td style="color:var(--removed);">${v1}</td>`;
      }

      row.innerHTML = `<td><strong>${getLabel(i)}</strong></td>${cell1}${cell2}${cellDiff}`;
      tbody.appendChild(row);
    }

    grid.appendChild(tbl);

    document.getElementById('modalBackdrop').classList.add('open');
    document.getElementById('modalBackdrop').style.display = 'flex';
    return;
  }

  // --- TIMESERIES ---
  if (section === "TIMESERIES") {
    grid.innerHTML = '';
    grid.style.display = 'block';

    const d = diffs.TIMESERIES;
    let oldData = null, newData = null;

    if (d.added && d.added[id]) newData = d.added[id];
    else if (d.removed && d.removed[id]) oldData = d.removed[id];
    else if (d.changed && d.changed[id]) {
      const cObj = d.changed[id];

      const pair = (cObj && cObj.values) ? cObj.values : cObj;
      oldData = pair[0];
      newData = pair[1];
    }


    const parseTS = (arr) => {
      if (!arr || arr.length < 2) return { type: "—", data: [] };
      if (arr[0] === "External") return { type: "External", file: arr[1], data: [] };
      try {
        return { type: "Inline", file: "", data: JSON.parse(arr[1]) };
      } catch (e) { return { type: "Inline", file: "", data: [] }; }
    };

    const t1 = parseTS(oldData);
    const t2 = parseTS(newData);


    let metaHTML = ``;
    if (t1.type !== t2.type && t1.type !== "—" && t2.type !== "—") {
      metaHTML += `<div style="margin-top:8px"><strong>Type:</strong> <span style="text-decoration:line-through;opacity:0.6">${escapeHtml(t1.type)}</span> → <span style="color:var(--changed)">${escapeHtml(t2.type)}</span></div>`;
    } else {
      metaHTML += `<div style="margin-top:8px"><strong>Type:</strong> ${escapeHtml(t2.type !== "—" ? t2.type : t1.type)}</div>`;
    }

    if (t1.file || t2.file) {
      if (t1.file && t2.file && t1.file !== t2.file) {
        metaHTML += `<div><strong>File:</strong> <span style="text-decoration:line-through;opacity:0.6">${escapeHtml(t1.file)}</span> → <span style="color:var(--changed)">${escapeHtml(t2.file)}</span></div>`;
      } else {
        metaHTML += `<div><strong>File:</strong> ${escapeHtml(t2.file || t1.file)}</div>`;
      }
    }

    let badge = 'Changed';
    if (!oldData) badge = 'Added';
    if (!newData) badge = 'Removed';
    metaEl.innerHTML = `<span class="badge ${badge.toLowerCase()}">${badge}</span>` + metaHTML;


    if (t2.type === "External" || (t1.type === "External" && !t2.type)) {
      grid.appendChild(document.createElement("div"));
      document.getElementById('modalBackdrop').classList.add('open');
      document.getElementById('modalBackdrop').style.display = 'flex';
      return;
    }


    const len = Math.max(t1.data.length, t2.data.length);
    const tbl = document.createElement("table");
    tbl.className = "data-table";
    tbl.style.width = "100%";

    tbl.innerHTML = `
      <thead>
        <tr>
          <th style="width:90px">Date</th>
          <th style="width:80px">Time</th>
          <th style="text-align:left;">Old Value</th>
          <th style="text-align:left;">New Value</th>
          <th style="text-align:left;">Diff</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = tbl.querySelector("tbody");

    for (let i = 0; i < len; i++) {
      const r1 = t1.data[i] || [];
      const r2 = t2.data[i] || [];

      const getDate = (r) => r.length === 3 ? r[0] : "";
      const getTime = (r) => r.length === 3 ? r[1] : (r.length === 2 ? r[0] : "");
      const getVal = (r) => r.length === 3 ? r[2] : (r.length === 2 ? r[1] : "");

      const d1 = getDate(r1), time1 = getTime(r1), v1 = getVal(r1);
      const d2 = getDate(r2), time2 = getTime(r2), v2 = getVal(r2);

      const dateDisplay = d2 || d1;
      const timeDisplay = time2 || time1;

      const n1 = parseFloat(v1);
      const n2 = parseFloat(v2);
      const isNum = !isNaN(n1) && !isNaN(n2);
      const diff = isNum ? n2 - n1 : null;
      const isDiff = v1 !== v2;

      if (onlyChangedBox.checked && !isDiff) continue;

      const row = document.createElement("tr");

      let cell1 = `<td>${v1 !== undefined && v1 !== "" ? v1 : ""}</td>`;
      let cell2 = `<td>${v2 !== undefined && v2 !== "" ? v2 : ""}</td>`;
      let cellDiff = `<td></td>`;

      if (isDiff) {
        cell1 = `<td style="color:var(--removed); text-decoration:line-through; opacity:0.7">${v1}</td>`;
        cell2 = `<td style="color:var(--changed); font-weight:600;">${v2}</td>`;
        if (isNum && diff !== 0) {
          const color = diff > 0 ? "var(--added)" : "var(--removed)";
          cellDiff = `<td style="color:${color}; font-size:0.9em;">${diff > 0 ? "+" : ""}${diff.toFixed(3)}</td>`;
        }
      } else if (!v1 && v2) {
        cell2 = `<td style="color:var(--added);">${v2}</td>`;
      } else if (v1 && !v2) {
        cell1 = `<td style="color:var(--removed);">${v1}</td>`;
      }

      row.innerHTML = `<td>${dateDisplay}</td><td><strong>${timeDisplay}</strong></td>${cell1}${cell2}${cellDiff}`;
      tbody.appendChild(row);
    }

    grid.appendChild(tbl);
    document.getElementById('modalBackdrop').classList.add('open');
    document.getElementById('modalBackdrop').style.display = 'flex';
    return;
  }

  // --- STANDARD DETAILS ---
  grid.style.display = 'grid'; // Restore grid
  grid.style.gridTemplateColumns = '140px 1fr 1fr';
  grid.style.gap = '1px';
  grid.style.background = 'var(--border-medium)';
  grid.style.border = '1px solid var(--border-medium)';

  const hdrsRaw = (headers?.[section] || []).slice();
  const hdrsLabeled = relabelHeaders(section, hdrsRaw);

  const isAdded = d.added && Object.prototype.hasOwnProperty.call(d.added, id);
  const isRemoved = d.removed && Object.prototype.hasOwnProperty.call(d.removed, id);
  const changeType = isAdded ? 'Added' : isRemoved ? 'Removed' : 'Changed';

  let oldArr, newArr;
  if (isAdded) {
    oldArr = [];
    newArr = d.added[id] || [];
  } else if (isRemoved) {
    oldArr = d.removed[id] || [];
    newArr = [];
  } else {
    const changedObj = d.changed[id];
    oldArr = Array.isArray(changedObj) ? changedObj[0] : (changedObj?.values?.[0] || []);
    newArr = Array.isArray(changedObj) ? changedObj[1] : (changedObj?.values?.[1] || []);
  }

  // --- SPECIAL HANDLING FOR TITLE SECTION ---
  if (section === "TITLE") {
    // Join all lines into a single string to display as one block
    if (oldArr && oldArr.length > 0) oldArr = [oldArr.join('\n')];
    if (newArr && newArr.length > 0) newArr = [newArr.join('\n')];
  }

  titleEl.textContent = `${section} : ${id}`;
  const renameTo = renames?.[section]?.[id];
  metaEl.innerHTML = `<span class="badge ${changeType.toLowerCase()}">${changeType}</span>${renameTo ? `<span class="badge" style="margin-left:6px; background:var(--bg-surface-hover); color:var(--text-secondary);">Renamed ↦ ${renameTo}</span>` : ''}`;

  const maxLen = Math.max(oldArr.length, newArr.length) + 1;
  while (hdrsLabeled.length < maxLen) hdrsLabeled.push(`Field ${hdrsLabeled.length + 1}`);

  grid.innerHTML = `
    <div class="hdr" style="background:var(--bg-body); padding:8px; font-weight:600;">Field</div>
    <div class="hdr" style="background:var(--bg-body); padding:8px; font-weight:600;">Old</div>
    <div class="hdr" style="background:var(--bg-body); padding:8px; font-weight:600;">New</div>
  `;
  const showOnlyChanged = () => onlyChangedBox.checked;
  const pushRow = (label, oldV, newV) => {
    const changed = (oldV || "") !== (newV || "");
    if (showOnlyChanged() && !changed) return;

    // Cell styling
    const cellStyle = "background:var(--bg-surface); padding:8px;";
    const changedStyle = "background:var(--bg-surface); padding:8px; color:var(--changed); font-weight:500;";

    const oldCell = `<div style="${changed ? changedStyle : cellStyle}">${escapeHtml(oldV || "")}</div>`;
    const newCell = `<div style="${changed ? changedStyle : cellStyle}">${escapeHtml(newV || "")}</div>`;

    grid.insertAdjacentHTML('beforeend', `<div style="${cellStyle}">${escapeHtml(label)}</div>${oldCell}${newCell}`);
  };

  const idOld = isAdded ? "" : id;
  const idNew = isRemoved ? "" : id;
  pushRow(hdrsLabeled[0] || "ID", idOld, idNew);

  for (let i = 1; i < maxLen; i++) pushRow(hdrsLabeled[i] || `Field ${i}`, oldArr[i - 1], newArr[i - 1]);

  onlyChangedBox.onchange = () => openDetail(section, id);
  document.getElementById('modalBackdrop').classList.add('open');
  document.getElementById('modalBackdrop').style.display = 'flex';
}

export function closeModal() {
  const el = document.getElementById('modalBackdrop');
  el.classList.remove('open');
  setTimeout(() => { if (!el.classList.contains('open')) el.style.display = 'none'; }, 200);
}



export function updateFileName(inputId, spanId) {
  const input = document.getElementById(inputId);
  const span = document.getElementById(spanId);
  input.addEventListener('change', () => span.textContent = input.files[0]?.name || 'No file selected');
}

// --- Session management ---

export async function saveSession() {
  if (!state.LAST.json) { alert("Run a comparison first."); return; }

  const session = {
    version: state.SESSION_VERSION,
    createdUtc: new Date().toISOString(),
    files: {
      file1: state.FILES.f1Bytes ? { name: state.FILES.f1Name, bytesB64: abToB64(state.FILES.f1Bytes) } : null,
      file2: state.FILES.f2Bytes ? { name: state.FILES.f2Name, bytesB64: abToB64(state.FILES.f2Bytes) } : null,
    },
    result: state.LAST.json,
    ui: {
      section: state.LAST.currentSection || null,
      crs: state.CURRENT_CRS,
      filters: {
        Added: document.getElementById('fAdded').checked,
        Removed: document.getElementById('fRemoved').checked,
        Changed: document.getElementById('fChanged').checked,
        Search: document.getElementById('search').value || ""
      },
      tolerances: {
        CONDUIT_LENGTH: parseFloat(document.getElementById('tol_conduit_length').value) || 0,
        CONDUIT_OFFSET: parseFloat(document.getElementById('tol_conduit_offset').value) || 0,
        JUNCTION_INVERT: parseFloat(document.getElementById('tol_junction_invert').value) || 0,
        JUNCTION_DEPTH: parseFloat(document.getElementById('tol_junction_depth').value) || 0,
        CONDUIT_ROUGHNESS: parseFloat(document.getElementById('tol_conduit_roughness').value) || 0
      }
    }
  };

  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
  const f1Name = state.FILES.f1Name || "file1";
  const f2Name = state.FILES.f2Name || "file2";
  const defaultName = `${f1Name}_vs_${f2Name}.sca`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: defaultName, types: [{ description: 'SWMM Comparison Session', accept: { 'application/json': ['.sca'] } }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus("Session saved.");
    } catch (err) { if (err.name !== 'AbortError') console.error("Save failed:", err); }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = defaultName; a.click(); URL.revokeObjectURL(url);
  }
}

export function applyUIState(ui) {
  if (!ui) return;
  const f = ui.filters;
  document.getElementById('fAdded').checked = f?.Added ?? true;
  document.getElementById('fRemoved').checked = f?.Removed ?? true;
  document.getElementById('fChanged').checked = f?.Changed ?? true;
  if (typeof f.Search === 'string') document.getElementById('search').value = f.Search;
  if (ui.crs && state.PROJECTIONS[ui.crs]) { document.getElementById('crsSelect').value = ui.crs; document.getElementById('crsSelect').dispatchEvent(new Event('change')); }
  if (ui.tolerances) {
    document.getElementById('tol_conduit_length').value = ui.tolerances.CONDUIT_LENGTH || 0;
    document.getElementById('tol_conduit_offset').value = ui.tolerances.CONDUIT_OFFSET || 0;
    document.getElementById('tol_junction_invert').value = ui.tolerances.JUNCTION_INVERT || 0;
    document.getElementById('tol_junction_depth').value = ui.tolerances.JUNCTION_DEPTH || 0;
    document.getElementById('tol_conduit_roughness').value = ui.tolerances.CONDUIT_ROUGHNESS || 0;
  }
}

export async function restoreFromResult(result, ui) {
  state.LAST.json = result;
  applyUIState(ui);
  renderSections(result);
  drawGeometry(result);
  if (ui?.section && result.diffs[ui.section]) {
    state.LAST.currentSection = ui.section;
    document.getElementById('currentSectionLabel').textContent = ui.section;
    const { renderTableFor } = await import('./table.js');
    renderTableFor(ui.section);
    const node = [...document.querySelectorAll('.sec-item')].find(n => n.dataset.sec === ui.section);
    document.querySelectorAll('.sec-item').forEach(n => n.classList.remove('active'));
    node?.classList.add('active');
  }
  setStatus("Session loaded.");
}

export async function loadSession(file) {
  try {
    const text = await file.text();
    const session = JSON.parse(text);
    state.FILES = { f1Name: null, f2Name: null, f1Bytes: null, f2Bytes: null };
    if (session.files?.file1?.bytesB64) { state.FILES.f1Name = session.files.file1.name || "file1.inp"; state.FILES.f1Bytes = b64ToAb(session.files.file1.bytesB64); }
    if (session.files?.file2?.bytesB64) { state.FILES.f2Name = session.files.file2.name || "file2.inp"; state.FILES.f2Bytes = b64ToAb(session.files.file2.bytesB64); }
    document.getElementById('f1-name').textContent = state.FILES.f1Name || ''; document.getElementById('f2-name').textContent = state.FILES.f2Name || '';
    if (session.result) { await restoreFromResult(session.result, session.ui); }
    else if (state.FILES.f1Bytes && state.FILES.f2Bytes) {
      setStatus("Recomputing comparison...");
      if (workerRef) workerRef.postMessage({ type: "compare", file1: state.FILES.f1Bytes, file2: state.FILES.f2Bytes, tolerances: session.ui?.tolerances || {} });
    } else { alert("Session file partial/empty."); }
  } catch (e) { console.error(e); alert("Load failed: " + e.message); }
}

// --- Excel export ---

export async function exportToExcel() {
  if (!state.LAST.json) { alert("Please run a comparison first."); return; }
  setStatus("Generating Excel file...");
  await new Promise(resolve => setTimeout(resolve, 50));

  const wb = XLSX.utils.book_new();
  const { diffs, headers, tolerances, warnings } = state.LAST.json;

  // --- 1. Summary Sheet ---
  const summaryData = [
    ["SWMM Comparison Report"],
    ["Generated", new Date().toLocaleString()],
    ["File 1", document.getElementById('f1-name').textContent || "file1.inp"],
    ["File 2", document.getElementById('f2-name').textContent || "file2.inp"],
    [],
    ["Tolerances Used"],
  ];

  if (tolerances && Object.keys(tolerances).length > 0) {
    for (const [k, v] of Object.entries(tolerances)) {
      summaryData.push([k, v]);
    }
  } else {
    summaryData.push(["(None)"]);
  }

  summaryData.push([]);
  summaryData.push(["Section Summary"]);
  summaryData.push(["Section", "Added", "Removed", "Changed"]);

  for (const sec of Object.keys(diffs).sort()) {
    const d = diffs[sec];
    summaryData.push([sec, Object.keys(d.added || {}).length, Object.keys(d.removed || {}).length, Object.keys(d.changed || {}).length]);
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 25 }, { wch: 40 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  // --- 2. Section Sheets ---
  const styles = {
    header: { font: { bold: true }, fill: { fgColor: { rgb: "FFFAFAFA" } } },
    added: { fill: { fgColor: { rgb: "FFEAF7EF" } }, font: { color: { rgb: "FF1E7B3A" } } },
    removed: { fill: { fgColor: { rgb: "FFFDEAEA" } }, font: { color: { rgb: "FFA52222" } } },
    changed: { fill: { fgColor: { rgb: "FFFFF6E6" } }, font: { color: { rgb: "FF935C00" } } },
    pillAdded: { fill: { fgColor: { rgb: "FFCDEED6" } }, font: { bold: true, color: { rgb: "FF1E7B3A" } } },
    pillRemoved: { fill: { fgColor: { rgb: "FFF7C7C7" } }, font: { bold: true, color: { rgb: "FFA52222" } } },
    pillChanged: { fill: { fgColor: { rgb: "FFFFE0A8" } }, font: { bold: true, color: { rgb: "FF935C00" } } },
  };

  for (const sec of Object.keys(diffs).sort()) {

    if (warnings && warnings[sec]) {
      const ws = XLSX.utils.aoa_to_sheet([["⚠️ Cannot Compare Section"], [warnings[sec]]]);
      const sheetName = sec.replace(/[:\\/?*[\]]/g, "").substring(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      continue;
    }

    const d = diffs[sec];
    let sheetData = [];
    let hdrs = headers[sec] ? [...headers[sec]] : [];

    if (sec === "HYDROGRAPHS") {
      hdrs = ["Hydrograph", "Month", "Response", "R", "T", "K", "Dmax", "Drecov", "Dinit", "RainGage"];
      sheetData.push(["Change", ...hdrs]);

      const rows = [];
      const push = (type, key, valsOld, valsNew) => {
        const parts = key.split(" ");
        const hydro = parts[0] || "";
        const month = parts[1] || "";
        const response = parts.slice(2).join(" ") || "";
        rows.push({ type, hydro, month, response, valsOld, valsNew });
      };

      for (const [k, v] of Object.entries(d.added || {})) push("Added", k, [], v);
      for (const [k, v] of Object.entries(d.removed || {})) push("Removed", k, v, []);
      for (const [k, v] of Object.entries(d.changed || {})) {
        const ov = Array.isArray(v) ? v[0] : (v.values?.[0] || []);
        const nv = Array.isArray(v) ? v[1] : (v.values?.[1] || []);
        push("Changed", k, ov, nv);
      }

      rows.sort((a, b) => (a.hydro + a.month + a.response).localeCompare(b.hydro + b.month + b.response));

      rows.forEach(r => {
        const row = [r.type, r.hydro, r.month, r.response];

        for (let i = 0; i < 7; i++) {
          const ov = r.valsOld[i] || "";
          const nv = r.valsNew[i] || "";

          if (r.type === "Added") row.push(nv);
          else if (r.type === "Removed") row.push(ov);
          else row.push((ov === nv) ? nv : `${ov} -> ${nv}`);
        }
        sheetData.push(row);
      });
    } else {
      hdrs = relabelHeaders(sec, hdrs);


      const diffHeaders = [];
      if (sec === 'CONDUITS') {
        diffHeaders.push('Δ Length', 'Δ InOffset', 'Δ OutOffset');
      } else if (sec === 'JUNCTIONS') {
        diffHeaders.push('Δ InvertElev', 'Δ MaxDepth');
      }

      sheetData.push(["Element ID", "Change", ...hdrs, ...diffHeaders]);

      const rows = [];
      for (const [id, arr] of Object.entries(d.added || {})) rows.push({ type: 'Added', id, oldArr: [], newArr: arr, diffs: {} });
      for (const [id, arr] of Object.entries(d.removed || {})) rows.push({ type: 'Removed', id, oldArr: arr, newArr: [], diffs: {} });
      for (const [id, pair] of Object.entries(d.changed || {})) {
        const oldArr = Array.isArray(pair) ? pair[0] : (pair.values?.[0] || []);
        const newArr = Array.isArray(pair) ? pair[1] : (pair.values?.[1] || []);
        const diffVals = pair.diff_values || {};
        rows.push({ type: 'Changed', id, oldArr, newArr, diffs: diffVals });
      }
      rows.sort((a, b) => a.id.localeCompare(b.id));

      rows.forEach(r => {
        const row = [r.id, r.type];
        const oldA = [r.id, ...r.oldArr];
        const newA = [r.id, ...r.newArr];

        for (let i = 0; i < hdrs.length; i++) {
          const ov = oldA[i] ?? "";
          const nv = newA[i] ?? "";

          if (r.type === 'Added') row.push(nv);
          else if (r.type === 'Removed') row.push(ov);
          else row.push(ov === nv ? nv : `${ov} -> ${nv}`);
        }


        if (sec === 'CONDUITS') {
          row.push(r.diffs?.Length ?? "");
          row.push(r.diffs?.InOffset ?? "");
          row.push(r.diffs?.OutOffset ?? "");
        } else if (sec === 'JUNCTIONS') {
          row.push(r.diffs?.InvertElev ?? "");
          row.push(r.diffs?.MaxDepth ?? "");
        }

        sheetData.push(row);
      });
    }

    const ws = XLSX.utils.aoa_to_sheet(sheetData);


    if (sheetData.length > 0) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
    }

    const colWidths = sheetData[0].map(h => (h ? h.length : 10));
    for (let R = 0; R < sheetData.length; ++R) {
      for (let C = 0; C < sheetData[R].length; ++C) {
        const cell_address = { c: C, r: R };
        const cell_ref = XLSX.utils.encode_cell(cell_address);
        if (!ws[cell_ref]) continue;

        const cellValue = sheetData[R][C]?.toString() || "";
        if (cellValue.length > colWidths[C]) colWidths[C] = cellValue.length;

        if (R === 0) {
          ws[cell_ref].s = styles.header;
        } else if (C === 1) {
          const changeType = sheetData[R][C];
          if (changeType.includes('Added')) ws[cell_ref].s = styles.pillAdded;
          else if (changeType.includes('Removed')) ws[cell_ref].s = styles.pillRemoved;
          else ws[cell_ref].s = styles.pillChanged;
        } else if (sec !== "HYDROGRAPHS" && C > 1) {
          const changeType = sheetData[R][1];
          if (changeType === 'Added') ws[cell_ref].s = styles.added;
          else if (changeType === 'Removed') ws[cell_ref].s = styles.removed;
          else if (cellValue.includes('->')) ws[cell_ref].s = styles.changed;
        }
      }
    }
    ws['!cols'] = colWidths.map(w => ({ wch: Math.min(w + 2, 60) }));

    const sheetName = sec.replace(/[:\\/?*[\]]/g, "").substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const f1Name = document.getElementById('f1-name').textContent || "file1";
  const f2Name = document.getElementById('f2-name').textContent || "file2";
  const filename = `SWMM_Compare_${f1Name}_vs_${f2Name}.xlsx`;

  XLSX.writeFile(wb, filename);
  setStatus("Excel file generated.");
}

// --- Shapefile export ---
export async function exportToShapefile() {
  if (!state.LAST.json) { alert("Please run a comparison first."); return; }
  setStatus("Requesting Shapefile generation...");

  const f1Name = (document.getElementById('f1-name').textContent || "file1").replace(/\.inp$/i, "").substring(0, 20);
  const f2Name = (document.getElementById('f2-name').textContent || "file2").replace(/\.inp$/i, "").substring(0, 20);
  const filePrefix = `${f1Name}_vs_${f2Name}`;

  if (workerRef) {
    workerRef.postMessage({
      type: "export_shapefiles",
      diffs: JSON.stringify(state.LAST.json),
      geometry: "{}",
      crs: state.CURRENT_CRS,
      filePrefix: filePrefix
    });
  }
}
