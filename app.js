// app.js - Main application logic (worker communication, initialization, coordination)
import { state } from './state.js';
import { renderSections } from './table.js';
import { drawGeometry } from './map.js';
import { makeResizable, openHelpModal, closeHelpModal, saveSession, loadSession, exportToExcel, openDetail, closeModal, copyRowJSON, updateFileName, openCompareModal, closeCompareModal, setWorker, setSetStatusCallback } from './ui.js';
import { setOpenDetailCallback } from './table.js';

// Initialize proj4 with default CRS
proj4.defs(state.CURRENT_CRS, state.PROJECTIONS[state.CURRENT_CRS]);

// Worker setup
const worker = new Worker("worker.js");
setWorker(worker);

function setStatus(s) {
  document.getElementById('status').textContent = s;
}
setSetStatusCallback(setStatus);

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
};
worker.postMessage({ type: "init" });

// Set up openDetail callback for table.js
setOpenDetailCallback(openDetail);

// File input handlers
updateFileName('f1', 'f1-name');
updateFileName('f2', 'f2-name');

// Compare button
document.getElementById('go').addEventListener('click', openCompareModal);

// Run comparison from modal
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
  };

  state.FILES.f1Name = f1.name;
  state.FILES.f2Name = f2.name;
  setStatus("Reading files…");
  const [b1, b2] = await Promise.all([f1.arrayBuffer(), f2.arrayBuffer()]);
  state.FILES.f1Bytes = b1;
  state.FILES.f2Bytes = b2;
  setStatus("Running comparison…");
  worker.postMessage({ type: "compare", file1: b1, file2: b2, tolerances: tolerances }, [b1, b2]);
  closeCompareModal();
});

// Session management
document.getElementById('saveSess').addEventListener('click', saveSession);
document.getElementById('loadSessBtn').addEventListener('click', () => document.getElementById('loadSessInput').click());
document.getElementById('loadSessInput').addEventListener('change', (ev) => {
  const f = ev.target.files?.[0];
  if (f) loadSession(f);
});

// Excel export
document.getElementById('exportXlsx').addEventListener('click', exportToExcel);

// Help button
document.getElementById('helpBtn').addEventListener('click', openHelpModal);

// Modal close handlers
window.closeModal = closeModal;
window.closeHelpModal = closeHelpModal;
window.copyRowJSON = copyRowJSON;

// Initialize resizable panels
document.addEventListener('DOMContentLoaded', makeResizable);

