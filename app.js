/**
 * APP.JS - Lógica principal de la aplicación (Módulo ES6)
 * Gestiona autenticación, inventario, ventas, reportes e integraciones.
 * 
 * Este archivo se importa como <script type="module" src="app.js"></script>
 * Por lo tanto, las funciones accesibles desde el HTML (onclick) deben
 * asignarse explícitamente al objeto 'window'.
 */

import { db, storage } from './firebase-config.js?v=20260427f';
import { sanitizeScanCode, buildScanVariants, isLikelyScanByTiming, validateBarcode } from './scanner_utils.js?v=20260427k';
import { lookupBarcodeOnline, getBarcodeLookupConfig, setBarcodeLookupConfig } from './barcode_lookup.js?v=20260427f';
import { buildVentasExport, buildMovimientosExport } from './report_export_utils.js?v=20260427f';
import {
  collection, getDocs, query, where, updateDoc, addDoc, onSnapshot, doc, 
  increment, deleteDoc, Timestamp, runTransaction, setDoc, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// =============================================
// CONFIGURACIÓN DE INTEGRACIONES EXTERNAS
// =============================================
const FACTILIZA_TOKEN  = "TU_TOKEN_FACTILIZA"; 
const WHATSAPP_DESTINO = "51999999999";       

// =============================================
// CREDENCIALES ADMINISTRADOR (HARDCODED)
// =============================================
const ADMIN_USER = "Admin";
const ADMIN_PASS = "virpu2010";

// Variables de estado global
const scannerInput = document.getElementById("scanner");
let todosLosProductos  = [];
let todasLasVentas     = [];
let todasLasCategorias = [];
let todosLosProveedores = [];
let todosLosMovimientos = [];
let todosLosVendedores = [];
let rolActual          = null; 
let nombreVendedor     = "";
let listenersIniciados = false;
const _ADMIN_TAB_KEY = "admin_last_tab_v1";
const _VENDEDOR_TAB_KEY = "vendedor_last_tab_v1";

function _saveAdminTab(payload) {
  try { localStorage.setItem(_ADMIN_TAB_KEY, JSON.stringify(payload || {})); } catch {}
}
function _loadAdminTab() {
  try {
    const raw = localStorage.getItem(_ADMIN_TAB_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return (o && typeof o === "object") ? o : null;
  } catch {
    return null;
  }
}
function _saveVendedorTab(tabId) {
  try { localStorage.setItem(_VENDEDOR_TAB_KEY, String(tabId || "")); } catch {}
}
function _loadVendedorTab() {
  try { return String(localStorage.getItem(_VENDEDOR_TAB_KEY) || ""); } catch { return ""; }
}

function _timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => { try { c.abort(); } catch {} }, ms);
  return c.signal;
}

function scanServiceBase() {
  const override = localStorage.getItem("scan_svc_base");
  if (override) return override;
  return "http://127.0.0.1:7777";
}

function _toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function _precioVenta(p) {
  return _toNum(p?.precio_venta ?? p?.precioVenta ?? p?.precio ?? 0);
}

function _precioCompra(p) {
  return _toNum(p?.precio_compra ?? p?.precioCompra ?? 0);
}

function _fmtS(n) {
  return `S/${_toNum(n).toFixed(2)}`;
}

function _parseDateOnly(v) {
  if (!v) return null;
  const s = String(v || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const da = parseInt(m[3], 10);
    const d = new Date(y, mo, da, 0, 0, 0, 0);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function _dateToYmd(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const da = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function _endOfDay(d) {
  if (!d) return null;
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function _tsToDate(x) {
  if (!x) return null;
  if (x?.toDate) return x.toDate();
  const d = new Date(x);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function _auditLog(action, col, docId, before, after) {
  try {
    const { rol, nombre, user_id, usuario } = leerSesion();
    await addDoc(collection(db, "audit_logs"), {
      action,
      col,
      docId: docId || "",
      before: before || null,
      after: after || null,
      ts: new Date(),
      actor: { rol: rol || "", nombre: nombre || "", user_id: user_id || "", usuario: usuario || "" },
    });
  } catch {}
}

// =============================================
// GESTIÓN DE SESIÓN
// =============================================
function guardarSesion(rol, nombre) {
  sessionStorage.setItem("lpm_rol", rol);
  sessionStorage.setItem("lpm_nombre", nombre || "");
  sessionStorage.removeItem("lpm_user_id");
  sessionStorage.removeItem("lpm_usuario");
}
function guardarSesionExt(rol, nombre, extra) {
  guardarSesion(rol, nombre);
  if (extra && extra.user_id) sessionStorage.setItem("lpm_user_id", extra.user_id);
  if (extra && extra.usuario) sessionStorage.setItem("lpm_usuario", extra.usuario);
}
function leerSesion() {
  return {
    rol: sessionStorage.getItem("lpm_rol"),
    nombre: sessionStorage.getItem("lpm_nombre"),
    user_id: sessionStorage.getItem("lpm_user_id"),
    usuario: sessionStorage.getItem("lpm_usuario"),
  };
}
function borrarSesion() {
  sessionStorage.removeItem("lpm_rol");
  sessionStorage.removeItem("lpm_nombre");
  sessionStorage.removeItem("lpm_user_id");
  sessionStorage.removeItem("lpm_usuario");
}

// =============================================
// NOTIFICACIONES (MENSAJE FLASH)
// =============================================
function mostrarMensaje(texto, tipo="ok") {
  const el = document.getElementById("mensaje");
  if (!el) return;
  el.textContent = texto; el.className = `visible ${tipo}`;
  clearTimeout(window._msgTimer);
  window._msgTimer = setTimeout(() => el.classList.remove("visible"), 3000);
}
window.mostrarMensaje = mostrarMensaje;

function _stockClearForm() {
  const ids = ["codigo-barras","nombre","prod-categoria","prod-proveedor","stock","precio-venta","precio-compra","rec-packs","rec-upp","rec-unitcode"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  }
  const cb = document.getElementById("codigo-barras");
  if (cb) cb.dataset.foundId = "";
  _stockSetMsg("", "");
  _recSetMsg("", "");
  const pm = document.getElementById("pack-mode");
  if (pm) pm.checked = false;
  const sec = document.getElementById("rec-section");
  if (sec) sec.style.display = "none";
  const rm = document.getElementById("rec-master");
  if (rm) rm.value = "";
  const sl = document.getElementById("stock-label");
  if (sl) sl.textContent = "Stock inicial *";
  const stockEl = document.getElementById("stock");
  if (stockEl) {
    stockEl.placeholder = "50";
    try { stockEl.min = "0"; } catch {}
  }
  const ab = document.getElementById("stock-actual-box");
  if (ab) ab.style.display = "none";
  const sa = document.getElementById("stock-actual");
  if (sa) sa.textContent = "—";
  try { document.getElementById("codigo-barras")?.focus?.(); } catch {}
}

window.toggleDtGroup = window.toggleDtGroup || function(groupId) {
  try {
    const grp = document.getElementById(groupId);
    if (!grp) return;
    const isOpen = grp.classList.contains("open");
    document.querySelectorAll(".dt-group").forEach(g => g.classList.remove("open"));
    if (!isOpen) grp.classList.add("open");
  } catch {}
};

window.selDt = window.selDt || function(tabId, btnId, titulo, groupId) {
  try {
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".dt-drop-item").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".dt-group").forEach(g => g.classList.remove("active-group", "open"));
    document.querySelectorAll(".sidebar-btn").forEach(b => b.classList.remove("active"));
    const panel = document.getElementById(tabId);
    if (panel) panel.classList.add("active");
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add("active");
    const grp = document.getElementById(groupId);
    if (grp) grp.classList.add("active-group");
    const sbId = String(btnId || "").replace("dt-", "sb-");
    const sb = document.getElementById(sbId);
    if (sb) sb.classList.add("active");
    const seccion = document.getElementById("seccion-activa");
    if (seccion) seccion.textContent = titulo || "";
  } catch {}
};

function _updateLowStockBanner() {
  const card = document.getElementById("v-low-stock-card");
  const list = document.getElementById("v-alertas-stock");
  if (!card || !list) return;
  if (rolActual !== "vendedor") {
    card.style.display = "none";
    return;
  }
  const bajos = (todosLosProductos || []).filter(p => _toNum(p.stock) <= 5).sort((a, b) => _toNum(a.stock) - _toNum(b.stock));
  if (!bajos.length) {
    card.style.display = "none";
    return;
  }
  list.innerHTML = bajos.map(p => {
    const nm = String(p.nombre || "").trim() || "Producto";
    const s = _toNum(p.stock);
    const cls = s <= 0 ? "badge-empty" : "badge-low";
    return `<div style="display:flex;justify-content:space-between;padding:7px 11px;border-bottom:1px dashed #fca5a5;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">
      <span style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:78%;">${nm}</span>
      <span class="badge-stock ${cls}">${s}</span>
    </div>`;
  }).join("");
  card.style.display = "block";
}

try { localStorage.setItem("scan_autofocus", "0"); } catch {}

const _OFFLINE_QUEUE_KEY = "offline_sales_queue_v1";
const _OFFLINE_FAILED_KEY = "offline_sales_failed_v1";
const _OFFLINE_SYNC = { running: false, lastAt: 0 };

function _offlineLoad() {
  try {
    const raw = localStorage.getItem(_OFFLINE_QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function _offlineSave(arr) {
  try {
    localStorage.setItem(_OFFLINE_QUEUE_KEY, JSON.stringify(arr || []));
  } catch {}
}

function _offlineFailPush(item, err) {
  try {
    const raw = localStorage.getItem(_OFFLINE_FAILED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const out = Array.isArray(arr) ? arr : [];
    out.push({ ...item, failedAt: Date.now(), err: String(err || "") });
    while (out.length > 200) out.shift();
    localStorage.setItem(_OFFLINE_FAILED_KEY, JSON.stringify(out));
  } catch {}
}

function _offlineEnqueue(code, meta) {
  if (rolActual !== "vendedor") return;
  const codigo = sanitizeScanCode(code);
  if (!codigo) return;
  const arr = _offlineLoad();
  const last = arr[arr.length - 1];
  if (last && last.codigo === codigo && (Date.now() - (last.at || 0)) < 1000) return;
  const item = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    codigo,
    at: Date.now(),
    source: meta?.source || "",
    rol: rolActual || "",
    vendedor: nombreVendedor || "Admin",
    usuario: leerSesion()?.usuario || "",
  };
  arr.push(item);
  while (arr.length > 300) arr.shift();
  _offlineSave(arr);
}

function _shouldQueueError(e) {
  if (!navigator.onLine) return true;
  const code = String(e?.code || "").toLowerCase();
  const msg = String(e?.message || "").toLowerCase();
  if (code.includes("unavailable") || msg.includes("unavailable")) return true;
  if (msg.includes("network") || msg.includes("failed to fetch")) return true;
  return false;
}

async function _offlineFlush(force) {
  if (_OFFLINE_SYNC.running) return;
  if (rolActual !== "vendedor") return;
  if (!navigator.onLine) return;
  if (!force && (Date.now() - _OFFLINE_SYNC.lastAt) < 5000) return;
  const arr = _offlineLoad();
  if (!arr.length) return;
  _OFFLINE_SYNC.running = true;
  _OFFLINE_SYNC.lastAt = Date.now();
  try {
    mostrarMensaje(`📡 Enviando ${arr.length} venta(s) pendientes...`, "warning");
    while (arr.length) {
      if (!navigator.onLine) break;
      const it = arr[0];
      try {
        const ok = await procesarCodigo(it.codigo, { source: it.source || "offline", offlineReplay: true, throwOnError: true, vendedor: it.vendedor, rol: it.rol });
        arr.shift();
        _offlineSave(arr);
        if (!ok) continue;
      } catch (e) {
        if (_shouldQueueError(e)) break;
        _offlineFailPush(it, e?.code || e?.message || e);
        arr.shift();
        _offlineSave(arr);
      }
    }
    if (!arr.length) mostrarMensaje("✅ Ventas pendientes enviadas", "ok");
  } finally {
    _OFFLINE_SYNC.running = false;
  }
}

function _pushRuntimeError(kind, err) {
  try {
    const raw = localStorage.getItem("runtime_errors");
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ ts: new Date().toISOString(), kind, err: String(err || "") });
    while (arr.length > 50) arr.shift();
    localStorage.setItem("runtime_errors", JSON.stringify(arr));
  } catch {}
}

window.addEventListener("error", (e) => {
  _pushRuntimeError("error", e?.message || e?.error || "unknown");
});

window.addEventListener("unhandledrejection", (e) => {
  _pushRuntimeError("rejection", e?.reason || "unknown");
});

// =============================================
// AUTENTICACIÓN
// =============================================
window.ejecutarLogin = async function() {
  const user = document.getElementById("login-user").value.trim();
  const pass = document.getElementById("login-pass").value.trim();
  const errDiv = document.getElementById("login-error");
  if (errDiv) errDiv.style.display = "none";

  if (user.toLowerCase() === ADMIN_USER.toLowerCase() && pass === ADMIN_PASS) {
    guardarSesionExt("admin", "Admin", { user_id: "admin", usuario: "Admin" });
    activarAdmin();
    return;
  }

  try {
    const snap = await getDocs(query(collection(db,"vendedores"), where("usuario","==",user), where("password","==",pass)));
    if (!snap.empty) {
      const docId = snap.docs[0].id;
      const v = snap.docs[0].data();
      guardarSesionExt("vendedor", v.nombre, { user_id: docId, usuario: v.usuario || user });
      activarVendedor(v.nombre);
      return;
    }
  } catch(e) { console.error("Error Login:", e); }

  if (errDiv) {
    errDiv.textContent = "❌ Usuario o contraseña incorrectos";
    errDiv.style.display = "block";
  }
};

function activarAdmin() {
  rolActual = "admin";
  document.getElementById("login-screen").style.display  = "none";
  document.getElementById("vendedor-screen").style.display = "none";
  document.getElementById("admin-screen").style.display  = "block";
  iniciarListeners();
  try { _fiadaInitReportUi("a"); } catch {}
  try {
    const pm = document.getElementById("pack-mode");
    const sec = document.getElementById("rec-section");
    if (pm && sec) {
      const sync = () => { sec.style.display = pm.checked ? "block" : "none"; };
      pm.onchange = sync;
      sync();
    }
  } catch {}
  try { localStorage.setItem("outside_queue_enabled", "0"); } catch {}
  try { localStorage.setItem("bg_scanner_enabled", "0"); } catch {}
  try { _bgStopStream?.(); } catch {}
  setTimeout(() => {
    try {
      const s = _loadAdminTab();
      if (s?.tabId && s?.btnId && s?.titulo && s?.groupId && typeof window.selDt === "function") {
        window.selDt(s.tabId, s.btnId, s.titulo, s.groupId);
      } else if (s?.tabId && s?.sbBtnId && s?.titulo && typeof window.cambiarTabSidebar === "function") {
        window.cambiarTabSidebar(s.tabId, s.sbBtnId, s.titulo);
      }
    } catch {}
  }, 120);
}

function activarVendedor(nombre) {
  rolActual = "vendedor";
  nombreVendedor = nombre;
  document.getElementById("login-screen").style.display    = "none";
  document.getElementById("admin-screen").style.display    = "none";
  document.getElementById("vendedor-screen").style.display = "block";
  const badge = document.getElementById("vendedor-nombre-badge");
  if (badge) badge.textContent = nombre.toUpperCase();
  if (scannerInput) scannerInput.focus();
  iniciarListeners();
  try { _fiadaInitReportUi("v"); } catch {}
  if (window._impAfterLogin) window._impAfterLogin();
  _offlineFlush(true);
  try { localStorage.setItem("scan_autofocus", "0"); } catch {}
  try { localStorage.setItem("scan_clean_inputs", "0"); } catch {}
  try { localStorage.setItem("scan_debug", "0"); } catch {}
  try { localStorage.setItem("outside_queue_enabled", "1"); } catch {}
  try { localStorage.setItem("bg_scanner_enabled", "0"); } catch {}
  try { _bgStopStream?.(); } catch {}
  try { _outsideDrainNow?.(); } catch {}
  setTimeout(() => {
    try {
      const tab = _loadVendedorTab();
      if (!tab) return;
      const panel = document.getElementById(tab);
      if (!panel) return;
      const btn = document.querySelector(`#vendedor-screen .tab-btn[onclick*="'${tab}'"]`);
      window.cambiarTabVendedor(tab, btn || null);
    } catch {}
  }, 120);
}

window.cerrarSesion = function() {
  borrarSesion();
  rolActual = null;
  try { bufferEscaner = ""; } catch {}
  try { if (timerEscaner) clearTimeout(timerEscaner); } catch {}
  try { timerEscaner = null; } catch {}
  try { _resetScanTiming?.(); } catch {}
  document.getElementById("vendedor-screen").style.display = "none";
  document.getElementById("admin-screen").style.display    = "none";
  document.getElementById("login-screen").style.display    = "flex";
  document.getElementById("login-user").value = "";
  document.getElementById("login-pass").value = "";
};

window.addEventListener("online", () => { try { _offlineFlush(true); } catch {} });
setInterval(() => { try { _offlineFlush(false); } catch {} }, 8000);

(function() {
  const { rol, nombre } = leerSesion();
  if (rol === "admin") { activarAdmin(); }
  else if (rol === "vendedor" && nombre) { activarVendedor(nombre); }
})();

// =============================================
// NAVEGACIÓN Y TABS
// =============================================
window.abrirSidebar = function() {
  document.getElementById("sidebar-menu").style.left = "0";
  document.getElementById("sidebar-overlay").style.display = "block";
};
window.cerrarSidebar = function() {
  document.getElementById("sidebar-menu").style.left = "-280px";
  document.getElementById("sidebar-overlay").style.display = "none";
};
window.cambiarTabSidebar = function(tabId, btnId, titulo) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".sidebar-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".dt-drop-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".dt-group").forEach(g => g.classList.remove("active-group","open"));
  document.getElementById(tabId).classList.add("active");
  document.getElementById(btnId).classList.add("active");
  
  const dtId = btnId.replace("sb-", "dt-");
  const dtEl = document.getElementById(dtId);
  if (dtEl) {
    dtEl.classList.add("active");
    const grp = dtEl.closest(".dt-group");
    if (grp) grp.classList.add("active-group");
  }
  const seccion = document.getElementById("seccion-activa");
  if (seccion) seccion.textContent = titulo;
  if (rolActual === "admin") {
    _saveAdminTab({ tabId, sbBtnId: btnId, titulo });
  }
  cerrarSidebar();
  if (tabId === "tab-agregar") {
    const el = document.getElementById("codigo-barras");
    if (el) setTimeout(() => { try { el.focus(); } catch {} }, 100);
    else if (scannerInput) setTimeout(() => scannerInput.focus(), 100);
  } else if (scannerInput) setTimeout(() => scannerInput.focus(), 100);
  if (window._impOnTab) window._impOnTab(tabId);
  if (rolActual === "admin") {
    if (tabId === "tab-ganancias") setTimeout(() => { try { window.gananciasCalcular?.(); } catch {} }, 80);
    if (tabId === "tab-movimientos") setTimeout(() => { try { window.movActualizar?.(); } catch {} }, 80);
  }
};

window.toggleDtGroup = function(groupId) {
  const grp = document.getElementById(groupId);
  if (!grp) return;
  const isOpen = grp.classList.contains("open");
  document.querySelectorAll(".dt-group").forEach(g => g.classList.remove("open"));
  if (!isOpen) grp.classList.add("open");
};

document.addEventListener("click", e => {
  if (!e.target.closest(".dt-group")) {
    document.querySelectorAll(".dt-group").forEach(g => g.classList.remove("open"));
  }
});

window.selDt = function(tabId, btnId, titulo, groupId) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".dt-drop-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".dt-group").forEach(g => { g.classList.remove("active-group","open"); });
  document.querySelectorAll(".sidebar-btn").forEach(b => b.classList.remove("active"));
  
  document.getElementById(tabId).classList.add("active");
  document.getElementById(btnId).classList.add("active");
  document.getElementById(groupId).classList.add("active-group");
  
  const sbId = btnId.replace("dt-", "sb-");
  const sbEl = document.getElementById(sbId);
  if (sbEl) sbEl.classList.add("active");
  
  const seccion = document.getElementById("seccion-activa");
  if (seccion) seccion.textContent = titulo;
  if (rolActual === "admin") {
    _saveAdminTab({ tabId, btnId, titulo, groupId });
  }
  if (tabId === "tab-agregar") {
    const el = document.getElementById("codigo-barras");
    if (el) setTimeout(() => { try { el.focus(); } catch {} }, 100);
    else if (scannerInput) setTimeout(() => scannerInput.focus(), 100);
  } else if (scannerInput) setTimeout(() => scannerInput.focus(), 100);
  if (window._impOnTab) window._impOnTab(tabId);
  if (rolActual === "admin") {
    if (tabId === "tab-ganancias") setTimeout(() => { try { window.gananciasCalcular?.(); } catch {} }, 80);
    if (tabId === "tab-movimientos") setTimeout(() => { try { window.movActualizar?.(); } catch {} }, 80);
  }
  if (tabId === "tab-etiquetas" && (!todosLosProductos || !todosLosProductos.length) && typeof window._cargarProductosOnce === "function") {
    window._cargarProductosOnce();
  }
};

window.cerrarModal = function(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove("active");
  const isAdminAgregar = (rolActual === "admin" && document.getElementById("tab-agregar")?.classList?.contains("active") === true);
  if (isAdminAgregar) {
    const el = document.getElementById("codigo-barras");
    if (el) setTimeout(() => { try { el.focus(); } catch {} }, 100);
    else if (scannerInput) setTimeout(() => scannerInput.focus(), 100);
  } else if (scannerInput) setTimeout(() => scannerInput.focus(), 100);
};

// =============================================
// LISTENERS DE FIRESTORE
// =============================================
function iniciarListeners() {
  if (listenersIniciados) return;
  listenersIniciados = true;

  const productosRef = collection(db, "productos");
  const cargarProductosOnce = async () => {
    try {
      const snap = await getDocs(productosRef);
      todosLosProductos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _rebuildProductoIndex();
      actualizarUIAdmin();
      if (typeof window._finRenderAll === "function") window._finRenderAll();
    } catch {
      mostrarMensaje("⚠️ No se pudieron cargar productos (red/firewall)", "warning");
    }
  };
  window._cargarProductosOnce = cargarProductosOnce;

  onSnapshot(
    productosRef,
    snap => {
      todosLosProductos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _rebuildProductoIndex();
      actualizarUIAdmin();
      if (typeof window._finRenderAll === "function") window._finRenderAll();
      _updateLowStockBanner();
      _drainPendingScans();
    },
    () => {
      cargarProductosOnce();
    }
  );

  onSnapshot(collection(db,"ventas"), snap => {
    todasLasVentas = snap.docs.map(d => {
      const x = d.data() || {};
      const cantidad = _toNum(x.cantidad) || 1;
      const unit = _toNum(x.precio_unitario) || _toNum(x.precio);
      const total = _toNum(x.total) || (_toNum(x.precio) || (unit * cantidad));
      const precioCompat = total || _toNum(x.precio) || (unit * cantidad);
      return { ...x, cantidad, precio_unitario: unit || _toNum(x.precio_unitario), total, precio: precioCompat };
    });
    actualizarUIVentas();
  });

  if (!window._dayTick) {
    window._dayKey = new Date().toDateString();
    window._dayTick = setInterval(() => {
      const k = new Date().toDateString();
      if (k === window._dayKey) return;
      window._dayKey = k;
      actualizarUIVentas();
      _updateLowStockBanner();
    }, 60_000);
  }

  cargarClientesFiados();
  cargarFiadasDia();

  onSnapshot(collection(db,"vendedores"), snap => {
    const lista = snap.docs.map(d => ({id:d.id,...d.data()}));
    todosLosVendedores = lista;
    renderizarVendedores(lista);
    try {
      const sel = document.getElementById("afiada-rep-vendedor");
      if (sel) {
        const cur = String(sel.value || "");
        const opts = ['<option value="">Todos</option>'].concat(
          (todosLosVendedores || []).slice().sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" }))
            .map(v => `<option value="${String(v.id || "")}">${String(v.nombre || "—")}</option>`)
        );
        sel.innerHTML = opts.join("");
        try { sel.value = cur; } catch {}
      }
    } catch {}
  });

  onSnapshot(collection(db, "fin_categorias"), snap => {
    todasLasCategorias = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof window._finRenderAll === "function") window._finRenderAll();
  });

  onSnapshot(collection(db, "fin_proveedores"), snap => {
    todosLosProveedores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof window._finRenderAll === "function") window._finRenderAll();
  });
}

