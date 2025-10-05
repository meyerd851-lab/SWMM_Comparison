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

        // Import the module
        core = pyodide.pyimport("core_web");
      }
      self.postMessage({ type: "ready" });
      return;
    }

    if (msg.type === "compare") {
      if (!pyodide || !core) throw new Error("Pyodide not initialized.");
      self.postMessage({ type: "progress", payload: "Running comparison in Python…" });

      // Convert ArrayBuffers -> Python bytes
      const py_b1 = pyodide.toPy(new Uint8Array(msg.file1));
      const py_b2 = pyodide.toPy(new Uint8Array(msg.file2));
      try {
        const out = core.run_compare(py_b1, py_b2); // returns JSON string
        const jsOut = out.toString();
        self.postMessage({ type: "result", payload: jsOut });
      } finally {
        py_b1.destroy();
        py_b2.destroy();
      }
      return;
    }
  } catch (err) {
    // Show nice error
    const text = (err && err.message) ? err.message : String(err);
    self.postMessage({ type: "error", error: text });
  }
};
