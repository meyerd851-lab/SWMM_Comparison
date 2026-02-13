
import { state } from './state.js';
import { updateMapStyle, drawGeometry, highlightElement, getBucketColor, C } from './map.js';
import { renderSections } from './table.js';

// =============================================================================
// RESULTS VIEWER LOGIC
// =============================================================================

export function initResultsUI() {
    // Tab Switching
    document.getElementById('tabInp').addEventListener('click', () => switchTab('INP'));
    document.getElementById('tabRpt').addEventListener('click', () => switchTab('RPT'));

    // Map Mode Select (Main Toolbar)
    document.getElementById('mapModeSelect').addEventListener('change', (e) => {
        if (state.UI_MODE === 'RPT') {
            updateMapResults();
        }
    });

    // Listen for Map Selection in RPT Mode (Bi-directional Link)
    window.addEventListener('results-map-selection', (e) => {
        if (state.UI_MODE !== 'RPT') return;
        const id = e.detail.id;
        if (!id) return;

        // Find row in the container
        const safeId = id.replace(/[^a-zA-Z0-9]/g, '_');
        const row = document.querySelector(`#rptTableContainer tr.row-id-${safeId}`);

        if (row) {
            // Flash highlight
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.style.backgroundColor = 'var(--primary-light)';
            setTimeout(() => row.style.backgroundColor = '', 1500);
        }
    });

    const searchInput = document.getElementById('rptSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const rows = document.querySelectorAll('#rptTableContainer tbody tr');
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(term) ? '' : 'none';
            });
        });
    }
}



export function switchTab(mode) {
    state.UI_MODE = mode; // 'INP' or 'RPT'

    // Update Tab Classes -- Header Tabs
    document.getElementById('tabInp').classList.toggle('active', mode === 'INP');
    document.getElementById('tabRpt').classList.toggle('active', mode === 'RPT');

    // Toggle Toolbars
    document.getElementById('toolbarInp').style.display = mode === 'INP' ? 'flex' : 'none';
    document.getElementById('toolbarRpt').style.display = mode === 'RPT' ? 'flex' : 'none';

    // Toggle Table Containers
    document.getElementById('table').style.display = mode === 'INP' ? 'table' : 'none';
    document.getElementById('rptTableContainer').style.display = mode === 'RPT' ? 'block' : 'none';

    // Sidebar & Map Logic
    if (mode === 'INP') {
        // Restore INP sidebar
        if (state.LAST.json) {
            renderSections(state.LAST.json);
            drawGeometry(state.LAST.json, false);
        } else {
            document.getElementById('sections').innerHTML = '';
        }

        // Reset Map Dropdown for INP
        populateMapDropdownINP();

    } else {
        // RPT Mode
        if (state.LAST.resultJson) {
            renderResultSections(state.LAST.resultJson);

            // Populate Map Dropdown for RPT
            populateMapDropdownRPT(state.LAST.resultJson);

            updateMapResults();
        } else {
            document.getElementById('sections').innerHTML = '';
        }
    }
}

function populateMapDropdownINP() {
    const select = document.getElementById('mapModeSelect');
    select.innerHTML = `
        <option value="Default" selected>Default View</option>
        <option value="Changed">Focus: Changed</option>
        <option value="Added">Focus: Added</option>
        <option value="Removed">Focus: Removed</option>
    `;
    select.value = "Default";
}

function populateMapDropdownRPT(rptJson) {
    const select = document.getElementById('mapModeSelect');
    select.innerHTML = '<option value="(None)">No coloring</option>';

    // Add Composite View Option first
    const compositeOpt = document.createElement('option');
    compositeOpt.value = "Composite";
    compositeOpt.textContent = "Composite View (Depth & Flow)";

    // Check if we have the necessary sections to support Composite view
    const hasNodeDepth = rptJson.sections.some(s => s.section === "Node Depth Summary");
    const hasLinkFlow = rptJson.sections.some(s => s.section === "Link Flow Summary");

    if (hasNodeDepth || hasLinkFlow) {
        select.appendChild(compositeOpt);
    }

    // Suggest mappable sections
    rptJson.sections.forEach(sec => {
        // Heuristic: only those with ID columns that match elements
        if (["Node", "Link", "Subcatchment", "Conduit", "Junction", "Storage", "Outfall", "Pump"].some(k => sec.id_col.includes(k))) {
            const opt = document.createElement('option');
            opt.value = sec.section;
            opt.textContent = sec.section;
            select.appendChild(opt);
        }
    });

    // Default selection: Composite -> Link Flow -> Node Depth -> first available
    if (hasNodeDepth || hasLinkFlow) {
        select.value = "Composite";
    } else {
        // Fallback
        const preferred = ["Link Flow Summary", "Node Depth Summary", "Subcatchment Runoff Summary"].find(n => Array.from(select.options).some(o => o.value === n));
        if (preferred) {
            select.value = preferred;
        }
    }
}