function renderizarVendedores(lista) {
  const div = document.getElementById("lista-vendedores");
  if (!div) return;
  if (!lista.length) {
    div.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:14px;font-size:0.9rem;">Sin vendedores</div>`;
    return;
  }
  div.innerHTML = lista.map(v => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);">
      <div style="min-width:0;">
        <div style="font-weight:900;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${v.nombre}</div>
        <div style="color:var(--muted);font-size:0.85rem;">@${v.usuario}</div>
      </div>
      <button class="btn btn-danger" style="padding:8px 10px;font-size:0.82rem;" onclick="eliminarVendedor('${v.id}','${String(v.nombre).replace(/'/g,"\\'")}')">Eliminar</button>
    </div>
  `).join("");
}

window.crearVendedor = async function() {
  const nombre = document.getElementById("v-nombre")?.value?.trim() || "";
  const usuario = document.getElementById("v-user")?.value?.trim() || "";
  const pass = document.getElementById("v-pass")?.value || "";
  if (!nombre || !usuario || !pass) return mostrarMensaje("⚠️ Completa todos los campos", "warning");
  if (usuario.toLowerCase() === ADMIN_USER.toLowerCase()) return mostrarMensaje("⚠️ Usuario reservado", "error");
  try {
    const snap = await getDocs(query(collection(db, "vendedores"), where("usuario", "==", usuario)));
    if (!snap.empty) return mostrarMensaje("⚠️ El usuario ya existe", "warning");
    await addDoc(collection(db, "vendedores"), { nombre, usuario, password: pass, creadoEn: new Date() });
    mostrarMensaje("✅ Vendedor creado", "ok");
    ["v-nombre", "v-user", "v-pass"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  } catch (e) {
    mostrarMensaje("❌ Error creando vendedor", "error");
  }
};

window.eliminarVendedor = async function(id, nombre) {
  if (!confirm(`¿Eliminar vendedor "${nombre}"?`)) return;
  try {
    await deleteDoc(doc(db, "vendedores", id));
    mostrarMensaje("🗑 Vendedor eliminado", "warning");
  } catch (e) {
    mostrarMensaje("❌ Error al eliminar", "error");
  }
};

// =============================================
// INVENTARIO
// =============================================
function actualizarUIAdmin() {
  const sp = document.getElementById("stat-productos");
  if (sp) sp.textContent = todosLosProductos.length;
  
  const bajo = todosLosProductos.filter(p=>p.stock>0 && p.stock<=5).length;
  const sbs = document.getElementById("stat-bajo-stock");
  if (sbs) sbs.textContent = bajo;
  
  renderizarListaEtiquetas();

  const bajos = todosLosProductos.filter(p=>p.stock<=5);
  const alertDiv = document.getElementById("alertas-stock");
  if (alertDiv) {
    alertDiv.innerHTML = bajos.length===0
      ? `<div style="text-align:center;color:#aaa;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;padding:20px;">Todo bien ✅</div>`
      : bajos.map(p=>`<div style="display:flex;justify-content:space-between;padding:7px 11px;border-bottom:1px dashed #fca5a5;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">
          <span style="font-weight:600;">${p.nombre}</span>
          <span class="badge-stock ${p.stock<=0?'badge-empty':'badge-low'}">${p.stock}</span>
        </div>`).join("");
  }

  const buscador = document.getElementById("buscador");
  const busq = buscador ? buscador.value.toLowerCase() : "";
  renderizarTabla(busq ? todosLosProductos.filter(p=>p.nombre.toLowerCase().includes(busq)||p.codigo.toLowerCase().includes(busq)) : todosLosProductos);
}

window.filtrarInventario = function() {
  actualizarUIAdmin();
};

function renderizarTabla(prods) {
  const inv = document.getElementById("inventario");
  if (!inv) return;
  if (!prods.length) { 
    inv.innerHTML=`<tr><td colspan="6" style="text-align:center;color:#aaa;padding:24px;font-family:'IBM Plex Mono',monospace;">Sin resultados</td></tr>`; 
    return; 
  }
  inv.innerHTML = prods.map(p => {
    const bc = p.stock<=0?"badge-empty":p.stock<=5?"badge-low":"badge-ok";
    const n  = p.nombre.replace(/'/g,"\\'");
    const pv = _precioVenta(p);
    const pc = _precioCompra(p);
    return `<tr>
      <td style="font-weight:600;">${p.nombre}</td>
      <td class="mono" style="font-size:0.76rem;color:#555;">${p.codigo}</td>
      <td><span class="badge-stock ${bc}">${p.stock}</span></td>
      <td class="mono" style="font-weight:900;color:var(--green);">S/ ${pv.toFixed(2)}</td>
      <td class="mono" style="font-weight:900;color:#475569;">S/ ${pc.toFixed(2)}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap;">
        <button onclick="abrirEdicion('${p.id}')" class="btn btn-edit">✏️</button>
        <button onclick="eliminarProducto('${p.id}','${n}')" class="btn btn-danger">🗑</button>
      </td>
    </tr>`;
  }).join("");
}

function renderizarListaEtiquetas() {
  const div = document.getElementById("etq-lista-productos");
  if (!div) return;
  if (!todosLosProductos.length) {
    div.innerHTML = `<div style="text-align:center;color:#94a3b8;padding:14px;">No hay productos</div>`;
    return;
  }
  const tamOpts = `
    <option value="25x10">25×10 mm</option>
    <option value="30x20" selected>30×20 mm</option>
    <option value="50x30">50×30 mm</option>
    <option value="60x40">60×40 mm</option>`;
  div.innerHTML = todosLosProductos.map((p, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);${i % 2 ? "background:rgba(99,102,241,.03);" : ""}">
      <input type="checkbox" class="etq-check" data-id="${p.id}" style="width:16px;height:16px;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.nombre}</div>
        <div style="color:var(--muted);font-size:0.85rem;" class="mono">${p.codigo}</div>
      </div>
      <input type="number" class="etq-cant input-field" data-id="${p.id}" value="1" min="1" max="99" style="width:86px;">
      <select class="etq-tam input-field" data-id="${p.id}" style="width:140px;">${tamOpts}</select>
    </div>
  `).join("");
}

window.seleccionarTodosEtq = function(checked) {
  document.querySelectorAll(".etq-check").forEach(cb => { cb.checked = checked; });
};

window.generarEtiquetas = async function() {
  const checks = document.querySelectorAll(".etq-check:checked");
  if (!checks.length) return mostrarMensaje("⚠️ Selecciona al menos un producto", "warning");
  const tipo = document.getElementById("etq-tipo")?.value || "qr";
  const cols = parseInt(document.getElementById("etq-cols")?.value || "5", 10) || 5;
  const items = [];
  checks.forEach(cb => {
    const id = cb.dataset.id;
    const prod = todosLosProductos.find(p => p.id === id);
    if (!prod) return;
    const cant = parseInt(document.querySelector(`.etq-cant[data-id="${id}"]`)?.value || "1", 10) || 1;
    const tam = document.querySelector(`.etq-tam[data-id="${id}"]`)?.value || "30x20";
    for (let i = 0; i < cant; i++) items.push({ ...prod, tam });
  });

  const prev = document.getElementById("preview-etiquetas");
  const printDiv = document.getElementById("etiquetas-print");
  if (!prev || !printDiv) return;

  const PX_PER_MM = 96 / 25.4;
  function parseTamMm(tam) {
    const s = String(tam || "30x20");
    const m = s.match(/^(\d+)\s*x\s*(\d+)$/i);
    const w = m ? parseInt(m[1], 10) : 30;
    const h = m ? parseInt(m[2], 10) : 20;
    return { wmm: w > 0 ? w : 30, hmm: h > 0 ? h : 20 };
  }
  function mmToPx(mm) { return Math.round(mm * PX_PER_MM); }

  prev.style.display = "flex";
  prev.style.flexWrap = "wrap";
  prev.style.alignItems = "flex-start";
  prev.style.gap = "8px";
  prev.innerHTML = "";
  printDiv.innerHTML = "";

  const grouped = new Map();
  for (const p of items) {
    const key = String(p.tam || "30x20");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(p);
  }

  async function buildCodeImageHtml(codigo, tipo, targetPx) {
    const code = String(codigo || "").trim();
    if (!code) return "";
    if (tipo === "qr") {
      try {
        const tmp = document.createElement("div");
        tmp.style.cssText = "position:absolute;left:-9999px;top:-9999px;";
        document.body.appendChild(tmp);
        new QRCode(tmp, { text: code, width: targetPx, height: targetPx, correctLevel: QRCode.CorrectLevel.M });
        let src = "";
        for (let i = 0; i < 4; i++) {
          await new Promise(r => setTimeout(r, 80));
          const qrImg = tmp.querySelector("img") || tmp.querySelector("canvas");
          src = qrImg ? (qrImg.src || qrImg.toDataURL?.() || "") : "";
          if (src) break;
        }
        document.body.removeChild(tmp);
        if (!src) return "";
        return `<img src="${src}" style="width:${targetPx}px;height:${targetPx}px;display:block;margin:2px auto;">`;
      } catch {
        return "";
      }
    }
    try {
      const bcCanvas = document.createElement("canvas");
      JsBarcode(bcCanvas, code, { format: "CODE128", width: 1, height: Math.min(targetPx, 32), displayValue: false, margin: 0 });
      return `<img src="${bcCanvas.toDataURL()}" style="max-width:100%;height:${Math.min(targetPx, 32)}px;display:block;margin:2px auto;">`;
    } catch {
      return "";
    }
  }

  for (const [tamKey, groupItems] of grouped.entries()) {
    const { wmm, hmm } = parseTamMm(tamKey);
    const wpx = mmToPx(wmm);
    const hpx = mmToPx(hmm);
    const codePx = Math.max(24, Math.min(hpx - 18, wpx - 18));

    const page = document.createElement("div");
    page.style.cssText = "page-break-after:always;padding:6mm;";
    const grid = document.createElement("div");
    grid.className = "etq-grid";
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols}, ${wmm}mm);gap:2mm;align-content:start;justify-content:start;`;
    page.appendChild(grid);
    printDiv.appendChild(page);

    for (const p of groupItems) {
      const codigo = String(p.codigo || "").trim();
      const nombre = String(p.nombre || "").trim();
      const precio = _precioVenta(p);
      const imgHtml = await buildCodeImageHtml(codigo, tipo, codePx);
      const html = `
        <div style="font-size:12px;font-weight:900;line-height:1.2;margin-bottom:2px;overflow:hidden;max-height:2.6em;">${nombre}</div>
        ${imgHtml || `<div class="mono" style="font-size:11px;color:#64748b;margin:4px 0;">${codigo}</div>`}
        <div style="font-size:10px;color:#475569;" class="mono">${codigo}</div>
        <div style="font-size:12px;font-weight:900;">S/ ${precio.toFixed(2)}</div>
      `;

      const box = document.createElement("div");
      box.style.cssText = `background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:8px;text-align:center;width:${wpx}px;min-height:${hpx}px;display:flex;flex-direction:column;align-items:center;justify-content:center;`;
      box.innerHTML = html;
      prev.appendChild(box);

      const item = document.createElement("div");
      item.className = "etq-item";
      item.style.cssText = `width:${wmm}mm;min-height:${hmm}mm;padding:1mm;`;
      item.innerHTML = html;
      grid.appendChild(item);
    }
  }

  mostrarMensaje(`✅ ${items.length} etiquetas generadas`, "ok");
};

window.imprimirEtiquetas = function() {
  const grid = document.querySelector("#etiquetas-print .etq-grid");
  if (!grid || !grid.children.length) return mostrarMensaje("⚠️ Primero genera las etiquetas", "warning");
  window.print();
};

function _stockSetMsg(texto, tipo) {
  const box = document.getElementById("stock-scan-msg");
  if (!box) return;
  if (!texto) { box.style.display = "none"; box.textContent = ""; return; }
  box.style.display = "block";
  box.textContent = texto;
  box.style.borderColor = tipo === "error" ? "#ef4444" : (tipo === "ok" ? "#16a34a" : "var(--border)");
  box.style.color = tipo === "error" ? "#991b1b" : (tipo === "ok" ? "#065f46" : "#444");
  box.style.background = tipo === "error" ? "#fee2e2" : (tipo === "ok" ? "#d1fae5" : "var(--paper)");
}

function _stockFindProductByCode(code) {
  const variantes = buildScanVariants(code);
  for (const v of variantes) {
    const hit = _productoIndex.get(v);
    if (hit && hit.id) return hit;
  }
  const list = Array.isArray(todosLosProductos) ? todosLosProductos : [];
  for (const v of variantes) {
    const hit = list.find(p => String(p?.codigo || "") === String(v));
    if (hit && hit.id) return hit;
  }
  return null;
}

function _recSetMsg(texto, tipo) {
  const box = document.getElementById("rec-msg");
  if (!box) return;
  if (!texto) { box.style.display = "none"; box.textContent = ""; return; }
  box.style.display = "block";
  box.textContent = texto;
  box.style.borderColor = tipo === "error" ? "#ef4444" : (tipo === "ok" ? "#16a34a" : "var(--border)");
  box.style.color = tipo === "error" ? "#991b1b" : (tipo === "ok" ? "#065f46" : "#444");
  box.style.background = tipo === "error" ? "#fee2e2" : (tipo === "ok" ? "#d1fae5" : "var(--paper)");
}

function _genSku() {
  const s = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `SKU-${s.slice(-6)}${r}`;
}

async function _findProductByCodeRemote(code) {
  const vb = validateBarcode(code, { allowLib: true });
  const normalized = vb.ok ? vb.normalized : sanitizeScanCode(code);
  if (!normalized) return null;
  const qy = query(collection(db, "productos"), where("codigo", "==", normalized));
  const snap = await getDocs(qy);
  const d = snap.docs[0];
  if (!d) return null;
  return { id: d.id, ...d.data() };
}

window.recGenerarSku = function() {
  if (rolActual !== "admin") return;
  const el = document.getElementById("rec-unitcode");
  if (!el) return;
  const v = _genSku();
  el.value = v;
  _outsideIgnoreAdd(v);
  _recSetMsg(`SKU generado: ${v}`, "ok");
};

window.recDetectar = async function() {
  if (rolActual !== "admin") return;
  const input = document.getElementById("rec-master");
  const raw = (input?.value || "").trim();
  const cleaned = sanitizeScanCode(raw);
  if (!cleaned) return _recSetMsg("Escanea el código maestro del paquete.", "warning");
  const vb = validateBarcode(cleaned, { allowLib: false });
  if (!vb.ok) return _recSetMsg("Código maestro inválido. Usa EAN-13 / UPC-A / EAN-8.", "error");
  const code = vb.normalized;
  if (input) input.value = code;
  _outsideIgnoreAdd(code);

  const p = _stockFindProductByCode(code) || (await (async () => { try { return await _findProductByCodeRemote(code); } catch { return null; } })());
  if (p && p.pack && typeof p.pack === "object") {
    const upp = _toNum(p.pack.units_per_pack);
    const unitCode = String(p.pack.unit_code || "").trim();
    const uppEl = document.getElementById("rec-upp");
    const ucEl = document.getElementById("rec-unitcode");
    if (uppEl && upp) uppEl.value = String(upp);
    if (ucEl && unitCode && !String(ucEl.value || "").trim()) ucEl.value = unitCode;
    _recSetMsg("Paquete reconocido. Completa y confirma desagregación.", "ok");
  } else {
    _recSetMsg("Paquete no registrado aún. Completa los datos y confirma desagregación.", "warning");
  }
};

window.recConfirmar = async function() {
  if (rolActual !== "admin") return;
  const masterEl = document.getElementById("rec-master");
  const rawMaster = String(masterEl?.value || "").trim();
  const cleaned = sanitizeScanCode(rawMaster);
  const vb = validateBarcode(cleaned, { allowLib: false });
  if (!vb.ok) return _recSetMsg("Código maestro inválido (EAN/UPC).", "error");
  const master = vb.normalized;
  if (masterEl) masterEl.value = master;

  const nombre = String(document.getElementById("nombre")?.value || "").trim();
  const categoria = String(document.getElementById("prod-categoria")?.value || "").trim();
  const proveedor = String(document.getElementById("prod-proveedor")?.value || "").trim();
  const pv = _toNum(document.getElementById("precio-venta")?.value || 0);
  const pc = _toNum(document.getElementById("precio-compra")?.value || 0);
  const packs = Math.max(0, parseInt(document.getElementById("rec-packs")?.value || "0", 10) || 0);
  const upp = Math.max(0, parseInt(document.getElementById("rec-upp")?.value || "0", 10) || 0);
  let unitCode = sanitizeScanCode(String(document.getElementById("rec-unitcode")?.value || "").trim());

  if (!nombre) return _recSetMsg("Falta el nombre del producto (unidad).", "error");
  if (!Number.isFinite(pv) || pv <= 0) return _recSetMsg("Precio venta inválido.", "error");
  if (!Number.isFinite(pc) || pc < 0) return _recSetMsg("Precio compra inválido.", "error");
  if (!packs || packs <= 0) return _recSetMsg("Paquetes recibidos inválido.", "error");
  if (!upp || upp <= 0) return _recSetMsg("Unidades por paquete inválido.", "error");

  if (unitCode) {
    const vbu = validateBarcode(unitCode, { allowLib: true });
    if (!vbu.ok) return _recSetMsg("Código unidad inválido (EAN/UPC) o SKU/LIB.", "error");
    unitCode = vbu.normalized;
  } else {
    unitCode = _genSku();
    const uEl = document.getElementById("rec-unitcode");
    if (uEl) uEl.value = unitCode;
  }

  const unitsTotal = packs * upp;
  const { rol, nombre: actorNombre, user_id, usuario } = leerSesion();
  const actor = { rol: rol || "", nombre: actorNombre || "", user_id: user_id || "", usuario: usuario || "" };

  _outsideIgnoreAdd(master);
  _outsideIgnoreAdd(unitCode);
  _recSetMsg("Registrando…", "warning");

  let pkg = _stockFindProductByCode(master);
  let unit = _stockFindProductByCode(unitCode);
  if (!pkg) { try { pkg = await _findProductByCodeRemote(master); } catch {} }
  if (!unit) { try { unit = await _findProductByCodeRemote(unitCode); } catch {} }

  const pkgRef = pkg?.id ? doc(db, "productos", pkg.id) : doc(collection(db, "productos"));
  const unitRef = unit?.id ? doc(db, "productos", unit.id) : doc(collection(db, "productos"));
  const movRef = doc(collection(db, "inventory_movements"));

  let beforePkg = null;
  let beforeUnit = null;
  let afterPkg = null;
  let afterUnit = null;
  const now = new Date();

  try {
    await runTransaction(db, async (tx) => {
      if (pkg?.id) {
        const s = await tx.get(pkgRef);
        beforePkg = s.exists() ? { id: pkgRef.id, ...s.data() } : null;
      }
      if (unit?.id) {
        const s = await tx.get(unitRef);
        beforeUnit = s.exists() ? { id: unitRef.id, ...s.data() } : null;
      }

      const pkgCurStock = _toNum(beforePkg?.stock);
      const unitCurStock = _toNum(beforeUnit?.stock);

      afterPkg = {
        codigo: master,
        nombre: String(beforePkg?.nombre || `Paquete: ${nombre}`).trim(),
        stock: pkgCurStock + packs,
        precio_venta: _toNum(beforePkg?.precio_venta),
        precio_compra: _toNum(beforePkg?.precio_compra),
        precio: _toNum(beforePkg?.precio_venta),
        categoria: categoria || String(beforePkg?.categoria || ""),
        proveedor: proveedor || String(beforePkg?.proveedor || ""),
        unidad: "paq",
        pack: { units_per_pack: upp, unit_code: unitCode, unit_name: nombre }
      };

      afterUnit = {
        codigo: unitCode,
        nombre,
        stock: unitCurStock + unitsTotal,
        precio_venta: pv,
        precio_compra: pc,
        precio: pv,
        categoria,
        proveedor,
        unidad: "und",
        pack: { master_code: master, units_per_pack: upp }
      };

      if (pkg?.id) tx.update(pkgRef, { ...afterPkg, actualizadoEn: now });
      else tx.set(pkgRef, { ...afterPkg, creadoEn: now });

      if (unit?.id) tx.update(unitRef, { ...afterUnit, actualizadoEn: now });
      else tx.set(unitRef, { ...afterUnit, creadoEn: now });

      tx.set(movRef, {
        tipo: "deaggregate_pack",
        master_code: master,
        unit_code: unitCode,
        packs,
        units_per_pack: upp,
        units_total: unitsTotal,
        producto_paquete_id: pkgRef.id,
        producto_unidad_id: unitRef.id,
        fecha_desagregacion: now,
        responsable: actor,
        before: { paquete: beforePkg ? { stock: _toNum(beforePkg.stock) } : null, unidad: beforeUnit ? { stock: _toNum(beforeUnit.stock) } : null },
        after: { paquete: { stock: afterPkg.stock }, unidad: { stock: afterUnit.stock } },
        creadoEn: now
      });
    });

    await _auditLog(pkg?.id ? "update" : "create", "productos", pkgRef.id, beforePkg, { ...(beforePkg || {}), ...afterPkg });
    await _auditLog(unit?.id ? "update" : "create", "productos", unitRef.id, beforeUnit, { ...(beforeUnit || {}), ...afterUnit });
    await _auditLog("create", "inventory_movements", movRef.id, null, { master_code: master, unit_code: unitCode, packs, units_total: unitsTotal });

    mostrarMensaje(`✅ Desagregado: ${packs} paquete(s) → ${unitsTotal} und.`, "ok");
    _stockClearForm();
  } catch (e) {
    _recSetMsg("❌ Error registrando desagregación. Reintenta.", "error");
  }
};

const _camScan = { stream: null, running: false, targetId: "codigo-barras", detector: null, last: "", lastAt: 0, busy: false };

function _camEl(id) { return document.getElementById(id); }

function _camSetStatus(text, type) {
  const el = _camEl("cam-status");
  if (!el) return;
  if (!text) { el.style.display = "none"; el.textContent = ""; return; }
  el.style.display = "block";
  el.textContent = text;
  el.style.borderColor = type === "error" ? "#ef4444" : (type === "ok" ? "#16a34a" : "var(--border)");
  el.style.color = type === "error" ? "#991b1b" : (type === "ok" ? "#065f46" : "#444");
  el.style.background = type === "error" ? "#fee2e2" : (type === "ok" ? "#d1fae5" : "var(--paper)");
}

function _camOpenModal(open) {
  const modal = _camEl("cam-modal");
  if (!modal) return;
  if (open) modal.classList.add("active");
  else modal.classList.remove("active");
}

function _camStopStream() {
  try { _camScan.stream?.getTracks?.().forEach(t => { try { t.stop(); } catch {} }); } catch {}
  _camScan.stream = null;
  const v = _camEl("cam-video");
  if (v) { try { v.srcObject = null; } catch {} }
}

function _camApplyToTarget(code) {
  const id = String(_camScan.targetId || "codigo-barras");
  const el = document.getElementById(id);
  if (el) el.value = code;
  if (id === "codigo-barras") {
    try { window.stockBuscarCodigo(code); } catch {}
    return;
  }
  if (id === "rec-master") {
    try { window.recDetectar(); } catch {}
    return;
  }
}

async function _camEnsureDetector() {
  if (_camScan.detector) return _camScan.detector;
  if (typeof window.BarcodeDetector !== "function") return null;
  try {
    const formats = ["ean_13", "ean_8", "upc_a", "code_128", "qr_code"];
    _camScan.detector = new window.BarcodeDetector({ formats });
    return _camScan.detector;
  } catch {
    return null;
  }
}

async function _camLoop() {
  if (!_camScan.running) return;
  if (_camScan.busy) return;
  _camScan.busy = true;
  try {
    const det = await _camEnsureDetector();
    const v = _camEl("cam-video");
    if (!det || !v) {
      _camSetStatus("Tu navegador no soporta BarcodeDetector. Usa Chrome (Android) o Safari reciente, o escanea con lector físico.", "warning");
      return;
    }
    const hits = await det.detect(v);
    if (Array.isArray(hits) && hits.length) {
      const raw = String(hits[0]?.rawValue || "").trim();
      const cleaned = sanitizeScanCode(raw);
      const vb = validateBarcode(cleaned, { allowLib: true });
      if (!vb.ok) {
        _camSetStatus("Código no válido (EAN/UPC o LIB-). Intenta de nuevo.", "warning");
      } else {
        const code = vb.normalized;
        if (_camScan.last === code && (Date.now() - _camScan.lastAt) < 1500) return;
        _camScan.last = code;
        _camScan.lastAt = Date.now();
        _camSetStatus(`✅ Detectado: ${code}`, "ok");
        _camApplyToTarget(code);
        window.camScanStop();
        return;
      }
    }
  } catch {
    _camSetStatus("No se pudo leer. Revisa permisos de cámara.", "error");
  } finally {
    _camScan.busy = false;
    if (_camScan.running) setTimeout(_camLoop, 220);
  }
}

window.camScanStart = async function(targetId) {
  if (rolActual !== "admin") return;
  if (targetId) _camScan.targetId = String(targetId);
  else {
    const ae = document.activeElement;
    const id = String(ae?.id || "");
    if (id === "codigo-barras" || id === "rec-unitcode" || id === "rec-packs" || id === "rec-upp") _camScan.targetId = id;
    else _camScan.targetId = "codigo-barras";
  }
  _camSetStatus("Iniciando cámara…", "warning");
  _camOpenModal(true);
  try {
    const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    _camScan.stream = media;
    const v = _camEl("cam-video");
    if (v) {
      v.srcObject = media;
      try { await v.play(); } catch {}
    }
    _camScan.running = true;
    _camSetStatus("Apunta al código…", "warning");
    setTimeout(_camLoop, 120);
  } catch {
    _camSetStatus("Permiso denegado o no hay cámara disponible.", "error");
  }
};

window.camScanStop = function() {
  _camScan.running = false;
  _camStopStream();
  _camOpenModal(false);
};

window.stockBuscarCodigo = function(arg) {
  if (rolActual !== "admin") return;
  const input = document.getElementById("codigo-barras");
  const raw = (typeof arg === "string" ? arg : (input?.value || "")).trim();
  const cleaned = sanitizeScanCode(raw);
  if (!cleaned) { _stockSetMsg("", ""); return; }
  const vb = validateBarcode(cleaned, { allowLib: true });
  if (!vb.ok) {
    _stockSetMsg("Código inválido. Usa EAN-13, UPC-A, EAN-8 (checksum válido) o LIB-.", "error");
    if (input) input.dataset.foundId = "";
    return;
  }
  const code = vb.normalized;
  if (input) input.value = code;
  if (rolActual === "admin") _outsideIgnoreAdd(code);
  try {
    const pm = document.getElementById("pack-mode");
    const isPack = pm && pm.checked;
    const rm = document.getElementById("rec-master");
    if (isPack && rm) rm.value = code;
    if (isPack) setTimeout(() => { try { window.recDetectar?.(); } catch {} }, 30);
  } catch {}
  const p = _stockFindProductByCode(code);
  const idEl = document.getElementById("nombre");
  const catEl = document.getElementById("prod-categoria");
  const provEl = document.getElementById("prod-proveedor");
  const stockEl = document.getElementById("stock");
  const stockLbl = document.getElementById("stock-label");
  const stockActBox = document.getElementById("stock-actual-box");
  const stockAct = document.getElementById("stock-actual");
  const pvEl = document.getElementById("precio-venta");
  const pcEl = document.getElementById("precio-compra");
  if (p) {
    if (input) input.dataset.foundId = p.id;
    if (idEl) idEl.value = String(p.nombre || "");
    if (catEl) catEl.value = String(p.categoria || "");
    if (provEl) provEl.value = String(p.proveedor || "");
    if (pvEl) pvEl.value = String(_precioVenta(p));
    if (pcEl) pcEl.value = String(_precioCompra(p));
    if (stockLbl) stockLbl.textContent = "Cantidad a agregar *";
    if (stockActBox) stockActBox.style.display = "block";
    if (stockAct) stockAct.textContent = String(_toNum(p.stock));
    if (stockEl) {
      stockEl.value = "";
      stockEl.placeholder = "Ej: 1";
      try { stockEl.min = "1"; } catch {}
    }
    _stockSetMsg(`Producto encontrado: "${String(p.nombre || "Producto")}". Ingresa cantidad para sumar y guarda.`, "ok");
  } else {
    if (input) input.dataset.foundId = "";
    if (stockLbl) stockLbl.textContent = "Stock inicial *";
    if (stockActBox) stockActBox.style.display = "none";
    if (stockAct) stockAct.textContent = "—";
    if (stockEl) {
      stockEl.placeholder = "50";
      try { stockEl.min = "0"; } catch {}
    }
    _stockSetMsg("No encontrado. Completa los datos y presiona Guardar para registrarlo.", "warning");
  }
};

window.stockConfigLookup = function() {
  if (rolActual !== "admin") return;
  const cur = getBarcodeLookupConfig();
  const p = prompt("Proveedor (openfoodfacts o custom):", String(cur.provider || "openfoodfacts"));
  if (!p) return;
  const provider = String(p).trim().toLowerCase();
  if (provider !== "openfoodfacts" && provider !== "custom") return mostrarMensaje("⚠️ Proveedor inválido", "warning");
  let customUrlTemplate = String(cur.customUrlTemplate || "");
  if (provider === "custom") {
    const tpl = prompt("URL template (usa {code}):", customUrlTemplate || "https://example.com/api?barcode={code}");
    if (!tpl) return;
    customUrlTemplate = String(tpl || "").trim();
    if (!customUrlTemplate.includes("{code}")) return mostrarMensaje("⚠️ La URL debe incluir {code}", "warning");
  }
  setBarcodeLookupConfig({ provider, customUrlTemplate });
  mostrarMensaje("✅ Configuración guardada", "ok");
};

window.stockBuscarOnline = async function() {
  if (rolActual !== "admin") return;
  const input = document.getElementById("codigo-barras");
  const raw = (input?.value || "").trim();
  const cleaned = sanitizeScanCode(raw);
  if (!cleaned) return _stockSetMsg("Escanea un código primero.", "warning");
  const vb = validateBarcode(cleaned, { allowLib: false });
  if (!vb.ok) return _stockSetMsg("Para Internet usa EAN-13 / UPC-A / EAN-8 (solo dígitos).", "warning");
  const digits = String(vb.normalized || "");
  const existing = _stockFindProductByCode(digits);
  if (existing) return _stockSetMsg("Ya existe en tu sistema. Usa “Buscar” para cargarlo.", "ok");
  const cfg = getBarcodeLookupConfig();
  _stockSetMsg("Buscando en Internet…", "warning");
  const r = await lookupBarcodeOnline(digits, cfg);
  if (!r.ok) {
    _stockSetMsg("No se encontró información online para este código.", "warning");
    return;
  }
  const nm = String(r.name || "").trim();
  const brand = String(r.brand || "").trim();
  const cat = String(r.category || "").trim();
  const nameEl = document.getElementById("nombre");
  const provEl = document.getElementById("prod-proveedor");
  const catEl = document.getElementById("prod-categoria");
  if (input) input.value = digits;
  if (nameEl && (!String(nameEl.value || "").trim())) nameEl.value = nm;
  if (provEl && (!String(provEl.value || "").trim()) && brand) provEl.value = brand;
  if (catEl && (!String(catEl.value || "").trim()) && cat) catEl.value = cat.split(",")[0].trim();
  _outsideIgnoreAdd(digits);
  _stockSetMsg(`Encontrado online: ${nm || "—"}. Revisa/ajusta y guarda.`, "ok");
};

window.agregarProducto = async function() {
  const codigoEl = document.getElementById("codigo-barras");
  const codigoRaw = (codigoEl?.value || "").trim();
  const nombre=document.getElementById("nombre").value.trim();
  const categoria = document.getElementById("prod-categoria")?.value?.trim() || "";
  const proveedor = document.getElementById("prod-proveedor")?.value?.trim() || "";
  const stock=parseInt(document.getElementById("stock").value);
  const precioVenta=parseFloat(document.getElementById("precio-venta").value);
  const precioCompra=parseFloat(document.getElementById("precio-compra").value);

  let codigo = sanitizeScanCode(codigoRaw);
  if (codigo) {
    const vb = validateBarcode(codigo, { allowLib: true });
    if (!vb.ok) { mostrarMensaje("⚠️ Código de barras inválido (EAN/UPC) o LIB-", "error"); _stockSetMsg("Código inválido. Verifica el escaneo.", "error"); return; }
    codigo = vb.normalized;
    if (codigoEl) codigoEl.value = codigo;
  } else {
    codigo = "LIB-" + Date.now().toString().slice(-8);
    if (codigoEl) codigoEl.value = codigo;
  }

  const existing = _stockFindProductByCode(codigo);
  if (existing) {
    if (isNaN(stock) || stock <= 0) { mostrarMensaje("⚠️ Ingresa cantidad (Stock) para sumar", "warning"); return; }
    if (!isNaN(precioVenta) && precioVenta < 0) { mostrarMensaje("⚠️ Precio venta inválido", "error"); return; }
    if (!isNaN(precioCompra) && precioCompra < 0) { mostrarMensaje("⚠️ Precio compra inválido", "error"); return; }
    try {
      const prodRef = doc(db, "productos", existing.id);
      let before = null;
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(prodRef);
        if (!snap.exists()) throw new Error("NOT_FOUND");
        before = { id: existing.id, ...snap.data() };
        const cur = snap.data() || {};
        const curStock = _toNum(cur.stock);
        const afterStock = Number.isFinite(curStock) ? (curStock + stock) : (stock);
        const updates = { stock: afterStock };
        if (nombre) updates.nombre = nombre;
        if (categoria) updates.categoria = categoria;
        if (proveedor) updates.proveedor = proveedor;
        if (Number.isFinite(precioVenta)) { updates.precio_venta = precioVenta; updates.precio = precioVenta; }
        if (Number.isFinite(precioCompra)) updates.precio_compra = precioCompra;
        tx.update(prodRef, updates);
      });
      await _auditLog("update", "productos", existing.id, before, { ...(before || {}), stock: (_toNum(before?.stock) + stock), nombre: (nombre || before?.nombre), categoria: (categoria || before?.categoria), proveedor: (proveedor || before?.proveedor), precio_venta: (Number.isFinite(precioVenta) ? precioVenta : before?.precio_venta), precio_compra: (Number.isFinite(precioCompra) ? precioCompra : before?.precio_compra) });
      mostrarMensaje(`✅ Stock actualizado: +${stock}`, "ok");
      _stockSetMsg(`Actualizado: +${stock} al stock de "${String(existing.nombre || "Producto")}".`, "ok");
      _stockClearForm();
      return;
    } catch (e) {
      mostrarMensaje("❌ Error actualizando stock", "error");
      _stockSetMsg("Error actualizando. Reintenta.", "error");
      return;
    }
  }

  if(!nombre){mostrarMensaje("⚠️ Falta el nombre","error");return;}
  if(isNaN(stock)||stock<0){mostrarMensaje("⚠️ Stock inválido","error");return;}
  if(isNaN(precioVenta)||precioVenta<0){mostrarMensaje("⚠️ Precio venta inválido","error");return;}
  if(!isNaN(precioCompra) && precioCompra<0){mostrarMensaje("⚠️ Precio compra inválido","error");return;}
  try{
    const precio_compra = Number.isFinite(precioCompra) ? precioCompra : 0;
    const precio_venta = precioVenta;
    await addDoc(collection(db,"productos"),{codigo,nombre,stock,precio_venta,precio_compra,precio:precio_venta,categoria,proveedor,creadoEn:new Date()});
    mostrarMensaje(`✅ "${nombre}" agregado`,"ok");
    _stockSetMsg(`Registrado: "${nombre}" (${codigo})`, "ok");
    _stockClearForm();
  }catch(e){mostrarMensaje("❌ Error: "+e.message,"error");}
};

window.guardarRegistroStock = async function() {
  if (rolActual !== "admin") return;
  const pm = document.getElementById("pack-mode");
  const isPack = pm && pm.checked;
  if (!isPack) return window.agregarProducto();
  const codigoEl = document.getElementById("codigo-barras");
  const raw = (codigoEl?.value || "").trim();
  const cleaned = sanitizeScanCode(raw);
  const vb = validateBarcode(cleaned, { allowLib: false });
  if (!vb.ok) { _recSetMsg("Código maestro inválido. Usa EAN-13 / UPC-A / EAN-8.", "error"); return; }
  const rm = document.getElementById("rec-master");
  if (rm) rm.value = vb.normalized;
  const sec = document.getElementById("rec-section");
  if (sec) sec.style.display = "block";
  return window.recConfirmar();
};

window.abrirEdicion = function(id){
  const p = (todosLosProductos || []).find(x => x?.id === id) || null;
  if (!p) return mostrarMensaje("⚠️ Producto no encontrado", "warning");
  document.getElementById("edit-id").value    =id;
  document.getElementById("edit-nombre").value=String(p.nombre || "");
  document.getElementById("edit-categoria").value=String(p.categoria || "");
  document.getElementById("edit-proveedor").value=String(p.proveedor || "");
  document.getElementById("edit-stock").value =_toNum(p.stock);
  document.getElementById("edit-precio-venta").value=_precioVenta(p);
  document.getElementById("edit-precio-compra").value=_precioCompra(p);
  const modal = document.getElementById("modal-editar");
  if (modal) modal.classList.add("active");
};

window.guardarEdicion = async function(){
  const id    = document.getElementById("edit-id").value;
  const nombre= document.getElementById("edit-nombre").value.trim();
  const categoria = document.getElementById("edit-categoria")?.value?.trim() || "";
  const proveedor = document.getElementById("edit-proveedor")?.value?.trim() || "";
  const stock = parseInt(document.getElementById("edit-stock").value);
  const precioVenta= parseFloat(document.getElementById("edit-precio-venta").value);
  const precioCompra= parseFloat(document.getElementById("edit-precio-compra").value);
  if(!nombre || isNaN(stock) || isNaN(precioVenta)){
    mostrarMensaje("⚠️ Completa todos los campos correctamente", "error");
    return;
  }
  if(!isNaN(precioCompra) && precioCompra < 0) return mostrarMensaje("⚠️ Precio compra inválido", "error");
  try {
    const precio_compra = Number.isFinite(precioCompra) ? precioCompra : 0;
    const precio_venta = precioVenta;
    await updateDoc(doc(db, "productos", id), { nombre, categoria, proveedor, stock, precio_venta, precio_compra, precio: precio_venta });
    mostrarMensaje("✅ Producto actualizado", "ok");
    cerrarModal("modal-editar");
  } catch (e) {
    mostrarMensaje("❌ Error al guardar cambios", "error");
  }
};

window.eliminarProducto = async function(id, nombre){
  if(!confirm(`¿Estás seguro de eliminar "${nombre}"?`)) return;
  try {
    await deleteDoc(doc(db, "productos", id));
    mostrarMensaje(`🗑 "${nombre}" ha sido eliminado`, "warning");
  } catch (e) {
    mostrarMensaje("❌ Error al eliminar", "error");
  }
};

// =============================================
// IMPORTAR / EXPORTAR EXCEL
// =============================================
window.importarExcel = async function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const wb   = XLSX.read(e.target.result, {type:"binary"});
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      if (!rows.length) { mostrarMensaje("⚠️ El archivo está vacío","error"); return; }
      const prev = document.getElementById("excel-preview");
      if (prev) {
        prev.innerHTML = `<div style="font-family:'IBM Plex Mono',monospace;font-size:0.78rem;color:#555;margin-bottom:8px;">✅ ${rows.length} productos encontrados.</div>
        <button onclick="confirmarImportacion()" class="btn btn-primary" style="margin-right:8px;">✅ Importar</button>
        <button onclick="cancelarImportacion()" class="btn">✕ Cancelar</button>`;
      }
      window._excelRows = rows;
    } catch(err) { mostrarMensaje("❌ Error leyendo Excel: "+err.message,"error"); }
  };
  reader.readAsBinaryString(file);
};

window.confirmarImportacion = async function() {
  const rows = window._excelRows;
  if (!rows) return;
  mostrarMensaje("⏳ Importando...","warning");
  let ok=0;
  for (const row of rows) {
    const lower = {};
    try {
      for (const [k, v] of Object.entries(row || {})) lower[String(k || "").trim().toLowerCase()] = v;
    } catch {}
    const nombre = String(lower["nombre"] ?? "").trim();
    const stock  = parseInt(lower["stock"] ?? 0);
    const categoria = String(lower["categoría"] ?? lower["categoria"] ?? lower["category"] ?? "").trim();
    const proveedor = String(lower["proveedor"] ?? lower["supplier"] ?? "").trim();
    const precioVenta = parseFloat(
      lower["precio venta"] ?? lower["precio_venta"] ?? lower["precio-venta"] ??
      lower["venta"] ?? lower["precio"] ?? lower["precio s/"] ?? 0
    );
    const precioCompra = parseFloat(
      lower["precio compra"] ?? lower["precio_compra"] ?? lower["precio-compra"] ??
      lower["compra"] ?? 0
    );
    if (!nombre) continue;
    try {
      const precio_compra = Number.isFinite(precioCompra) ? precioCompra : 0;
      const precio_venta = Number.isFinite(precioVenta) ? precioVenta : 0;
      await addDoc(collection(db,"productos"),{codigo:"LIB-"+Date.now().toString().slice(-8),nombre,stock,precio_venta,precio_compra,precio:precio_venta,categoria,proveedor,creadoEn:new Date()});
      ok++;
    } catch(e) {}
  }
  mostrarMensaje(`✅ ${ok} productos importados`,"ok");
  window._excelRows=null;
  document.getElementById("excel-preview").innerHTML="";
};

window.cancelarImportacion = function() {
  window._excelRows=null;
  document.getElementById("excel-preview").innerHTML="";
};

window.descargarPlantilla = function() {
  const ws = XLSX.utils.json_to_sheet([{Nombre:"Producto Ejemplo", Categoría:"Útiles", Proveedor:"Distribuidora X", Stock:10, "Precio Venta":5.00, "Precio Compra":3.20}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
  XLSX.writeFile(wb, "plantilla_productos.xlsx");
};

function _brandInfo() {
  const nombre = "Librería Virgen de la Puerta";
  let logoUrl = "";
  try { logoUrl = new URL("virgen.png", window.location.href).toString(); } catch { logoUrl = "virgen.png"; }
  return { nombre, logoUrl };
}

function _mkReportBook(opts) {
  const b = _brandInfo();
  const title = String(opts?.title || "").trim() || "Reporte";
  const subtitle = String(opts?.subtitle || "").trim();
  const dataRows = Array.isArray(opts?.dataRows) ? opts.dataRows : [];
  const columns = Array.isArray(opts?.columns) ? opts.columns : [];
  const statsRows = Array.isArray(opts?.statsRows) ? opts.statsRows : [];
  const sheetName = String(opts?.sheetName || "Reporte");

  const aoa = [
    [b.nombre, "", "", ""],
    [title, "", "", ""],
    [subtitle, "", "", ""],
    ["Logo", b.logoUrl, "", ""],
    ["", "", "", ""],
    ["Estadísticas", "", "", ""],
    ...statsRows.map(r => [String(r?.k || ""), r?.v ?? "", "", ""]),
    ["", "", "", ""],
    ["Datos", "", "", ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  try {
    if (b.logoUrl) ws["B4"] = { f: `HYPERLINK("${b.logoUrl}","Abrir logo")` };
  } catch {}
  XLSX.utils.sheet_add_json(ws, dataRows, { origin: "A11" });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  if (columns.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(columns), "Columnas");
  return wb;
}

window.exportarExcel = function(){
  const datos = (todosLosProductos || []).map(p => ({
    Nombre: p.nombre,
    Categoría: p.categoria || "",
    Proveedor: p.proveedor || "",
    Stock: _toNum(p.stock),
    "Precio Venta": _precioVenta(p),
    "Precio Compra": _precioCompra(p)
  }));
  const wb = _mkReportBook({
    title: "Reporte de inventario",
    subtitle: "Listado de productos del sistema",
    dataRows: datos,
    columns: [
      { Columna: "Nombre", Descripción: "Nombre del producto." },
      { Columna: "Categoría", Descripción: "Categoría del producto." },
      { Columna: "Proveedor", Descripción: "Proveedor/marca/distribuidor (según registro)." },
      { Columna: "Stock", Descripción: "Stock actual." },
      { Columna: "Precio Venta", Descripción: "Precio de venta (S/)." },
      { Columna: "Precio Compra", Descripción: "Costo/precio compra (S/)." }
    ],
    statsRows: [
      { k: "Productos", v: datos.length }
    ],
    sheetName: "Inventario"
  });
  XLSX.writeFile(wb, `inventario_${new Date().toLocaleDateString("es-PE").replace(/\//g,"-")}.xlsx`);
};

window.exportarHistorialExcel = function() {
  const desde = document.getElementById("filtro-desde")?.value || "";
  const hasta = document.getElementById("filtro-hasta")?.value || "";
  const from = desde ? new Date(desde + "T00:00:00") : null;
  const to = hasta ? new Date(hasta + "T23:59:59") : null;
  const built = buildVentasExport(todasLasVentas, { from, to });
  const sub = [
    from ? `Desde: ${_dateToYmd(from)}` : "Desde: —",
    to ? `Hasta: ${_dateToYmd(to)}` : "Hasta: —"
  ].join("  |  ");
  const wb = _mkReportBook({
    title: "Reporte de ventas",
    subtitle: sub,
    dataRows: built.rows,
    columns: built.columns,
    statsRows: [
      { k: "Ventas", v: built.stats.ventas },
      { k: "Unidades", v: built.stats.unidades },
      { k: "Total", v: Number(built.stats.total || 0).toFixed(2) },
      { k: "Ticket prom.", v: Number(built.stats.ticketPromedio || 0).toFixed(2) }
    ],
    sheetName: "Ventas"
  });
  XLSX.writeFile(wb, `ventas_${new Date().toLocaleDateString("es-PE").replace(/\//g,"-")}.xlsx`);
};

window.exportarHistorialPDF = function() {
  const desde = document.getElementById("filtro-desde")?.value || "";
  const hasta = document.getElementById("filtro-hasta")?.value || "";
  const from = desde ? new Date(desde + "T00:00:00") : null;
  const to = hasta ? new Date(hasta + "T23:59:59") : null;
  const built = buildVentasExport(todasLasVentas, { from, to });
  const b = _brandInfo();
  const w = window.open("", "_blank");
  if (!w) return mostrarMensaje("⚠️ Permite ventanas emergentes", "warning");
  const title = "Reporte de ventas";
  const subtitle = [
    from ? `Desde: ${_dateToYmd(from)}` : "Desde: —",
    to ? `Hasta: ${_dateToYmd(to)}` : "Hasta: —"
  ].join("  |  ");
  const head = `<meta charset="utf-8"><title>${title}</title>
    <style>
      :root{--g:#10b981;--b:#111827;--m:#6b7280;--bd:#e5e7eb;}
      body{font-family:Arial, sans-serif; padding:22px; color:var(--b);}
      .hdr{display:flex;align-items:center;gap:12px;margin-bottom:10px;}
      .logo{width:40px;height:40px;object-fit:contain;border-radius:10px;border:1px solid var(--bd);padding:6px;background:#fff;}
      h1{font-size:18px;margin:0;}
      .sub{color:var(--m);font-size:12px;margin-top:2px;}
      .box{border:1px solid var(--bd);padding:12px;border-radius:12px;margin:10px 0;}
      .k{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px;}
      .k .box{margin:0;}
      .k .v{font-size:16px;font-weight:900;}
      table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px;}
      th,td{border:1px solid var(--bd);padding:6px;text-align:left;vertical-align:top;}
      th{background:#f9fafb;font-weight:900;}
      .mono{font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;}
      .right{text-align:right;}
      .small{font-size:11px;color:var(--m);}
    </style>`;
  const stats = `
    <div class="k">
      <div class="box"><div class="small">Ventas</div><div class="v">${built.stats.ventas}</div></div>
      <div class="box"><div class="small">Unidades</div><div class="v">${built.stats.unidades}</div></div>
      <div class="box"><div class="small">Total</div><div class="v" style="color:var(--g);">S/ ${Number(built.stats.total||0).toFixed(2)}</div></div>
      <div class="box"><div class="small">Ticket prom.</div><div class="v">S/ ${Number(built.stats.ticketPromedio||0).toFixed(2)}</div></div>
    </div>
  `;
  const cols = `
    <div class="box">
      <div style="font-weight:900;margin-bottom:6px;">Descripción de columnas</div>
      ${(built.columns || []).map(c => `<div class="small"><span class="mono">${c.Columna}:</span> ${c.Descripción}</div>`).join("")}
    </div>
  `;
  const rowsHtml = (built.rows || []).map(r => `
    <tr>
      <td class="mono">${r.Fecha} ${r.Hora}</td>
      <td>${r.Producto}</td>
      <td class="mono right">${Number(r.Cantidad||0).toLocaleString()}</td>
      <td class="mono right">S/ ${Number(r["Precio unitario"]||0).toFixed(2)}</td>
      <td class="mono right">S/ ${Number(r.Total||0).toFixed(2)}</td>
    </tr>
  `).join("");
  const body = `
    <div class="hdr">
      <img class="logo" src="${b.logoUrl}" onerror="this.style.display='none'">
      <div>
        <div style="font-weight:900;">${b.nombre}</div>
        <h1>${title}</h1>
        <div class="sub">${subtitle}</div>
      </div>
    </div>
    ${stats}
    ${cols}
    <div class="box">
      <div style="font-weight:900;margin-bottom:6px;">Detalle</div>
      <table>
        <thead><tr><th>Fecha/Hora</th><th>Producto</th><th class="right">Cant</th><th class="right">Precio unit.</th><th class="right">Total</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="5" style="text-align:center;color:#999;padding:14px;">Sin datos</td></tr>`}</tbody>
      </table>
    </div>
  `;
  w.document.open();
  w.document.write(`<html><head>${head}</head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch {} }, 300);
};

