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
    push("LIB-" + digitsAll);
    push("LIB-" + digitsAll.replace(/^0+/, ""));
  }
  return out;
}

export function isLikelyScanByTiming(deltasMs) {
  const ds = Array.isArray(deltasMs) ? deltasMs.filter(n => Number.isFinite(n) && n >= 0) : [];
  if (ds.length < 2) return true;
  const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
  return avg <= 80;
}

export function normalizeBarcodeDigits(raw) {
  return String(raw || "").trim().replace(/\D+/g, "");
}

function _checksumMod10(digits, expectedLen) {
  const s = String(digits || "");
  if (!/^\d+$/.test(s)) return null;
  if (expectedLen && s.length !== expectedLen) return null;
  if (s.length < 2) return null;
  const check = Number(s[s.length - 1]);
  if (!Number.isFinite(check)) return null;
  let sum = 0;
  let w = 3;
  for (let i = s.length - 2; i >= 0; i -= 1) {
    const d = Number(s[i]);
    sum += d * w;
    w = (w === 3 ? 1 : 3);
  }
  const calc = (10 - (sum % 10)) % 10;
  return calc === check ? calc : null;
}

export function validateBarcode(raw, opts) {
  const allowLib = (opts?.allowLib ?? true) !== false;
  const cleaned = sanitizeScanCode(raw);
  const u = String(cleaned || "").toUpperCase();
  if (allowLib && u.startsWith("LIB-") && u.length >= 8) {
    return { ok: true, type: "LIB", normalized: u };
  }
  const digits = normalizeBarcodeDigits(cleaned);
  if (!digits) return { ok: false, type: "", normalized: "", reason: "EMPTY" };
  if (digits.length === 14 && digits.startsWith("0")) {
    const e13 = digits.slice(1);
    const ok13 = _checksumMod10(e13, 13) !== null;
    if (ok13) return { ok: true, type: "EAN13", normalized: e13 };
    const u12 = digits.slice(2);
    const ok12 = _checksumMod10(u12, 12) !== null;
    if (ok12) return { ok: true, type: "UPCA", normalized: u12 };
    return { ok: false, type: "EAN13", normalized: e13, reason: "CHECKSUM" };
  }
  if (digits.length === 13) {
    const ok = _checksumMod10(digits, 13) !== null;
    if (ok) return { ok: true, type: "EAN13", normalized: digits };
    if (digits.startsWith("0")) {
      const u12 = digits.slice(1);
      const ok12 = _checksumMod10(u12, 12) !== null;
      if (ok12) return { ok: true, type: "UPCA", normalized: u12 };
    }
    return { ok: false, type: "EAN13", normalized: digits, reason: "CHECKSUM" };
  }
  if (digits.length === 12) {
    const ok = _checksumMod10(digits, 12) !== null;
    return ok ? { ok: true, type: "UPCA", normalized: digits } : { ok: false, type: "UPCA", normalized: digits, reason: "CHECKSUM" };
  }
  if (digits.length === 8) {
    const ok = _checksumMod10(digits, 8) !== null;
    return ok ? { ok: true, type: "EAN8", normalized: digits } : { ok: false, type: "EAN8", normalized: digits, reason: "CHECKSUM" };
  }
  return { ok: false, type: "UNKNOWN", normalized: digits, reason: "LENGTH" };
}