export function loadResultsData(rptJson) {
    // Called when data is received.
    // Ensure we switch to RPT mode or just store it?
    // User might be in INP mode. Just store it.
    // BUT if we are in RPT mode, refresh.
    if (state.UI_MODE === 'RPT') {
        renderResultSections(rptJson);
        populateMapDropdownRPT(rptJson);
        updateMapResults();
    }
}

function renderResultSections(json) {
    const cont = document.getElementById('sections');
    cont.innerHTML = "";

    if ((!json.sections || json.sections.length === 0) && (!json.blocks_side_by_side || Object.keys(json.blocks_side_by_side).length === 0)) {
        cont.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-tertiary);">No results loaded.</div>';
        return;
    }

    // 1. Unparsed Blocks Group (Analysis Options, etc)
    if (json.blocks_side_by_side && Object.keys(json.blocks_side_by_side).length > 0) {
        const header = document.createElement('div');
        header.className = 'sec-group-header';
        header.style.cssText = "padding: 8px 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; margin-top: 8px; display: block;";
        header.textContent = "GENERAL / SUMMARY";
        cont.appendChild(header);

        const groupDiv = document.createElement('div');
        groupDiv.className = 'sec-group-content';

        Object.keys(json.blocks_side_by_side).sort().forEach(blockName => {
            const div = document.createElement('div');
            div.className = 'sec-item';
            div.innerHTML = `<span>${blockName}</span>`;
            div.onclick = () => {
                document.querySelectorAll('.sec-item').forEach(n => n.classList.remove('active'));
                div.classList.add('active');
                renderResultBlock(blockName);
            };
            groupDiv.appendChild(div);
        });
        cont.appendChild(groupDiv);
    }

    // 2. Sections Group
    if (json.sections && json.sections.length > 0) {
        // Group Header
        const header = document.createElement('div');
        header.className = 'sec-group-header';
        header.style.cssText = "padding: 8px 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; margin-top: 8px; display: block;";
        header.textContent = "RESULT TABLES";
        cont.appendChild(header);

        const groupDiv = document.createElement('div');
        groupDiv.className = 'sec-group-content';

        json.sections.forEach(sec => {
            const div = document.createElement('div');
            div.className = 'sec-item';
            div.dataset.sec = sec.section;

            // Count Diff?
            const changedCount = sec.rows.filter(r => r.Status !== 'SAME').length;

            div.innerHTML = `<span>${sec.section}</span>
              <span class="sec-counts">
                 ${changedCount > 0 ? `<span class="badge changed" style="font-size:10px; border-radius:10px; padding:1px 6px;">${changedCount}</span>` : ''}
              </span>`;

            div.onclick = () => {
                document.querySelectorAll('.sec-item').forEach(n => n.classList.remove('active'));
                div.classList.add('active');
                renderResultSection(sec.section);
            };
            groupDiv.appendChild(div);
        });

        cont.appendChild(groupDiv);
    }

    // Auto-select first item
    const first = cont.querySelector('.sec-item');
    if (first) first.click();
}

function renderResultBlock(blockName) {
    const container = document.getElementById('rptTableContainer');
    container.innerHTML = '';

    state.ResultsCurrentParams = { type: 'block', name: blockName };

    if (!state.LAST.resultJson || !state.LAST.resultJson.blocks_side_by_side) return;
    const blockData = state.LAST.resultJson.blocks_side_by_side[blockName];
    if (!blockData) return;

    // Render Side-by-Side Text
    const wrapper = document.createElement('div');
    wrapper.style.cssText = "display: flex; gap: 20px; padding: 20px;";

    const createPre = (title, text) => {
        const d = document.createElement('div');
        d.style.flex = "1";
        d.innerHTML = `<h4 style="margin-top:0; border-bottom:1px solid var(--border-medium); padding-bottom:8px;">${title}</h4>
                       <pre style="white-space:pre-wrap; font-family:monospace; font-size:12px; background:var(--bg-body); padding:10px; border-radius:4px;">${text || '(Empty)'}</pre>`;
        return d;
    };

    wrapper.appendChild(createPre("Input 1", blockData.a));
    wrapper.appendChild(createPre("Input 2", blockData.b));
    container.appendChild(wrapper);
}

