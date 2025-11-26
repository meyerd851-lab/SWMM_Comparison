// table.js - Table rendering and section management
import { state } from './state.js';
import { escapeHtml, relabelHeaders } from './utils.js';
import { highlightElement } from './map.js';

// Open detail modal (imported from ui.js to avoid circular dependency)
let openDetailCallback = null;
export function setOpenDetailCallback(callback) {
  openDetailCallback = callback;
}

function openDetail(section, id) {
  if (openDetailCallback) openDetailCallback(section, id);
}

export function groupHydroSummary(d) {
  const allKeys = new Set([
    ...Object.keys(d.added || {}),
    ...Object.keys(d.removed || {}),
    ...Object.keys(d.changed || {})
  ]);
  const grouped = new Map();
  for (const k of allKeys) {
    const parts = k.split(" ");
    const hydro = parts[0] || "";
    const month = parts[1] || "";
    const gkey = `${hydro} ${month}`;
    if (!grouped.has(gkey)) grouped.set(gkey, new Set());
    const s = grouped.get(gkey);
    if (d.added && (k in d.added)) s.add("Added");
    if (d.removed && (k in d.removed)) s.add("Removed");
    if (d.changed && (k in d.changed)) s.add("Changed");
  }
  const rows = [];
  for (const [gkey, set] of grouped.entries()) {
    const [hydro, month] = gkey.split(" ");
    rows.push({ id: gkey, hydro, month, changeType: [...set].sort().join(", ") || "—" });
  }
  rows.sort((a, b) => (a.hydro + b.month).localeCompare(b.hydro + b.month));
  return rows;
}

export function renderSections(json) {
  const diffs = json.diffs || {};
  const cont = document.getElementById('sections');
  const items = [];
  for (const sec of Object.keys(diffs).sort()) {
    const d = diffs[sec];
    const added = Object.keys(d.added || {}).length;
    const removed = Object.keys(d.removed || {}).length;
    const changed = Object.keys(d.changed || {}).length;
    items.push({ sec, added, removed, changed });
  }
  if (!items.length) { cont.textContent = "No sections with differences."; return; }
  cont.innerHTML = "";
  items.forEach(({ sec, added, removed, changed }) => {
    const div = document.createElement('div');
    div.className = 'sec';
    div.dataset.sec = sec;
    div.innerHTML = `<span>${sec}</span>
      <span class="counts">
        <span class="pill added">+${added}</span>
        <span class="pill removed">-${removed}</span>
        <span class="pill changed">⚙${changed}</span>
      </span>`;
    div.onclick = () => {
      document.querySelectorAll('.sec').forEach(n => n.classList.remove('active'));
      div.classList.add('active');
      state.LAST.currentSection = sec;
      document.getElementById('currentSectionLabel').textContent = sec;
      renderTableFor(sec);
    };
    cont.appendChild(div);
  });
  cont.firstChild?.click();
}

function passChangeFilter(changeType) {
  const m = { Added: 'fAdded', Removed: 'fRemoved', Changed: 'fChanged' };
  const id = m[changeType] || null;
  if (!id) return true;
  return document.getElementById(id).checked;
}

let currentSort = { sec: null, col: 0, dir: 1 }; // dir: 1=asc, -1=desc