// =============================================
// VENTAS Y HISTORIAL
// =============================================
function actualizarUIVentas() {
  const ahora = new Date();
  const hoyIni = new Date(ahora); hoyIni.setHours(0,0,0,0);
  
  const ventasHoy = todasLasVentas.filter(v=>{
    const f=v.fecha?.toDate ? v.fecha.toDate() : new Date(v.fecha);
    return f >= hoyIni;
  });
  const totalHoy = ventasHoy.reduce((s,v)=>s+(_toNum(v.total) || _toNum(v.precio) || (_toNum(v.precio_unitario)*(_toNum(v.cantidad)||1))),0);

  const svh = document.getElementById("stat-ventas-hoy");
  const sth = document.getElementById("stat-total-hoy");
  if(svh) svh.textContent = ventasHoy.length;
  if(sth) sth.textContent = `S/${totalHoy.toFixed(2)}`;

  const vvh = document.getElementById("v-ventas-hoy");
  const vth = document.getElementById("v-total-hoy");
  if(vvh) vvh.textContent = ventasHoy.length;
  if(vth) vth.textContent = `S/${totalHoy.toFixed(2)}`;

  _renderCajaAdmin(ahora, ventasHoy, totalHoy);
  _renderVentasDelDia(ventasHoy);
  renderizarHistorial(todasLasVentas);
}

function _renderCajaAdmin(ahora, ventasHoy, totalHoy) {
  const elCajaHoy = document.getElementById("caja-hoy");
  const elCajaHoyCount = document.getElementById("caja-hoy-count");
  if (elCajaHoy) elCajaHoy.textContent = `S/ ${Number(totalHoy || 0).toFixed(2)}`;
  if (elCajaHoyCount) elCajaHoyCount.textContent = `${ventasHoy.length} ventas hoy`;

  const mesIni = new Date(ahora.getFullYear(), ahora.getMonth(), 1, 0, 0, 0, 0);
  const ventasMes = (todasLasVentas || []).filter(v => {
    const f = v.fecha?.toDate ? v.fecha.toDate() : new Date(v.fecha);
    return f >= mesIni;
  });
  const totalMes = ventasMes.reduce((s, v) => s + (_toNum(v.total) || _toNum(v.precio) || (_toNum(v.precio_unitario) * (_toNum(v.cantidad) || 1))), 0);
  const elCajaMes = document.getElementById("caja-mes");
  const elCajaMesCount = document.getElementById("caja-mes-count");
  if (elCajaMes) elCajaMes.textContent = `S/ ${Number(totalMes || 0).toFixed(2)}`;
  if (elCajaMesCount) elCajaMesCount.textContent = `${ventasMes.length} ventas este mes`;

  const sem = document.getElementById("resumen-semana");
  if (sem) {
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(ahora);
      d.setDate(ahora.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const k = _dateToYmd(d);
      days.push({ d, k });
    }
    const byDay = new Map(days.map(x => [x.k, { k: x.k, d: x.d, cant: 0, total: 0 }]));
    for (const v of (todasLasVentas || [])) {
      const f = v.fecha?.toDate ? v.fecha.toDate() : new Date(v.fecha);
      const d = new Date(f.getFullYear(), f.getMonth(), f.getDate(), 0, 0, 0, 0);
      const k = _dateToYmd(d);
      const cur = byDay.get(k);
      if (!cur) continue;
      const cant = _toNum(v.cantidad) || 1;
      const monto = _toNum(v.total) || _toNum(v.precio) || (_toNum(v.precio_unitario) * cant);
      cur.cant += cant;
      cur.total += Number(monto || 0);
      byDay.set(k, cur);
    }
    const rows = days.map(x => byDay.get(x.k)).filter(Boolean).map(x => {
      const lbl = x.d.toLocaleDateString("es-PE", { weekday: "short" });
      return `<div class="hist-row" style="grid-template-columns:1fr .7fr;">
        <span style="font-weight:800;">${lbl}</span>
        <span style="text-align:right;color:var(--green);font-weight:900;">S/ ${Number(x.total || 0).toFixed(2)}</span>
      </div>`;
    }).join("");
    sem.innerHTML = rows || `<div style="text-align:center;color:#aaa;padding:12px;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">Sin datos</div>`;
  }

  const top = document.getElementById("top-productos");
  if (top) {
    const map = new Map();
    for (const v of ventasMes) {
      const key = String(v.codigo || v.nombre || "").trim() || "SIN_CODIGO";
      const prev = map.get(key) || { nombre: v.nombre || "", codigo: v.codigo || "", cant: 0, total: 0 };
      const cant = _toNum(v.cantidad) || 1;
      const monto = _toNum(v.total) || _toNum(v.precio) || (_toNum(v.precio_unitario) * cant);
      prev.cant += cant;
      prev.total += Number(monto || 0);
      if (!prev.nombre) prev.nombre = v.nombre || "";
      if (!prev.codigo) prev.codigo = v.codigo || "";
      map.set(key, prev);
    }
    const items = [...map.values()].sort((a, b) => (b.total - a.total) || (b.cant - a.cant));
    const rows = items.slice(0, 10).map(x => {
      const label = x.nombre || "Producto";
      return `<div class="hist-row" style="grid-template-columns:2fr .6fr .8fr;">
        <span style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span>
        <span class="mono" style="font-weight:900;text-align:right;">${x.cant}</span>
        <span style="text-align:right;color:var(--green);font-weight:900;">S/ ${Number(x.total || 0).toFixed(2)}</span>
      </div>`;
    }).join("");
    top.innerHTML = rows || `<div style="text-align:center;color:#aaa;padding:12px;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">Sin datos</div>`;
  }
}

function _renderVentasDelDia(ventasHoy) {
  const ord = [...(ventasHoy || [])].sort((a, b) => {
    const fa = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha);
    const fb = b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha);
    return fb - fa;
  });

  const ven = document.getElementById("ventas-vendedor");
  if (ven) {
    if (!ord.length) {
      ven.innerHTML = `<div style="text-align:center;color:#aaa;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;padding:30px;">Sin ventas hoy...</div>`;
    } else {
      const rows = ord.slice(0, 500).map(v => {
        const f = v.fecha?.toDate ? v.fecha.toDate() : new Date(v.fecha);
        const dt = f.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
        const monto = _toNum(v.total) || _toNum(v.precio) || (_toNum(v.precio_unitario) * (_toNum(v.cantidad) || 1));
        const cant = _toNum(v.cantidad) || 1;
        return `<div class="hist-row" style="grid-template-columns:1fr 2fr .6fr .8fr;">
          <span class="mono">${dt}</span>
          <span style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${v.nombre || ""}</span>
          <span class="mono" style="font-weight:900;text-align:right;">${cant}</span>
          <span style="color:var(--green);font-weight:900;text-align:right;">S/ ${Number(monto || 0).toFixed(2)}</span>
        </div>`;
      }).join("");
      ven.innerHTML = `<div class="hist-row hdr" style="grid-template-columns:1fr 2fr .6fr .8fr;">
        <span>Hora</span><span>Producto</span><span style="text-align:right;">Cant</span><span style="text-align:right;">Total</span>
      </div>` + rows + (ord.length > 500 ? `<div style="padding:10px 12px;color:#888;font-size:.8rem;">Mostrando 500 de ${ord.length}</div>` : "");
    }
  }

  const adm = document.getElementById("ventas-admin");
  if (adm) {
    if (!ord.length) {
      adm.innerHTML = `<div style="text-align:center;color:#aaa;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;padding:20px;">Sin ventas hoy...</div>`;
    } else {
      const map = new Map();
      for (const v of ord) {
        const key = String(v.codigo || v.nombre || "").trim() || "SIN_CODIGO";
        const prev = map.get(key) || { nombre: v.nombre || "", codigo: v.codigo || "", cant: 0, total: 0 };
        const cant = _toNum(v.cantidad) || 1;
        const monto = _toNum(v.total) || _toNum(v.precio) || (_toNum(v.precio_unitario) * cant);
        prev.cant += cant;
        prev.total += Number(monto || 0);
        if (!prev.nombre) prev.nombre = v.nombre || "";
        if (!prev.codigo) prev.codigo = v.codigo || "";
        map.set(key, prev);
      }
      const items = [...map.values()].sort((a, b) => b.cant - a.cant);
      const rows = items.slice(0, 300).map(x => {
        const label = x.nombre || "Producto";
        return `<div class="hist-row" style="grid-template-columns:2.2fr .6fr .8fr .4fr;">
          <span style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span>
          <span class="mono" style="font-weight:900;text-align:right;">${x.cant}</span>
          <span style="color:var(--green);font-weight:900;text-align:right;">S/ ${Number(x.total || 0).toFixed(2)}</span>
          <span></span>
        </div>`;
      }).join("");
      adm.innerHTML = `<div class="hist-row hdr" style="grid-template-columns:2.2fr .6fr .8fr .4fr;">
        <span>Producto</span><span style="text-align:right;">Cant</span><span style="text-align:right;">Total</span><span></span>
      </div>` + rows + (items.length > 300 ? `<div style="padding:10px 12px;color:#888;font-size:.8rem;">Mostrando 300 de ${items.length}</div>` : "");
    }
  }
}

