// ui.js - UI interactions (modals, resizing, file handling, session management, Excel export)
import { state } from './state.js';
import { abToB64, b64ToAb, escapeHtml, relabelHeaders } from './utils.js';
import { renderSections } from './table.js';
import { drawGeometry } from './map.js';

// Status setter (will be set by app.js)
let setStatusCallback = null;
export function setSetStatusCallback(callback) {
  setStatusCallback = callback;
}
function setStatus(s) {
  if (setStatusCallback) setStatusCallback(s);
  else document.getElementById('status').textContent = s;
}

// Worker reference (will be set by app.js)
let workerRef = null;
export function setWorker(worker) {
  workerRef = worker;
}

// Resizable panels
export function makeResizable() {
  const vSplitter = document.getElementById('v-splitter');
  const mapSplitter = document.getElementById('map-v-splitter');
  const wrap = document.getElementById('wrap');
  const left = document.getElementById('left');

  vSplitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('resizing-v');
    const startX = e.clientX;
    const startWidth = left.getBoundingClientRect().width;

    const onMouseMove = (moveEvent) => {
      const newWidth = startWidth + (moveEvent.clientX - startX);
      if (newWidth > 200 && newWidth < (wrap.clientWidth - 400)) {
        wrap.style.gridTemplateColumns = `${newWidth}px 5px 1fr`;
      }
    };
    const onMouseUp = () => {
      document.body.classList.remove('resizing-v');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  mapSplitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('resizing-v');
    const detailsWrap = document.getElementById('detailsWrap');
    const startX = e.clientX;
    const startWidth = detailsWrap.querySelector('#tableWrap').getBoundingClientRect().width;

    const onMouseMove = (moveEvent) => {
      const newWidth = startWidth + (moveEvent.clientX - startX);
      if (newWidth > 200 && newWidth < (detailsWrap.clientWidth - 200)) {
        detailsWrap.style.gridTemplateColumns = `${newWidth}px 5px 1fr`;
      }
    };
    const onMouseUp = () => {
      document.body.classList.remove('resizing-v');
      document.removeEventListener('mousemove', onMouseMove);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp, { once: true });
  });
}

// Help modal
export function openHelpModal() {
  document.getElementById('helpModalBackdrop').style.display = 'flex';
}
export function closeHelpModal() {
  document.getElementById('helpModalBackdrop').style.display = 'none';
}