export function renderTableFor(sec) {
  const table = document.getElementById('table');
  const { diffs, headers } = state.LAST.json;
  const d = diffs[sec] || { added: {}, removed: {}, changed: {} };
  const q = document.getElementById('search').value.trim().toLowerCase();

  // Reset sort if section changed
  if (currentSort.sec !== sec) {
    currentSort = { sec: sec, col: 0, dir: 1 };
  }

  if (sec === "HYDROGRAPHS") {

    const rows = groupHydroSummary(d);
    const hdrs = ["Hydrograph", "Month", "ChangeType"];

    let thead = `<thead><tr><th style="width:180px">ElementID</th><th style="width:110px">Change</th>`;
    for (const h of hdrs) thead += `<th>${escapeHtml(h)}</th>`;
    thead += `</tr></thead>`;

    const fAdded = document.getElementById('fAdded').checked;
    const fRemoved = document.getElementById('fRemoved').checked;
    const fChanged = document.getElementById('fChanged').checked;

    const filtered = rows.filter(r => {
      const changeText = r.changeType.toLowerCase();
      const matchesFilter = (fAdded && changeText.includes('added')) || (fRemoved && changeText.includes('removed')) || (fChanged && changeText.includes('changed'));
      const matchesSearch = !q || (`${r.id} ${r.changeType}`).toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });

    const body = [];
    for (const r of filtered) {
      const type = r.changeType === "Added" || r.changeType === "Removed" ? r.changeType : "Changed";
      const pill = type.toLowerCase();
      let tr = `<tr class="row" data-hydro="${escapeHtml(r.hydro)}" data-month="${escapeHtml(r.month)}">`;
      tr += `<td>${escapeHtml(`${r.hydro} ${r.month}`)}</td>`;
      tr += `<td><span class="pill ${pill}">${type}</span></td>`;
      tr += `<td>${escapeHtml(r.hydro)}</td><td>${escapeHtml(r.month)}</td><td>${escapeHtml(r.changeType)}</td>`;
      tr += `</tr>`;
      body.push(tr);
    }

    table.innerHTML = thead + `<tbody>${body.join("") || `<tr><td colspan="${hdrs.length + 2}" style="color:#666;font-style:italic;">No rows match.</td></tr>`}</tbody>`;

    table.querySelectorAll('tbody tr').forEach((tr) => {
      const hydro = tr.dataset.hydro;
      const month = tr.dataset.month;
      tr.onclick = () => highlightElement(sec, `${hydro} ${month}`, true);
      tr.ondblclick = () => openDetail("HYDROGRAPHS", `${hydro} ${month}`);
    });
    return;
  }

  const hdrs = headers[sec] || [];
  const hdrsLabeled = relabelHeaders(sec, hdrs);
  const originalHdrsLength = hdrsLabeled.length;

  if (sec === 'JUNCTIONS') {
    hdrsLabeled.push('Rim Elevation');
  }

  const showDiffs = document.getElementById('fShowDiffs').checked;

  const diffHeaders = [];
  if (showDiffs) {
    if (sec === 'CONDUITS') {
      diffHeaders.push('Δ Length', 'Δ InOffset', 'Δ OutOffset');
    } else if (sec === 'JUNCTIONS') {
      diffHeaders.push('Δ InvertElev', 'Δ MaxDepth');
    }
  }

  const rows = [];
  const push = (type, id, oldArr, newArr, diffs) => rows.push({ type, id, oldArr: (oldArr || []), newArr: (newArr || []), diffs: (diffs || {}) });

  for (const [id, arr] of Object.entries(d.added || {})) if (passChangeFilter('Added')) push('Added', id, [], arr);
  for (const [id, arr] of Object.entries(d.removed || {})) if (passChangeFilter('Removed')) push('Removed', id, arr, []);
  for (const [id, changedObj] of Object.entries(d.changed || {})) {
    if (passChangeFilter('Changed')) {
      const oldArr = Array.isArray(changedObj) ? changedObj[0] : (changedObj.values?.[0] || []);
      const newArr = Array.isArray(changedObj) ? changedObj[1] : (changedObj.values?.[1] || []);
      const diffVals = changedObj.diff_values || {};
      push('Changed', id, oldArr, newArr, diffVals);
    }
  }

  let filt = q ? rows.filter(r => (r.id + ' ' + r.type + ' ' + r.oldArr.join(' ') + ' ' + r.newArr.join(' ')).toLowerCase().includes(q)) : rows;

  // --- SORTING LOGIC ---
  filt.sort((a, b) => {
    let valA, valB;
    const col = currentSort.col;

    if (col === 0) { // ElementID
      valA = a.id;
      valB = b.id;
    } else if (col === 1) { // Change Type
      valA = a.type;
      valB = b.type;
    } else if (col >= 2 && col < 2 + hdrsLabeled.length) { // Data Columns
      const idx = col - 2;

      // Construct full arrays to match rendering (ID + values)
      const fullOldA = [a.id, ...(a.oldArr || [])];
      const fullNewA = [a.id, ...(a.newArr || [])];
      const fullOldB = [b.id, ...(b.oldArr || [])];
      const fullNewB = [b.id, ...(b.newArr || [])];

      // Use new value for sorting, unless removed then use old
      valA = a.type === 'Removed' ? fullOldA[idx] : fullNewA[idx];
      valB = b.type === 'Removed' ? fullOldB[idx] : fullNewB[idx];

      // Handle special calculated Rim Elevation column (last in hdrsLabeled for JUNCTIONS)
      if (sec === 'JUNCTIONS' && idx === originalHdrsLength) {
        valA = a.type === 'Removed' ? a.diffs?.RimElevation_old : a.diffs?.RimElevation_new;
        valB = b.type === 'Removed' ? b.diffs?.RimElevation_old : b.diffs?.RimElevation_new;
      }
    } else { // Diff Columns
      const diffIdx = col - 2 - hdrsLabeled.length;
      const diffKey = sec === 'CONDUITS' ? ['Length', 'InOffset', 'OutOffset'][diffIdx] :
        sec === 'JUNCTIONS' ? ['InvertElev', 'MaxDepth'][diffIdx] : null;
      if (diffKey) {
        valA = a.diffs?.[diffKey];
        valB = b.diffs?.[diffKey];
      }
    }

    // Simple alphanumeric sort
    return String(valA ?? "").localeCompare(String(valB ?? ""), undefined, { numeric: true }) * currentSort.dir;
  });

  // --- HEADER GENERATION ---
  const makeTh = (label, idx, width) => {
    const isSorted = currentSort.col === idx;
    const arrow = isSorted ? (currentSort.dir === 1 ? ' ▲' : ' ▼') : '';
    const style = width ? `style="width:${width}px; cursor:pointer; user-select:none;"` : `style="cursor:pointer; user-select:none;"`;
    const bg = idx >= 2 + hdrsLabeled.length ? 'background:#eef3ff;' : '';
    return `<th ${style} onclick="window.updateTableSort(${idx})">${escapeHtml(label)}${arrow}</th>`.replace('style="', `style="${bg} `);
  };

  let thead = `<thead><tr>`;
  thead += makeTh("ElementID", 0, 180);
  thead += makeTh("Change", 1, 110);
  hdrsLabeled.forEach((h, i) => thead += makeTh(h, i + 2));
  diffHeaders.forEach((h, i) => thead += makeTh(h, i + 2 + hdrsLabeled.length));
  thead += `</tr></thead>`;

  // Expose sort function globally so onclick works
  window.updateTableSort = (colIdx) => {
    if (currentSort.col === colIdx) {
      currentSort.dir *= -1;
    } else {
      currentSort.col = colIdx;
      currentSort.dir = 1;
    }
    renderTableFor(sec);
  };

  const fmtNum = (n) => {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    const s = n.toFixed(3);
    return s === '-0.000' ? '0.000' : s;
  };

  const tbodyParts = [];
  for (const r of filt) {
    const pill = r.type.toLowerCase();
    let tr = `<tr class="row">`;
    tr += `<td>${escapeHtml(r.id)}</td>`;
    tr += `<td><span class="pill ${pill}">${r.type}</span></td>`;

    const len = hdrsLabeled.length;
    let oldA, newA;

    if (sec === "HYDROGRAPHS") {
      const parts = r.id.split(' ');
      const hydrograph = parts[0] || '';
      const month = parts[1] || '';
      const response = parts.slice(2).join(' ') || '';
      oldA = [hydrograph, month, response, ...r.oldArr];
      newA = [hydrograph, month, response, ...r.newArr];
    } else {
      oldA = [r.id, ...r.oldArr];
      newA = [r.id, ...r.newArr];
    }

    while (oldA.length < len) oldA.push("");
    while (newA.length < len) newA.push("");

    for (let i = 0; i < len; i++) {
      // Handle special calculated Rim Elevation column
      if (sec === 'JUNCTIONS' && i === originalHdrsLength) {
        const oldRim = r.diffs?.RimElevation_old;
        const newRim = r.diffs?.RimElevation_new;

        if (r.type === "Added") {
          tr += `<td class="addedCell">${fmtNum(newRim)}</td>`;
        } else if (r.type === "Removed") {
          tr += `<td class="removedCell">${fmtNum(oldRim)}</td>`;
        } else {
          tr += (fmtNum(oldRim) !== fmtNum(newRim))
            ? `<td><span class="diff">${fmtNum(oldRim)} <span class="arrow">→</span> ${fmtNum(newRim)}</span></td>`
            : `<td>${fmtNum(newRim)}</td>`;
        }
      } else {
        const ov = oldA[i] ?? "";
        const nv = newA[i] ?? "";
        if (r.type === "Added") tr += `<td class="addedCell">${escapeHtml(nv)}</td>`;
        else if (r.type === "Removed") tr += `<td class="removedCell">${escapeHtml(ov)}</td>`;
        else tr += (ov !== nv)
          ? `<td><span class="diff">${escapeHtml(ov)} <span class="arrow">→</span> ${escapeHtml(nv)}</span></td>`
          : `<td>${escapeHtml(nv)}</td>`;
      }
    }

    if (showDiffs) {
      if (sec === 'CONDUITS') {
        tr += `<td class="cell-changed">${fmtNum(r.diffs?.Length)}</td>`;
        tr += `<td class="cell-changed">${fmtNum(r.diffs?.InOffset)}</td>`;
        tr += `<td class="cell-changed">${fmtNum(r.diffs?.OutOffset)}</td>`;
      } else if (sec === 'JUNCTIONS') {
        tr += `<td class="cell-changed">${fmtNum(r.diffs?.InvertElev)}</td>`;
        tr += `<td class="cell-changed">${fmtNum(r.diffs?.MaxDepth)}</td>`;
      }
    }

    tr += `</tr>`;
    tbodyParts.push(tr);
  }

  const totalCols = hdrsLabeled.length + diffHeaders.length + 2;
  table.innerHTML = thead + `<tbody>${tbodyParts.join("") || `<tr><td colspan="${totalCols}" style="color:#666;font-style:italic;">No rows match.</td></tr>`}</tbody>`;

  table.querySelectorAll('tbody tr').forEach((tr) => {
    const id = tr.children[0]?.textContent || "";
    tr.onclick = () => highlightElement(sec, id, true);
    tr.classList.add(`row-id-${id.replace(/[^a-zA-Z0-9]/g, '_')}`);
    tr.addEventListener('highlight', () => tr.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    tr.ondblclick = () => openDetail(sec, id);
  });
}

// Initialize filter listeners
["fAdded", "fRemoved", "fChanged", "fShowDiffs", "search"].forEach(id => {
  document.getElementById(id).addEventListener(id === "search" ? "input" : "change", () => {
    if (!state.LAST.currentSection) return;
    renderTableFor(state.LAST.currentSection);
  });
});

