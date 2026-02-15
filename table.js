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

// --- SECTION GROUPING CONFIGURATION ---
const SECTION_GROUPS = {
  Nodes: [
    "DWF", "INFLOWS", "JUNCTIONS", "OUTFALLS", "RDII", "STORAGE", "DIVIDERS", "TREATMENT", "UNITHYD", "HYDROGRAPHS", "HYDROGRAPH_RAINGAGES"
  ],
  Links: [
    "CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS", "XSECTIONS", "TRANSECTS", "STREETS", "INLETS", "INLET_USAGE", "LOSSES"
  ],
  Subcatchments: [
    "SUBCATCHMENTS", "POLLUTANTS", "LANDUSES", "COVERAGES", "BUILDUP", "WASHOFF", "LOADINGS",
    "GWF", "GROUNDWATER", "INFILTRATION", "LID_CONTROLS", "LID_USAGE", "SUBAREAS"
  ]
};

export function renderSections(json) {
  const diffs = json.diffs || {};
  const cont = document.getElementById('sections');

  if (!Object.keys(diffs).length) {
    cont.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-tertiary);">No differences found.</div>';
    return;
  }

  cont.innerHTML = "";

  // Helper to create a section item element
  const createSecItem = (sec) => {
    const d = diffs[sec];
    if (!d) return null; // Should not happen if we iterate diffs keys, but safe for fixed lists

    const added = Object.keys(d.added || {}).length;
    const removed = Object.keys(d.removed || {}).length;
    const changed = Object.keys(d.changed || {}).length;

    const div = document.createElement('div');
    div.className = 'sec-item';
    div.dataset.sec = sec;
    div.innerHTML = `<span>${sec}</span>
      <span class="sec-counts">
        ${added > 0 ? `<span class="badge added" title="Added" style="font-size:10px; border-radius:10px; padding:1px 6px;">+${added}</span>` : ''}
        ${removed > 0 ? `<span class="badge removed" title="Removed" style="font-size:10px; border-radius:10px; padding:1px 6px;">-${removed}</span>` : ''}
        ${changed > 0 ? `<span class="badge changed" title="Changed" style="font-size:10px; border-radius:10px; padding:1px 6px;">~${changed}</span>` : ''}
      </span>`;

    div.onclick = () => {
      document.querySelectorAll('.sec-item').forEach(n => n.classList.remove('active'));
      div.classList.add('active');
      state.LAST.currentSection = sec;
      document.getElementById('currentSectionLabel').textContent = sec;
      renderTableFor(sec);
    };
    return div;
  };

  // Helper to render a group
  const renderGroup = (name, sections, defaultOpen = true) => {
    if (!sections || sections.length === 0) return;

    // Group Header
    const header = document.createElement('div');
    header.className = 'sec-group-header';
    header.style.cssText = "padding: 8px 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; margin-top: 8px; cursor: pointer; display: flex; align-items: center; justify-content: space-between;";
    header.innerHTML = `<span>${name}</span><span class="arrow" style="transition: transform 0.2s; font-size: 10px;">${defaultOpen ? '▼' : '▶'}</span>`;

    // Group Container
    const groupDiv = document.createElement('div');
    groupDiv.className = 'sec-group-content';
    if (!defaultOpen) groupDiv.style.display = 'none';

    sections.forEach(sec => {
      const item = createSecItem(sec);
      if (item) groupDiv.appendChild(item);
    });

    // Toggle Logic
    header.onclick = () => {
      const isOpen = groupDiv.style.display !== 'none';
      if (isOpen) {
        groupDiv.style.display = 'none';
        header.querySelector('.arrow').textContent = '▶';
      } else {
        groupDiv.style.display = 'block';
        header.querySelector('.arrow').textContent = '▼';
      }
    };

    cont.appendChild(header);
    cont.appendChild(groupDiv);
  };

  // Track which sections we have rendered
  const renderedSections = new Set();
  const groupsToRender = [];

  // Prepare defined groups
  for (const [groupName, secList] of Object.entries(SECTION_GROUPS)) {
    const relevant = secList.filter(s => diffs[s]);
    if (relevant.length > 0) {
      groupsToRender.push({ name: groupName, sections: relevant });
      relevant.forEach(s => renderedSections.add(s));
    }
  }

  // Identify General (Remaining) sections
  const allSections = Object.keys(diffs).sort();
  const generalSections = allSections.filter(s => !renderedSections.has(s));

  // Render General FIRST
  if (generalSections.length > 0) {
    renderGroup("General", generalSections, true);
  }

  // Render other groups
  groupsToRender.forEach(g => renderGroup(g.name, g.sections, true));

  // Select first item by default
  const firstItem = cont.querySelector('.sec-item');
  if (firstItem) firstItem.click();
}

