// ==============================================================================
// UI.JS - USER INTERFACE INTERACTIONS
// ==============================================================================

import { state } from './state.js';
import { abToB64, b64ToAb, escapeHtml, relabelHeaders } from './utils.js';
import { renderSections } from './table.js';
import { drawGeometry } from './map.js';

// ==============================================================================
// SECTION 1: GLOBAL HELPERS & STATE SETTERS
// ==============================================================================

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

// ==============================================================================
// SECTION 2: RESIZABLE PANELS
// ==============================================================================

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

// ==============================================================================
// SECTION 3: MODAL MANAGEMENT
// ==============================================================================

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

// Tolerance Toggle
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

// ==============================================================================
// SECTION 6: DETAIL VIEW
// ==============================================================================

export function openDetail(section, id) {
  const { diffs, headers, renames, hydrographs } = state.LAST.json || {};
  const d = diffs?.[section] || { added: {}, removed: {}, changed: {} };
  const titleEl = document.getElementById('modalTitle');
  const metaEl = document.getElementById('modalMeta');
  const grid = document.getElementById('modalGrid');
  const onlyChangedBox = document.getElementById('onlyChangedBox');

  // Helper for formatting
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

    const params = ["R", "T", "K", "Dmax", "Drecov", "Dinit"];
    const responses = ["Short", "Medium", "Long"];

    const h1 = (hydrographs?.file1 || {});
    const h2 = (hydrographs?.file2 || {});
    function getVals(dict, resp) {
      return (dict[`${hydro} ${month} ${resp}`] || ["", "", "", "", "", ""]).slice(0, 6);
    }

    function deltaCell(ov, nv) {
      if ((ov ?? "") === (nv ?? "")) return `<span class="num">${fmtNum(nv)}</span>`;
      const vo = Number(ov), vn = Number(nv);
      const hasNums = isFinite(vo) && isFinite(vn);
      const delta = hasNums ? vn - vo : null;
      const dTxt = hasNums ? ` <span class="plusminus" style="font-size:0.8em; opacity:0.8;">(${delta >= 0 ? "+" : ""}${fmtNum(delta)})</span>` : "";

      const oTxt = (ov !== "" && ov !== undefined) ? fmtNum(ov) : "—";
      const nTxt = (nv !== "" && nv !== undefined) ? fmtNum(nv) : "—";

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
          return `<td>${deltaCell(ov, nv)}</td>`;
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

// ==============================================================================
// SECTION 4: SESSION MANAGEMENT
// ==============================================================================

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

// ==============================================================================
// SECTION 5: EXCEL EXPORT
// ==============================================================================

export async function exportToExcel() {
  if (!state.LAST.json) { alert("Please run a comparison first."); return; }
  setStatus("Generating Excel file...");
  await new Promise(resolve => setTimeout(resolve, 50));

  const wb = XLSX.utils.book_new();
  const { diffs, headers, tolerances } = state.LAST.json;

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
    const d = diffs[sec];
    let sheetData = [];
    let hdrs = headers[sec] ? [...headers[sec]] : [];

    if (sec === "HYDROGRAPHS") {
      hdrs = ["Hydrograph", "Month", "Response", "R", "T", "K", "Dmax", "Drecov", "Dinit"];
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
        // For remaining 6 params (R...Dinit)
        for (let i = 0; i < 6; i++) {
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

      // Inject Diff Headers
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

        // Append Diff Values
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

    // Auto-filter
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

// Shapefile export
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

export function copyRowJSON(id, section) {
  const { diffs } = state.LAST.json || {};
  if (!diffs || !diffs[section]) return;
  const d = diffs[section];

  let data = null;
  if (d.added && d.added[id]) data = { status: 'Added', value: d.added[id] };
  else if (d.removed && d.removed[id]) data = { status: 'Removed', value: d.removed[id] };
  else if (d.changed && d.changed[id]) data = { status: 'Changed', value: d.changed[id] };

  if (data) {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      .then(() => console.log('Row JSON copied'))
      .catch(err => console.error('Copy failed', err));
  }
}
