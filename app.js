/**
 * APP.JS - Lógica principal de la aplicación (Módulo ES6)
 * Gestiona autenticación, inventario, ventas, reportes e integraciones.
 * 
 * Este archivo se importa como <script type="module" src="app.js"></script>
 * Por lo tanto, las funciones accesibles desde el HTML (onclick) deben
 * asignarse explícitamente al objeto 'window'.
 */

import { db } from './firebase-config.js';
import { sanitizeScanCode, buildScanVariants, isLikelyScanByTiming } from './scanner_utils.js';
import {
  collection, getDocs, query, where, updateDoc, addDoc, onSnapshot, doc, 
  increment, deleteDoc, Timestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let rolActual          = null; 
let nombreVendedor     = "";
let listenersIniciados = false;

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
  if (scannerInput) scannerInput.focus();
  iniciarListeners();
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
  if (window._impAfterLogin) window._impAfterLogin();
}

window.cerrarSesion = function() {
  borrarSesion();
  rolActual = null;
  document.getElementById("vendedor-screen").style.display = "none";
  document.getElementById("admin-screen").style.display    = "none";
  document.getElementById("login-screen").style.display    = "flex";
  document.getElementById("login-user").value = "";
  document.getElementById("login-pass").value = "";
};

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
  cerrarSidebar();
  if (scannerInput) setTimeout(() => scannerInput.focus(), 100);
  if (window._impOnTab) window._impOnTab(tabId);
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
  if (scannerInput) setTimeout(() => scannerInput.focus(), 100);
  if (window._impOnTab) window._impOnTab(tabId);
  if (tabId === "tab-etiquetas" && (!todosLosProductos || !todosLosProductos.length) && typeof window._cargarProductosOnce === "function") {
    window._cargarProductosOnce();
  }
};

