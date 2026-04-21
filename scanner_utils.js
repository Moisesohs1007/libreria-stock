export function sanitizeScanCode(raw) {
  let s = String(raw || "").trim().replace(/[^0-9a-zA-Z-]/g, "");
  const u = s.toUpperCase();
  const i = u.indexOf("LIB-");
  if (i > 0 && i <= 6) s = s.slice(i);
  return s;
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
  const u = s0.toUpperCase();
  if (u.startsWith("LIB-")) {
    const tail = u.slice(4);
    push(tail);
    push(tail.replace(/^0+/, ""));
    const digits = tail.replace(/\D+/g, "");
    if (digits && digits.length >= 6) {
      push(digits);
      push(digits.replace(/^0+/, ""));
    }
  }
  const digitsAll = u.replace(/\D+/g, "");
  if (digitsAll && digitsAll.length >= 6) {
    push(digitsAll);
    push(digitsAll.replace(/^0+/, ""));
  }
  return out;
}

export function isLikelyScanByTiming(deltasMs) {
  const ds = Array.isArray(deltasMs) ? deltasMs.filter(n => Number.isFinite(n) && n >= 0) : [];
  if (ds.length < 2) return true;
  const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
  return avg <= 80;
}

