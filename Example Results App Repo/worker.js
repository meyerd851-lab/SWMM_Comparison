// worker.js
let pyodide, core;

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === "init") {
      if (!pyodide) {
        self.postMessage({ type: "progress", payload: "Loading Pyodide…" });
        importScripts("https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js");
        pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/" });

        // Fetch your local module and write it to the Pyodide FS
        self.postMessage({ type: "progress", payload: "Loading core_web.py…" });
        const src = await (await fetch("./core_web.py", { cache: "no-store" })).text();
        pyodide.FS.writeFile("core_web.py", src);

        self.postMessage({ type: "progress", payload: "Loading core_results.py…" });
        const resSrc = await (await fetch("./core_results.py", { cache: "no-store" })).text();
        pyodide.FS.writeFile("core_results.py", resSrc);

        self.postMessage({ type: "progress", payload: "Loading shapefile.py…" });
        const shpSrc = await (await fetch("./shapefile.py", { cache: "no-store" })).text();
        pyodide.FS.writeFile("shapefile.py", shpSrc);

        // Import the module
        core = pyodide.pyimport("core_web");
        core_results = pyodide.pyimport("core_results");
      }
      self.postMessage({ type: "ready" });
      return;
    }

    if (msg.type === "compare") {
      if (!pyodide || !core) throw new Error("Pyodide not initialized.");
      self.postMessage({ type: "progress", payload: "Running comparison in Python…" });

      // Convert ArrayBuffers -> Python bytes
      const tolerancesJS = msg.tolerances || {};
      const hasTolerances = Object.keys(tolerancesJS).length > 0;

      // Safe access helper
      const toPyBytes = (buf) => buf ? pyodide.toPy(new Uint8Array(buf)) : null;

      const py_b1 = toPyBytes(msg.file1);
      const py_b2 = toPyBytes(msg.file2);
      const py_tolerances = hasTolerances ? pyodide.toPy(tolerancesJS) : undefined;

      // RPT files (text)
      const rpt1_text = msg.rpt1_text || null;
      const rpt2_text = msg.rpt2_text || null;

      try {
        // Run INP comparison (always, if files present)
        let inp_out = "{}";
        if (py_b1 && py_b2) {
          const out = core.run_compare(py_b1, py_b2, py_tolerances);
          inp_out = out.toString();
        }

        // Run RPT comparison (optional)
        let rpt_out = "null";
        if (rpt1_text && rpt2_text) {
          rpt_out = core_results.build_side_by_side(rpt1_text, rpt2_text);
        }

        // Combine
        // We wrap them in a bigger JSON structure
        const combined = JSON.stringify({
          inp: JSON.parse(inp_out),
          rpt: JSON.parse(rpt_out)
        });

        self.postMessage({ type: "result", payload: combined });

      } finally {
        if (py_b1) py_b1.destroy();
        if (py_b2) py_b2.destroy();
        if (py_tolerances) py_tolerances.destroy();
      }
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