function passChangeFilter(changeType) {
  const m = { Added: 'fAdded', Removed: 'fRemoved', Changed: 'fChanged' };
  const id = m[changeType] || null;
  if (!id) return true;
  return document.getElementById(id).checked;
}

let currentSort = { sec: null, col: 0, dir: 1 }; // dir: 1=asc, -1=desc

// --- SECTION REFERENCE MAPPING ---
// Maps non-geometry sections to their geometry counterparts (e.g. DWF -> JUNCTIONS (Node))
const SECTION_REF_MAP = {
  // Nodes (Map to JUNCTIONS as a generic Node type proxy)
  "DWF": "JUNCTIONS",
  "INFLOWS": "JUNCTIONS",
  "RDII": "JUNCTIONS",
  "TREATMENT": "JUNCTIONS",
  "COORDINATES": "JUNCTIONS", // Explicit node coordinates section

  // Links (Map to CONDUITS as a generic Link type proxy)
  "XSECTIONS": "CONDUITS",
  "LOSSES": "CONDUITS",
  "VERTICES": "CONDUITS", // Link vertices section

  // Subcatchments
  "SUBCATCHMENTS": "SUBCATCHMENTS", // Self
  "GWF": "SUBCATCHMENTS",
  "GROUNDWATER": "SUBCATCHMENTS",
  "INFILTRATION": "SUBCATCHMENTS",
  "COVERAGES": "SUBCATCHMENTS",
  "LOADINGS": "SUBCATCHMENTS",
  "LID_USAGE": "SUBCATCHMENTS",
  "SUBAREAS": "SUBCATCHMENTS",
  "POLYGONS": "SUBCATCHMENTS" // Subcatchment polygons section
};

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

    // Add empty header for details column
    let thead = `<thead><tr><th style="width:40px"></th><th style="width:180px">ElementID</th><th style="width:110px">Change</th>`;
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
      const badge = type.toLowerCase();
      let tr = `<tr data-hydro="${escapeHtml(r.hydro)}" data-month="${escapeHtml(r.month)}">`;
      // Add details button cell
      tr += `<td><button class="icon-btn btn-details" style="padding:4px; width:24px; height:24px;" title="Open Details">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
             </button></td>`;
      tr += `<td>${escapeHtml(`${r.hydro} ${r.month}`)}</td>`;
      tr += `<td><span class="badge ${badge}">${type}</span></td>`;
      tr += `<td>${escapeHtml(r.hydro)}</td><td>${escapeHtml(r.month)}</td><td>${escapeHtml(r.changeType)}</td>`;
      tr += `</tr>`;
      body.push(tr);
    }

    table.innerHTML = thead + `<tbody>${body.join("") || `<tr><td colspan="${hdrs.length + 3}" style="color:var(--text-tertiary);font-style:italic;padding:12px;">No rows match.</td></tr>`}</tbody>`;

    table.querySelectorAll('tbody tr').forEach((tr) => {
      const hydro = tr.dataset.hydro;
      const month = tr.dataset.month;

      // Wire up the details button
      const btn = tr.querySelector('.btn-details');
      if (btn) {
        btn.onclick = (e) => {
          e.stopPropagation();
          openDetail("HYDROGRAPHS", `${hydro} ${month}`);
        };
      }

      // Hydrographs don't map to geometry
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

    if (col === 0) {
      // Details column - unsortable, effectively random or maintain stable sort
      return 0;
    } else if (col === 1) { // ElementID (was 0)
      valA = a.id;
      valB = b.id;
    } else if (col === 2) { // Change Type (was 1)
      valA = a.type;
      valB = b.type;
    } else if (col >= 3 && col < 3 + hdrsLabeled.length) { // Data Columns (was 2)
      const idx = col - 3;

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
      const diffIdx = col - 3 - hdrsLabeled.length;
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
    const styleParts = [];

    if (width) styleParts.push(`width:${width}px`);
    styleParts.push('cursor:pointer', 'user-select:none');

    const style = `style="${styleParts.join(';')}"`;
    return `<th ${style} onclick="window.updateTableSort(${idx})">${escapeHtml(label)}${arrow}</th>`;
  };



  let thead = `<thead><tr>`;
  thead += `<th style="width:40px"></th>`; // Details column
  thead += makeTh("ElementID", 1, 180);
  thead += makeTh("Change", 2, 110);
  hdrsLabeled.forEach((h, i) => thead += makeTh(h, i + 3));
  diffHeaders.forEach((h, i) => thead += makeTh(h, i + 3 + hdrsLabeled.length));
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
    const badge = r.type.toLowerCase();
    let tr = `<tr>`;
    // Add details button cell
    tr += `<td><button class="icon-btn btn-details" style="padding:4px; width:24px; height:24px;" title="Open Details">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
           </button></td>`;
    tr += `<td>${escapeHtml(r.id)}</td>`;
    tr += `<td><span class="badge ${badge}">${r.type}</span></td>`;

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
          tr += `<td style="color:var(--added)">${fmtNum(newRim)}</td>`;
        } else if (r.type === "Removed") {
          tr += `<td style="color:var(--removed)">${fmtNum(oldRim)}</td>`;
        } else {
          tr += (fmtNum(oldRim) !== fmtNum(newRim))
            ? `<td><span style="opacity:0.6;font-size:0.9em;">${fmtNum(oldRim)}</span> → <span>${fmtNum(newRim)}</span></td>`
            : `<td>${fmtNum(newRim)}</td>`;
        }
      } else {
        const ov = oldA[i] ?? "";
        const nv = newA[i] ?? "";
        if (
          (sec && sec.trim() === "CURVES" && i === 2) ||
          (sec && (sec.trim() === "VERTICES" || sec.trim() === "POLYGONS") && i === 1)
        ) {
          // Value is JSON string of points
          const parseCount = (s) => {
            try { return JSON.parse(s).length + " pts"; } catch (e) { return "—"; }
          };
          const oTxt = parseCount(ov);
          const nTxt = parseCount(nv);

          if (r.type === "Added") tr += `<td style="color:var(--added)">${escapeHtml(nTxt)}</td>`;
          else if (r.type === "Removed") tr += `<td style="color:var(--removed)">${escapeHtml(oTxt)}</td>`;
          else tr += (oTxt !== nTxt)
            ? `<td><span style="opacity:0.6;font-size:0.9em;">${escapeHtml(oTxt)}</span> → <span>${escapeHtml(nTxt)}</span></td>`
            : `<td>${escapeHtml(nTxt)}</td>`;
        } else {
          // Normal rendering
          if (r.type === "Added") tr += `<td style="color:var(--added)">${escapeHtml(nv)}</td>`;
          else if (r.type === "Removed") tr += `<td style="color:var(--removed)">${escapeHtml(ov)}</td>`;
          else tr += (ov !== nv)
            ? `<td><span style="opacity:0.6;font-size:0.9em;">${escapeHtml(ov)}</span> → <span>${escapeHtml(nv)}</span></td>`
            : `<td>${escapeHtml(nv)}</td>`;
        }
      }
    }

    if (showDiffs) {
      if (sec === 'CONDUITS') {
        tr += `<td>${fmtNum(r.diffs?.Length)}</td>`;
        tr += `<td>${fmtNum(r.diffs?.InOffset)}</td>`;
        tr += `<td>${fmtNum(r.diffs?.OutOffset)}</td>`;
      } else if (sec === 'JUNCTIONS') {
        tr += `<td>${fmtNum(r.diffs?.InvertElev)}</td>`;
        tr += `<td>${fmtNum(r.diffs?.MaxDepth)}</td>`;
      }
    }

    tr += `</tr>`;
    tbodyParts.push(tr);
  }

  const totalCols = hdrsLabeled.length + diffHeaders.length + 3;
  table.innerHTML = thead + `<tbody>${tbodyParts.join("") || `<tr><td colspan="${totalCols}" style="color:var(--text-tertiary);font-style:italic;padding:12px;">No rows match.</td></tr>`}</tbody>`;

  table.querySelectorAll('tbody tr').forEach((tr) => {
    const id = tr.children[1]?.textContent || ""; // ID is now at index 1 due to details button

    // Wire up the details button
    const btn = tr.querySelector('.btn-details');
    if (btn) {
      btn.onclick = (e) => {
        e.stopPropagation();
        openDetail(sec, id);
      };
    }

    // Determine mapping for highlighting
    // If sec is in SECTION_REF_MAP, use that type. Otherwise use sec itself.
    const mapSec = SECTION_REF_MAP[sec] || sec;

    // Check if this row represents a removed item
    const isRemoved = tr.querySelector('.badge.removed') !== null;

    tr.onclick = () => highlightElement(mapSec, id, true, isRemoved, true);
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
