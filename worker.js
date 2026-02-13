// worker.js
let pyodide, core, core_results;

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === "init") {
      if (!pyodide) {
        self.postMessage({ type: "progress", payload: "Loading…" });
        importScripts("https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js");
        pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/" });

        // Fetch your local module and write it to the Pyodide FS
        self.postMessage({ type: "progress", payload: "Loading…" });
        const src = await (await fetch("./core_web.py", { cache: "no-store" })).text();
        pyodide.FS.writeFile("core_web.py", src);

        const shpSrc = await (await fetch("./shapefile.py", { cache: "no-store" })).text();
        pyodide.FS.writeFile("shapefile.py", shpSrc);

        // Load core_results.py for RPT logic
        const resSrc = await (await fetch("./core_results.py", { cache: "no-store" })).text();
        pyodide.FS.writeFile("core_results.py", resSrc);

        // Import the modules
        core = pyodide.pyimport("core_web");
        core_results = pyodide.pyimport("core_results");
      }
      self.postMessage({ type: "ready" });
      return;
    }

    if (msg.type === "compare") {
      if (!pyodide || !core) throw new Error("Pyodide not initialized.");
      self.postMessage({ type: "progress", payload: "Running comparison…" });

      // 1. INP COMPARISON
      // Convert ArrayBuffers -> Python bytes
      const tolerancesJS = msg.tolerances || {};
      const hasTolerances = Object.keys(tolerancesJS).length > 0;

      const py_b1 = pyodide.toPy(new Uint8Array(msg.file1));
      const py_b2 = pyodide.toPy(new Uint8Array(msg.file2));
      const py_tolerances = hasTolerances ? pyodide.toPy(tolerancesJS) : undefined;

      const progressCallback = (pct, text) => {
        self.postMessage({ type: "progress", payload: `${text} (${pct.toFixed(0)}%)` });
      };

      let inpOut = null;
      try {
        const out = core.run_compare(py_b1, py_b2, py_tolerances, progressCallback);
        inpOut = JSON.parse(out.toString());
      } finally {
        py_b1.destroy();
        py_b2.destroy();
        if (py_tolerances) py_tolerances.destroy();
      }

      // 2. RPT COMPARISON
      let rptOut = null;
      if (msg.rpt1_text && msg.rpt2_text) {
        self.postMessage({ type: "progress", payload: "Comparing Results..." });
        try {
          const rOut = core_results.build_side_by_side(msg.rpt1_text, msg.rpt2_text);
          rptOut = JSON.parse(rOut.toString());
        } catch (e) {
          console.error("RPT Compare Error:", e);
          // We don't fail the whole process if RPT fails, just log it
        }
      }

      // 3. COMBINE AND RETURN
      const finalResult = {
        inp: inpOut,
        rpt: rptOut
      };

      self.postMessage({ type: "result", payload: JSON.stringify(finalResult) });
      return;
    }

    if (msg.type === "export_shapefiles") {
      if (!pyodide || !core) throw new Error("Pyodide not initialized.");
      self.postMessage({ type: "progress", payload: "Generating Shapefiles…" });

      const diffsJson = msg.diffs;
      const geometryJson = msg.geometry;
      const crs = msg.crs;
      const filePrefix = msg.filePrefix || "export";

      try {
        const zipBytes = core.generate_shapefiles_zip(diffsJson, geometryJson, crs, filePrefix);
        // Convert PyProxy/bytes to JS Uint8Array
        const jsBytes = zipBytes.toJs();
        zipBytes.destroy();

        self.postMessage({ type: "shapefile_result", payload: jsBytes }, [jsBytes.buffer]);
      } catch (e) {
        throw new Error("Shapefile generation failed: " + e.message);
      }
      return;
    }
  } catch (err) {
    // Show nice error
    const text = (err && err.message) ? err.message : String(err);
    self.postMessage({ type: "error", error: text });
  }
};
