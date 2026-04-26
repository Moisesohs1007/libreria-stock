export function getBarcodeLookupConfig() {
  const base = { provider: "openfoodfacts", customUrlTemplate: "" };
  try {
    const raw = localStorage.getItem("barcode_lookup_cfg");
    if (!raw) return base;
    const obj = JSON.parse(raw);
    return { ...base, ...(obj || {}) };
  } catch {
    return base;
  }
}

export function setBarcodeLookupConfig(cfg) {
  const out = {
    provider: String(cfg?.provider || "openfoodfacts"),
    customUrlTemplate: String(cfg?.customUrlTemplate || ""),
  };
  localStorage.setItem("barcode_lookup_cfg", JSON.stringify(out));
  return out;
}

function _pick(obj, keys) {
  for (const k of (keys || [])) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function parseOpenFoodFacts(json) {
  const p = json?.product || null;
  const ok = json?.status === 1 && !!p;
  if (!ok) return { ok: false, name: "", brand: "", category: "", raw: json || null };
  const name = _pick(p, ["product_name", "product_name_es", "product_name_en", "generic_name", "generic_name_es", "generic_name_en"]);
  const brand = _pick(p, ["brands", "brand_owner", "brand"]);
  const category = _pick(p, ["categories", "categories_tags", "category"]);
  return { ok: true, name, brand, category, raw: json };
}

export function parseHeuristic(json) {
  const name = _pick(json, ["name", "title", "product_name", "descripcion", "description"]);
  const brand = _pick(json, ["brand", "brands", "marca", "manufacturer", "company"]);
  const category = _pick(json, ["category", "categories", "categoria", "type"]);
  if (!name && !brand && !category) return { ok: false, name: "", brand: "", category: "", raw: json || null };
  return { ok: true, name, brand, category, raw: json };
}

async function _fetchJson(url, timeoutMs) {
  const c = new AbortController();
  const t = setTimeout(() => { try { c.abort(); } catch {} }, timeoutMs || 6500);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) return { ok: false, status: r.status, json: null };
    const json = await r.json();
    return { ok: true, status: r.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(t);
  }
}

export async function lookupBarcodeOnline(codeDigits, cfg) {
  const code = String(codeDigits || "").trim();
  if (!/^\d{8,14}$/.test(code)) return { ok: false, reason: "INVALID", name: "", brand: "", category: "", raw: null };
  const c = cfg || getBarcodeLookupConfig();
  const provider = String(c.provider || "openfoodfacts");
  if (provider === "custom") {
    const tpl = String(c.customUrlTemplate || "").trim();
    if (!tpl || !tpl.includes("{code}")) return { ok: false, reason: "NO_TEMPLATE", name: "", brand: "", category: "", raw: null };
    const url = tpl.replaceAll("{code}", encodeURIComponent(code));
    const fx = await _fetchJson(url, 6500);
    if (!fx.ok) return { ok: false, reason: "HTTP", status: fx.status, name: "", brand: "", category: "", raw: null };
    const parsed = parseHeuristic(fx.json);
    return parsed.ok ? { ...parsed, ok: true, provider } : { ok: false, reason: "NO_DATA", name: "", brand: "", category: "", raw: fx.json };
  }
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
  const fx = await _fetchJson(url, 6500);
  if (!fx.ok) return { ok: false, reason: "HTTP", status: fx.status, name: "", brand: "", category: "", raw: null };
  const parsed = parseOpenFoodFacts(fx.json);
  return parsed.ok ? { ...parsed, ok: true, provider: "openfoodfacts" } : { ok: false, reason: "NO_DATA", name: "", brand: "", category: "", raw: fx.json };
}

