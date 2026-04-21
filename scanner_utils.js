export function sanitizeScanCode(raw) {
  return String(raw || "").trim().replace(/[^0-9a-zA-Z-]/g, "");
}

export function buildScanVariants(raw) {
  const s0 = sanitizeScanCode(raw);
  if (!s0) return [];
  const out = [];
  const push = (v) => {
    if (!v) return;
    if (!out.includes(v)) out.push(v);
  };
  push(s0);
  push(s0.toUpperCase());
  push(s0.replace(/^0+/, ""));
  push(s0.toUpperCase().replace(/^0+/, ""));
  return out;
}

export function isLikelyScanByTiming(deltasMs) {
  const ds = Array.isArray(deltasMs) ? deltasMs.filter(n => Number.isFinite(n) && n >= 0) : [];
  if (ds.length < 2) return true;
  const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
  return avg <= 80;
}