window.cerrarModal = function(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove("active");
  if (scannerInput) setTimeout(() => scannerInput.focus(), 100);
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
    },
    () => {
      cargarProductosOnce();
    }
  );

  onSnapshot(collection(db,"ventas"), snap => {
    todasLasVentas = snap.docs.map(d => d.data());
    actualizarUIVentas();
  });

  cargarClientesFiados();
  cargarFiadasDia();

  onSnapshot(collection(db,"vendedores"), snap => {
    const lista = snap.docs.map(d => ({id:d.id,...d.data()}));
    renderizarVendedores(lista);
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
    inv.innerHTML=`<tr><td colspan="5" style="text-align:center;color:#aaa;padding:24px;font-family:'IBM Plex Mono',monospace;">Sin resultados</td></tr>`; 
    return; 
  }
  inv.innerHTML = prods.map(p => {
    const bc = p.stock<=0?"badge-empty":p.stock<=5?"badge-low":"badge-ok";
    const n  = p.nombre.replace(/'/g,"\\'");
    return `<tr>
      <td style="font-weight:600;">${p.nombre}</td>
      <td class="mono" style="font-size:0.76rem;color:#555;">${p.codigo}</td>
      <td><span class="badge-stock ${bc}">${p.stock}</span></td>
      <td class="mono" style="font-weight:700;color:var(--green);">S/ ${parseFloat(p.precio).toFixed(2)}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap;">
        <button onclick="abrirEdicion('${p.id}','${n}',${p.stock},${p.precio})" class="btn btn-edit">✏️</button>
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
      const precio = parseFloat(p.precio);
      const imgHtml = await buildCodeImageHtml(codigo, tipo, codePx);
      const html = `
        <div style="font-size:12px;font-weight:900;line-height:1.2;margin-bottom:2px;overflow:hidden;max-height:2.6em;">${nombre}</div>
        ${imgHtml || `<div class="mono" style="font-size:11px;color:#64748b;margin:4px 0;">${codigo}</div>`}
        <div style="font-size:10px;color:#475569;" class="mono">${codigo}</div>
        <div style="font-size:12px;font-weight:900;">S/ ${Number.isFinite(precio) ? precio.toFixed(2) : "0.00"}</div>
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

window.agregarProducto = async function() {
  const nombre=document.getElementById("nombre").value.trim();
  const stock=parseInt(document.getElementById("stock").value);
  const precio=parseFloat(document.getElementById("precio").value);
  if(!nombre){mostrarMensaje("⚠️ Falta el nombre","error");return;}
  if(isNaN(stock)||stock<0){mostrarMensaje("⚠️ Stock inválido","error");return;}
  if(isNaN(precio)||precio<0){mostrarMensaje("⚠️ Precio inválido","error");return;}
  const codigo="LIB-"+Date.now().toString().slice(-8);
  try{
    await addDoc(collection(db,"productos"),{codigo,nombre,stock,precio,creadoEn:new Date()});
    mostrarMensaje(`✅ "${nombre}" agregado`,"ok");
    ["nombre","stock","precio"].forEach(id=>document.getElementById(id).value="");
  }catch(e){mostrarMensaje("❌ Error: "+e.message,"error");}
};

window.abrirEdicion = function(id,nombre,stock,precio){
  document.getElementById("edit-id").value    =id;
  document.getElementById("edit-nombre").value=nombre;
  document.getElementById("edit-stock").value =stock;
  document.getElementById("edit-precio").value=precio;
  const modal = document.getElementById("modal-editar");
  if (modal) modal.classList.add("active");
};

window.guardarEdicion = async function(){
  const id    = document.getElementById("edit-id").value;
  const nombre= document.getElementById("edit-nombre").value.trim();
  const stock = parseInt(document.getElementById("edit-stock").value);
  const precio= parseFloat(document.getElementById("edit-precio").value);
  if(!nombre || isNaN(stock) || isNaN(precio)){
    mostrarMensaje("⚠️ Completa todos los campos correctamente", "error");
    return;
  }
  try {
    await updateDoc(doc(db, "productos", id), { nombre, stock, precio });
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
    const nombre = (row.Nombre||row.nombre||"").toString().trim();
    const stock  = parseInt(row.Stock||row.stock||0);
    const precio = parseFloat(row.Precio||row.precio||0);
    if (!nombre) continue;
    try {
      await addDoc(collection(db,"productos"),{codigo:"LIB-"+Date.now().toString().slice(-8),nombre,stock,precio,creadoEn:new Date()});
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
  const ws = XLSX.utils.json_to_sheet([{Nombre:"Producto Ejemplo", Stock:10, Precio:5.00}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
  XLSX.writeFile(wb, "plantilla_productos.xlsx");
};

window.exportarExcel = function(){
  const datos=todosLosProductos.map(p=>({Nombre:p.nombre,Código:p.codigo,Stock:p.stock,Precio:p.precio}));
  const ws=XLSX.utils.json_to_sheet(datos);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Inventario");
  XLSX.writeFile(wb,`inventario_${new Date().toLocaleDateString("es-PE").replace(/\//g,"-")}.xlsx`);
};

window.exportarHistorialExcel = function() {
  const desde = document.getElementById("filtro-desde")?.value || "";
  const hasta = document.getElementById("filtro-hasta")?.value || "";
  let f = todasLasVentas;
  if (desde) { const d = new Date(desde); d.setHours(0, 0, 0, 0); f = f.filter(v => { const t = v.fecha?.toDate ? v.fecha.toDate() : new Date(v.fecha); return t >= d; }); }
  if (hasta) { const h = new Date(hasta); h.setHours(23, 59, 59, 999); f = f.filter(v => { const t = v.fecha?.toDate ? v.fecha.toDate() : new Date(v.fecha); return t <= h; }); }
  const datos = f.map(v => {
    const ft = v.fecha?.toDate ? v.fecha.toDate() : new Date(v.fecha);
    return { Fecha: ft.toLocaleDateString("es-PE"), Hora: ft.toLocaleTimeString("es-PE"), Producto: v.nombre, Precio: v.precio, Código: v.codigo || "" };
  });
  const ws = XLSX.utils.json_to_sheet(datos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ventas");
  XLSX.writeFile(wb, `ventas_${new Date().toLocaleDateString("es-PE").replace(/\//g,"-")}.xlsx`);
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
  const totalHoy = ventasHoy.reduce((s,v)=>s+(v.precio||0),0);

  const svh = document.getElementById("stat-ventas-hoy");
  const sth = document.getElementById("stat-total-hoy");
  if(svh) svh.textContent = ventasHoy.length;
  if(sth) sth.textContent = `S/${totalHoy.toFixed(2)}`;

  const vvh = document.getElementById("v-ventas-hoy");
  const vth = document.getElementById("v-total-hoy");
  if(vvh) vvh.textContent = ventasHoy.length;
  if(vth) vth.textContent = `S/${totalHoy.toFixed(2)}`;

  renderizarHistorial(todasLasVentas);
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
    return `<div class="hist-row"><span>${dt}</span><span style="font-weight:600;">${v.nombre}</span><span style="color:var(--green);font-weight:700;">S/ ${parseFloat(v.precio).toFixed(2)}</span></div>`;
  }).join("");
}

window.filtrarHistorial = function() {
  const desde=document.getElementById("filtro-desde").value;
  const hasta=document.getElementById("filtro-hasta").value;
  let f=todasLasVentas;
  if(desde){const d=new Date(desde);d.setHours(0,0,0,0);f=f.filter(v=>{const t=v.fecha?.toDate?v.fecha.toDate():new Date(v.fecha);return t>=d;});}
  if(hasta){const h=new Date(hasta);h.setHours(23,59,59,999);f=f.filter(v=>{const t=v.fecha?.toDate?v.fecha.toDate():new Date(v.fecha);return t<=h;});}
  renderizarHistorial(f);
};

// =============================================
// ESCÁNER (LÓGICA)
// =============================================
let bufferEscaner = "";
let timerEscaner = null;
let lastScanAt = 0;
const SCAN_IDLE_MS = 120;
const SCAN_MIN_LEN = 3;

let _productoIndex = new Map();
function _scanDebug() { return localStorage.getItem("scan_debug") === "1"; }
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
  const v = String(t.value || "");
  if (v.endsWith(typed)) t.value = v.slice(0, -typed.length);
}

function setScannerDot(ok, mode) {
  const id = rolActual === "vendedor" ? "dot-v" : "dot-a";
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

async function procesarCodigo(codigo) {

  codigo = sanitizeScanCode(codigo);
  if (!codigo) return;
  if (_scanDebug()) mostrarMensaje("🔍 Escaneado: " + codigo, "ok");
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

    if (!p || !p.id) { mostrarMensaje("❌ No encontrado (código no registrado)", "error"); return; }

    await runTransaction(db, async (tx) => {
      const prodRef = doc(db, "productos", p.id);
      const snap = await tx.get(prodRef);
      if (!snap.exists()) throw new Error("NOT_FOUND");
      const data = snap.data() || {};
      const stock = Number(data.stock);
      if (Number.isFinite(stock) && stock <= 0) {
        const err = new Error("SIN_STOCK");
        err.code = "SIN_STOCK";
        throw err;
      }
      if (Number.isFinite(stock)) tx.update(prodRef, { stock: stock - 1 });
      else tx.update(prodRef, { stock: increment(-1) });

      const ventaRef = doc(collection(db, "ventas"));
      tx.set(ventaRef, {
        codigo: data.codigo ?? p.codigo ?? codigo,
        nombre: data.nombre ?? p.nombre ?? "",
        precio: data.precio ?? p.precio ?? 0,
        fecha: new Date(),
        vendedor: nombreVendedor || "Admin",
      });
    });

    mostrarMensaje("✅ " + (p.nombre || "Venta registrada"), "ok");
  } catch (e) {
    if (e?.code === "SIN_STOCK" || e?.message === "SIN_STOCK") mostrarMensaje("⚠️ Sin stock", "warning");
    else mostrarMensaje("❌ Error registrando venta", "error");
    if (_scanDebug()) console.error("scan_error", e);
  }
}

function finalizarEscaneo() {
  const c = bufferEscaner;
  bufferEscaner = "";
  if (scannerInput) scannerInput.value = "";
  if (timerEscaner) clearTimeout(timerEscaner);
  timerEscaner = null;
  const cleaned = sanitizeScanCode(c);
  const fromScannerFocus = document.activeElement === scannerInput;
  const likelyScan = fromScannerFocus || _scanTiming.source === "input" || _scanTiming.source === "bg" || isLikelyScanByTiming(_scanTiming.deltas);
  _resetScanTiming();
  if (_scanSteal.active) _removeTypedFromTarget();
  _resetScanSteal();
  if (!cleaned || cleaned.length < SCAN_MIN_LEN) return;
  if (!likelyScan) return;
  procesarCodigo(cleaned);
}

function alimentarEscaneo(ch, source) {
  bufferEscaner += ch;
  const now = Date.now();
  if (!_scanTiming.source) _scanTiming.source = source || "doc";
  if (_scanTiming.lastTs) _scanTiming.deltas.push(now - _scanTiming.lastTs);
  _scanTiming.lastTs = now;
  lastScanAt = now;
  setScannerDot(true, "local");
  if (timerEscaner) clearTimeout(timerEscaner);
  timerEscaner = setTimeout(() => finalizarEscaneo(), SCAN_IDLE_MS);
}

function shouldForceScannerFocus() {
  if (!rolActual) return false;
  if (document.querySelector(".modal-overlay.active")) return false;
  const inLogin = document.getElementById("login-screen")?.style?.display !== "none";
  if (inLogin) return false;
  if (rolActual === "vendedor") return document.getElementById("vtab-ventas")?.classList?.contains("active") === true;
  return document.getElementById("tab-ventas")?.classList?.contains("active") === true;
}

function isSalesContext() {
  if (!rolActual) return false;
  if (rolActual === "vendedor") return document.getElementById("vtab-ventas")?.classList?.contains("active") === true;
  return document.getElementById("tab-ventas")?.classList?.contains("active") === true;
}

if (scannerInput) {
  scannerInput.addEventListener("keydown", e => {
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
    if (e.key && e.key.length === 1) {
      alimentarEscaneo(e.key, "scanner");
      return;
    }
  });

  scannerInput.addEventListener("input", () => {
    const v = (scannerInput.value || "").trim();
    if (!v) return;
    const cleaned = sanitizeScanCode(v);
    if (cleaned !== v) scannerInput.value = cleaned;
    if (cleaned && cleaned.length >= SCAN_MIN_LEN) {
      bufferEscaner = cleaned;
      _resetScanTiming();
      _scanTiming.source = "input";
      finalizarEscaneo();
    }
  });

  scannerInput.addEventListener("blur", () => {
    if (shouldForceScannerFocus()) setTimeout(() => { try { scannerInput.focus(); } catch {} }, 80);
  });
}

document.addEventListener("keydown", e => {
  if (!rolActual) return;
  const ae = document.activeElement;
  const isScanner = ae === scannerInput;
  const isEditable = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable);
  if (e.key === "Enter" || e.key === "Tab") {
    if (bufferEscaner && (_scanSteal.active || isLikelyScanByTiming(_scanTiming.deltas))) {
      e.preventDefault();
      finalizarEscaneo();
    }
    return;
  }
  if (e.key && e.key.length === 1) {
    if (isEditable && !isScanner) {
      const now = Date.now();
      if (_scanTiming.lastTs) _scanTiming.deltas.push(now - _scanTiming.lastTs);
      _scanTiming.lastTs = now;
      _scanTiming.source = "doc";
      bufferEscaner += e.key;
      if (timerEscaner) clearTimeout(timerEscaner);
      timerEscaner = setTimeout(() => finalizarEscaneo(), SCAN_IDLE_MS);

      _scanSteal.target = ae;
      _scanSteal.typed += e.key;

      if (!_scanSteal.active && bufferEscaner.length >= 3 && isLikelyScanByTiming(_scanTiming.deltas)) {
        _scanSteal.active = true;
        _removeTypedFromTarget();
      }
      if (_scanSteal.active) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    alimentarEscaneo(e.key, "doc");
  }
});

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
  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
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
  await addDoc(collection(db, "ricoh_lecturas"), {copias, tipo, fecha: new Date()});
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
    await addDoc(collection(db, "ricoh_lecturas"), { copias, tipo, nota, fecha: new Date() });
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
    await addDoc(collection(db, "clientesFiados"), { nombre, creadoEn: new Date() });
    if (input) input.value = "";
    mostrarMensaje("✅ Cliente agregado", "ok");
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
    await addDoc(collection(db, "copiasFiadas"), { cliente: cli.nombre, cara, duplex, carasFisicas, total, precio: FIADA_PRECIO, fecha: new Date() });
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
function cargarClientesFiados() {
  onSnapshot(collection(db,"clientesFiados"), snap => {
    clientesFiados = snap.docs.map(d => ({id:d.id,...d.data()}));
    const opts = '<option value="">— Seleccionar —</option>' + clientesFiados.map(c=>`<option value="${c.id}">${c.nombre}</option>`).join("");
    if(document.getElementById("v-fiada-sel")) document.getElementById("v-fiada-sel").innerHTML = opts;
    if(document.getElementById("a-fiada-sel")) document.getElementById("a-fiada-sel").innerHTML = opts;
  });
}

function cargarFiadasDia() {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  onSnapshot(collection(db,"copiasFiadas"), snap => {
    const fiadas = snap.docs.map(d=>d.data()).filter(f=>(f.fecha?.toDate ? f.fecha.toDate() : new Date(f.fecha)) >= hoy);
    const total = fiadas.reduce((s,f)=> {
      const cara = _toInt(f.cara);
      const duplex = _toInt(f.duplex);
      const carasFisicas = _toInt(f.carasFisicas) || (cara + duplex * 2);
      return s + (carasFisicas * FIADA_PRECIO);
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
    await addDoc(collection(db, "hojasMalogradas"), { cantidad: cant, fecha: new Date() });
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
  await addDoc(collection(db,"hojasMalogradas"), {cantidad:cant, fecha:new Date()});
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
    const qFiadas = query(collection(db, "copiasFiadas"), where("fecha", ">=", from), where("fecha", "<=", to));
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

    const qMal = query(collection(db, "hojasMalogradas"), where("fecha", ">=", from), where("fecha", "<=", to));
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
  const bg = localStorage.getItem("bg_scanner_enabled") === "1";
  const msg =
    "Escáner de códigos:\n\n" +
    "1) Modo normal (web): funciona cuando esta pestaña está abierta.\n" +
    "2) Modo fondo (recomendado): funciona aunque otra app esté activa.\n\n" +
    "Para modo fondo:\n" +
    "- Ejecuta escaner_fondo.py / instalador del escáner en la PC.\n" +
    "- En Chrome: icono candado → Configuración del sitio → permitir 'Contenido no seguro'.\n\n" +
    "Nota: para registrar ventas por escaneo, entra a la pestaña Ventas.\n\n" +
    `Estado actual: ${bg ? "FONDO habilitado" : "FONDO deshabilitado"}\n\n` +
    "¿Quieres alternarlo ahora?";
  const ok = confirm(msg);
  if (!ok) return;
  if (bg) window.deshabilitarEscanerFondo();
  else window.habilitarEscanerFondo();
};

// Foco automático
setInterval(() => {
  if (!scannerInput) return;
  if (!shouldForceScannerFocus()) return;
  const ae = document.activeElement;
  const isScanner = ae === scannerInput;
  const isEditable = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable);
  if (isEditable && !isScanner) return;
  try { scannerInput.focus(); } catch {}
}, 1000);

// Escáner de fondo
let _bgFailCount = 0;
setInterval(async () => {
  if (!rolActual) return;
  if (localStorage.getItem("bg_scanner_enabled") !== "1") return;
  try {
    setBgBadge(true);
    setScannerDot(true, "bg");
    const r = await fetch("http://127.0.0.1:7777/poll", { signal: AbortSignal.timeout(1800) });
    const d = await r.json();
    if(d.codigo) procesarCodigo(d.codigo);
    _bgFailCount = 0;
  } catch(e) {
    _bgFailCount += 1;
    setBgBadge(false);
    setScannerDot(false);
    if (_bgFailCount === 1) {
      mostrarMensaje("⚠️ No se pudo acceder al escáner en fondo (bloqueo del navegador o servicio apagado).", "warning");
    }
    if (_bgFailCount >= 6) {
      localStorage.setItem("bg_scanner_enabled", "0");
      _bgFailCount = 0;
      mostrarMensaje("⚠️ Escáner de fondo no disponible. Se activó modo normal.", "warning");
    }
  }
}, 500);

window.habilitarEscanerFondo = async function() {
  try {
    const r = await fetch("http://127.0.0.1:7777/status", { signal: AbortSignal.timeout(1500) });
    if (!r.ok) throw new Error(String(r.status));
    localStorage.setItem("bg_scanner_enabled", "1");
    _bgFailCount = 0;
    mostrarMensaje("✅ Escáner de fondo habilitado (este equipo)", "ok");
    setBgBadge(true);
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

function impDateRangeToIso(desde, hasta) {
  const out = {};
  if (desde) {
    const d = new Date(`${desde}T00:00:00`);
    out.from = d.toISOString();
  }
  if (hasta) {
    const d = new Date(`${hasta}T23:59:59`);
    out.to = d.toISOString();
  }
  return out;
}

function impSelectedValues(selId) {
  const el = document.getElementById(selId);
  if (!el) return [];
  return Array.from(el.selectedOptions).map(o => o.value).filter(Boolean);
}

async function impFetchJson(path, params) {
  const url = `${impCfg.url}${path}${impQs(params)}`;
  const r = await fetch(url, { headers: impHeaders() });
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
  const qSummary = { ...impLastQuery };
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

    let r = await impFetchJson("/api/prints/my-summary", { user_id: effectiveUserBase });
    let t = r.totals || {};
    const isAllZero = (t.pages_total ?? 0) === 0 && (t.pages_bn ?? 0) === 0 && (t.pages_color ?? 0) === 0;
    if (isAllZero && effectiveUserBase !== candidate) {
      try {
        r = await impFetchJson("/api/prints/my-summary", { user_id: candidate });
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
      const sum = await impFetchJson("/api/prints/summary", { users: effectiveUserFull, status: "completed" });
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
  const out = document.getElementById("scan-doctor-out");
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
      const r = await fetch(url, { signal: AbortSignal.timeout(1800) });
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
  add("=== Doctor Escáner (localhost:7777) ===");
  add(`Hora: ${new Date().toLocaleString("es-PE")}`);
  add("");
  const s = await test("STATUS", "http://127.0.0.1:7777/status");
  add("");
  const p = await test("POLL", "http://127.0.0.1:7777/poll");
  add("");
  await test("HEALTH (opcional)", "http://127.0.0.1:7777/health");
  add("");

  if (s.ok && p.ok) {
    add("RESULTADO: ✅ El servicio del escáner está activo en esta PC.");
    add("Si no funciona en la web, revisa: candado del navegador → permitir 'Contenido no seguro' y habilitar FONDO en el indicador ESCÁNER.");
  } else {
    add("RESULTADO: ❌ El servicio del escáner NO responde correctamente en esta PC.");
    add("Solución: descarga y ejecuta el instalador del escáner (setup_escaner_fondo.cmd) como Administrador.");
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
  impUpdateVendorWidget();
  clearInterval(window._impVendorTimer);
  window._impVendorTimer = setInterval(() => { impUpdateVendorWidget().catch(() => {}); }, 30000);
};

impLoadCfg();
