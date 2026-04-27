import { db } from "./firebase-config.js?v=20260427d";
import { sanitizeScanCode, buildScanVariants, validateBarcode } from "./scanner_utils.js?v=20260427d";
import { collection, doc, getDoc, setDoc, addDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const state = {
  session: "",
  deviceId: (() => {
    try {
      const k = "scan_device_id_v1";
      const ex = localStorage.getItem(k);
      if (ex) return ex;
      const v = "dev_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
      localStorage.setItem(k, v);
      return v;
    } catch {
      return "dev_" + Date.now().toString(16);
    }
  })(),
  stream: null,
  running: false,
  detector: null,
  lastSent: { code: "", at: 0 },
  queueKey: "scan_mobile_queue_v1",
};

function setStatus(txt) {
  const el = $("st");
  if (el) el.textContent = txt;
}

function setSession(code) {
  state.session = code;
  const el = $("sess");
  if (el) el.textContent = code || "—";
}

function _loadQueue() {
  try {
    const raw = localStorage.getItem(state.queueKey);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function _saveQueue(arr) {
  try { localStorage.setItem(state.queueKey, JSON.stringify(arr || [])); } catch {}
}

async function pushEvent(code) {
  const cleaned = sanitizeScanCode(code);
  if (!cleaned) return;
  const vb = validateBarcode(cleaned, { allowLib: true });
  const normalized = vb.ok ? vb.normalized : cleaned;

  const now = Date.now();
  if (state.lastSent.code === normalized && (now - state.lastSent.at) < 1200) return;
  state.lastSent = { code: normalized, at: now };

  const lastEl = $("last");
  if (lastEl) lastEl.textContent = normalized;

  if (!state.session) {
    const q = _loadQueue();
    q.push({ code: normalized, at: now });
    while (q.length > 200) q.shift();
    _saveQueue(q);
    setStatus("sin sesión (en cola)");
    return;
  }

  try {
    const sid = state.session;
    const sessRef = doc(db, "scan_sessions", sid);
    const snap = await getDoc(sessRef);
    if (!snap.exists()) {
      await setDoc(sessRef, { createdAt: serverTimestamp(), status: "open" }, { merge: true });
    }
    await addDoc(collection(db, "scan_sessions", sid, "events"), {
      code: normalized,
      variants: buildScanVariants(normalized),
      deviceId: state.deviceId,
      at: serverTimestamp(),
      clientAt: now
    });
    setStatus(navigator.onLine ? "enviado" : "en cola (offline)");
  } catch {
    const q = _loadQueue();
    q.push({ code: normalized, at: now });
    while (q.length > 200) q.shift();
    _saveQueue(q);
    setStatus("falló envío (en cola)");
  }
}

async function flushQueue() {
  if (!state.session) return;
  const q = _loadQueue();
  if (!q.length) return;
  _saveQueue([]);
  for (const it of q) {
    try { await pushEvent(it.code); } catch {}
  }
}

function parseSessionFromUrl() {
  try {
    const u = new URL(window.location.href);
    const s = (u.searchParams.get("session") || "").trim();
    if (s) return s;
  } catch {}
  return "";
}

function connect(code) {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) {
    setStatus("código inválido");
    return;
  }
  setSession(c);
  $("code").value = c;
  setStatus(navigator.onLine ? "conectado" : "offline");
  flushQueue();
  try {
    if (state._unsub) state._unsub();
    const ref = doc(db, "scan_sessions", c);
    state._unsub = onSnapshot(ref, () => {});
  } catch {}
}

async function startCamera() {
  if (state.running) return;
  if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
    setStatus("cámara no disponible");
    return;
  }
  if (!("BarcodeDetector" in window)) {
    setStatus("BarcodeDetector no soportado");
    return;
  }
  try {
    state.detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
  } catch {
    state.detector = new BarcodeDetector();
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    state.stream = stream;
    const v = $("v");
    v.srcObject = stream;
    await v.play();
    state.running = true;
    setStatus("cámara activa");
    loopDetect();
  } catch {
    setStatus("permiso denegado");
  }
}

function stopCamera() {
  state.running = false;
  try { state.stream?.getTracks?.().forEach(t => t.stop()); } catch {}
  state.stream = null;
  const v = $("v");
  if (v) v.srcObject = null;
  setStatus("cámara detenida");
}

async function loopDetect() {
  const v = $("v");
  const c = $("c");
  const ctx = c.getContext("2d");
  const tick = async () => {
    if (!state.running) return;
    try {
      const w = v.videoWidth || 0;
      const h = v.videoHeight || 0;
      if (w > 0 && h > 0) {
        c.width = w;
        c.height = h;
        ctx.drawImage(v, 0, 0, w, h);
        const bmp = await createImageBitmap(c);
        const det = await state.detector.detect(bmp);
        if (det && det.length) {
          const raw = String(det[0]?.rawValue || "").trim();
          if (raw) await pushEvent(raw);
        }
      }
    } catch {}
    setTimeout(tick, 220);
  };
  tick();
}

window.addEventListener("online", () => { setStatus("online"); flushQueue(); });
window.addEventListener("offline", () => setStatus("offline"));

$("btnConnect").addEventListener("click", () => connect($("code").value));
$("btnSend").addEventListener("click", () => pushEvent($("manual").value));
$("btnCam").addEventListener("click", () => {
  if (!state.running) startCamera();
  else stopCamera();
});

const preset = parseSessionFromUrl();
if (preset) connect(preset);
else setStatus(navigator.onLine ? "inactivo" : "offline");