function renderizarHistorial(ventas) {
  const lista = document.getElementById("historial-lista");
  if (!lista) return;
  const ord = [...ventas].sort((a,b)=>{
    const fa=a.fecha?.toDate?a.fecha.toDate():new Date(a.fecha);
    const fb=b.fecha?.toDate?b.fecha.toDate():new Date(b.fecha);
    return fb-fa;
  }).slice(0,100);
  lista.innerHTML = ord.map(v=>{
    const f=v.fecha?.toDate?v.fecha.toDate():new Date(v.fecha);
    const dt=f.toLocaleDateString("es-PE")+" "+f.toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"});
    const monto = _toNum(v.total) || _toNum(v.precio) || (_toNum(v.precio_unitario)*(_toNum(v.cantidad)||1));
    return `<div class="hist-row hist-row3"><span>${dt}</span><span style="font-weight:600;">${v.nombre}</span><span style="color:var(--green);font-weight:700;">S/ ${monto.toFixed(2)}</span></div>`;
  }).join("");
}

window.filtrarHistorial = function() {
  const desde=document.getElementById("filtro-desde").value;
  const hasta=document.getElementById("filtro-hasta").value;
  let f=todasLasVentas;
  if (desde) {
    const d = _parseDateOnly(desde);
    if (d) f = f.filter(v => { const t = v.fecha?.toDate ? v.fecha.toDate() : new Date(v.fecha); return t >= d; });
  }
  if (hasta) {
    const h = _endOfDay(_parseDateOnly(hasta));
    if (h) f = f.filter(v => { const t = v.fecha?.toDate ? v.fecha.toDate() : new Date(v.fecha); return t <= h; });
  }
  renderizarHistorial(f);
};

// =============================================
// ESCÁNER (LÓGICA)
// =============================================
let bufferEscaner = "";
let timerEscaner = null;
let lastScanAt = 0;
const SCAN_IDLE_MS = 350;
const SCAN_MIN_LEN = 3;
const SCAN_LIB_MIN_LEN = 12;

let _productoIndex = new Map();
function _scanDebug() { return localStorage.getItem("scan_debug") === "1"; }
let _pendingScans = [];
function _enqueuePendingScan(code, meta) {
  const codigo = sanitizeScanCode(code);
  if (!codigo) return;
  const arr = Array.isArray(_pendingScans) ? _pendingScans : [];
  const last = arr[arr.length - 1];
  if (last && last.codigo === codigo && (Date.now() - (last.at || 0)) < 1000) return;
  arr.push({ codigo, at: Date.now(), meta: meta || {} });
  while (arr.length > 30) arr.shift();
  _pendingScans = arr;
}
async function _drainPendingScans() {
  const arr = Array.isArray(_pendingScans) ? _pendingScans : [];
  if (!arr.length) return;
  _pendingScans = [];
  for (const it of arr) {
    try { await procesarCodigo(it.codigo, it.meta || {}); } catch {}
  }
}
function _rebuildProductoIndex() {
  const m = new Map();
  for (const p of (todosLosProductos || [])) {
    const base = p?.codigo;
    const variants = buildScanVariants(base);
    for (const v of variants) {
      if (!m.has(v)) m.set(v, p);
    }
  }
  _productoIndex = m;
}

const _scanTiming = { source: "", lastTs: 0, deltas: [] };
function _resetScanTiming() { _scanTiming.source = ""; _scanTiming.lastTs = 0; _scanTiming.deltas = []; }
const _scanSteal = { active: false, target: null, typed: "" };
function _resetScanSteal() { _scanSteal.active = false; _scanSteal.target = null; _scanSteal.typed = ""; }
function _removeTypedFromTarget() {
  const t = _scanSteal.target;
  const typed = _scanSteal.typed;
  if (!t || !typed) return;
  const tag = (t.tagName || "").toUpperCase();
  if (tag !== "INPUT" && tag !== "TEXTAREA") return;
  const type = String(t.getAttribute?.("type") || t.type || "").toLowerCase();
  if (type === "password") return;
  const v = String(t.value || "");
  if (v.endsWith(typed)) t.value = v.slice(0, -typed.length);
}

const _scanInputPrev = new WeakMap();
function _looksLikeScanText(cleaned) {
  if (!cleaned) return false;
  if (/^LIB-[0-9A-Z\-]{8,}$/i.test(cleaned)) return true;
  if (/^\d{6,}$/.test(cleaned)) return true;
  const digits = (cleaned.match(/\d/g) || []).length;
  if (digits >= 4 && cleaned.length >= 6) return true;
  return false;
}

function _scanLooksIncomplete(cleaned) {
  const u = String(cleaned || "").toUpperCase();
  if (u.startsWith("LIB-") && u.length < SCAN_LIB_MIN_LEN) return true;
  return false;
}

const _scanAudit = { max: 120 };
function _scanAuditEnabled() { return localStorage.getItem("scan_audit") === "1"; }
function _scanAuditPush(e) {
  if (!_scanAuditEnabled()) return;
  try {
    const raw = localStorage.getItem("scan_audit_log");
    const arr = raw ? JSON.parse(raw) : [];
    arr.push(e);
    while (arr.length > _scanAudit.max) arr.shift();
    localStorage.setItem("scan_audit_log", JSON.stringify(arr));
  } catch {}
}

const _scanDedupe = { code: "", at: 0 };
const SCAN_DEDUPE_MS = 180;
const _outsideWebDedupe = { winMs: 5000, max: 200 };
const _recentWebCodes = new Map();
function _touchRecentWebCode(code) {
  const now = Date.now();
  _recentWebCodes.set(code, now);
  if (_recentWebCodes.size <= _outsideWebDedupe.max) return;
  for (const [k, t] of _recentWebCodes) {
    if ((now - t) > _outsideWebDedupe.winMs || _recentWebCodes.size > _outsideWebDedupe.max) _recentWebCodes.delete(k);
    if (_recentWebCodes.size <= _outsideWebDedupe.max) break;
  }
}

const _outsideIgnoreCfg = { key: "outside_queue_ignore_v1", ttlMs: 24 * 60 * 60 * 1000, max: 800 };
function _outsideIgnoreLoad() {
  try {
    const raw = localStorage.getItem(_outsideIgnoreCfg.key);
    const obj = raw ? JSON.parse(raw) : null;
    const m = new Map();
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        const at = Number(v);
        if (!k) continue;
        if (!Number.isFinite(at)) continue;
        m.set(k, at);
      }
    }
    return m;
  } catch {
    return new Map();
  }
}

function _outsideIgnoreSave(map) {
  try {
    const obj = {};
    for (const [k, at] of map.entries()) obj[k] = at;
    localStorage.setItem(_outsideIgnoreCfg.key, JSON.stringify(obj));
  } catch {}
}

function _outsideIgnorePrune(map) {
  const now = Date.now();
  for (const [k, at] of map.entries()) {
    if (!Number.isFinite(at) || (now - at) > _outsideIgnoreCfg.ttlMs) map.delete(k);
  }
  if (map.size <= _outsideIgnoreCfg.max) return map;
  const entries = Array.from(map.entries()).sort((a, b) => a[1] - b[1]);
  while (entries.length > _outsideIgnoreCfg.max) entries.shift();
  return new Map(entries);
}

function _outsideIgnoreAdd(code) {
  const c = sanitizeScanCode(code);
  if (!c) return;
  const map = _outsideIgnorePrune(_outsideIgnoreLoad());
  const now = Date.now();
  const vs = buildScanVariants(c);
  for (const v of vs) map.set(v, now);
  _outsideIgnoreSave(_outsideIgnorePrune(map));
}

function _outsideIgnoreHas(code) {
  const c = sanitizeScanCode(code);
  if (!c) return false;
  const map = _outsideIgnorePrune(_outsideIgnoreLoad());
  const vs = buildScanVariants(c);
  for (const v of vs) {
    const at = map.get(v);
    if (at && (Date.now() - at) <= _outsideIgnoreCfg.ttlMs) {
      _outsideIgnoreSave(map);
      return true;
    }
  }
  _outsideIgnoreSave(map);
  return false;
}

function setScannerDot(ok, mode) {
  if (rolActual !== "vendedor") return;
  const id = "dot-v";
  const dot = document.getElementById(id);
  if (!dot) return;
  if (!ok) {
    dot.style.background = "#f87171";
    return;
  }
  dot.style.background = mode === "bg" ? "#4ade80" : "#60a5fa";
}

function setBgBadge(visible) {
  const id = rolActual === "vendedor" ? "bg-badge-v" : "bg-badge-a";
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = visible ? "flex" : "none";
}

async function procesarCodigo(codigo, meta) {
  if (rolActual !== "vendedor") return false;

  const source = meta?.source || "";
  const started = performance.now();
  codigo = sanitizeScanCode(codigo);
  if (!codigo) return false;
  if (source === "outside_queue") {
    const t = _recentWebCodes.get(codigo);
    if (t && (Date.now() - t) < _outsideWebDedupe.winMs) return true;
  } else {
    _touchRecentWebCode(codigo);
  }
  if (!meta?.offlineReplay && (!todosLosProductos || !todosLosProductos.length) && (_productoIndex?.size || 0) === 0 && typeof window._cargarProductosOnce === "function" && !meta?._retriedLoad) {
    mostrarMensaje("⏳ Cargando productos... vuelve a escanear en 2s", "warning");
    _enqueuePendingScan(codigo, { ...(meta || {}), _retriedLoad: true });
    try { window._cargarProductosOnce(); } catch {}
    return true;
  }
  if (_scanDebug()) mostrarMensaje("🔍 Escaneado: " + codigo, "ok");
  if (!meta?.offlineReplay && !navigator.onLine) {
    const ms = Math.round(performance.now() - started);
    _offlineEnqueue(codigo, meta);
    _scanAuditPush({ ts: new Date().toISOString(), ok: false, code: codigo, source: source || "offline", rol: rolActual || "", user: nombreVendedor || "Admin", ms, err: "QUEUED_OFFLINE" });
    mostrarMensaje("⏳ Sin internet: venta guardada (se enviará al volver)", "warning");
    return true;
  }
  if (_scanDedupe.code === codigo && (Date.now() - _scanDedupe.at) < SCAN_DEDUPE_MS) return true;
  _scanDedupe.code = codigo;
  _scanDedupe.at = Date.now();
  try {
    const variantes = buildScanVariants(codigo);
    if (_scanDebug()) console.log("scan_variantes", codigo, variantes, { idx: _productoIndex.size });
    let p = null;
    for (const v of variantes) {
      const hit = _productoIndex.get(v);
      if (hit) { p = hit; break; }
    }

    if (!p) {
      const productosCol = collection(db, "productos");
      let docSnap = null;
      for (const s of variantes) {
        const snap = await getDocs(query(productosCol, where("codigo", "==", s)));
        if (!snap.empty) { docSnap = snap.docs[0]; break; }
        if (/^\d+$/.test(s)) {
          const n = Number(s);
          if (Number.isFinite(n)) {
            const snapN = await getDocs(query(productosCol, where("codigo", "==", n)));
            if (!snapN.empty) { docSnap = snapN.docs[0]; break; }
          }
        }
      }
      if (docSnap) p = { id: docSnap.id, ...docSnap.data() };
    }

    if (!p || !p.id) {
      const ms = Math.round(performance.now() - started);
      _scanAuditPush({ ts: new Date().toISOString(), ok: false, code: codigo, source, rol: rolActual || "", user: nombreVendedor || "Admin", ms, err: "NO_ENCONTRADO" });
      const count = Array.isArray(todosLosProductos) ? todosLosProductos.length : 0;
      mostrarMensaje(`❌ No encontrado: ${codigo}${count ? ` (productos cargados: ${count})` : ""}`, "error");
      if (meta?.throwOnError) {
        const err = new Error("NO_ENCONTRADO");
        err.code = "NO_ENCONTRADO";
        throw err;
      }
      return false;
    }

    let _lowStockAfter = null;
    let _soldName = "";
    await runTransaction(db, async (tx) => {
      const prodRef = doc(db, "productos", p.id);
      const snap = await tx.get(prodRef);
      if (!snap.exists()) throw new Error("NOT_FOUND");
      const data = snap.data() || {};
      const stock = Number(data.stock);
      _soldName = String(data.nombre ?? p.nombre ?? "").trim();
      if (Number.isFinite(stock) && stock <= 0) {
        const err = new Error("SIN_STOCK");
        err.code = "SIN_STOCK";
        throw err;
      }
      if (Number.isFinite(stock)) {
        const after = stock - 1;
        _lowStockAfter = after;
        tx.update(prodRef, { stock: after });
      }
      else tx.update(prodRef, { stock: increment(-1) });

      const ventaRef = doc(collection(db, "ventas"));
      const cant = 1;
      const unit = _toNum(data.precio_venta ?? data.precio ?? p.precio_venta ?? p.precio ?? 0);
      const costoUnit = _toNum(data.precio_compra ?? p.precio_compra ?? 0);
      const total = unit * cant;
      tx.set(ventaRef, {
        codigo: data.codigo ?? p.codigo ?? codigo,
        nombre: data.nombre ?? p.nombre ?? "",
        cantidad: cant,
        precio_unitario: unit,
        costo_unitario: costoUnit,
        total,
        precio: total,
        impuesto_monto: 0,
        descuento_monto: 0,
        fecha: new Date(),
        vendedor: meta?.vendedor || nombreVendedor || "Admin",
        rol: meta?.rol || rolActual || "",
        fuente: source || "",
      });
    });

    const ms = Math.round(performance.now() - started);
    _scanAuditPush({ ts: new Date().toISOString(), ok: true, code: codigo, source, rol: rolActual || "", user: nombreVendedor || "Admin", ms });
    if (_scanDebug()) console.log("scan_ok", { code: codigo, ms });
    if (typeof _lowStockAfter === "number" && _lowStockAfter <= 5) {
      const nm = _soldName || (p.nombre || "Producto");
      mostrarMensaje(`⚠️ Stock bajo: ${nm} (${_lowStockAfter} restantes)`, "warning");
      return true;
    }
    mostrarMensaje(`✅ ${(p.nombre || "Venta registrada")} (${ms}ms)`, "ok");
    return true;
  } catch (e) {
    const ms = Math.round(performance.now() - started);
    let msg = "❌ Error registrando venta";
    if (e?.code === "SIN_STOCK" || e?.message === "SIN_STOCK") msg = "⚠️ Sin stock";
    else if (String(e?.message || "") === "NOT_FOUND") msg = "❌ Producto no encontrado";
    else if (String(e?.code || "").includes("permission")) msg = "❌ Sin permisos para registrar ventas";
    else if (String(e?.code || "").includes("unavailable")) msg = "❌ Sin conexión a la base de datos";
    const errStr = String(e?.code || e?.message || e);
    _scanAuditPush({ ts: new Date().toISOString(), ok: false, code: codigo, source, rol: rolActual || "", user: nombreVendedor || "Admin", ms, err: errStr });
    if (!meta?.offlineReplay && _shouldQueueError(e)) {
      _offlineEnqueue(codigo, meta);
      mostrarMensaje("⏳ Sin internet: venta guardada (se enviará al volver)", "warning");
      return true;
    }
    mostrarMensaje(msg, msg.startsWith("⚠️") ? "warning" : "error");
    if (_scanDebug()) console.error("scan_error", e);
    if (meta?.throwOnError) throw e;
    return false;
  }
}

function finalizarEscaneo() {
  const isAdminStock = (rolActual === "admin" && document.getElementById("admin-screen")?.style?.display !== "none" && document.getElementById("tab-agregar")?.classList?.contains("active") === true);
  if (rolActual !== "vendedor" && !isAdminStock) {
    bufferEscaner = "";
    if (scannerInput) scannerInput.value = "";
    if (timerEscaner) clearTimeout(timerEscaner);
    timerEscaner = null;
    _resetScanTiming();
    return;
  }
  const c = bufferEscaner;
  const cleaned = sanitizeScanCode(c);
  const fromScannerFocus = document.activeElement === scannerInput;
  const likelyScan = fromScannerFocus || _scanTiming.source === "input" || _scanTiming.source === "bg" || isLikelyScanByTiming(_scanTiming.deltas);
  if (!cleaned || cleaned.length < SCAN_MIN_LEN) {
    bufferEscaner = "";
    if (scannerInput) scannerInput.value = "";
    if (timerEscaner) clearTimeout(timerEscaner);
    timerEscaner = null;
    _resetScanTiming();
    return;
  }
  if (!likelyScan) {
    bufferEscaner = "";
    if (scannerInput) scannerInput.value = "";
    if (timerEscaner) clearTimeout(timerEscaner);
    timerEscaner = null;
    _resetScanTiming();
    return;
  }
  if (_scanLooksIncomplete(cleaned) && (Date.now() - lastScanAt) < 900) {
    if (timerEscaner) clearTimeout(timerEscaner);
    timerEscaner = setTimeout(() => finalizarEscaneo(), SCAN_IDLE_MS);
    return;
  }

  bufferEscaner = "";
  if (scannerInput) scannerInput.value = "";
  if (timerEscaner) clearTimeout(timerEscaner);
  timerEscaner = null;
  _resetScanTiming();
  if (isAdminStock) {
    window.stockBuscarCodigo(cleaned);
    return;
  }
  procesarCodigo(cleaned, { source: "web" });
}

function alimentarEscaneo(ch, source) {
  const isAdminStock = (rolActual === "admin" && document.getElementById("admin-screen")?.style?.display !== "none" && document.getElementById("tab-agregar")?.classList?.contains("active") === true);
  if (rolActual !== "vendedor" && !isAdminStock) return;
  bufferEscaner += ch;
  const now = Date.now();
  if (!_scanTiming.source) _scanTiming.source = source || "doc";
  if (_scanTiming.lastTs) _scanTiming.deltas.push(now - _scanTiming.lastTs);
  _scanTiming.lastTs = now;
  lastScanAt = now;
  if (rolActual === "vendedor") setScannerDot(true, "local");
  if (timerEscaner) clearTimeout(timerEscaner);
  timerEscaner = setTimeout(() => finalizarEscaneo(), SCAN_IDLE_MS);
}

function shouldForceScannerFocus() {
  if (rolActual !== "vendedor") return false;
  if (localStorage.getItem("scan_autofocus") !== "1") return false;
  if (document.querySelector(".modal-overlay.active")) return false;
  const inLogin = document.getElementById("login-screen")?.style?.display !== "none";
  if (inLogin) return false;
  return document.getElementById("vtab-ventas")?.classList?.contains("active") === true;
}

function isSalesContext() {
  if (rolActual !== "vendedor") return false;
  return document.getElementById("vtab-ventas")?.classList?.contains("active") === true;
}

if (scannerInput) {
  scannerInput.addEventListener("keydown", e => {
    const isAdminStock = (rolActual === "admin" && document.getElementById("admin-screen")?.style?.display !== "none" && document.getElementById("tab-agregar")?.classList?.contains("active") === true);
    if (rolActual !== "vendedor" && !isAdminStock) return;
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      finalizarEscaneo();
      return;
    }
    if (e.key === "Escape") {
      bufferEscaner = "";
      _resetScanTiming();
      scannerInput.value = "";
      return;
    }
    if (e.key && e.key.length === 1) return;
  });

  scannerInput.addEventListener("input", () => {
    const v = String(scannerInput.value || "");
    const cleaned = sanitizeScanCode(v);
    if (cleaned !== v) scannerInput.value = cleaned;
    if (!cleaned || cleaned.length < SCAN_MIN_LEN) return;
    bufferEscaner = cleaned;
    _resetScanTiming();
    _scanTiming.source = "input";
    lastScanAt = Date.now();
    if (timerEscaner) clearTimeout(timerEscaner);
    timerEscaner = setTimeout(() => finalizarEscaneo(), SCAN_IDLE_MS);
  });

  scannerInput.addEventListener("blur", () => {
    if (localStorage.getItem("scan_autofocus") === "1" && shouldForceScannerFocus()) {
      setTimeout(() => { try { scannerInput.focus(); } catch {} }, 80);
    }
  });
}

document.addEventListener("keydown", e => {
  const isAdminStock = (rolActual === "admin" && document.getElementById("admin-screen")?.style?.display !== "none" && document.getElementById("tab-agregar")?.classList?.contains("active") === true);
  if (rolActual !== "vendedor" && !isAdminStock) return;
  const inLogin = document.getElementById("login-screen")?.style?.display !== "none";
  if (inLogin) return;
  const ae = document.activeElement;
  const isScanner = ae === scannerInput;
  const isEditable = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable);
  if (e.key === "Enter" || e.key === "Tab") {
    if (bufferEscaner && isLikelyScanByTiming(_scanTiming.deltas)) {
      e.preventDefault();
      e.stopPropagation();
      finalizarEscaneo();
    } else if (bufferEscaner) {
      bufferEscaner = "";
      if (timerEscaner) clearTimeout(timerEscaner);
      timerEscaner = null;
      _resetScanTiming();
    }
    return;
  }
  if (e.key && e.key.length === 1) {
    if (isEditable && !isScanner) {
      const type = String(ae?.getAttribute?.("type") || ae?.type || "").toLowerCase();
      if (type === "password" || String(ae?.id || "").startsWith("login-")) return;
      const now = Date.now();
      if (_scanTiming.lastTs) _scanTiming.deltas.push(now - _scanTiming.lastTs);
      _scanTiming.lastTs = now;
      _scanTiming.source = "doc";
      bufferEscaner += e.key;
      if (timerEscaner) clearTimeout(timerEscaner);
      timerEscaner = setTimeout(() => finalizarEscaneo(), SCAN_IDLE_MS);
      return;
    }

    alimentarEscaneo(e.key, "doc");
  }
});

document.addEventListener("input", e => {
  const isAdminStock = (rolActual === "admin" && document.getElementById("admin-screen")?.style?.display !== "none" && document.getElementById("tab-agregar")?.classList?.contains("active") === true);
  if (rolActual !== "vendedor" && !isAdminStock) return;
  const inLogin = document.getElementById("login-screen")?.style?.display !== "none";
  if (inLogin) return;
  if (localStorage.getItem("scan_clean_inputs") !== "1") return;
  const t = e.target;
  if (!t || t === scannerInput) return;
  const tag = (t.tagName || "").toUpperCase();
  if (tag !== "INPUT" && tag !== "TEXTAREA") return;
  const type = String(t.getAttribute?.("type") || t.type || "").toLowerCase();
  if (type === "password" || String(t.id || "").startsWith("login-")) return;
  const cur = String(t.value || "");
  const prev = _scanInputPrev.get(t) ?? "";
  _scanInputPrev.set(t, cur);
  if (!cur) return;
  let appended = cur.startsWith(prev) ? cur.slice(prev.length) : cur;
  appended = String(appended || "");
  const cleaned = sanitizeScanCode(appended);
  if (!cleaned || cleaned.length < SCAN_MIN_LEN) return;
  if (!_looksLikeScanText(cleaned)) return;
  if (cur.startsWith(prev)) t.value = prev;
  else t.value = "";
  bufferEscaner = cleaned;
  _resetScanTiming();
  _scanTiming.source = "input";
  finalizarEscaneo();
}, true);

// =============================================
// RICOH MP5055 INTEGRACIÓN
// =============================================
let ricohConfig = { ip: "", port: "3001", community: "public" };
let ricohMonitorInterval = null;
let ricohBaseTotal = null;
let ricohLastTotal = null;
let ricohHistorialData = [];

// Cargar config guardada
(function() {
  try {
    const saved = localStorage.getItem("ricoh_config");
    if (saved) ricohConfig = {...ricohConfig, ...JSON.parse(saved)};
    if (ricohConfig.ip && document.getElementById("ricoh-ip")) document.getElementById("ricoh-ip").value = ricohConfig.ip;
    if (ricohConfig.port && document.getElementById("ricoh-proxy-port")) document.getElementById("ricoh-proxy-port").value = ricohConfig.port;
    if (ricohConfig.community && document.getElementById("ricoh-community")) document.getElementById("ricoh-community").value = ricohConfig.community;
  } catch(e) {}
})();

window.ricohGuardarConfig = function() {
  ricohConfig.ip        = document.getElementById("ricoh-ip").value.trim();
  ricohConfig.port      = document.getElementById("ricoh-proxy-port").value.trim() || "3001";
  ricohConfig.community = document.getElementById("ricoh-community").value.trim() || "public";
  localStorage.setItem("ricoh_config", JSON.stringify(ricohConfig));
  mostrarMensaje("✅ Configuración Ricoh guardada","ok");
};

async function ricohSnmpGet(oid) {
  const { ip, port, community } = ricohConfig;
  if (!ip) throw new Error("IP no configurada");
  const url = `http://localhost:${port}/snmp?ip=${encodeURIComponent(ip)}&community=${encodeURIComponent(community)}&oid=${encodeURIComponent(oid)}`;
  const resp = await fetch(url, { signal: _timeoutSignal(5000) });
  const data = await resp.json();
  return data.value;
}

window.ricohConectar = async function() {
  window.ricohGuardarConfig();
  try {
    const total = await ricohSnmpGet("1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.1");
    const bw    = await ricohSnmpGet("1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.14");
    document.getElementById("ricoh-total").textContent = parseInt(total).toLocaleString();
    document.getElementById("ricoh-bw").textContent    = parseInt(bw).toLocaleString();
    document.getElementById("ricoh-dot").style.background = "#4ade80";
    mostrarMensaje("✅ Conectado a Ricoh","ok");
    return {total: parseInt(total), bw: parseInt(bw)};
  } catch(e) { 
    document.getElementById("ricoh-dot").style.background = "#f87171";
    mostrarMensaje("❌ Error conexión Ricoh","error"); 
  }
};

window.ricohIniciarMonitor = function() {
  if(ricohMonitorInterval) return;
  const poll = async () => {
    const data = await window.ricohConectar();
    if (data) {
      const now = new Date().toLocaleTimeString();
      if (ricohBaseTotal === null) ricohBaseTotal = data.total;
      const delta = data.total - (ricohLastTotal !== null ? ricohLastTotal : data.total);
      ricohLastTotal = data.total;
      const sesion = data.total - ricohBaseTotal;
      document.getElementById("ricoh-sesion").textContent = sesion;
      document.getElementById("ricoh-ultima").textContent = now;
      if (delta > 0) {
        ricohHistorialData.unshift({hora: now, total: data.total, delta, bw: data.bw, estado: "OK"});
        renderRicohHistorial();
      }
    }
  };
  poll();
  ricohMonitorInterval = setInterval(poll, 10000);
  document.getElementById("btn-ricoh-start").style.display = "none";
  document.getElementById("btn-ricoh-stop").style.display = "inline-flex";
  document.getElementById("ricoh-estado").textContent = "activo";
};