function renderResultSection(sectionName) {
    const container = document.getElementById('rptTableContainer');
    container.innerHTML = '';

    // Ensure overflow styling for horizontal scroll
    container.style.overflowX = 'auto';
    container.style.width = '100%';

    state.ResultsCurrentParams = { type: 'section', name: sectionName };

    if (!state.LAST.resultJson || !sectionName) return;

    const secData = state.LAST.resultJson.sections.find(s => s.section === sectionName);
    if (!secData) return;

    // Create Table
    const table = document.createElement('table');
    table.className = 'data-table';
    table.style.width = 'max-content'; // Force horizontal expansion for scrolling

    // Header
    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    secData.out_columns.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col;
        trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    let visibleRows = 0;

    // Identify metrics for coloring
    const cols = secData.out_columns;

    secData.rows.forEach(row => {
        visibleRows++;

        const tr = document.createElement('tr');

        // ID for linking
        const idCol = secData.id_col;
        const idVal = row[idCol];
        if (idVal) tr.classList.add(`row-id-${idVal.replace(/[^a-zA-Z0-9]/g, '_')}`);

        if (row.Status === 'CHANGED') tr.classList.add('changed-row');
        if (row.Status === 'ONLY_IN_A') tr.classList.add('removed-row');
        if (row.Status === 'ONLY_IN_B') tr.classList.add('added-row');

        // Identify primary metric (last column usually)
        const metricCol = cols[cols.length - 1];
        let rowColor = null;

        cols.forEach(col => {
            const td = document.createElement('td');
            const valStr = row[col];
            td.textContent = valStr;

            // Text Coloring Logic - apply only to metric values
            if (col !== idCol && valStr) {
                const num = parseFloat(valStr);
                if (!isNaN(num)) {
                    const isPct = col.includes('%') || col.includes('Percent');
                    const isDiff = col.includes('Diff');

                    // 1. Text Coloring (High Vis)
                    if (isPct || isDiff) {
                        const color = getBucketColor(num, isPct);
                        if (color !== C.unchanged) {
                            td.style.color = color;
                            td.style.fontWeight = '600';
                        }
                    }

                    // 2. Row Background Logic (Subtle)
                    // Use the primary metric column to determine row background
                    if (col === metricCol) {
                        const color = getBucketColor(num, isPct);
                        if (color !== C.unchanged) {
                            rowColor = color;
                        }
                    }
                }
            }

            tr.appendChild(td);
        });

        // Apply Row Background Tint
        if (rowColor) {
            // Convert hex to rgba for tint
            // Simple hex to rgb
            const r = parseInt(rowColor.slice(1, 3), 16);
            const g = parseInt(rowColor.slice(3, 5), 16);
            const b = parseInt(rowColor.slice(5, 7), 16);
            tr.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.1)`;
        }

        // Highlight on Click (Table -> Map)
        tr.addEventListener('click', () => {
            if (!idVal) return;

            // Map generic types
            let type = null;
            if (sectionName.includes("Node") || sectionName.includes("Junction") || sectionName.includes("Storage")) type = "JUNCTIONS";
            else if (sectionName.includes("Link") || sectionName.includes("Conduit") || sectionName.includes("Pump")) type = "CONDUITS";
            else if (sectionName.includes("Subcatchment")) type = "SUBCATCHMENTS";

            if (type) {
                // Highlight and Zoom (true)
                highlightElement(type, idVal, true, false, true); // skipScroll=true
            }
        });

        tbody.appendChild(tr);
    });

    if (visibleRows === 0) {
        tbody.innerHTML = `<tr><td colspan="${secData.out_columns.length}" style="text-align:center; padding:20px; color:var(--text-tertiary);">No rows match.</td></tr>`;
    }

    table.appendChild(tbody);
    container.appendChild(table);
}

function updateMapResults() {
    if (state.UI_MODE !== 'RPT') return;

    const select = document.getElementById('mapModeSelect');
    const modeOrSection = select.value;

    updateMapStyle('RPT', {
        section: modeOrSection
    });
}
