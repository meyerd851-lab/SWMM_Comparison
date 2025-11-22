// Utility functions

export function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

export function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[c]));
}

export function abToB64(ab) {
  const bytes = new Uint8Array(ab);
  let binary = '';
  const chunkSize = 0x8000; // 32 KB chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

export function b64ToAb(b64) {
  const bin = atob(b64);
  const ab = new ArrayBuffer(bin.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return ab;
}

export function relabelHeaders(section, hdrs) {
  if (section !== "INFILTRATION") return hdrs;
  const MAP = {
    "Param1": "Max. Infil. Rate",
    "Param 1": "Max. Infil. Rate",
    "Param2": "Min. Infil. Rate",
    "Param 2": "Min. Infil. Rate",
    "Param3": "Decay Constant",
    "Param 3": "Decay Constant",
    "Param4": "Drying Time",
    "Param 4": "Drying Time",
    "Param5": "Max. Volume",
    "Param 5": "Max. Volume",
  };
  return hdrs.map(h => MAP[h] ?? h);
}