window.ricohDetenerMonitor = function() {
  clearInterval(ricohMonitorInterval); ricohMonitorInterval = null;
  document.getElementById("btn-ricoh-start").style.display = "inline-flex";
  document.getElementById("btn-ricoh-stop").style.display = "none";
  document.getElementById("ricoh-estado").textContent = "detenido";
};

function renderRicohHistorial() {
  const tbody = document.getElementById("ricoh-historial");
  if (!tbody) return;
  tbody.innerHTML = ricohHistorialData.slice(0, 50).map(f => `
    <tr>
      <td>${f.hora}</td>
      <td class="mono">${f.total}</td>
      <td class="mono" style="color:var(--accent);">+${f.delta}</td>
      <td class="mono">${f.bw}</td>
      <td>${f.estado}</td>
    </tr>`).join("");
}

window.ricohReiniciarSesion = function() {
  ricohBaseTotal = ricohLastTotal;
  document.getElementById("ricoh-sesion").textContent = "0";
  mostrarMensaje("↺ Sesión reiniciada","ok");
};

window.ricohLimpiarHistorial = function() {
  ricohHistorialData = []; renderRicohHistorial();
};

window.ricohExportarHistorial = function() {
  const ws = XLSX.utils.json_to_sheet(ricohHistorialData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ricoh");
  XLSX.writeFile(wb, "ricoh_historial.xlsx");
};

window.ricohGuardarLecturaManual = async function() {
  const copias = parseInt(document.getElementById("ricoh-man-copias").value) || 0;
  const tipo   = document.getElementById("ricoh-man-tipo").value;
  if (copias <= 0) return mostrarMensaje("⚠️ Cantidad inválida", "warning");
  const s = leerSesion();
  await addDoc(collection(db, "ricoh_lecturas"), {
    copias,
    tipo,
    fecha: new Date(),
    ownerUserId: s?.user_id || "",
    ownerUsuario: s?.usuario || "",
    ownerNombre: s?.nombre || "",
    ownerRol: s?.rol || ""
  });
  mostrarMensaje("✅ Lectura guardada", "ok");
};

window.ricohDescargarProxy = function() {
  const script = `const express = require('express'); const snmp = require('net-snmp'); const cors = require('cors'); const app = express(); app.use(cors()); app.get('/snmp', (req, res) => { const { ip, community = 'public', oid } = req.query; const session = snmp.createSession(ip, community); session.get([oid], (err, varbinds) => { session.close(); if (err) return res.status(500).json({ error: err.message }); res.json({ value: varbinds[0].value.toString() }); }); }); app.listen(3001, () => console.log('Proxy OK en 3001'));`;
  const blob = new Blob([script], { type: "text/javascript" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "proxy-ricoh.js"; a.click();
};

let ricohRepMonitorInterval = null;
let ricohRepBaseTotal = null;
let ricohRepLastTotal = null;
let ricohRepHistorialData = [];

function renderRicohRepBanner(ok, text) {
  const banner = document.getElementById("ricoh-rep-banner");
  const txt = document.getElementById("ricoh-rep-banner-txt");
  const dot = document.getElementById("ricoh-rep-dot");
  if (txt && text) txt.textContent = text;
  if (dot) dot.style.background = ok ? "#16a34a" : "#ef4444";
  if (banner) {
    banner.style.borderColor = ok ? "rgba(22,163,74,.30)" : "rgba(239,68,68,.30)";
    banner.style.background = ok ? "rgba(22,163,74,.10)" : "rgba(239,68,68,.10)";
    banner.style.color = ok ? "#14532d" : "#7f1d1d";
  }
}

async function ricohRepLeer() {
  const { ip } = ricohConfig;
  if (!ip) throw new Error("IP no configurada");
  const total = await ricohSnmpGet("1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.1");
  const bw    = await ricohSnmpGet("1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.14");
  return { total: parseInt(total, 10), bw: parseInt(bw, 10) };
}

async function ricohRepActualizarUI() {
  window.ricohGuardarConfig();
  try {
    const data = await ricohRepLeer();
    const now = new Date().toLocaleTimeString();
    if (ricohRepBaseTotal === null) ricohRepBaseTotal = data.total;
    const delta = data.total - (ricohRepLastTotal !== null ? ricohRepLastTotal : data.total);
    ricohRepLastTotal = data.total;
    const sesion = data.total - ricohRepBaseTotal;

    const elTotal = document.getElementById("ricoh-rep-total");
    const elBw = document.getElementById("ricoh-rep-bw");
    const elSesion = document.getElementById("ricoh-rep-sesion");
    const elUlt = document.getElementById("ricoh-rep-ultima");
    if (elTotal) elTotal.textContent = data.total.toLocaleString();
    if (elBw) elBw.textContent = data.bw.toLocaleString();
    if (elSesion) elSesion.textContent = sesion.toLocaleString();
    if (elUlt) elUlt.textContent = now;

    if (delta > 0) {
      ricohRepHistorialData.unshift({ Hora: now, Total: data.total, Nuevas: delta, BN: data.bw, Estado: "OK" });
      renderRicohRepHistorial();
    }
    renderRicohRepBanner(true, "Conectado — lectura OK");
  } catch (e) {
    renderRicohRepBanner(false, "Sin conexión — configura IP/Proxy o inicia el proxy local");
  }
}

function renderRicohRepHistorial() {
  const tbody = document.getElementById("ricoh-rep-historial");
  if (!tbody) return;
  if (!ricohRepHistorialData.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:18px;">Sin lecturas</td></tr>`;
    return;
  }
  tbody.innerHTML = ricohRepHistorialData.slice(0, 60).map(r => `
    <tr>
      <td>${r.Hora}</td>
      <td class="mono">${r.Total}</td>
      <td class="mono" style="color:var(--accent);font-weight:900;">+${r.Nuevas}</td>
      <td class="mono">${r.BN}</td>
      <td>${r.Estado}</td>
    </tr>`).join("");
}

window.ricohRepIniciar = function() {
  if (ricohRepMonitorInterval) return;
  ricohRepActualizarUI();
  ricohRepMonitorInterval = setInterval(ricohRepActualizarUI, 10000);
  const start = document.getElementById("btn-ricoh-rep-start");
  const stop = document.getElementById("btn-ricoh-rep-stop");
  if (start) start.style.display = "none";
  if (stop) stop.style.display = "inline-flex";
  const st = document.getElementById("ricoh-rep-estado");
  if (st) st.textContent = "activo";
};

window.ricohRepDetener = function() {
  clearInterval(ricohRepMonitorInterval);
  ricohRepMonitorInterval = null;
  const start = document.getElementById("btn-ricoh-rep-start");
  const stop = document.getElementById("btn-ricoh-rep-stop");
  if (start) start.style.display = "inline-flex";
  if (stop) stop.style.display = "none";
  const st = document.getElementById("ricoh-rep-estado");
  if (st) st.textContent = "detenido";
};

window.ricohRepReiniciar = function() {
  ricohRepBaseTotal = ricohRepLastTotal;
  const elSesion = document.getElementById("ricoh-rep-sesion");
  if (elSesion) elSesion.textContent = "0";
  mostrarMensaje("↺ Sesión reiniciada", "ok");
};

window.ricohRepLimpiar = function() {
  ricohRepHistorialData = [];
  renderRicohRepHistorial();
};

window.ricohRepExportar = function() {
  if (!ricohRepHistorialData.length) return mostrarMensaje("⚠️ Sin datos para exportar", "warning");
  const ws = XLSX.utils.json_to_sheet(ricohRepHistorialData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ricoh");
  XLSX.writeFile(wb, "ricoh_reporte.xlsx");
};

window.ricohRepGuardarManual = async function() {
  const copias = parseInt(document.getElementById("ricoh-rep-man-copias")?.value || "0", 10) || 0;
  const tipo = document.getElementById("ricoh-rep-man-tipo")?.value || "bw";
  const nota = document.getElementById("ricoh-rep-man-nota")?.value || "";
  if (copias <= 0) return mostrarMensaje("⚠️ Cantidad inválida", "warning");
  try {
    const s = leerSesion();
    await addDoc(collection(db, "ricoh_lecturas"), {
      copias,
      tipo,
      nota,
      fecha: new Date(),
      ownerUserId: s?.user_id || "",
      ownerUsuario: s?.usuario || "",
      ownerNombre: s?.nombre || "",
      ownerRol: s?.rol || ""
    });
    mostrarMensaje("✅ Registro guardado", "ok");
    const el = document.getElementById("ricoh-rep-man-copias"); if (el) el.value = "";
  } catch {
    mostrarMensaje("❌ Error guardando registro", "error");
  }
};

// =============================================
// COPIAS FIADAS
// =============================================
let clientesFiados = [];
const FIADA_PRECIO = 0.10;
let _clientesFiadosModalBound = false;

function _fmtSoles(n) {
  const v = Number(n || 0);
  return `S/ ${v.toFixed(2)}`;
}

function _toInt(v) {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function _fiadaCalc(prefix) {
  const caraEl = document.getElementById(`${prefix}-fiada-cara`);
  const duplexEl = document.getElementById(`${prefix}-fiada-duplex`);
  const cara = Math.max(0, _toInt(caraEl?.value));
  const duplex = Math.max(0, _toInt(duplexEl?.value));
  const carasFisicas = cara + (duplex * 2);
  const total = carasFisicas * FIADA_PRECIO;

  const cont = document.getElementById(`${prefix}-fiada-contador`);
  if (cont) cont.textContent = String(carasFisicas);

  const rCara = document.getElementById(`${prefix}-fiada-r-cara`);
  const rDuplex = document.getElementById(`${prefix}-fiada-r-duplex`);
  const rCont = document.getElementById(`${prefix}-fiada-r-cont`);
  const rTotal = document.getElementById(`${prefix}-fiada-r-total`);
  if (rCara) rCara.textContent = `${cara} - ${_fmtSoles(FIADA_PRECIO)} = ${_fmtSoles(cara * FIADA_PRECIO)}`;
  if (rDuplex) rDuplex.textContent = `${duplex} - ${_fmtSoles(FIADA_PRECIO)} = ${_fmtSoles((duplex * 2) * FIADA_PRECIO)}`;
  if (rCont) rCont.textContent = String(carasFisicas);
  if (rTotal) rTotal.textContent = _fmtSoles(total);

  return { cara, duplex, carasFisicas, total };
}

function _fiadaSelect(prefix) {
  const sel = document.getElementById(`${prefix}-fiada-sel`);
  const form = document.getElementById(`${prefix}-fiada-form`);
  const lbl = document.getElementById(`${prefix}-fiada-nombre-lbl`);
  const id = (sel?.value || "").trim();
  if (!id) {
    if (form) form.style.display = "none";
    if (lbl) lbl.textContent = "";
    return;
  }
  const cli = clientesFiados.find(c => c.id === id);
  if (lbl) lbl.textContent = cli?.nombre || "";
  if (form) form.style.display = "block";
  const caraEl = document.getElementById(`${prefix}-fiada-cara`);
  const duplexEl = document.getElementById(`${prefix}-fiada-duplex`);
  if (caraEl) caraEl.value = "0";
  if (duplexEl) duplexEl.value = "0";
  _fiadaCalc(prefix);
}

async function _fiadaAddCliente(prefix) {
  const input = document.getElementById(`${prefix}-fiada-nuevo`);
  const nombre = (input?.value || "").trim();
  if (!nombre) return mostrarMensaje("⚠️ Escribe el nombre del cliente", "warning");
  try {
    const s = leerSesion();
    const ref = await addDoc(collection(db, "clientesFiados"), {
      nombre,
      creadoEn: new Date(),
      ownerUserId: s?.user_id || "",
      ownerUsuario: s?.usuario || "",
      ownerNombre: s?.nombre || "",
      ownerRol: s?.rol || ""
    });
    if (input) input.value = "";
    mostrarMensaje("✅ Cliente agregado", "ok");
    const sel = document.getElementById(`${prefix}-fiada-sel`);
    if (sel) {
      sel.value = ref.id;
      _fiadaSelect(prefix);
    }
  } catch {
    mostrarMensaje("❌ No se pudo agregar", "error");
  }
}

async function _fiadaGuardar(prefix) {
  const sel = document.getElementById(`${prefix}-fiada-sel`);
  const id = (sel?.value || "").trim();
  if (!id) return mostrarMensaje("⚠️ Selecciona cliente", "warning");
  const cli = clientesFiados.find(c => c.id === id);
  if (!cli) return mostrarMensaje("⚠️ Cliente inválido", "error");
  const { cara, duplex, carasFisicas, total } = _fiadaCalc(prefix);
  if (carasFisicas <= 0) return mostrarMensaje("⚠️ Cantidad inválida", "warning");
  try {
    const s = leerSesion();
    await addDoc(collection(db, "copiasFiadas"), {
      clienteId: id,
      cliente: cli.nombre,
      simple: cara,
      cara,
      duplex,
      carasFisicas,
      monto: total,
      total,
      precio: FIADA_PRECIO,
      fecha: serverTimestamp(),
      ownerUserId: s?.user_id || "",
      ownerUsuario: s?.usuario || "",
      ownerNombre: s?.nombre || "",
      ownerRol: s?.rol || ""
    });
    const msg = document.getElementById(`${prefix}-fiada-msg`);
    if (msg) {
      msg.textContent = `✅ Guardado: ${cli.nombre} · ${carasFisicas} caras · ${_fmtSoles(total)}`;
      msg.style.display = "block";
      setTimeout(() => { msg.style.display = "none"; }, 3000);
    }
    mostrarMensaje("✅ Fiada guardada", "ok");
    _fiadaSelect(prefix);
  } catch {
    mostrarMensaje("❌ Error guardando fiada", "error");
  }
}

const _FIADA_PAGOS_COL = "copiasFiadasPagos";
let _fiadaDetCtx = null;
const _fiadaRepBound = { v: false, a: false };

function _fiadaInitReportUi(prefix) {
  if (prefix !== "v" && prefix !== "a") return;
  if (_fiadaRepBound[prefix]) return;
  _fiadaRepBound[prefix] = true;
  const isAdmin = prefix === "a";
  const desdeEl = document.getElementById(isAdmin ? "afiada-rep-desde" : "vfiada-rep-desde");
  const hastaEl = document.getElementById(isAdmin ? "afiada-rep-hasta" : "vfiada-rep-hasta");
  if (desdeEl && !String(desdeEl.value || "").trim()) desdeEl.value = _dateToYmd(new Date());
  const sync = () => {
    const hasDesde = !!String(desdeEl?.value || "").trim();
    if (hastaEl) {
      hastaEl.disabled = !hasDesde;
      if (!hasDesde) hastaEl.value = "";
    }
  };
  if (desdeEl) desdeEl.addEventListener("change", sync);
  if (hastaEl) hastaEl.addEventListener("change", () => {});
  sync();
}

function _fiadaRangeFromTo(prefix) {
  const isAdmin = prefix === "a";
  const desdeEl = document.getElementById(isAdmin ? "afiada-rep-desde" : "vfiada-rep-desde");
  const hastaEl = document.getElementById(isAdmin ? "afiada-rep-hasta" : "vfiada-rep-hasta");
  const d = _parseDateOnly(desdeEl?.value || "");
  const h0 = _parseDateOnly(hastaEl?.value || "");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (!d && !h0) return { from: today, to: _endOfDay(today) };
  if (d && !h0) return { from: d, to: _endOfDay(d) };
  if (!d && h0) return { from: h0, to: _endOfDay(h0) };
  return { from: d, to: _endOfDay(h0) };
}

function _fiadaClientFilter(prefix) {
  const isAdmin = prefix === "a";
  const sel = document.getElementById(isAdmin ? "afiada-rep-cliente" : "vfiada-rep-cliente");
  const v = String(sel?.value || "").trim();
  if (!v) return { clienteId: "", clienteNombre: "" };
  const cli = clientesFiados.find(c => c.id === v);
  return { clienteId: v, clienteNombre: String(cli?.nombre || "").trim() };
}

function _fiadaVendorFilter(prefix) {
  if (prefix !== "a") return { ownerUserId: "" };
  const sel = document.getElementById("afiada-rep-vendedor");
  const v = String(sel?.value || "").trim();
  return { ownerUserId: v };
}

function _fiadaRowToLine(f) {
  const cara = _toInt(f?.simple ?? f?.cara);
  const duplex = _toInt(f?.duplex);
  const carasFisicas = _toInt(f?.carasFisicas) || (cara + duplex * 2);
  const monto = _toNum(f?.monto) || _toNum(f?.total) || (carasFisicas * FIADA_PRECIO);
  const fecha = _tsToDate(f?.fecha) || _tsToDate(f?.creadoEn) || new Date(0);
  const clienteId = String(f?.clienteId || "").trim();
  const clienteNombre = String(f?.cliente || f?.clienteNombre || "—").trim() || "—";
  return { cara, duplex, carasFisicas, monto, fecha, clienteId, clienteNombre };
}

async function _fiadaFetchFiadas(prefix, from, to) {
  const s = leerSesion();
  const uid = String(s?.user_id || "");
  const isVend = rolActual === "vendedor";
  if (isVend && !uid) {
    mostrarMensaje("⚠️ Sesión incompleta. Vuelve a ingresar.", "warning");
    return [];
  }
  const adminOwner = _fiadaVendorFilter(prefix).ownerUserId;
  const constraints = [
    where("fecha", ">=", from),
    where("fecha", "<=", to)
  ];
  if (isVend) constraints.unshift(where("ownerUserId", "==", uid));
  else if (prefix === "a" && adminOwner) constraints.unshift(where("ownerUserId", "==", adminOwner));
  const qy = query(collection(db, "copiasFiadas"), ...constraints);
  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function _fiadaFetchPagos(prefix, from, to) {
  const s = leerSesion();
  const uid = String(s?.user_id || "");
  const isVend = rolActual === "vendedor";
  if (isVend && !uid) return [];
  const adminOwner = _fiadaVendorFilter(prefix).ownerUserId;
  const constraints = [
    where("fecha", ">=", from),
    where("fecha", "<=", to)
  ];
  if (isVend) constraints.unshift(where("targetOwnerUserId", "==", uid));
  else if (prefix === "a" && adminOwner) constraints.unshift(where("targetOwnerUserId", "==", adminOwner));
  const qy = query(collection(db, _FIADA_PAGOS_COL), ...constraints);
  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function _fiadaClientMatches(line, clienteId, clienteNombre) {
  if (!clienteId && !clienteNombre) return true;
  if (clienteId && line.clienteId && line.clienteId === clienteId) return true;
  if (clienteNombre) return _clientesKey(line.clienteNombre) === _clientesKey(clienteNombre);
  return false;
}

function _fiadaAggByClient(lines, pagos, clienteId, clienteNombre) {
  const payByKey = new Map();
  for (const p of (pagos || [])) {
    const pid = String(p?.clienteId || "").trim();
    const pnom = String(p?.clienteNombre || "").trim();
    const key = pid ? `id:${pid}` : `n:${_clientesKey(pnom)}`;
    const cur = payByKey.get(key) || 0;
    payByKey.set(key, cur + _toNum(p?.monto));
  }

  const map = new Map();
  for (const raw of (lines || [])) {
    const ln = _fiadaRowToLine(raw);
    if (!_fiadaClientMatches(ln, clienteId, clienteNombre)) continue;
    const key = ln.clienteId ? `id:${ln.clienteId}` : `n:${_clientesKey(ln.clienteNombre)}`;
    const cur = map.get(key) || { key, clienteId: ln.clienteId, clienteNombre: ln.clienteNombre, fiado: 0, caras: 0 };
    cur.fiado += ln.monto;
    cur.caras += ln.carasFisicas;
    map.set(key, cur);
  }

  const out = Array.from(map.values()).map(x => {
    const pkey = x.clienteId ? `id:${x.clienteId}` : `n:${_clientesKey(x.clienteNombre)}`;
    const pag = payByKey.get(pkey) || 0;
    const saldo = x.fiado - pag;
    return { ...x, pagado: pag, saldo };
  });
  out.sort((a, b) => (b.saldo - a.saldo) || a.clienteNombre.localeCompare(b.clienteNombre, "es", { sensitivity: "base" }));
  return out;
}

function _fiadaRenderResumen(prefix, rows, subTxt) {
  const isAdmin = prefix === "a";
  const tbody = document.getElementById(isAdmin ? "afiada-rep-tbody" : "vfiada-rep-tbody");
  const sub = document.getElementById(isAdmin ? "afiada-rep-sub" : "vfiada-rep-sub");
  if (sub) sub.textContent = subTxt || "";
  if (!tbody) return;
  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#aaa;padding:16px;">Sin datos</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.clienteNombre}</td>
      <td class="mono" style="font-weight:900;color:${r.saldo>=0?"var(--green)":"#ef4444"};">${_fmtSoles(r.saldo)}</td>
      <td style="text-align:right;">
        <button class="btn btn-info" style="padding:6px 10px;font-size:0.72rem;" onclick="fiadaVerDetalle('${prefix}','${String(r.clienteId||"").replace(/'/g,"\\'")}','${String(r.clienteNombre||"").replace(/'/g,"\\'")}')">Detalle</button>
      </td>
    </tr>
  `).join("");
}

async function _fiadaReporte(prefix) {
  const { from, to } = _fiadaRangeFromTo(prefix);
  const { clienteId, clienteNombre } = _fiadaClientFilter(prefix);
  const isAdmin = prefix === "a";
  const vend = _fiadaVendorFilter(prefix).ownerUserId;
  const vendName = vend ? (todosLosVendedores || []).find(x => String(x.id || "") === vend)?.nombre : "";
  if (isAdmin && !vend) {
    const subTxt = `Vendedor: Todos · ${_dateToYmd(from)} → ${_dateToYmd(to)}`;
    const fiadas = await _fiadaFetchFiadas(prefix, from, to);
    const pagos = await _fiadaFetchPagos(prefix, from, to);
    const rows = _fiadaAggByClient(fiadas, pagos, clienteId, clienteNombre);
    _fiadaRenderResumen(prefix, rows, subTxt);
    return;
  }
  const who = isAdmin ? `Vendedor: ${vendName || "Seleccionado"}` : "Vendedor";
  const subTxt = `${who} · ${_dateToYmd(from)} → ${_dateToYmd(to)}`;
  const fiadas = await _fiadaFetchFiadas(prefix, from, to);
  const pagos = await _fiadaFetchPagos(prefix, from, to);
  const rows = _fiadaAggByClient(fiadas, pagos, clienteId, clienteNombre);
  _fiadaRenderResumen(prefix, rows, subTxt);
}

window.vFiadaRepVer = function() { return _fiadaReporte("v"); };
window.aFiadaRepVer = function() { return _fiadaReporte("a"); };

window.fiadaVerDetalle = async function(prefix, clienteId, clienteNombre) {
  const modal = document.getElementById("modal-fiada-detalle");
  if (!modal) return;
  const { from, to } = _fiadaRangeFromTo(prefix);
  const cf = { clienteId: String(clienteId || ""), clienteNombre: String(clienteNombre || "").trim() };
  _fiadaDetCtx = { prefix, from, to, ...cf };
  const tit = document.getElementById("fiada-det-cliente");
  const sub = document.getElementById("fiada-det-sub");
  if (tit) tit.textContent = cf.clienteNombre || "—";
  if (sub) sub.textContent = `${_dateToYmd(from)} → ${_dateToYmd(to)}`;
  modal.classList.add("active");
  try {
    const m = document.getElementById("fiada-pay-monto");
    if (m) m.value = "";
    const n = document.getElementById("fiada-pay-nota");
    if (n) n.value = "";
    const msg = document.getElementById("fiada-pay-msg");
    if (msg) msg.style.display = "none";
    if (m) setTimeout(() => { try { m.focus(); } catch {} }, 60);
  } catch {}
  await _fiadaRenderDetalle();
};

async function _fiadaRenderDetalle() {
  const ctx = _fiadaDetCtx;
  if (!ctx) return;
  const tbody = document.getElementById("fiada-det-tbody");
  const totalEl = document.getElementById("fiada-det-total");
  if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:16px;">Cargando...</td></tr>`;
  const fiadas = await _fiadaFetchFiadas(ctx.prefix, ctx.from, ctx.to);
  const pagos = await _fiadaFetchPagos(ctx.prefix, ctx.from, ctx.to);
  const lines = fiadas.map(_fiadaRowToLine).filter(ln => _fiadaClientMatches(ln, ctx.clienteId, ctx.clienteNombre));
  const byDay = new Map();
  for (const ln of lines) {
    const k = _dateToYmd(ln.fecha);
    const cur = byDay.get(k) || { k, simple: 0, duplex: 0, caras: 0, monto: 0 };
    cur.simple += ln.cara;
    cur.duplex += ln.duplex;
    cur.caras += ln.carasFisicas;
    cur.monto += ln.monto;
    byDay.set(k, cur);
  }
  const rows = Array.from(byDay.values()).sort((a, b) => a.k.localeCompare(b.k));

  const payTotal = (pagos || []).reduce((s, p) => {
    const pid = String(p?.clienteId || "").trim();
    const pnom = String(p?.clienteNombre || "").trim();
    const keyOk = ctx.clienteId ? (pid === ctx.clienteId) : (_clientesKey(pnom) === _clientesKey(ctx.clienteNombre));
    if (!keyOk) return s;
    return s + _toNum(p?.monto);
  }, 0);

  const fiadoTotal = rows.reduce((s, r) => s + r.monto, 0);
  const saldo = fiadoTotal - payTotal;
  if (totalEl) totalEl.textContent = _fmtSoles(saldo);

  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:16px;">Sin datos</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="mono">${r.k}</td>
      <td class="mono">${r.simple}</td>
      <td class="mono">${r.duplex}</td>
      <td class="mono">${r.caras}</td>
      <td class="mono" style="font-weight:900;color:var(--green);">${_fmtSoles(r.monto)}</td>
    </tr>
  `).join("");
}

function _parseMontoInput(v) {
  const s = String(v ?? "").trim();
  if (!s) return NaN;
  const norm = s.replace(/\s+/g, "").replace(",", ".");
  const n = Number(norm);
  return Number.isFinite(n) ? n : NaN;
}

window.fiadaRegistrarPago = async function() {
  const ctx = _fiadaDetCtx;
  if (!ctx) return;
  const msg = document.getElementById("fiada-pay-msg");
  const montoEl = document.getElementById("fiada-pay-monto");
  const monto = _parseMontoInput(montoEl?.value);
  const nota = String(document.getElementById("fiada-pay-nota")?.value || "").trim();
  if (!Number.isFinite(monto) || monto <= 0) {
    if (msg) {
      msg.textContent = "⚠️ Ingresa un monto válido en “Monto S/” (ej: 15 o 15.50)";
      msg.style.display = "block";
      msg.style.borderColor = "#f59e0b";
      msg.style.color = "#92400e";
      msg.style.background = "#fef3c7";
    }
    if (montoEl) {
      montoEl.style.borderColor = "#f59e0b";
      setTimeout(() => { try { montoEl.focus(); } catch {} }, 50);
    }
    return;
  }
  if (montoEl) montoEl.style.borderColor = "";

  const s = leerSesion();
  const isVend = rolActual === "vendedor";
  const uid = String(s?.user_id || "");
  const isAdmin = rolActual === "admin";
  if (isVend && !uid) return mostrarMensaje("⚠️ Sesión incompleta. Vuelve a ingresar.", "warning");
  let targetOwnerUserId = "";
  if (isVend) targetOwnerUserId = uid;
  if (isAdmin) {
    const vsel = String(document.getElementById("afiada-rep-vendedor")?.value || "").trim();
    if (!vsel) return mostrarMensaje("⚠️ Selecciona un vendedor para registrar el pago", "warning");
    targetOwnerUserId = vsel;
  }
  try {
    await addDoc(collection(db, _FIADA_PAGOS_COL), {
      clienteId: ctx.clienteId || "",
      clienteNombre: ctx.clienteNombre || "",
      monto,
      nota,
      fecha: serverTimestamp(),
      targetOwnerUserId,
      ownerUserId: s?.user_id || "",
      ownerUsuario: s?.usuario || "",
      ownerNombre: s?.nombre || "",
      ownerRol: s?.rol || ""
    });
    const m = document.getElementById("fiada-pay-monto"); if (m) m.value = "";
    const n = document.getElementById("fiada-pay-nota"); if (n) n.value = "";
    if (msg) {
      msg.textContent = "✅ Pago registrado";
      msg.style.display = "block";
      msg.style.borderColor = "var(--green)";
      msg.style.color = "#065f46";
      msg.style.background = "#d1fae5";
      setTimeout(() => { try { msg.style.display = "none"; } catch {} }, 2500);
    }
    await _fiadaRenderDetalle();
    await _fiadaReporte(ctx.prefix);
  } catch (e) {
    if (msg) {
      msg.textContent = `❌ Error: ${String(e?.message || e)}`;
      msg.style.display = "block";
      msg.style.borderColor = "#ef4444";
      msg.style.color = "#991b1b";
      msg.style.background = "#fee2e2";
    }
  }
};

function _clientesKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function _updateClientesFiadosCounters() {
  const n = Array.isArray(clientesFiados) ? clientesFiados.length : 0;
  const vEl = document.getElementById("v-clientes-fiados-count");
  const aEl = document.getElementById("a-clientes-fiados-count");
  const txt = n ? `(${n})` : "";
  if (vEl) vEl.textContent = txt;
  if (aEl) aEl.textContent = txt;
}

function _renderClientesFiadosModal() {
  const modal = document.getElementById("modal-clientes-fiados");
  if (!modal || !modal.classList.contains("active")) return;

  const q = _clientesKey(document.getElementById("clientes-fiados-search")?.value || "");
  const isAdmin = rolActual === "admin";
  const list = (Array.isArray(clientesFiados) ? clientesFiados : [])
    .map(c => ({
      id: String(c.id || ""),
      nombre: String(c.nombre || "").trim(),
      ownerNombre: String(c.ownerNombre || "").trim(),
      ownerUsuario: String(c.ownerUsuario || "").trim()
    }))
    .filter(c => c.id && c.nombre)
    .filter(c => !q || _clientesKey(c.nombre).includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));

  const thead = document.getElementById("clientes-fiados-thead");
  const tbody = document.getElementById("clientes-fiados-tbody");
  const total = document.getElementById("clientes-fiados-total");
  if (total) total.textContent = `${list.length} cliente(s)`;

  if (thead) {
    thead.innerHTML = isAdmin
      ? "<tr><th>CLIENTE</th><th>CREADO POR</th></tr>"
      : "<tr><th>CLIENTE</th></tr>";
  }

  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = isAdmin
      ? `<tr><td colspan="2" style="text-align:center;color:#aaa;padding:16px;">Sin clientes</td></tr>`
      : `<tr><td style="text-align:center;color:#aaa;padding:16px;">Sin clientes</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(c => {
      const owner = (c.ownerNombre || c.ownerUsuario) ? `${c.ownerNombre || c.ownerUsuario || "—"}` : "—";
      const row = isAdmin
        ? `<tr data-id="${c.id}" style="cursor:pointer;"><td>${c.nombre}</td><td style="color:#64748b;font-size:0.82rem;">${owner}</td></tr>`
        : `<tr data-id="${c.id}" style="cursor:pointer;"><td>${c.nombre}</td></tr>`;
      return row;
    })
    .join("");

  tbody.querySelectorAll("tr[data-id]").forEach(tr => {
    tr.addEventListener("click", () => {
      const id = String(tr.getAttribute("data-id") || "");
      if (!id) return;
      const selV = document.getElementById("v-fiada-sel");
      const selA = document.getElementById("a-fiada-sel");
      const inVendor = (rolActual === "vendedor" && document.getElementById("vendedor-screen")?.style?.display !== "none");
      const inAdminFiadas = (rolActual === "admin" && document.getElementById("admin-screen")?.style?.display !== "none" && document.getElementById("tab-fiadas")?.classList?.contains("active") === true);

      if (inVendor && selV) {
        selV.value = id;
        try { window.vFiadaSeleccionar?.(); } catch {}
      } else if (inAdminFiadas && selA) {
        selA.value = id;
        try { window.aFiadaSeleccionar?.(); } catch {}
      }
      cerrarModal("modal-clientes-fiados");
    });
  });
}

window.verClientesFiados = function() {
  const modal = document.getElementById("modal-clientes-fiados");
  if (!modal) return;
  modal.classList.add("active");
  const inp = document.getElementById("clientes-fiados-search");
  if (inp) inp.value = "";
  if (!_clientesFiadosModalBound) {
    _clientesFiadosModalBound = true;
    if (inp) {
      inp.addEventListener("input", () => _renderClientesFiadosModal());
      inp.addEventListener("keydown", e => {
        if (e.key === "Escape") {
          e.preventDefault();
          cerrarModal("modal-clientes-fiados");
        }
      });
    }
  }
  _renderClientesFiadosModal();
  if (inp) setTimeout(() => { try { inp.focus(); } catch {} }, 50);
};
function cargarClientesFiados() {
  onSnapshot(collection(db,"clientesFiados"), snap => {
    clientesFiados = snap.docs.map(d => ({id:d.id,...d.data()}));
    const opts = '<option value="">— Seleccionar —</option>' + clientesFiados.map(c=>`<option value="${c.id}">${c.nombre}</option>`).join("");
    if(document.getElementById("v-fiada-sel")) document.getElementById("v-fiada-sel").innerHTML = opts;
    if(document.getElementById("a-fiada-sel")) document.getElementById("a-fiada-sel").innerHTML = opts;
    const repOpts = '<option value="">Todos</option>' + clientesFiados.map(c=>`<option value="${c.id}">${c.nombre}</option>`).join("");
    const vrep = document.getElementById("vfiada-rep-cliente");
    const arep = document.getElementById("afiada-rep-cliente");
    if (vrep) vrep.innerHTML = repOpts;
    if (arep) arep.innerHTML = repOpts;
    _updateClientesFiadosCounters();
    _renderClientesFiadosModal();
  });
}


function cargarFiadasDia() {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const s = leerSesion();
  const isV = (rolActual === "vendedor");
  const uid = String(s?.user_id || "");
  if (isV && !uid) {
    mostrarMensaje("⚠️ Sesión incompleta. Vuelve a ingresar.", "warning");
  }
  const qy = isV
    ? query(collection(db,"copiasFiadas"), where("ownerUserId","==", uid || "__missing__"), where("fecha", ">=", hoy))
    : query(collection(db,"copiasFiadas"), where("fecha", ">=", hoy));
  onSnapshot(qy, snap => {
    const fiadas = snap.docs.map(d=>d.data()).filter(f=>(f.fecha?.toDate ? f.fecha.toDate() : new Date(f.fecha)) >= hoy);
    const total = fiadas.reduce((acc,f)=> {
      const cara = _toInt(f.cara);
      const duplex = _toInt(f.duplex);
      const carasFisicas = _toInt(f.carasFisicas) || (cara + duplex * 2);
      return acc + (carasFisicas * FIADA_PRECIO);
    },0);
    if(document.getElementById("a-fiada-total-dia")) document.getElementById("a-fiada-total-dia").textContent = "S/ "+total.toFixed(2);
  });
}

window.cambiarTabVendedor = function(tabId, btn) {
  document.querySelectorAll("#vendedor-screen .tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll("#vendedor-screen .tab-btn").forEach(b => b.classList.remove("active"));
  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add("active");
  if (btn) btn.classList.add("active");
  _saveVendedorTab(tabId);
};

window.vFiadaSeleccionar = function() { _fiadaSelect("v"); };
window.aFiadaSeleccionar = function() { _fiadaSelect("a"); };
window.vFiadaCalc = function() { _fiadaCalc("v"); };
window.aFiadaCalc = function() { _fiadaCalc("a"); };
window.vFiadaAgregarCliente = function() { return _fiadaAddCliente("v"); };
window.aFiadaAgregarCliente = function() { return _fiadaAddCliente("a"); };
window.aFiadaGuardar = function() { return _fiadaGuardar("a"); };

window.vFiadaGuardar = async function() {
  return _fiadaGuardar("v");
};

window.vMalGuardar = async function() {
  const cant = parseInt(document.getElementById("v-mal-cant")?.value || "0", 10) || 0;
  if (cant <= 0) return mostrarMensaje("⚠️ Cantidad inválida", "warning");
  try {
    const s = leerSesion();
    await addDoc(collection(db, "hojasMalogradas"), {
      cantidad: cant,
      fecha: new Date(),
      ownerUserId: s?.user_id || "",
      ownerUsuario: s?.usuario || "",
      ownerNombre: s?.nombre || "",
      ownerRol: s?.rol || ""
    });
    const el = document.getElementById("v-mal-cant"); if (el) el.value = "0";
    const msg = document.getElementById("v-mal-msg");
    if (msg) {
      msg.textContent = `✅ Guardado: ${cant} hoja(s)`;
      msg.style.display = "block";
      setTimeout(() => { msg.style.display = "none"; }, 3000);
    }
    mostrarMensaje("⚠️ Malograda registrada", "warning");
  } catch {
    mostrarMensaje("❌ Error guardando", "error");
  }
};

window.aMalGuardar = async function() {
  const cant = parseInt(document.getElementById("a-mal-cant").value) || 0;
  if(cant <= 0) return;
  const s = leerSesion();
  await addDoc(collection(db,"hojasMalogradas"), {
    cantidad: cant,
    fecha: new Date(),
    ownerUserId: s?.user_id || "",
    ownerUsuario: s?.usuario || "",
    ownerNombre: s?.nombre || "",
    ownerRol: s?.rol || ""
  });
  mostrarMensaje("⚠️ Malograda registrada","warning");
};

window.switchRepTab = (p, b) => {
  document.querySelectorAll("#tab-reporte .rep-panel").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll("#tab-reporte .rep-tab-btn").forEach(x=>x.classList.remove("active"));
  document.getElementById(p).classList.add("active");
  const btn = document.getElementById(b);
  if (btn) btn.classList.add("active");
};

window.switchRepTabV = (p, b) => {
  document.querySelectorAll("#vtab-reporte-v .rep-panel").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll("#vtab-reporte-v .rep-tab-btn").forEach(x=>x.classList.remove("active"));
  document.getElementById(p).classList.add("active");
  const btn = document.getElementById(b);
  if (btn) btn.classList.add("active");
};

function _rangeFromInputs(prefix) {
  const isV = prefix === "v";
  const dia = document.getElementById(isV ? "vrep-dia" : "rep-dia")?.value || "";
  const desde = document.getElementById(isV ? "vrep-desde" : "rep-desde")?.value || "";
  const hasta = document.getElementById(isV ? "vrep-hasta" : "rep-hasta")?.value || "";
  if (dia) {
    const d1 = new Date(`${dia}T00:00:00`);
    const d2 = new Date(`${dia}T23:59:59`);
    return { from: d1, to: d2, title: `Reporte del ${dia}` };
  }
  if (desde && hasta) {
    const d1 = new Date(`${desde}T00:00:00`);
    const d2 = new Date(`${hasta}T23:59:59`);
    return { from: d1, to: d2, title: `Reporte ${desde} → ${hasta}` };
  }
  return null;
}

async function _generarReporte(prefix) {
  const r = _rangeFromInputs(prefix);
  if (!r) return mostrarMensaje("⚠️ Selecciona día o rango", "warning");
  const { from, to, title } = r;
  try {
    const s = leerSesion();
    const isVendedor = (prefix === "v" && rolActual === "vendedor");
    const uid = String(s?.user_id || "");
    if (isVendedor && !uid) return mostrarMensaje("⚠️ Sesión incompleta. Vuelve a ingresar.", "warning");
    const qFiadas = isVendedor
      ? query(collection(db, "copiasFiadas"), where("ownerUserId","==", uid || "__missing__"), where("fecha", ">=", from), where("fecha", "<=", to))
      : query(collection(db, "copiasFiadas"), where("fecha", ">=", from), where("fecha", "<=", to));
    const sFiadas = await getDocs(qFiadas);
    const rows = sFiadas.docs.map(d => d.data());

    const byCliente = new Map();
    let carasTotal = 0;
    for (const f of rows) {
      const cliente = String(f.cliente || "—").trim() || "—";
      const cara = _toInt(f.cara);
      const duplex = _toInt(f.duplex);
      const carasFisicas = _toInt(f.carasFisicas) || (cara + duplex * 2);
      const deuda = carasFisicas * FIADA_PRECIO;
      carasTotal += carasFisicas;
      const cur = byCliente.get(cliente) || { cliente, cara: 0, duplex: 0, carasFisicas: 0, deuda: 0 };
      cur.cara += cara;
      cur.duplex += duplex;
      cur.carasFisicas += carasFisicas;
      cur.deuda += deuda;
      byCliente.set(cliente, cur);
    }

    const qMal = isVendedor
      ? query(collection(db, "hojasMalogradas"), where("ownerUserId","==", uid || "__missing__"), where("fecha", ">=", from), where("fecha", "<=", to))
      : query(collection(db, "hojasMalogradas"), where("fecha", ">=", from), where("fecha", "<=", to));
    const sMal = await getDocs(qMal);
    const mal = sMal.docs.map(d => d.data()).reduce((s, x) => s + _toInt(x.cantidad), 0);

    const deudaTotal = Array.from(byCliente.values()).reduce((s, x) => s + x.deuda, 0);
    const ganancia = deudaTotal;
    const neta = ganancia - (mal * FIADA_PRECIO);

    const isV = prefix === "v";
    const box = document.getElementById(isV ? "vrep-resultado" : "reporte-resultado");
    if (box) box.style.display = "block";
    const tit = document.getElementById(isV ? "vrep-titulo" : "rep-titulo");
    if (tit) tit.textContent = title;
    const elG = document.getElementById(isV ? "vrep-ganancia" : "rep-ganancia");
    const elC = document.getElementById(isV ? "vrep-copias" : "rep-copias");
    const elD = document.getElementById(isV ? "vrep-deuda" : "rep-deuda");
    const elM = document.getElementById(isV ? "vrep-mal" : "rep-mal");
    const elM2 = document.getElementById(isV ? "vrep-mal2" : "rep-mal2");
    const elN = document.getElementById(isV ? "vrep-neta" : "rep-neta");
    if (elG) elG.textContent = _fmtSoles(ganancia);
    if (elC) elC.textContent = String(carasTotal);
    if (elD) elD.textContent = _fmtSoles(deudaTotal);
    if (elM) elM.textContent = String(mal);
    if (elM2) elM2.textContent = `${mal} hojas`;
    if (elN) elN.textContent = _fmtSoles(neta);

    const tbody = document.getElementById(isV ? "vrep-detalle" : "rep-detalle");
    const det = Array.from(byCliente.values()).sort((a, b) => (b.deuda - a.deuda) || a.cliente.localeCompare(b.cliente));
    if (tbody) {
      if (!det.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:16px;">Sin datos</td></tr>`;
      } else {
        tbody.innerHTML = det.map(x => `
          <tr>
            <td>${x.cliente}</td>
            <td class="mono">${x.cara}</td>
            <td class="mono">${x.duplex}</td>
            <td class="mono">${x.carasFisicas}</td>
            <td class="mono">${_fmtSoles(x.deuda)}</td>
          </tr>
        `).join("");
      }
    }
  } catch {
    mostrarMensaje("❌ Error generando reporte", "error");
  }
}

window.generarReporteDeudas = function() { return _generarReporte("a"); };
window.generarReporteDeudasV = function() { return _generarReporte("v"); };

window.ayudaSeguridad = () => {
  alert(
    "Escáner (Vendedor):\n\n" +
    "- El escaneo se usa solo dentro de este sistema y en esta misma PC.\n" +
    "- El modo FONDO está desactivado para evitar problemas.\n\n" +
    "Si el lector escribe LIB-... en una celda, es normal. La venta igual debe registrarse."
  );
};

// Foco automático
setInterval(() => {
  if (!scannerInput) return;
  if (localStorage.getItem("scan_autofocus") !== "1") return;
  if (!shouldForceScannerFocus()) return;
  const ae = document.activeElement;
  const isScanner = ae === scannerInput;
  const isEditable = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable);
  if (isEditable && !isScanner) return;
  if (ae && ae !== document.body && !isScanner) return;
  try { scannerInput.focus(); } catch {}
}, 2500);

// Escáner de fondo
const BG_SCANNER_FEATURE = false;
const OUTSIDE_QUEUE_FEATURE = true;
let _bgFailCount = 0;
let _bgInFlight = false;
let _bgStream = null;
let _bgStreamBase = "";
let _bgWarned = false;

let _outsideInFlight = false;
let _outsideWarnAt = 0;

function _outsideQueueEnabled() {
  if (!OUTSIDE_QUEUE_FEATURE) return false;
  const v = localStorage.getItem("outside_queue_enabled");
  if (v === "0") return false;
  return rolActual === "vendedor";
}

function _outsideWarnOnce() {
  const now = Date.now();
  if (_outsideWarnAt && (now - _outsideWarnAt) < 600000) return;
  _outsideWarnAt = now;
  const samePc = "Para capturar fuera del navegador, el servicio local del escáner debe estar encendido en esta MISMA PC (127.0.0.1:7777).";
  const mixed = (location.protocol === "https:" ? "Si usas GitHub Pages (https), Chrome puede bloquear http://127.0.0.1. Solución: usar POS local http://127.0.0.1:8787/ o permitir 'Contenido no seguro'." : "");
  mostrarMensaje(`⚠️ No se pudo leer la cola externa. ${samePc} ${mixed}`.trim(), "warning");
}

async function _outsideDrainNow() {
  if (rolActual !== "vendedor") return;
  const inLogin = document.getElementById("login-screen")?.style?.display !== "none";
  if (inLogin) return;
  if (!_outsideQueueEnabled()) return;
  if (_outsideInFlight) return;
  _outsideInFlight = true;
  try {
    const base = scanServiceBase();
    const r = await fetch(base + "/drain?limit=80", { signal: _timeoutSignal(1800) });
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    const arr = Array.isArray(d?.codes) ? d.codes : [];
    const codes = arr.map(x => (typeof x === "string" ? x : x?.codigo)).filter(Boolean);
    if (!codes.length) return;
    for (const c of codes) {
      if (_outsideIgnoreHas(c)) continue;
      try { await procesarCodigo(c, { source: "outside_queue" }); } catch {}
    }
  } catch {
    _outsideWarnOnce();
  } finally {
    _outsideInFlight = false;
  }
}

window.addEventListener("focus", () => { try { _outsideDrainNow(); } catch {} });
document.addEventListener("visibilitychange", () => { try { _outsideDrainNow(); } catch {} });
setInterval(() => { try { _outsideDrainNow(); } catch {} }, 1800);

function _bgWarnOnce() {
  if (_bgWarned) return;
  _bgWarned = true;
  const samePc = "FONDO solo funciona si esta web está abierta en la MISMA PC donde corre el servicio del escáner (127.0.0.1).";
  const mixed = (location.protocol === "https:" ? "Si usas GitHub Pages (https), Chrome puede bloquear http://127.0.0.1. Solución segura: usar POS local http://127.0.0.1:8787." : "");
  mostrarMensaje(`⚠️ FONDO no disponible. ${samePc} ${mixed}`.trim(), "warning");
}

function _bgStopStream() {
  try { _bgStream?.close?.(); } catch {}
  _bgStream = null;
  _bgStreamBase = "";
}

function _bgStartStream() {
  if (!BG_SCANNER_FEATURE) return;
  if (!rolActual) return;
  if (localStorage.getItem("bg_scanner_enabled") !== "1") return;
  const base = scanServiceBase();
  if (_bgStream && _bgStreamBase === base) return;
  _bgStopStream();
  _bgStreamBase = base;
  try {
    const es = new EventSource(base + "/stream");
    _bgStream = es;
    setBgBadge(true);
    setScannerDot(true, "bg");
    es.onmessage = (ev) => {
      const code = sanitizeScanCode(ev?.data || "");
      if (!code) return;
      procesarCodigo(code, { source: "bg" });
    };
    es.onerror = () => {
      _bgFailCount += 1;
      setBgBadge(false);
      setScannerDot(false);
      _bgStopStream();
      _bgWarnOnce();
    };
  } catch {
    _bgWarnOnce();
  }
}

setInterval(async () => {
  if (!BG_SCANNER_FEATURE) return;
  if (!rolActual) return;
  if (localStorage.getItem("bg_scanner_enabled") !== "1") { _bgStopStream(); return; }
  _bgStartStream();
  if (_bgStream) return;
  if (_bgInFlight) return;
  _bgInFlight = true;
  try {
    setBgBadge(true);
    setScannerDot(true, "bg");
    const base = scanServiceBase();
    const r = await fetch(base + "/poll", { signal: _timeoutSignal(1500) });
    const d = await r.json();
    if (d.codigo) procesarCodigo(d.codigo, { source: "bg" });
    _bgFailCount = 0;
  } catch(e) {
    if (e?.name !== "AbortError") _bgFailCount += 1;
    setBgBadge(false);
    setScannerDot(false);
    if (_bgFailCount >= 2) _bgWarnOnce();
  } finally {
    _bgInFlight = false;
  }
}, 900);

window.habilitarEscanerFondo = async function() {
  if (!BG_SCANNER_FEATURE) {
    try { localStorage.setItem("bg_scanner_enabled", "0"); } catch {}
    try { setBgBadge(false); } catch {}
    mostrarMensaje("ℹ️ Modo FONDO desactivado (solo se escanea dentro del sistema)", "warning");
    return;
  }
  try {
    const base = scanServiceBase();
    const r = await fetch(base + "/status", { signal: _timeoutSignal(1500) });
    if (!r.ok) throw new Error(String(r.status));
    localStorage.setItem("bg_scanner_enabled", "1");
    _bgFailCount = 0;
    mostrarMensaje("✅ Escáner de fondo habilitado (este equipo)", "ok");
    setBgBadge(true);
    _bgStartStream();
  } catch {
    localStorage.setItem("bg_scanner_enabled", "0");
    setBgBadge(false);
    mostrarMensaje("❌ No se pudo habilitar FONDO. Activa 'Contenido no seguro' y verifica que el servicio 7777 esté encendido.", "error");
  }
};

window.deshabilitarEscanerFondo = function() {
  localStorage.setItem("bg_scanner_enabled", "0");
  mostrarMensaje("ℹ️ Escáner de fondo deshabilitado", "warning");
  setBgBadge(false);
};

// Inicializar grupo Ventas al cargar
(function(){
  const grp = document.getElementById("dtg-ventas");
  if (grp) grp.classList.add("active-group");
  const dtV = document.getElementById("dt-ventas");
  if (dtV) dtV.classList.add("active");
})();

let impCfg = { url: "http://localhost:5056", token: "" };
let impSocket = null;
let impAutoTimer = null;
let impPage = 1;
let impLimit = 50;
let impLastQuery = null;

function impLoadCfg() {
  try {
    const raw = localStorage.getItem("print_svc_cfg");
    if (raw) impCfg = { ...impCfg, ...JSON.parse(raw) };
  } catch {}
  const urlInput = document.getElementById("imp-svc-url");
  const tokenInput = document.getElementById("imp-svc-token");
  if (urlInput) urlInput.value = impCfg.url || "";
  if (tokenInput) tokenInput.value = impCfg.token || "";
  const vSvc = document.getElementById("v-imp-svc");
  if (vSvc) vSvc.textContent = impCfg.url || "—";
}

function impSaveCfg() {
  const urlInput = document.getElementById("imp-svc-url");
  const tokenInput = document.getElementById("imp-svc-token");
  const url = (urlInput?.value || "").trim() || "http://localhost:5056";
  const token = (tokenInput?.value || "").trim();
  impCfg = { url, token };
  localStorage.setItem("print_svc_cfg", JSON.stringify(impCfg));
  const vSvc = document.getElementById("v-imp-svc");
  if (vSvc) vSvc.textContent = impCfg.url || "—";
}

function impHeaders() {
  const h = {};
  if (impCfg.token) h["X-Print-Token"] = impCfg.token;
  return h;
}

function impQs(params) {
  const u = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    u.set(k, String(v));
  });
  const s = u.toString();
  return s ? `?${s}` : "";
}

function impIsoUtcCompat(d) {
  return d.toISOString().replace("Z", "+00:00");
}

function impDateRangeToIso(desde, hasta) {
  const out = {};
  if (desde) {
    const d = new Date(`${desde}T00:00:00`);
    out.from = impIsoUtcCompat(d);
  }
  if (hasta) {
    const d = new Date(`${hasta}T23:59:59`);
    out.to = impIsoUtcCompat(d);
  }
  return out;
}

function impTodayIsoRange() {
  const n = new Date();
  const from = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0);
  const to = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59);
  return { from: impIsoUtcCompat(from), to: impIsoUtcCompat(to) };
}

function impSelectedValues(selId) {
  const el = document.getElementById(selId);
  if (!el) return [];
  return Array.from(el.selectedOptions).map(o => o.value).filter(Boolean);
}

async function impFetchJson(path, params) {
  const url = `${impCfg.url}${path}${impQs(params)}`;
  const r = await fetch(url, { headers: impHeaders(), signal: _timeoutSignal(5000) });
  if (!r.ok) throw new Error(String(r.status));
  return await r.json();
}

async function impFetchBlob(path, params) {
  const url = `${impCfg.url}${path}${impQs(params)}`;
  const r = await fetch(url, { headers: impHeaders() });
  if (!r.ok) throw new Error(String(r.status));
  return await r.blob();
}

function impSetConn(ok, text) {
  const dot = document.getElementById("imp-dot");
  const st = document.getElementById("imp-estado");
  if (dot) dot.style.background = ok ? "#16a34a" : "#ef4444";
  if (st) st.textContent = text || (ok ? "conectado" : "sin conexión");
}

function impSetConnVendor(ok) {
  const vSvc = document.getElementById("v-imp-svc");
  if (!vSvc) return;
  const base = (impCfg.url || "").trim() || "http://localhost:5056";
  vSvc.textContent = ok ? base : "sin conexión";
}

function impRenderTotals(totals) {
  const total = document.getElementById("imp-total");
  const ok = document.getElementById("imp-ok");
  const bn = document.getElementById("imp-bn");
  const color = document.getElementById("imp-color");
  if (total) total.textContent = (totals?.pages_total_estimated ?? totals?.pages_total ?? 0).toLocaleString();
  if (ok) ok.textContent = (totals?.completed_jobs ?? 0).toLocaleString();
  if (bn) bn.textContent = (totals?.pages_bn_estimated ?? totals?.pages_bn ?? 0).toLocaleString();
  if (color) color.textContent = (totals?.pages_color_estimated ?? totals?.pages_color ?? 0).toLocaleString();
  const conf = document.getElementById("imp-total-conf");
  const est = document.getElementById("imp-total-est");
  if (conf) conf.textContent = (totals?.pages_total ?? 0).toLocaleString();
  if (est) est.textContent = (totals?.pages_total_estimated ?? 0).toLocaleString();
  const ult = document.getElementById("imp-ultima");
  if (ult) ult.textContent = new Date().toLocaleTimeString();
}

function impRenderByPrinter(rows) {
  const tbody = document.getElementById("imp-by-printer");
  if (!tbody) return;
  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#aaa;padding:18px;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">Sin datos</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.printer_name || ""}</td>
      <td class="mono">${(r.pages_total || 0).toLocaleString()}</td>
      <td class="mono">${(r.pages_total_estimated || 0).toLocaleString()}</td>
      <td class="mono">${(r.pages_bn_estimated ?? r.pages_bn ?? 0).toLocaleString()}</td>
      <td class="mono">${(r.pages_color_estimated ?? r.pages_color ?? 0).toLocaleString()}</td>
      <td class="mono">${(r.jobs_completed || 0).toLocaleString()}</td>
      <td class="mono">${(r.jobs_failed || 0).toLocaleString()}</td>
    </tr>`).join("");
}

function impRenderRows(rows) {
  const tbody = document.getElementById("imp-rows");
  const count = document.getElementById("imp-count");
  const pageEl = document.getElementById("imp-page");
  if (count) count.textContent = (rows?.length ?? 0).toLocaleString();
  if (pageEl) pageEl.textContent = String(impPage);
  if (!tbody) return;
  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:#aaa;padding:18px;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">Sin registros</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="mono">${r.id ?? ""}</td>
      <td class="mono">${(r.ts_created || "").slice(0, 19)}</td>
      <td class="mono">${(r.ts_completed || "").slice(0, 19)}</td>
      <td>${r.printer_name || ""}</td>
      <td>${r.user_id || ""}</td>
      <td>${r.document || ""}</td>
      <td>${r.print_type || ""}</td>
      <td class="mono">${(r.pages || 0).toLocaleString()}</td>
      <td class="mono">${(r.pages_estimated || 0).toLocaleString()}</td>
      <td class="mono">${(r.copies_requested || 1).toLocaleString()}</td>
      <td>${r.status || ""}${r.error_code ? ` (${r.error_code})` : ""}</td>
      <td><button class="btn btn-danger" style="padding:4px 8px;font-size:0.65rem;" onclick="impEliminar(${r.id})">Eliminar</button></td>
    </tr>`).join("");
}

