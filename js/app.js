// app.js — Main application controller

import { state } from './state.js';
import { renderSections } from './table.js';
import { drawGeometry } from './map.js';
import { makeResizable, openHelpModal, closeHelpModal, saveSession, loadSession, exportToExcel, exportToShapefile, openDetail, closeModal, updateFileName, openCompareModal, closeCompareModal, setWorker, setSetStatusCallback, initTheme, toggleTheme } from './ui.js';
import { setOpenDetailCallback } from './table.js';

// --- Initialization ---


proj4.defs(state.CURRENT_CRS, state.PROJECTIONS[state.CURRENT_CRS]);

// --- Worker setup ---


const worker = new Worker("worker/worker.js");
setWorker(worker);

function setStatus(s) {
  document.getElementById('status').textContent = s;
}
setSetStatusCallback(setStatus);
initTheme();


worker.onmessage = (ev) => {
  const { type, payload, error } = ev.data || {};
  if (type === "ready") {
    setStatus("Ready.");
    return;
  }
  if (type === "progress") {
    setStatus(payload);
    return;
  }
  if (type === "error") {
    setStatus(error || "Error");
    alert(error);
    return;
  }
  if (type === "result") {
    try {
      const json = JSON.parse(payload);
      state.LAST.json = json;
      renderSections(json);
      drawGeometry(json);
      setStatus("Done.");
    } catch (e) {
      console.error(e);
      setStatus("Failed to parse result.");
      alert("Failed to parse result JSON.");
    }
  }
  if (type === "shapefile_result") {
    try {
      const blob = new Blob([payload], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const f1Name = (document.getElementById('f1-name').textContent || "file1").replace(/\.inp$/i, "").substring(0, 20);
      const f2Name = (document.getElementById('f2-name').textContent || "file2").replace(/\.inp$/i, "").substring(0, 20);
      a.download = `SWMM_Shapefiles_${f1Name}_vs_${f2Name}.zip`;

      a.click();
      URL.revokeObjectURL(url);
      setStatus("Shapefiles downloaded.");
    } catch (e) {
      console.error(e);
      setStatus("Failed to download shapefiles.");
    }
  }
};

worker.postMessage({ type: "init" });

// --- UI event listeners ---


setOpenDetailCallback(openDetail);

updateFileName('f1', 'f1-name');
updateFileName('f2', 'f2-name');


document.getElementById('go').addEventListener('click', openCompareModal);


document.getElementById('runCompareFromModal').addEventListener('click', async () => {
  const f1 = document.getElementById('f1').files?.[0];
  const f2 = document.getElementById('f2').files?.[0];
  if (!f1 || !f2) {
    alert("Please select both INP files to compare.");
    return;
  }

  const tolerances = {
    "CONDUIT_LENGTH": parseFloat(document.getElementById('tol_conduit_length').value) || 0,
    "CONDUIT_OFFSET": parseFloat(document.getElementById('tol_conduit_offset').value) || 0,
    "JUNCTION_INVERT": parseFloat(document.getElementById('tol_junction_invert').value) || 0,
    "JUNCTION_DEPTH": parseFloat(document.getElementById('tol_junction_depth').value) || 0,
    "CONDUIT_ROUGHNESS": parseFloat(document.getElementById('tol_conduit_roughness').value) || 0,
  };

  state.FILES.f1Name = f1.name;
  state.FILES.f2Name = f2.name;
  setStatus("Reading files…");
  const [b1, b2] = await Promise.all([f1.arrayBuffer(), f2.arrayBuffer()]);
  state.FILES.f1Bytes = b1;
  state.FILES.f2Bytes = b2;
  setStatus("Running comparison…");
  worker.postMessage({ type: "compare", file1: b1, file2: b2, tolerances: tolerances });
  closeCompareModal();
});


document.getElementById('saveSess').addEventListener('click', saveSession);
document.getElementById('loadSessBtn').addEventListener('click', () => document.getElementById('loadSessInput').click());
document.getElementById('loadSessInput').addEventListener('change', (ev) => {
  const f = ev.target.files?.[0];
  if (f) loadSession(f);
});


document.getElementById('exportXlsx').addEventListener('click', exportToExcel);
document.getElementById('exportShp').addEventListener('click', exportToShapefile);


document.getElementById('helpBtn').addEventListener('click', openHelpModal);
document.getElementById('themeBtn').addEventListener('click', toggleTheme);

// Expose modal close handlers to onclick attributes in HTML
window.closeModal = closeModal;
window.closeHelpModal = closeHelpModal;
window.closeCompareModal = closeCompareModal;


document.addEventListener('DOMContentLoaded', makeResizable);