// Session management
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
      }
    }
  };

  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `inp_diff_session_${Date.now()}.json`,
        types: [{
          description: 'INP Diff Session',
          accept: { 'application/json': ['.json'] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus("Session saved.");
    } catch (err) {
      if (err.name !== 'AbortError') console.error("Save failed:", err);
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inp_diff_session_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export function applyUIState(ui) {
  if (!ui) return;
  const f = ui.filters;
  document.getElementById('fAdded').checked = f?.Added ?? true;
  document.getElementById('fRemoved').checked = f?.Removed ?? true;
  document.getElementById('fChanged').checked = f?.Changed ?? true;
  if (typeof f.Search === 'string') document.getElementById('search').value = f.Search;

  if (ui.crs && state.PROJECTIONS[ui.crs]) {
    document.getElementById('crsSelect').value = ui.crs;
    document.getElementById('crsSelect').dispatchEvent(new Event('change'));
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
    const node = [...document.querySelectorAll('.sec')].find(n => n.dataset.sec === ui.section);
    document.querySelectorAll('.sec').forEach(n => n.classList.remove('active'));
    node?.classList.add('active');
  }
  setStatus("Session loaded.");
}

export async function loadSession(file) {
  try {
    const text = await file.text();
    const session = JSON.parse(text);

    state.FILES = { f1Name: null, f2Name: null, f1Bytes: null, f2Bytes: null };
    if (session.files?.file1?.bytesB64) {
      state.FILES.f1Name = session.files.file1.name || "file1.inp";
      state.FILES.f1Bytes = b64ToAb(session.files.file1.bytesB64);
    }
    if (session.files?.file2?.bytesB64) {
      state.FILES.f2Name = session.files.file2.name || "file2.inp";
      state.FILES.f2Bytes = b64ToAb(session.files.file2.bytesB64);
    }

    document.getElementById('f1-name').textContent = state.FILES.f1Name || '';
    document.getElementById('f2-name').textContent = state.FILES.f2Name || '';

    if (session.result) {
      await restoreFromResult(session.result, session.ui);
    } else if (state.FILES.f1Bytes && state.FILES.f2Bytes) {
      setStatus("Recomputing comparison from saved INP files (using default tolerances)…");
      if (workerRef) {
        workerRef.postMessage({ type: "compare", file1: state.FILES.f1Bytes, file2: state.FILES.f2Bytes, tolerances: {} }, [state.FILES.f1Bytes, state.FILES.f2Bytes]);
      }
    } else {
      alert("Session file has no result data and no embedded INP files. Please select the INP files and run Compare.");
    }
  } catch (e) {
    console.error(e);
    alert("Could not load session: " + e.message);
  }
}

// Excel export
export async function exportToExcel() {
  if (!state.LAST.json) { alert("Please run a comparison first."); return; }
  setStatus("Generating Excel file...");
  await new Promise(resolve => setTimeout(resolve, 50));

  const wb = XLSX.utils.book_new();
  const { diffs, headers } = state.LAST.json;

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
      hdrs = ["Hydrograph", "Month", "Change Type"];
      sheetData.push(["Element ID", "Change", ...hdrs]);
      const { groupHydroSummary } = await import('./table.js');
      const rows = groupHydroSummary(d);
      rows.forEach(r => {
        sheetData.push([`${r.hydro} ${r.month}`, r.changeType.includes("Added") || r.changeType.includes("Removed") ? r.changeType.split(',')[0] : "Changed", r.hydro, r.month, r.changeType]);
      });
    } else {
      hdrs = relabelHeaders(sec, hdrs);
      sheetData.push(["Element ID", "Change", ...hdrs]);

      const rows = [];
      for (const [id, arr] of Object.entries(d.added || {})) rows.push({ type: 'Added', id, oldArr: [], newArr: arr });
      for (const [id, arr] of Object.entries(d.removed || {})) rows.push({ type: 'Removed', id, oldArr: arr, newArr: [] });
      for (const [id, pair] of Object.entries(d.changed || {})) {
        const oldArr = Array.isArray(pair) ? pair[0] : (pair.values?.[0] || []);
        const newArr = Array.isArray(pair) ? pair[1] : (pair.values?.[1] || []);
        rows.push({ type: 'Changed', id, oldArr, newArr });
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
          else row.push(ov === nv ? nv : `${ov} → ${nv}`);
        }
        sheetData.push(row);
      });
    }

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    const colWidths = sheetData[0].map(h => h.length);
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
          else if (cellValue.includes('→')) ws[cell_ref].s = styles.changed;
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

// Detail modal
export function openDetail(section, id) {
  const { diffs, headers, renames, hydrographs } = state.LAST.json || {};
  const d = diffs?.[section] || { added: {}, removed: {}, changed: {} };
  const titleEl = document.getElementById('modalTitle');
  const metaEl = document.getElementById('modalMeta');
  const grid = document.getElementById('modalGrid');
  const onlyChangedBox = document.getElementById('onlyChangedBox');

  if (section === "HYDROGRAPHS" && id.includes(" ")) {
    const [hydro, month] = id.split(" ");
    titleEl.textContent = `HYDROGRAPH · ${hydro} · ${month}`;
    grid.innerHTML = "";

    const params = ["R", "T", "K", "Dmax", "Drecov", "Dinit"];
    const responses = ["Short", "Medium", "Long"];

    const h1 = (hydrographs?.file1 || {});
    const h2 = (hydrographs?.file2 || {});
    function getVals(dict, resp) {
      return (dict[`${hydro} ${month} ${resp}`] || ["", "", "", "", "", ""]).slice(0, 6);
    }

    function fmtNum(x) {
      const v = Number(x);
      if (!isFinite(v)) return (x && x !== "") ? escapeHtml(x) : "—";
      const s = v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
      return s === "-0.000" ? "0.000" : s;
    }

    function deltaCell(ov, nv) {
      if ((ov ?? "") === (nv ?? "")) return `<span class="num">${fmtNum(nv)}</span>`;
      const vo = Number(ov), vn = Number(nv);
      const hasNums = isFinite(vo) && isFinite(vn);
      const delta = hasNums ? vn - vo : null;
      const dTxt = hasNums ? ` <span class="plusminus">(${delta >= 0 ? "+" : ""}${fmtNum(delta)})</span>` : "";
      const oTxt = (ov !== "" && ov !== undefined) ? fmtNum(ov) : "—";
      const nTxt = (nv !== "" && nv !== undefined) ? fmtNum(nv) : "—";
      return `<span class="delta"><span class="old">${oTxt}</span><span class="arrow">→</span><span class="diff">${nTxt}</span>${dTxt}</span>`;
    }

    const tbl = document.createElement("table");
    tbl.className = "modal-hydro";
    tbl.innerHTML = `<thead>
      <tr><th class="resp">Response</th>${params.map(p => `<th>${p}</th>`).join("")}</tr>
    </thead><tbody></tbody>`;
    const tbody = tbl.querySelector("tbody");

    const showOnlyChanged = () => onlyChangedBox.checked;

    for (const resp of responses) {
      const oldVals = getVals(h1, resp);
      const newVals = getVals(h2, resp);
      const rowHasChange = oldVals.some((ov, i) => (ov || "") !== (newVals[i] || ""));
      if (showOnlyChanged() && !rowHasChange) continue;

      const tr = document.createElement("tr");
      tr.innerHTML = `<td style="padding:6px 8px;font-weight:600;">${resp}</td>` +
        params.map((_, i) => {
          const ov = oldVals[i] || "";
          const nv = newVals[i] || "";
          return `<td>${deltaCell(ov, nv)}</td>`;
        }).join("");
      tbody.appendChild(tr);
    }

    metaEl.innerHTML = `<span class="tag">Hydrograph</span>`;
    grid.appendChild(tbl);
    onlyChangedBox.onchange = () => openDetail(section, id);
    document.getElementById('modalBackdrop').style.display = 'flex';
    return;
  }

  const hdrsRaw = (headers?.[section] || []).slice();
  const hdrsLabeled = relabelHeaders(section, hdrsRaw);

  const isAdded = d.added && Object.prototype.hasOwnProperty.call(d.added, id);
  const isRemoved = d.removed && Object.prototype.hasOwnProperty.call(d.removed, id);
  const changeType = isAdded ? 'Added' : isRemoved ? 'Removed' : 'Changed';

  let oldArr = isAdded ? [] : isRemoved ? (d.removed[id] || []) : (d.changed[id]?.[0] || []);
  let newArr = isRemoved ? [] : isAdded ? (d.added[id] || []) : (d.changed[id]?.[1] || []);

  titleEl.textContent = `${section} · ${id}`;
  const renameTo = renames?.[section]?.[id];
  metaEl.innerHTML = `<span class="tag">${changeType}</span>${renameTo ? `<span class="tag" style="margin-left:6px">Renamed ↦ ${renameTo}</span>` : ''}`;

  const maxLen = Math.max(oldArr.length, newArr.length) + 1;
  while (hdrsLabeled.length < maxLen) hdrsLabeled.push(`Field ${hdrsLabeled.length + 1}`);

  grid.innerHTML = `
    <div class="hdr">Field</div>
    <div class="hdr">Old</div>
    <div class="hdr">New</div>
  `;
  const showOnlyChanged = () => onlyChangedBox.checked;
  const pushRow = (label, oldV, newV) => {
    const changed = (oldV || "") !== (newV || "");
    if (showOnlyChanged() && !changed) return;
    const oldCell = changed ? `<span class="cell-changed">${escapeHtml(oldV || "")}</span>` : escapeHtml(oldV || "");
    const newCell = changed ? `<span class="cell-changed">${escapeHtml(newV || "")}</span>` : escapeHtml(newV || "");
    grid.insertAdjacentHTML('beforeend', `<div>${escapeHtml(label)}</div><div>${oldCell}</div><div>${newCell}</div>`);
  };
  pushRow(hdrsLabeled[0] || "ID", id, id);
  for (let i = 1; i < maxLen; i++) pushRow(hdrsLabeled[i] || `Field ${i}`, oldArr[i - 1], newArr[i - 1]);

  onlyChangedBox.onchange = () => openDetail(section, id);
  document.getElementById('modalBackdrop').style.display = 'flex';
}

export function closeModal() {
  document.getElementById('modalBackdrop').style.display = 'none';
}

export function copyRowJSON() {
  const section = state.LAST.currentSection;
  if (!section) return;
  const d = state.LAST.json?.diffs?.[section] || {};
  const rawTitle = document.getElementById('modalTitle').textContent;
  const parts = rawTitle.split('·').map(s => s.trim());
  const id = parts[parts.length - 1];

  let oldArr = [], newArr = [];
  if (d.added && Object.prototype.hasOwnProperty.call(d.added, id)) {
    newArr = d.added[id] || [];
  } else if (d.removed && Object.prototype.hasOwnProperty.call(d.removed, id)) {
    oldArr = d.removed[id] || [];
  } else if (d.changed && Object.prototype.hasOwnProperty.call(d.changed, id)) {
    const changedObj = d.changed[id];
    oldArr = Array.isArray(changedObj) ? changedObj[0] : (changedObj.values?.[0] || []);
    newArr = Array.isArray(changedObj) ? changedObj[1] : (changedObj.values?.[1] || []);
  }

  const entry = {
    section,
    id,
    headers: relabelHeaders(section, (state.LAST.json?.headers?.[section] || [])),
    old: oldArr,
    new: newArr,
  };
  navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
  alert("Row JSON copied.");
}

// File name display
export function updateFileName(inputId, spanId) {
  const input = document.getElementById(inputId);
  const span = document.getElementById(spanId);
  input.addEventListener('change', () => span.textContent = input.files[0]?.name || 'No file selected');
}

// Compare modal
export function openCompareModal() {
  document.getElementById('compareModalBackdrop').style.display = 'flex';
}
export function closeCompareModal() {
  document.getElementById('compareModalBackdrop').style.display = 'none';
}