async function impLoadMeta() {
  const meta = await impFetchJson("/api/prints/meta");
  const pSel = document.getElementById("imp-printers");
  const uSel = document.getElementById("imp-users");
  if (pSel) pSel.innerHTML = (meta.printers || []).map(p => `<option value="${p}">${p}</option>`).join("");
  if (uSel) uSel.innerHTML = (meta.users || []).map(u => `<option value="${u}">${u}</option>`).join("");
}

function impBuildQuery() {
  const desde = document.getElementById("imp-desde")?.value || "";
  const hasta = document.getElementById("imp-hasta")?.value || "";
  const { from, to } = impDateRangeToIso(desde, hasta);
  const printers = impSelectedValues("imp-printers");
  const users = impSelectedValues("imp-users");
  const type = document.getElementById("imp-tipo")?.value || "";
  const status = document.getElementById("imp-status")?.value || "";
  const q = { from, to, type, status };
  if (printers.length) q.printers = printers.join(",");
  if (users.length) q.users = users.join(",");
  return q;
}

async function impRefreshAll() {
  impLastQuery = impBuildQuery();
  const day = impTodayIsoRange();
  const qSummary = { ...impLastQuery, ...day };
  const qRows = { ...impLastQuery, limit: impLimit, offset: (impPage - 1) * impLimit };
  const [s, l] = await Promise.all([
    impFetchJson("/api/prints/summary", qSummary),
    impFetchJson("/api/prints", qRows),
  ]);
  impRenderTotals(s.totals);
  impRenderByPrinter(s.by_printer);
  impRenderRows(l.rows);
}

