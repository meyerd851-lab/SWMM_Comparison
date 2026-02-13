// results/results_map.js

import { map, xyToLatLng } from '../map.js';
import { ShapeMarker } from '../ShapeMarker.js'; // Assuming direct import works if in same structure, or adjust path
// Start of Selection
import { state } from '../state.js';

let resultLayers = {
    nodes: L.layerGroup(),
    links: L.layerGroup()
};

let currentMetric = null;
let currentThresholds = { low: 5, high: 10 }; // Percent

export function initResultsMap() {
    resultLayers.nodes.addTo(map);
    resultLayers.links.addTo(map);
}

export function clearResultsMap() {
    resultLayers.nodes.clearLayers();
    resultLayers.links.clearLayers();
}

/**
 * Updates the map coloring based on the selected metric and thresholds.
 * @param {Object} resultsData - The full RPTSideBySideResult object
 * @param {string} sectionName - The active section name (e.g. "Node Depth Summary")
 * @param {string} metricCol - Column name to visualize (e.g. "Diff Max Depth" or "% Diff ...")
 * @param {Object} thresholds - { low: 5, high: 10 }
 */
export function updateResultsMap(resultsData, sectionName, metricCol, thresholds) {
    clearResultsMap();
    if (!resultsData) return;

    currentMetric = metricCol;
    currentThresholds = thresholds || currentThresholds;

    const section = resultsData.sections.find(s => s.section === sectionName);
    if (!section) return;

    // We need geometry to draw. Results don't have geometry, so we must rely on
    // INP geometry if available (state.LAST.json.geometry).
    // If INP files haven't been loaded/compared, we can't draw the map for Results.
    // Ideally user compares INP + RPT together.
    const geometry = state.LAST.json?.geometry;
    if (!geometry) {
        console.warn("No geometry available context to map results.");
        return;
    }

    // Determine if we are mapping Nodes or Links
    const isNode = ["Node", "Storage Unit", "Outfall"].some(k => sectionName.includes(k));
    const isLink = ["Link", "Conduit", "Pump"].some(k => sectionName.includes(k)); // "Link Flow Summary"

    if (!isNode && !isLink) return; // e.g., Subcatchment or System-wide

    section.rows.forEach(row => {
        const id = row[section.id_col];
        const valStr = row[metricCol];
        if (!valStr) return;

        const val = parseFloat(valStr);
        if (isNaN(val)) return;

        // Color Logic
        // Green < Low < Orange < High < Red
        let color = '#9ca3af'; // Grey/unchanged base
        const absVal = Math.abs(val);

        if (absVal < currentThresholds.low) color = '#10b981'; // Green (Safe/Low Diff)
        else if (absVal < currentThresholds.high) color = '#f59e0b'; // Orange (Medium Diff)
        else color = '#ef4444'; // Red (High Diff)

        // Draw Element
        if (isNode) {
            drawResultNode(id, color, geometry);
        } else if (isLink) {
            drawResultLink(id, color, geometry);
        }
    });
}

function drawResultNode(id, color, geom) {
    // Try to find node in geometry (nodes2 preferred as 'new', or nodes1)
    const xy = (geom.nodes2 && geom.nodes2[id]) || (geom.nodes1 && geom.nodes1[id]);
    if (!xy) return;

    const ll = xyToLatLng(xy[0], xy[1]);

    // Simple Circle Marker
    new ShapeMarker(ll, {
        radius: 6,
        color: "#000",
        weight: 1,
        fillColor: color,
        fillOpacity: 1,
        shape: 'circle'
    }).addTo(resultLayers.nodes).bindPopup(`<b>${id}</b><br>Value: ${currentMetric ? currentMetric : ''}`);
}

function drawResultLink(id, color, geom) {
    // Try to find link in geometry
    const coords = (geom.links2 && geom.links2[id]) || (geom.links1 && geom.links1[id]);
    if (!coords) return;

    const ll = coords.map(p => xyToLatLng(p[0], p[1]));

    L.polyline(ll, {
        color: color,
        weight: 4,
        opacity: 0.9
    }).addTo(resultLayers.links).bindPopup(`<b>${id}</b><br>Value: ${currentMetric ? currentMetric : ''}`);
}