async function impUpdateVendorWidget() {
  if (rolActual !== "vendedor") return;
  const { usuario, nombre } = leerSesion();
  const candidate = (usuario || nombre || "").trim();
  if (!candidate) return;
  try {
    let effectiveUserFull = "";
    let effectiveUserBase = candidate;
    try {
      const meta = await impFetchJson("/api/prints/meta");
      const users = meta?.users || [];
      const userStrings = users.filter(u => typeof u === "string").map(u => u.trim()).filter(Boolean);
      if (userStrings.length) {
        const candLower = candidate.toLowerCase();
        for (const u of userStrings) {
          const owner = u.split("@")[0].trim();
          if (!owner) continue;
          if (owner.toLowerCase() === candLower) { effectiveUserFull = u; break; }
        }
        if (!effectiveUserFull) {
          for (const u of userStrings) {
            const owner = u.split("@")[0].trim();
            if (!owner) continue;
            if (owner.toLowerCase().includes(candLower) || candLower.includes(owner.toLowerCase())) { effectiveUserFull = u; break; }
          }
        }
        if (!effectiveUserFull) effectiveUserFull = userStrings[0];
      }
    } catch {}

    if (effectiveUserFull) effectiveUserBase = effectiveUserFull.split("@")[0].trim() || candidate;

    const day = impTodayIsoRange();
    let r = await impFetchJson("/api/prints/my-summary", { user_id: effectiveUserBase, ...day });
    let t = r.totals || {};
    const isAllZero = (t.pages_total ?? 0) === 0 && (t.pages_bn ?? 0) === 0 && (t.pages_color ?? 0) === 0;
    if (isAllZero && effectiveUserBase !== candidate) {
      try {
        r = await impFetchJson("/api/prints/my-summary", { user_id: candidate, ...day });
        t = r.totals || t;
      } catch {}
    }
    const vTot = document.getElementById("v-imp-total");
    const vBn = document.getElementById("v-imp-bn");
    const vCol = document.getElementById("v-imp-color");
    if (vTot) vTot.textContent = (t.pages_total_estimated ?? t.pages_total ?? 0).toLocaleString();
    if (vBn) vBn.textContent = (t.pages_bn_estimated ?? t.pages_bn ?? 0).toLocaleString();
    if (vCol) vCol.textContent = (t.pages_color_estimated ?? t.pages_color ?? 0).toLocaleString();
    const vConf = document.getElementById("v-imp-total-conf");
    const vEst = document.getElementById("v-imp-total-est");
    if (vConf) vConf.textContent = (t.pages_total ?? 0).toLocaleString();
    if (vEst) vEst.textContent = (t.pages_total_estimated ?? 0).toLocaleString();

    try {
      const tbody = document.getElementById("v-imp-by-printer");
      if (!tbody) return;
      if (!effectiveUserFull) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:12px;">Sin datos</td></tr>`;
        return;
      }
      const sum = await impFetchJson("/api/prints/summary", { users: effectiveUserFull, status: "completed", ...day });
      const rows = sum?.by_printer || [];
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:12px;">Sin datos</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.printer_name || ""}</td>
          <td class="mono">${(r.pages_total || 0).toLocaleString()}</td>
          <td class="mono">${(r.pages_total_estimated || 0).toLocaleString()}</td>
          <td class="mono">${(r.pages_bn_estimated ?? r.pages_bn ?? 0).toLocaleString()}</td>
          <td class="mono">${(r.pages_color_estimated ?? r.pages_color ?? 0).toLocaleString()}</td>
        </tr>
      `).join("");
    } catch {
      const tbody = document.getElementById("v-imp-by-printer");
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:12px;">Sin datos</td></tr>`;
    }
  } catch {}
}

function impConnectSocket() {
  if (!window.io || !impCfg.url) return;
  try {
    if (impSocket) {
      try { impSocket.disconnect(); } catch {}
      impSocket = null;
    }
    impSocket = window.io(impCfg.url, { transports: ["websocket", "polling"] });
    impSocket.on("connect", () => { impSetConn(true, "conectado"); });
    impSocket.on("disconnect", () => { impSetConn(false, "sin conexión"); });
    impSocket.on("prints:finalized", async () => {
      try { await impRefreshAll(); } catch {}
      try { await impUpdateVendorWidget(); } catch {}
    });
    impSocket.on("prints:deleted", async () => {
      try { await impRefreshAll(); } catch {}
      try { await impUpdateVendorWidget(); } catch {}
    });
  } catch {}
}

window.impMostrarNotaInstalador = function() {
  mostrarMensaje("Descarga completada. Ejecuta el .bat como Administrador en la PC de la impresora.", "info");
};

window.scanDoctorUI = async function() {
  const out = document.getElementById("scan-doctor-out") || document.getElementById("vendor-setup-out");
  const lines = [];
  const show = () => {
    if (!out) return;
    out.style.display = "block";
    out.textContent = lines.join("\n");
  };
  const add = (s) => { lines.push(s); show(); };
  const test = async (label, url) => {
    add(`⏳ ${label}: ${url}`);
    try {
      const r = await fetch(url, { signal: _timeoutSignal(1800) });
      const txt = await r.text();
      add(`✅ ${label}: HTTP ${r.status}`);
      if (txt) add(txt.slice(0, 600));
      return { ok: r.ok, status: r.status, body: txt };
    } catch (e) {
      add(`❌ ${label}: ${e?.message || String(e)}`);
      return { ok: false, status: 0, body: "" };
    }
  };

  lines.length = 0;
  add("=== Doctor Escáner ===");
  add(`Hora: ${new Date().toLocaleString("es-PE")}`);
  add(`Rol: ${rolActual || "—"} | Usuario: ${(nombreVendedor || (rolActual === "admin" ? "Admin" : "")) || "—"}`);
  add("Modo: SOLO VENDEDOR (misma PC, dentro del sistema)");
  add(`Audit: ${localStorage.getItem("scan_audit") === "1" ? "ON" : "OFF"}`);
  add(`Protocol: ${location.protocol}`);
  add(`Autofocus: ${localStorage.getItem("scan_autofocus") === "1" ? "ON" : "OFF"}`);
  add(`CleanInputs: ${localStorage.getItem("scan_clean_inputs") === "1" ? "ON" : "OFF"}`);
  add(`Cola externa: ${_outsideQueueEnabled() ? "ON" : "OFF"}`);
  try { add(`OfflineQueue: ${_offlineLoad().length}`); } catch {}
  add("");
  try {
    const errs = JSON.parse(localStorage.getItem("runtime_errors") || "[]");
    if (errs.length) add("Runtime errors (últimos): " + JSON.stringify(errs.slice(-3)));
  } catch {}
  add("");
  if (!BG_SCANNER_FEATURE) add("FONDO: desactivado por configuración.");
  add("");
  const base = scanServiceBase();
  add(`ScanBase: ${base}`);
  add("");
  await test("ESCÁNER STATUS", base + "/status");
  add("");
  await test("ESCÁNER PEEK", base + "/peek");
  show();
};

window.scanOneClick = async function() {
  const out = document.getElementById("scan-doctor-out") || document.getElementById("vendor-setup-out");
  const lines = [];
  const show = () => {
    if (!out) return;
    out.style.display = "block";
    out.textContent = lines.join("\n");
  };
  const add = (s) => { lines.push(s); show(); };
  const testJson = async (label, url) => {
    add(`⏳ ${label}: ${url}`);
    try {
      const r = await fetch(url, { signal: _timeoutSignal(1800) });
      const txt = await r.text();
      add(`✅ ${label}: HTTP ${r.status}`);
      if (txt) add(txt.slice(0, 600));
      return { ok: r.ok, status: r.status, body: txt };
    } catch (e) {
      add(`❌ ${label}: ${e?.message || String(e)}`);
      return { ok: false, status: 0, body: "" };
    }
  };

  lines.length = 0;
  add("=== Escáner (1 clic) ===");
  add(`Hora: ${new Date().toLocaleString("es-PE")}`);
  add(`Protocol: ${location.protocol}`);
  add("");

  try { localStorage.setItem("bg_scanner_enabled", "0"); } catch {}
  try { localStorage.removeItem("scan_svc_base"); } catch {}
  try { localStorage.setItem("scan_autofocus", "0"); } catch {}
  try { localStorage.setItem("scan_clean_inputs", "0"); } catch {}
  try { localStorage.setItem("scan_debug", "0"); } catch {}
  try { localStorage.setItem("outside_queue_enabled", "1"); } catch {}
  try { setBgBadge(false); } catch {}
  add("✅ Configuración aplicada:");
  add("- Escáner: solo dentro del sistema (vendedor)");
  add("- FONDO: OFF");
  add("- Cola externa: ON (captura fuera y registra al volver)");
  add("- Autofocus: OFF");
  add("- Limpieza inputs: OFF");
  add("");
  add("Requisito: servicio local del escáner encendido en esta PC (127.0.0.1).");
  const base = scanServiceBase();
  await testJson("ESCÁNER STATUS", base + "/status");
  await testJson("ESCÁNER PEEK", base + "/peek");
  show();
};

window.vendorPcSetupOneClick = async function() {
  if (rolActual !== "admin") {
    mostrarMensaje("⚠️ Solo Admin puede usar Instalaciones", "warning");
    return;
  }
  const out = document.getElementById("vendor-setup-out");
  const dl = document.getElementById("dl-pc-vendedor");
  const lines = [];
  const show = () => {
    if (!out) return;
    out.style.display = "block";
    out.textContent = lines.join("\n");
  };
  const add = (s) => { lines.push(s); show(); };
  const test = async (label, url) => {
    add(`⏳ ${label}: ${url}`);
    try {
      const r = await fetch(url, { signal: _timeoutSignal(1800) });
      const txt = await r.text();
      add(`✅ ${label}: HTTP ${r.status}`);
      if (txt) add(txt.slice(0, 300));
      return { ok: r.ok, status: r.status, body: txt };
    } catch (e) {
      add(`❌ ${label}: ${e?.message || String(e)}`);
      return { ok: false, status: 0, body: "" };
    }
  };

  lines.length = 0;
  add("=== PC Vendedor (1 clic) ===");
  add(`Hora: ${new Date().toLocaleString("es-PE")}`);
  add(`Protocol: ${location.protocol}`);
  add("");
  add("Este botón descarga un instalador único para esta PC (vendedor).");
  add("Luego debes ejecutarlo como Administrador.");
  add("");

  try { localStorage.setItem("outside_queue_enabled", "1"); } catch {}
  try { localStorage.setItem("bg_scanner_enabled", "0"); } catch {}
  try { localStorage.setItem("scan_autofocus", "0"); } catch {}
  try { localStorage.setItem("scan_clean_inputs", "0"); } catch {}
  try { localStorage.setItem("scan_debug", "0"); } catch {}

  try {
    const svcUrl = document.getElementById("imp-svc-url");
    if (svcUrl && !svcUrl.value) svcUrl.value = "http://localhost:5056";
  } catch {}

  add("✅ Configuración aplicada:");
  add("- Cola externa escáner: ON (solo vendedor)");
  add("- FONDO: OFF");
  add("- Autofocus: OFF");
  add("- Limpieza inputs: OFF");
  add("");

  if (dl) {
    add("⏬ Descargando instalador: setup_pc_vendedor.cmd");
    try {
      const ver = Date.now();
      dl.href = `https://raw.githubusercontent.com/Moisesohs1007/libreria-stock/main/installer/setup_pc_vendedor.cmd?v=${ver}`;
      add(`Link: ${dl.href}`);
    } catch {}
    try { dl.click(); } catch {}
    add("1) Ejecuta el .cmd descargado como Administrador.");
    add("2) Abre el sistema por: http://127.0.0.1:8787/");
  } else {
    add("❌ No se encontró el instalador en la página.");
  }

  add("");
  add("Diagnóstico rápido (si ya está instalado):");
  if (location.protocol === "https:") {
    add("ℹ️ Estás en https (GitHub Pages). El navegador puede bloquear pruebas a http://127.0.0.1 y por eso salen timeouts aquí.");
    add("Abre estas URLs manualmente en esta PC:");
    add("- POS: http://127.0.0.1:8787/");
    add("- Escáner: http://127.0.0.1:7777/status");
    add("- Impresiones: http://127.0.0.1:5056/api/prints/health");
    add("Luego entra al POS local (http://127.0.0.1:8787/) y ahí sí el diagnóstico funcionará sin bloqueos.");
  } else {
    await test("POS 8787 (web)", "http://127.0.0.1:8787/");
    await test("ESCÁNER 7777 (status)", "http://127.0.0.1:7777/status");
    await test("IMPRESIONES 5056 (health)", "http://127.0.0.1:5056/api/prints/health");
  }
  show();
};

window.vendorPcDoctor = async function() {
  if (rolActual !== "admin") {
    mostrarMensaje("⚠️ Solo Admin puede usar Instalaciones", "warning");
    return;
  }
  const out = document.getElementById("vendor-setup-out");
  const lines = [];
  const show = () => {
    if (!out) return;
    out.style.display = "block";
    out.textContent = lines.join("\n");
  };
  const add = (s) => { lines.push(s); show(); };
  const test = async (label, url) => {
    add(`⏳ ${label}: ${url}`);
    try {
      const r = await fetch(url, { signal: _timeoutSignal(1800) });
      const txt = await r.text();
      add(`✅ ${label}: HTTP ${r.status}`);
      if (txt) add(txt.slice(0, 300));
      return { ok: r.ok, status: r.status, body: txt };
    } catch (e) {
      add(`❌ ${label}: ${e?.message || String(e)}`);
      return { ok: false, status: 0, body: "" };
    }
  };

  lines.length = 0;
  add("=== Diagnóstico PC Vendedor ===");
  add(`Hora: ${new Date().toLocaleString("es-PE")}`);
  add(`Protocol: ${location.protocol}`);
  add("");
  if (location.protocol === "https:") {
    add("ℹ️ En https, el navegador puede bloquear pruebas a http://127.0.0.1 desde esta página.");
    add("Usa el POS local (http://127.0.0.1:8787/) para diagnóstico o abre las URLs manualmente:");
    add("- POS: http://127.0.0.1:8787/");
    add("- Escáner: http://127.0.0.1:7777/status");
    add("- Escáner (peek): http://127.0.0.1:7777/peek");
    add("- Impresiones: http://127.0.0.1:5056/api/prints/health");
  } else {
    await test("POS 8787 (web)", "http://127.0.0.1:8787/");
    await test("ESCÁNER 7777 (status)", "http://127.0.0.1:7777/status");
    await test("ESCÁNER 7777 (peek)", "http://127.0.0.1:7777/peek");
    await test("IMPRESIONES 5056 (health)", "http://127.0.0.1:5056/api/prints/health");
  }
  show();
};

window.impGuardarConfig = function() {
  impSaveCfg();
  impConnectSocket();
  mostrarMensaje("✅ Configuración guardada", "ok");
};

window.impProbarConexion = async function() {
  impSaveCfg();
  try {
    await impFetchJson("/api/prints/health");
    impSetConn(true, "conectado");
    mostrarMensaje("✅ Servicio OK", "ok");
  } catch {
    impSetConn(false, "sin conexión");
    mostrarMensaje("❌ No se pudo conectar al servicio", "error");
  }
};

window.impBuscar = async function() {
  impPage = 1;
  try {
    await impRefreshAll();
  } catch {
    mostrarMensaje("❌ Error consultando impresiones", "error");
  }
};

window.impLimpiarFiltros = function() {
  const desde = document.getElementById("imp-desde"); if (desde) desde.value = "";
  const hasta = document.getElementById("imp-hasta"); if (hasta) hasta.value = "";
  const tipo = document.getElementById("imp-tipo"); if (tipo) tipo.value = "";
  const st = document.getElementById("imp-status"); if (st) st.value = "";
  const pSel = document.getElementById("imp-printers"); if (pSel) Array.from(pSel.options).forEach(o => (o.selected = false));
  const uSel = document.getElementById("imp-users"); if (uSel) Array.from(uSel.options).forEach(o => (o.selected = false));
};

window.impPrev = async function() {
  if (impPage <= 1) return;
  impPage -= 1;
  try { await impRefreshAll(); } catch {}
};

window.impNext = async function() {
  impPage += 1;
  try {
    const before = impPage;
    await impRefreshAll();
    const count = document.getElementById("imp-count");
    if (count && count.textContent === "0") {
      impPage = Math.max(1, before - 1);
      await impRefreshAll();
    }
  } catch {}
};

window.impEliminar = async function(id) {
  if (!confirm("¿Eliminar este registro?")) return;
  try {
    const url = `${impCfg.url}/api/prints/${id}`;
    const r = await fetch(url, { method: "DELETE", headers: impHeaders() });
    if (!r.ok) throw new Error(String(r.status));
    mostrarMensaje("✅ Eliminado", "ok");
    await impRefreshAll();
  } catch {
    mostrarMensaje("❌ No se pudo eliminar", "error");
  }
};

window.impExportarExcel = async function() {
  try {
    const q = impBuildQuery();
    const blob = await impFetchBlob("/api/prints/export/excel", q);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "impresiones.xlsx";
    a.click();
  } catch {
    mostrarMensaje("❌ Error exportando Excel", "error");
  }
};

window.impExportarPdf = async function() {
  try {
    const q = impBuildQuery();
    const blob = await impFetchBlob("/api/prints/export/pdf", q);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "impresiones.pdf";
    a.click();
  } catch {
    mostrarMensaje("❌ Error exportando PDF", "error");
  }
};

window._impOnTab = function(tabId) {
  if (impAutoTimer) clearInterval(impAutoTimer);
  impAutoTimer = null;
  if (tabId !== "tab-impresiones" && tabId !== "tab-impresiones-svc") return;
  impLoadCfg();
  impConnectSocket();
  (async () => {
    try {
      await impFetchJson("/api/prints/health");
      impSetConn(true, "conectado");
      if (tabId === "tab-impresiones") {
        await impLoadMeta();
        await impRefreshAll();
      }
    } catch {
      impSetConn(false, "sin conexión");
    }
  })();
  if (tabId === "tab-impresiones") {
    impAutoTimer = setInterval(() => { impRefreshAll().catch(() => {}); }, 30000);
  }
};

window._impAfterLogin = function() {
  impLoadCfg();
  impConnectSocket();
  (async () => {
    try {
      await impFetchJson("/api/prints/health");
      impSetConnVendor(true);
    } catch {
      impSetConnVendor(false);
    }
  })();
  impUpdateVendorWidget();
  clearInterval(window._impVendorTimer);
  window._impVendorTimer = setInterval(() => {
    (async () => {
      try {
        await impFetchJson("/api/prints/health");
        impSetConnVendor(true);
      } catch {
        impSetConnVendor(false);
      }
    })();
    impUpdateVendorWidget().catch(() => {});
  }, 30000);
};

function _requireAdmin() {
  if (rolActual !== "admin") {
    mostrarMensaje("⛔ Solo Admin", "error");
    return false;
  }
  return true;
}

function _normName(v) {
  return String(v || "").trim().replace(/\s+/g, " ");
}

function _uniqSorted(arr) {
  const set = new Set();
  for (const x of (arr || [])) {
    const s = String(x || "").trim();
    if (!s) continue;
    set.add(s);
  }
  return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
}

function _setSelectOptions(el, values, firstLabel) {
  if (!el) return;
  const cur = el.value;
  const opts = [];
  if (firstLabel !== undefined) opts.push(`<option value="">${firstLabel}</option>`);
  for (const v of (values || [])) {
    const safe = String(v).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    opts.push(`<option value="${safe}">${safe}</option>`);
  }
  el.innerHTML = opts.join("");
  try { el.value = cur; } catch {}
}

function _ventasInRange(from, to) {
  const f = (todasLasVentas || []).filter(v => {
    const d = _tsToDate(v.fecha);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
  return f;
}

function _ventaLineNet(v) {
  const cant = _toNum(v?.cantidad) || 1;
  const unit = _toNum(v?.precio_unitario) || _toNum(v?.precio) || 0;
  const base = unit * cant;
  const desc = _toNum(v?.descuento_monto);
  const imp = _toNum(v?.impuesto_monto);
  const net = base - desc + imp;
  let costoUnit = _toNum(v?.costo_unitario) || 0;
  if (!costoUnit) {
    const code = sanitizeScanCode(v?.codigo || "");
    const p = (code && _productoIndex?.get?.(code)) || (todosLosProductos || []).find(x => sanitizeScanCode(x?.codigo || "") === code) || null;
    costoUnit = _precioCompra(p);
  }
  const costo = (Number.isFinite(costoUnit) ? costoUnit : 0) * cant;
  return { cant, unit, base, desc, imp, net, costo };
}

function _gananciasBuildUiFilters() {
  const desde = _parseDateOnly(document.getElementById("gan-desde")?.value || "");
  const hasta = _endOfDay(_parseDateOnly(document.getElementById("gan-hasta")?.value || ""));
  const categoria = String(document.getElementById("gan-categoria")?.value || "").trim();
  const proveedor = String(document.getElementById("gan-proveedor")?.value || "").trim();
  return { desde, hasta, categoria, proveedor };
}

function _gananciasCompute(filters) {
  const desde = filters?.desde || null;
  const hasta = filters?.hasta || null;
  const categoria = String(filters?.categoria || "").trim();
  const proveedor = String(filters?.proveedor || "").trim();
  const ventas = _ventasInRange(desde, hasta);
  const byCode = new Map();
  const series = new Map();
  for (const v of ventas) {
    const vcode = sanitizeScanCode(v?.codigo || "");
    const p =
      (vcode && _productoIndex?.get?.(vcode)) ||
      (todosLosProductos || []).find(x => sanitizeScanCode(x?.codigo || "") === vcode) ||
      null;
    const pc = String(p?.categoria || "").trim();
    const pv = String(p?.proveedor || "").trim();
    if (categoria && pc !== categoria) continue;
    if (proveedor && pv !== proveedor) continue;
    const ln = _ventaLineNet(v);
    const code = String(v?.codigo || p?.codigo || "").trim() || "—";
    const name = String(v?.nombre || p?.nombre || "").trim() || "Producto";
    const cur = byCode.get(code) || { codigo: code, producto: name, cant: 0, ingresos: 0, costos: 0, utilidad: 0 };
    cur.cant += ln.cant;
    cur.ingresos += ln.net;
    cur.costos += ln.costo;
    cur.utilidad = cur.ingresos - cur.costos;
    byCode.set(code, cur);
    const d = _tsToDate(v?.fecha) || new Date();
    const k = _dateToYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0));
    const s = series.get(k) || { k, ingresos: 0, costos: 0, utilidad: 0 };
    s.ingresos += ln.net;
    s.costos += ln.costo;
    s.utilidad = s.ingresos - s.costos;
    series.set(k, s);
  }
  const rows = Array.from(byCode.values()).sort((a, b) => (b.utilidad - a.utilidad) || a.producto.localeCompare(b.producto));
  const ingresos = rows.reduce((s, r) => s + r.ingresos, 0);
  const costos = rows.reduce((s, r) => s + r.costos, 0);
  const utilidadBruta = ingresos - costos;
  const serie = Array.from(series.values()).sort((a, b) => a.k.localeCompare(b.k));
  return { rows, ingresos, costos, utilidadBruta, serie, ventasCount: ventas.length };
}

async function _movFetchRange(from, to) {
  const qy = query(
    collection(db, "fin_movimientos"),
    where("fecha", ">=", from),
    where("fecha", "<=", to)
  );
  const snap = await getDocs(qy);
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  arr.sort((a, b) => {
    const da = _tsToDate(a.fecha) || new Date(0);
    const dbb = _tsToDate(b.fecha) || new Date(0);
    return dbb - da;
  });
  return arr;
}

function _movRangeFromUi() {
  const modo = String(document.getElementById("movf-periodo")?.value || "rango");
  const year = parseInt(document.getElementById("movf-year")?.value || "") || new Date().getFullYear();
  const month = parseInt(document.getElementById("movf-month")?.value || "") || 0;
  const tri = parseInt(document.getElementById("movf-tri")?.value || "") || 0;
  const inpDesde = document.getElementById("movf-desde");
  const inpHasta = document.getElementById("movf-hasta");
  let from = null;
  let to = null;
  if (modo === "mensual" && year && month) {
    from = new Date(year, month - 1, 1, 0, 0, 0, 0);
    to = new Date(year, month, 0, 23, 59, 59, 999);
  } else if (modo === "trimestral" && year && tri) {
    const m0 = (tri - 1) * 3;
    from = new Date(year, m0, 1, 0, 0, 0, 0);
    to = new Date(year, m0 + 3, 0, 23, 59, 59, 999);
  } else if (modo === "anual" && year) {
    from = new Date(year, 0, 1, 0, 0, 0, 0);
    to = new Date(year, 12, 0, 23, 59, 59, 999);
  } else {
    const d = _parseDateOnly(inpDesde?.value || "");
    const h = _endOfDay(_parseDateOnly(inpHasta?.value || ""));
    if (d && h) { from = d; to = h; }
    else if (d && !h) { from = d; to = _endOfDay(d); }
    else if (!d && h) { from = _parseDateOnly(inpHasta?.value || ""); to = h; }
    if (!from || !to) {
      const n = new Date();
      from = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0, 0);
      to = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59, 999);
    }
  }
  if (inpDesde) inpDesde.value = _dateToYmd(from);
  if (inpHasta) inpHasta.value = _dateToYmd(to);
  const doCompare = !!document.getElementById("movf-compare")?.checked;
  let prev = null;
  if (doCompare) {
    const ms = (to.getTime() - from.getTime()) + 1;
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - ms + 1);
    prev = { from: prevFrom, to: prevTo };
  }
  return { from, to, prev };
}

function _movTotals(arr) {
  let ing = 0, egr = 0, imp = 0, desc = 0;
  for (const m of (arr || [])) {
    const tipo = String(m?.tipo || "").toLowerCase();
    const monto = _toNum(m?.monto);
    const imps = _toNum(m?.impuesto_monto);
    const descuento = _toNum(m?.descuento_monto);
    if (tipo === "ingreso") ing += monto;
    if (tipo === "egreso") egr += monto;
    imp += imps;
    desc += descuento;
  }
  return { ing, egr, neto: ing - egr, imp, desc };
}

function _renderMovTabla(rows) {
  const tbody = document.getElementById("mov-tabla");
  if (!tbody) return;
  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#aaa;padding:18px;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">Sin datos</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(m => {
    const d = _tsToDate(m.fecha) || new Date();
    const tipo = String(m.tipo || "");
    const cat = String(m.categoria || "");
    const cuenta = String(m.cuenta || "");
    const desc = String(m.descripcion || "");
    const monto = _fmtS(m.monto);
    const imp = _fmtS(m.impuesto_monto);
    const des = _fmtS(m.descuento_monto);
    return `<tr>
      <td class="mono">${_dateToYmd(d)}</td>
      <td>${tipo}</td>
      <td>${cat}</td>
      <td>${cuenta}</td>
      <td style="max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${desc}</td>
      <td class="mono" style="font-weight:800;">${monto}</td>
      <td class="mono">${imp}</td>
      <td class="mono">${des}</td>
      <td><button class="btn btn-danger" style="padding:6px 10px;font-size:0.72rem;" onclick="movEliminar('${m.id}')">🗑</button></td>
    </tr>`;
  }).join("");
}

function _renderMovEerr(cur, prev) {
  const tbody = document.getElementById("mov-eerr");
  const colComp = document.getElementById("eerr-col-comp");
  if (!tbody) return;
  const showPrev = !!prev;
  if (colComp) colComp.style.display = showPrev ? "" : "none";
  const row = (name, v1, v0) => {
    const a = `<td>${name}</td><td class="mono" style="font-weight:900;">${_fmtS(v1)}</td>`;
    const b = showPrev ? `<td class="mono" style="font-weight:900;">${_fmtS(v0)}</td>` : `<td style="display:none;"></td>`;
    return `<tr>${a}${showPrev ? b : ""}</tr>`;
  };
  const rows = [];
  rows.push(row("Ventas netas", cur.ventasNet, prev?.ventasNet || 0));
  rows.push(row("Costo de ventas", cur.cogs, prev?.cogs || 0));
  rows.push(row("Utilidad bruta", cur.ventasNet - cur.cogs, (prev?.ventasNet || 0) - (prev?.cogs || 0)));
  rows.push(row("Otros ingresos", cur.otrosIng, prev?.otrosIng || 0));
  rows.push(row("Gastos/Egresos", cur.egresos, prev?.egresos || 0));
  rows.push(row("Utilidad neta", cur.utilidadNeta, prev?.utilidadNeta || 0));
  tbody.innerHTML = rows.join("");
}

window._finRenderAll = function() {
  try {
    const n = new Date();
    const mf = document.getElementById("mov-fecha");
    if (mf && !String(mf.value || "").trim()) mf.value = _dateToYmd(n);
  } catch {}
  try {
    const prodCats = _uniqSorted((todosLosProductos || []).map(p => p.categoria || ""));
    const prodProvs = _uniqSorted((todosLosProductos || []).map(p => p.proveedor || ""));
    _setSelectOptions(document.getElementById("gan-categoria"), prodCats, "Todas");
    _setSelectOptions(document.getElementById("gan-proveedor"), prodProvs, "Todos");
  } catch {}
  try {
    const cats = _uniqSorted((todasLasCategorias || []).map(c => c.nombre || ""));
    const provs = _uniqSorted((todosLosProveedores || []).map(p => p.nombre || ""));
    _setSelectOptions(document.getElementById("mov-categoria"), cats, "Sin categoría");
    _setSelectOptions(document.getElementById("mov-proveedor"), provs, "—");
  } catch {}
  try {
    const catList = document.getElementById("cat-lista");
    if (catList) {
      const cats = _uniqSorted((todasLasCategorias || []).map(c => c.nombre || ""));
      if (!cats.length) catList.innerHTML = `<div style="text-align:center;color:#aaa;padding:12px;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">Sin categorías</div>`;
      else catList.innerHTML = (todasLasCategorias || []).slice().sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""))).map(c => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border);gap:10px;">
          <span style="font-family:'IBM Plex Mono',monospace;font-size:0.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${String(c.nombre || "")}</span>
          <button class="btn btn-danger" style="padding:6px 10px;font-size:0.72rem;" onclick="catEliminar('${c.id}')">🗑</button>
        </div>
      `).join("");
    }
    const provList = document.getElementById("prov-lista");
    if (provList) {
      const provs = _uniqSorted((todosLosProveedores || []).map(p => p.nombre || ""));
      if (!provs.length) provList.innerHTML = `<div style="text-align:center;color:#aaa;padding:12px;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">Sin proveedores</div>`;
      else provList.innerHTML = (todosLosProveedores || []).slice().sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""))).map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border);gap:10px;">
          <span style="font-family:'IBM Plex Mono',monospace;font-size:0.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${String(p.nombre || "")}</span>
          <button class="btn btn-danger" style="padding:6px 10px;font-size:0.72rem;" onclick="provEliminar('${p.id}')">🗑</button>
        </div>
      `).join("");
    }
  } catch {}
};

window.catAgregar = async function() {
  if (!_requireAdmin()) return;
  const raw = document.getElementById("cat-nombre")?.value || "";
  const nombre = _normName(raw);
  if (!nombre) return mostrarMensaje("⚠️ Ingresa un nombre", "warning");
  const dup = (todasLasCategorias || []).some(c => String(c?.nombre || "").toLowerCase() === nombre.toLowerCase());
  if (dup) return mostrarMensaje("⚠️ Ya existe", "warning");
  try {
    const ref = await addDoc(collection(db, "fin_categorias"), { nombre, creadoEn: new Date() });
    await _auditLog("create", "fin_categorias", ref.id, null, { nombre });
    const el = document.getElementById("cat-nombre"); if (el) el.value = "";
    mostrarMensaje("✅ Categoría agregada", "ok");
  } catch {
    mostrarMensaje("❌ Error agregando categoría", "error");
  }
};

window.catEliminar = async function(id) {
  if (!_requireAdmin()) return;
  if (!confirm("¿Eliminar categoría?")) return;
  const before = (todasLasCategorias || []).find(x => x?.id === id) || null;
  try {
    await deleteDoc(doc(db, "fin_categorias", id));
    await _auditLog("delete", "fin_categorias", id, before, null);
    mostrarMensaje("🗑 Eliminado", "warning");
  } catch {
    mostrarMensaje("❌ Error eliminando", "error");
  }
};

window.provAgregar = async function() {
  if (!_requireAdmin()) return;
  const raw = document.getElementById("prov-nombre")?.value || "";
  const nombre = _normName(raw);
  if (!nombre) return mostrarMensaje("⚠️ Ingresa un nombre", "warning");
  const dup = (todosLosProveedores || []).some(p => String(p?.nombre || "").toLowerCase() === nombre.toLowerCase());
  if (dup) return mostrarMensaje("⚠️ Ya existe", "warning");
  try {
    const ref = await addDoc(collection(db, "fin_proveedores"), { nombre, creadoEn: new Date() });
    await _auditLog("create", "fin_proveedores", ref.id, null, { nombre });
    const el = document.getElementById("prov-nombre"); if (el) el.value = "";
    mostrarMensaje("✅ Proveedor agregado", "ok");
  } catch {
    mostrarMensaje("❌ Error agregando proveedor", "error");
  }
};

window.provEliminar = async function(id) {
  if (!_requireAdmin()) return;
  if (!confirm("¿Eliminar proveedor?")) return;
  const before = (todosLosProveedores || []).find(x => x?.id === id) || null;
  try {
    await deleteDoc(doc(db, "fin_proveedores", id));
    await _auditLog("delete", "fin_proveedores", id, before, null);
    mostrarMensaje("🗑 Eliminado", "warning");
  } catch {
    mostrarMensaje("❌ Error eliminando", "error");
  }
};

async function _uploadComprobante(file, movId) {
  if (!file) return null;
  const max = 8 * 1024 * 1024;
  if ((file.size || 0) > max) throw new Error("Archivo muy grande (máx 8MB)");
  const safeName = String(file.name || "comprobante").replace(/[^\w.\-]+/g, "_");
  const d = new Date();
  const path = `comprobantes/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}/${movId}_${safeName}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  return { path, url, name: file.name || "", size: file.size || 0, type: file.type || "" };
}

window.movGuardar = async function() {
  if (!_requireAdmin()) return;
  const tipo = String(document.getElementById("mov-tipo")?.value || "").trim();
  const fechaStr = String(document.getElementById("mov-fecha")?.value || "").trim();
  const fecha = _parseDateOnly(fechaStr) || new Date();
  const monto = _toNum(document.getElementById("mov-monto")?.value || 0);
  const cuenta = _normName(document.getElementById("mov-cuenta")?.value || "");
  const categoria = _normName(document.getElementById("mov-categoria")?.value || "");
  const proveedor = _normName(document.getElementById("mov-proveedor")?.value || "");
  const impuesto_monto = _toNum(document.getElementById("mov-impuesto")?.value || 0);
  const descuento_monto = _toNum(document.getElementById("mov-descuento")?.value || 0);
  const descripcion = _normName(document.getElementById("mov-desc")?.value || "");
  const comprobante_url = _normName(document.getElementById("mov-doc")?.value || "");
  const file = document.getElementById("mov-doc-file")?.files?.[0] || null;
  if (tipo !== "ingreso" && tipo !== "egreso") return mostrarMensaje("⚠️ Tipo inválido", "warning");
  if (!Number.isFinite(monto) || monto <= 0) return mostrarMensaje("⚠️ Monto inválido", "warning");
  if (!cuenta) return mostrarMensaje("⚠️ Cuenta requerida", "warning");
  const { rol, nombre, user_id, usuario } = leerSesion();
  const movRef = doc(collection(db, "fin_movimientos"));
  const base = {
    tipo,
    fecha,
    monto,
    cuenta,
    categoria,
    proveedor,
    impuesto_monto,
    descuento_monto,
    descripcion,
    comprobante_url,
    comprobante: null,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
    actor: { rol: rol || "", nombre: nombre || "", user_id: user_id || "", usuario: usuario || "" },
  };
  try {
    await setDoc(movRef, base);
    let comp = null;
    if (file) comp = await _uploadComprobante(file, movRef.id);
    if (comp) await updateDoc(doc(db, "fin_movimientos", movRef.id), { comprobante: comp, actualizadoEn: new Date() });
    await _auditLog("create", "fin_movimientos", movRef.id, null, { ...base, comprobante: comp });
    ["mov-monto","mov-cuenta","mov-impuesto","mov-descuento","mov-desc","mov-doc"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    const mf = document.getElementById("mov-fecha"); if (mf) mf.value = _dateToYmd(new Date());
    const fi = document.getElementById("mov-doc-file"); if (fi) fi.value = "";
    mostrarMensaje("✅ Movimiento guardado", "ok");
    await window.movActualizar();
  } catch (e) {
    mostrarMensaje(`❌ Error guardando: ${String(e?.message || e)}`, "error");
  }
};

window.movEliminar = async function(id) {
  if (!_requireAdmin()) return;
  if (!confirm("¿Eliminar movimiento?")) return;
  try {
    const before = (todosLosMovimientos || []).find(x => x?.id === id) || null;
    await deleteDoc(doc(db, "fin_movimientos", id));
    await _auditLog("delete", "fin_movimientos", id, before, null);
    mostrarMensaje("🗑 Eliminado", "warning");
    await window.movActualizar();
  } catch {
    mostrarMensaje("❌ Error eliminando", "error");
  }
};

window.movActualizar = async function() {
  if (!_requireAdmin()) return;
  const r = _movRangeFromUi();
  try {
    const rows = await _movFetchRange(r.from, r.to);
    todosLosMovimientos = rows;
    const tot = _movTotals(rows);
    const elIng = document.getElementById("mov-ing");
    const elEgr = document.getElementById("mov-egr");
    const elNet = document.getElementById("mov-neto");
    const elImp = document.getElementById("mov-imps");
    if (elIng) elIng.textContent = _fmtS(tot.ing);
    if (elEgr) elEgr.textContent = _fmtS(tot.egr);
    if (elNet) elNet.textContent = _fmtS(tot.neto);
    if (elImp) elImp.textContent = _fmtS(tot.imp);
    _renderMovTabla(rows);
    if (!rows?.length) mostrarMensaje("ℹ️ No hay movimientos registrados en ese período", "warning");
    const ventas = _ventasInRange(r.from, r.to);
    const ventasNet = ventas.reduce((s, v) => s + _ventaLineNet(v).net, 0);
    const cogs = ventas.reduce((s, v) => s + _ventaLineNet(v).costo, 0);
    const otrosIng = tot.ing;
    const egresos = tot.egr;
    const utilidadNeta = (ventasNet - cogs) + otrosIng - egresos;
    let prevEerr = null;
    if (r.prev) {
      const prevRows = await _movFetchRange(r.prev.from, r.prev.to);
      const prevTot = _movTotals(prevRows);
      const prevVentas = _ventasInRange(r.prev.from, r.prev.to);
      const prevVentasNet = prevVentas.reduce((s, v) => s + _ventaLineNet(v).net, 0);
      const prevCogs = prevVentas.reduce((s, v) => s + _ventaLineNet(v).costo, 0);
      const prevOtrosIng = prevTot.ing;
      const prevEgr = prevTot.egr;
      const prevUtil = (prevVentasNet - prevCogs) + prevOtrosIng - prevEgr;
      prevEerr = { ventasNet: prevVentasNet, cogs: prevCogs, otrosIng: prevOtrosIng, egresos: prevEgr, utilidadNeta: prevUtil };
    }
    _renderMovEerr({ ventasNet, cogs, otrosIng, egresos, utilidadNeta }, prevEerr);
  } catch (e) {
    mostrarMensaje(`❌ Error actualizando: ${String(e?.message || e)}`, "error");
  }
};

window.movExportarExcel = function() {
  if (!_requireAdmin()) return;
  const r = _movRangeFromUi();
  const built = buildMovimientosExport(todosLosMovimientos, { from: r?.from || null, to: r?.to || null });
  const sub = [
    r?.from ? `Desde: ${_dateToYmd(r.from)}` : "Desde: —",
    r?.to ? `Hasta: ${_dateToYmd(r.to)}` : "Hasta: —"
  ].join("  |  ");
  const wb = _mkReportBook({
    title: "Reporte de movimientos (ingresos/egresos)",
    subtitle: sub,
    dataRows: built.rows,
    columns: built.columns,
    statsRows: [
      { k: "Movimientos", v: built.stats.movimientos },
      { k: "Ingresos", v: Number(built.stats.ingresos || 0).toFixed(2) },
      { k: "Egresos", v: Number(built.stats.egresos || 0).toFixed(2) },
      { k: "Neto", v: Number(built.stats.neto || 0).toFixed(2) }
    ],
    sheetName: "Movimientos"
  });
  XLSX.writeFile(wb, `movimientos_${new Date().toLocaleDateString("es-PE").replace(/\//g,"-")}.xlsx`);
};

window.gananciasCalcular = async function() {
  if (!_requireAdmin()) return;
  const f = _gananciasBuildUiFilters();
  if (!f.desde || !f.hasta) {
    const n = new Date();
    const d = new Date(n.getFullYear(), n.getMonth(), 1);
    document.getElementById("gan-desde").value = _dateToYmd(d);
    document.getElementById("gan-hasta").value = _dateToYmd(n);
    f.desde = _parseDateOnly(document.getElementById("gan-desde").value);
    f.hasta = _endOfDay(_parseDateOnly(document.getElementById("gan-hasta").value));
  }
  const res = _gananciasCompute(f);
  if (!res?.rows?.length) mostrarMensaje("ℹ️ Sin ventas en el rango seleccionado", "warning");
  const egresosOp = (await (async () => {
    try {
      const movs = await _movFetchRange(f.desde, f.hasta);
      return _movTotals(movs).egr;
    } catch { return 0; }
  })());
  const elIng = document.getElementById("gan-ingresos");
  const elCos = document.getElementById("gan-costos");
  const elOp = document.getElementById("gan-operativos");
  const elUt = document.getElementById("gan-utilidad");
  const utilidad = res.utilidadBruta - egresosOp;
  if (elIng) elIng.textContent = _fmtS(res.ingresos);
  if (elCos) elCos.textContent = _fmtS(res.costos);
  if (elOp) elOp.textContent = _fmtS(egresosOp);
  if (elUt) elUt.textContent = _fmtS(utilidad);
  const tbody = document.getElementById("gan-tabla");
  if (tbody) {
    if (!res.rows.length) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#aaa;padding:18px;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">Sin datos</td></tr>`;
    else tbody.innerHTML = res.rows.map(r => {
      const margen = r.ingresos > 0 ? (r.utilidad / r.ingresos) * 100 : 0;
      return `<tr>
        <td>${r.producto}</td>
        <td class="mono">${r.cant.toLocaleString()}</td>
        <td class="mono">${_fmtS(r.ingresos)}</td>
        <td class="mono">${_fmtS(r.costos)}</td>
        <td class="mono" style="font-weight:900;color:${r.utilidad>=0?"var(--green)":"#ef4444"};">${_fmtS(r.utilidad)}</td>
        <td class="mono">${margen.toFixed(1)}%</td>
      </tr>`;
    }).join("");
  }
  try {
    const canvas = document.getElementById("gan-chart-canvas");
    if (!canvas || typeof Chart === "undefined") return;
    const labels = res.serie.map(x => x.k);
    const data = res.serie.map(x => x.utilidad);
    if (window._ganChart) { try { window._ganChart.destroy(); } catch {} }
    window._ganChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets: [{ label: "Utilidad bruta", data, borderColor: "#10b981", backgroundColor: "rgba(16,185,129,0.15)", fill: true, tension: 0.25, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6 } }, y: { ticks: { callback: (v) => `S/${Number(v).toFixed(0)}` } } } }
    });
  } catch {}
  window._ganLast = { filtros: f, res, egresosOp, utilidad };
};

window.gananciasExportarExcel = function() {
  if (!_requireAdmin()) return;
  const last = window._ganLast;
  if (!last) return mostrarMensaje("⚠️ Primero calcula", "warning");
  const { filtros, res, egresosOp, utilidad } = last;
  const detalle = (res.rows || []).map(r => ({
    Producto: r.producto,
    Cantidad: r.cant,
    Ingresos: _toNum(r.ingresos),
    Costos: _toNum(r.costos),
    Utilidad: _toNum(r.utilidad),
    Margen: r.ingresos > 0 ? (r.utilidad / r.ingresos) : 0,
  }));
  const sub = [
    filtros.desde ? `Desde: ${_dateToYmd(filtros.desde)}` : "Desde: —",
    filtros.hasta ? `Hasta: ${_dateToYmd(filtros.hasta)}` : "Hasta: —",
    `Categoría: ${filtros.categoria || "Todas"}`,
    `Proveedor: ${filtros.proveedor || "Todos"}`
  ].join("  |  ");
  const margenBruto = res.ingresos > 0 ? (res.utilidadBruta / res.ingresos) : 0;
  const wb = _mkReportBook({
    title: "Análisis de ganancias",
    subtitle: sub,
    dataRows: detalle,
    columns: [
      { Columna: "Producto", Descripción: "Nombre del producto." },
      { Columna: "Cantidad", Descripción: "Unidades vendidas en el período." },
      { Columna: "Ingresos", Descripción: "Ingresos por ventas (S/), considerando registros de venta." },
      { Columna: "Costos", Descripción: "Costo de adquisición (S/) según precio_compra * cantidad." },
      { Columna: "Utilidad", Descripción: "Ingresos - costos." },
      { Columna: "Margen", Descripción: "Utilidad / ingresos (0–1)." }
    ],
    statsRows: [
      { k: "Ingresos", v: Number(res.ingresos || 0).toFixed(2) },
      { k: "Costos", v: Number(res.costos || 0).toFixed(2) },
      { k: "Egresos op.", v: Number(egresosOp || 0).toFixed(2) },
      { k: "Utilidad", v: Number(utilidad || 0).toFixed(2) },
      { k: "Margen bruto", v: (Number(margenBruto || 0) * 100).toFixed(2) + "%" }
    ],
    sheetName: "Ganancias"
  });
  XLSX.writeFile(wb, `ganancias_${new Date().toLocaleDateString("es-PE").replace(/\//g,"-")}.xlsx`);
};

window.gananciasExportarPDF = function() {
  if (!_requireAdmin()) return;
  const last = window._ganLast;
  if (!last) return mostrarMensaje("⚠️ Primero calcula", "warning");
  const { filtros, res, egresosOp, utilidad } = last;
  const b = _brandInfo();
  const img = (() => {
    try {
      const c = document.getElementById("gan-chart-canvas");
      if (!c) return "";
      return c.toDataURL("image/png");
    } catch { return ""; }
  })();
  const w = window.open("", "_blank");
  if (!w) return mostrarMensaje("⚠️ Permite ventanas emergentes", "warning");
  const title = "Análisis de ganancias";
  const sub = [
    filtros.desde ? `Desde: ${_dateToYmd(filtros.desde)}` : "Desde: —",
    filtros.hasta ? `Hasta: ${_dateToYmd(filtros.hasta)}` : "Hasta: —",
    `Categoría: ${filtros.categoria || "Todas"}`,
    `Proveedor: ${filtros.proveedor || "Todos"}`
  ].join("  |  ");
  const head = `<meta charset="utf-8"><title>${title}</title>
    <style>
      :root{--g:#10b981;--b:#111827;--m:#6b7280;--bd:#e5e7eb;}
      body{font-family:Arial, sans-serif; padding:22px; color:var(--b);}
      .hdr{display:flex;align-items:center;gap:12px;margin-bottom:10px;}
      .logo{width:40px;height:40px;object-fit:contain;border-radius:10px;border:1px solid var(--bd);padding:6px;background:#fff;}
      h1{font-size:18px;margin:0;}
      .sub{color:var(--m);font-size:12px;margin-top:2px;}
      .box{border:1px solid var(--bd);padding:12px;border-radius:12px;margin:10px 0;}
      .k{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px;}
      .k .box{margin:0;}
      .k .v{font-size:16px;font-weight:900;}
      table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px;}
      th,td{border:1px solid var(--bd);padding:6px;text-align:left;vertical-align:top;}
      th{background:#f9fafb;font-weight:900;}
      .mono{font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;}
      .right{text-align:right;}
      .small{font-size:11px;color:var(--m);}
    </style>`;
  const body = `
    <div class="hdr">
      <img class="logo" src="${b.logoUrl}" onerror="this.style.display='none'">
      <div>
        <div style="font-weight:900;">${b.nombre}</div>
        <h1>${title}</h1>
        <div class="sub">${sub}</div>
      </div>
    </div>
    <div class="k">
      <div class="box"><div class="small">Ingresos</div><div class="v" style="color:#60a5fa;">${_fmtS(res.ingresos)}</div></div>
      <div class="box"><div class="small">Costos</div><div class="v" style="color:#f87171;">${_fmtS(res.costos)}</div></div>
      <div class="box"><div class="small">Egresos op.</div><div class="v" style="color:#f59e0b;">${_fmtS(egresosOp)}</div></div>
      <div class="box"><div class="small">Utilidad</div><div class="v" style="color:var(--g);">${_fmtS(utilidad)}</div></div>
    </div>
    <div class="box">
      <div style="font-weight:900;margin-bottom:6px;">Descripción de columnas</div>
      <div class="small"><span class="mono">Producto:</span> Nombre del producto.</div>
      <div class="small"><span class="mono">Cant:</span> Unidades vendidas en el período.</div>
      <div class="small"><span class="mono">Ingresos:</span> Total vendido (S/).</div>
      <div class="small"><span class="mono">Costos:</span> Costo de adquisición (S/).</div>
      <div class="small"><span class="mono">Utilidad:</span> Ingresos - costos.</div>
      <div class="small"><span class="mono">Margen:</span> Utilidad / ingresos (porcentaje).</div>
    </div>
    ${img ? `<div class="box"><div style="font-weight:900;margin-bottom:6px;">Tendencia</div><img src="${img}" style="width:100%;max-height:220px;object-fit:contain;"></div>` : ""}
    <div class="box">
      <div style="font-weight:900;margin-bottom:8px;">Margen por producto</div>
      <table>
        <thead><tr><th>Producto</th><th class="right">Cant</th><th class="right">Ingresos</th><th class="right">Costos</th><th class="right">Utilidad</th><th class="right">Margen</th></tr></thead>
        <tbody>
          ${(res.rows || []).slice(0, 200).map(r => {
            const margen = r.ingresos > 0 ? (r.utilidad / r.ingresos) * 100 : 0;
            return `<tr><td>${r.producto}</td><td class="mono right">${r.cant}</td><td class="mono right">${_fmtS(r.ingresos)}</td><td class="mono right">${_fmtS(r.costos)}</td><td class="mono right">${_fmtS(r.utilidad)}</td><td class="mono right">${margen.toFixed(1)}%</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
  w.document.open();
  w.document.write(`<html><head>${head}</head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch {} }, 300);
};

setTimeout(() => { try { window._finRenderAll(); } catch {} }, 500);

impLoadCfg();
