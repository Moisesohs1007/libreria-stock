import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, getDocs, query, where,
  updateDoc, addDoc, onSnapshot, doc, increment, deleteDoc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig, APP_CONFIG } from "./firebase-config.js";

// =============================================
// INITIALIZATION
// =============================================
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

const scannerInput = document.getElementById("scanner");
let todosLosProductos  = [];
let todasLasVentas     = [];
let rolActual          = null; // "admin" | "vendedor"
let nombreVendedor     = "";
let listenersIniciados = false;
let colaVentasPendientes = []; // Cola para ventas en segundo plano
let colaVentasFallidas = [];   // Cola para ventas que no se pudieron procesar

// =============================================
// LOGGING Y AUDITORÍA
// =============================================
function logAuditoria(mensaje, datos = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[AUDITORÍA ${timestamp}] ${mensaje}`, datos);
  // Aquí se podría persistir en Firestore en una colección de logs si fuera necesario
}

// =============================================
// SESIÓN — sessionStorage para persistencia
// =============================================
function guardarSesion(rol, nombre) {
  sessionStorage.setItem("lpm_rol", rol);
  sessionStorage.setItem("lpm_nombre", nombre || "");
}
function leerSesion() {
  return { rol: sessionStorage.getItem("lpm_rol"), nombre: sessionStorage.getItem("lpm_nombre") };
}
function borrarSesion() {
  sessionStorage.removeItem("lpm_rol");
  sessionStorage.removeItem("lpm_nombre");
}

// =============================================
// MENSAJE FLASH
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
// LOGIN
// =============================================
window.ejecutarLogin = async function() {
  const user = document.getElementById("login-user").value.trim();
  const pass = document.getElementById("login-pass").value.trim();
  const errDiv = document.getElementById("login-error");
  errDiv.style.display = "none";

  // Admin validation (hardcoded for now, but in config)
  if (user.toLowerCase() === APP_CONFIG.ADMIN_USER.toLowerCase() && pass === APP_CONFIG.ADMIN_PASS) {
    guardarSesion("admin", "Admin");
    activarAdmin();
    return;
  }

  // Buscar vendedor en Firestore
  try {
    const snap = await getDocs(query(collection(db,"vendedores"), where("usuario","==",user), where("password","==",pass)));
    if (!snap.empty) {
      const v = snap.docs[0].data();
      guardarSesion("vendedor", v.nombre);
      activarVendedor(v.nombre);
      return;
    }
  } catch(e) { console.error("Error en login:", e); }

  errDiv.textContent = "❌ Usuario o contraseña incorrectos";
  errDiv.style.display = "block";
};

function activarAdmin() {
  rolActual = "admin";
  document.getElementById("login-screen").style.display  = "none";
  document.getElementById("vendedor-screen").style.display = "none";
  document.getElementById("admin-screen").style.display  = "block";
  scannerInput.focus();
  iniciarListeners();
  cargarConfigCopias();
}

function activarVendedor(nombre) {
  rolActual = "vendedor";
  nombreVendedor = nombre;
  document.getElementById("login-screen").style.display    = "none";
  document.getElementById("admin-screen").style.display    = "none";
  document.getElementById("vendedor-screen").style.display = "block";
  document.getElementById("vendedor-nombre-badge").textContent = nombre.toUpperCase();
  scannerInput.focus();
  iniciarListeners();
  cargarConfigCopias();
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

// Auto-login si hay sesión guardada
(function() {
  const { rol, nombre } = leerSesion();
  if (rol === "admin") { activarAdmin(); }
  else if (rol === "vendedor" && nombre) { activarVendedor(nombre); }
})();

// =============================================
// TABS / SIDEBAR
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
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  
  document.getElementById(tabId).classList.add("active");
  document.getElementById(btnId).classList.add("active");
  
  // Sincronizar con el botón de escritorio si existe
  const deskBtnId = btnId.replace("sb-", "btn-");
  const deskBtn = document.getElementById(deskBtnId);
  if (deskBtn) deskBtn.classList.add("active");

  const seccion = document.getElementById("seccion-activa");
  if (seccion) seccion.textContent = titulo;
  
  cerrarSidebar();
  setTimeout(() => scannerInput.focus(), 100);
};

window.toggleDtGroup = function(groupId, event) {
  if (event) event.stopPropagation();
  const grp = document.getElementById(groupId);
  if (!grp) return;
  
  const wasOpen = grp.classList.contains("open");
  
  // Cerrar otros grupos abiertos
  document.querySelectorAll(".dt-group").forEach(g => {
    g.classList.remove("open");
  });
  
  // Alternar el actual si no estaba abierto
  if (!wasOpen) {
    grp.classList.add("open");
  }
  
  console.log("Menú clickeado:", groupId, "Ahora abierto:", grp.classList.contains("open"));
};

// Función para ayudar con el error de Mixed Content
window.ayudaSeguridad = function() {
  const msg = "🔧 CONFIGURACIÓN DEL NAVEGADOR:\n\n" +
              "El sistema no detecta el escáner porque el navegador bloquea la conexión local.\n\n" +
              "PASOS PARA REPARAR:\n" +
              "1. Haz clic en el CANDADO 🔒 o ICONO DE AJUSTES a la izquierda de la dirección web.\n" +
              "2. Entra en 'Configuración de sitios' (Site settings).\n" +
              "3. Busca 'Contenido no seguro' (Insecure content) al final de la lista.\n" +
              "4. Cámbialo de 'Bloquear' a 'Permitir'.\n" +
              "5. Recarga la página (F5).\n\n" +
              "Si el punto sigue rojo, asegúrate de haber ejecutado el archivo 'escaner_fondo.py' en tu computadora.";
  alert(msg);
};

// Cerrar menús al hacer clic fuera
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
  const seccion = document.querySelectorAll("#seccion-activa");
  seccion.forEach(s => s.textContent = titulo);
  setTimeout(() => scannerInput.focus(), 100);
};

window.cambiarTab = function(id, btn, titulo) {
  // Desactivar todos los paneles y botones
  document.querySelectorAll("#admin-screen .tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll("#admin-screen .tab-btn").forEach(b => b.classList.remove("active"));
  
  // Activar el seleccionado
  const panel = document.getElementById(id);
  if (panel) {
    panel.classList.add("active");
    btn.classList.add("active");
  }

  // Actualizar título
  const seccion = document.getElementById("seccion-activa");
  if (seccion) seccion.textContent = titulo;
  
  // Foco al escáner por comodidad
  setTimeout(() => scannerInput.focus(), 100);
};

window.cambiarTabVendedor = function(id, btn) {
  document.querySelectorAll("#vendedor-screen .tab-panel").forEach(p=>p.classList.remove("active"));
  document.querySelectorAll("#vendedor-screen .tab-btn").forEach(b=>b.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  btn.classList.add("active");
  setTimeout(() => scannerInput.focus(), 100);
};

// =============================================
// MODALES
// =============================================
window.cerrarModal = function(id) {
  document.getElementById(id).classList.remove("active");
  setTimeout(() => scannerInput.focus(), 100);
};

// =============================================
// LISTENERS FIRESTORE
// =============================================
function iniciarListeners() {
  if (listenersIniciados) return;
  listenersIniciados = true;

  onSnapshot(collection(db,"productos"), snap => {
    todosLosProductos = snap.docs.map(d => ({id:d.id,...d.data()}));
    actualizarUIAdmin();
  });

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

// =============================================
// UI ADMIN — INVENTARIO
// =============================================
function actualizarUIAdmin() {
  const statProd = document.getElementById("stat-productos");
  if(statProd) statProd.textContent = todosLosProductos.length;
  
  const bajoCount = todosLosProductos.filter(p=>p.stock>0&&p.stock<=5).length;
  const statBajo = document.getElementById("stat-bajo-stock");
  if(statBajo) statBajo.textContent = bajoCount;
  
  renderizarListaEtiquetas();

  const bajos = todosLosProductos.filter(p=>p.stock<=5);
  const alertDiv = document.getElementById("alertas-stock");
  if(alertDiv) {
    alertDiv.innerHTML = bajos.length===0
      ? `<div style="text-align:center;color:#aaa;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;padding:20px;">Todo bien ✅</div>`
      : bajos.map(p=>`<div style="display:flex;justify-content:space-between;padding:7px 11px;border-bottom:1px dashed #fca5a5;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">
          <span style="font-weight:600;">${p.nombre}</span>
          <span class="badge-stock ${p.stock<=0?'badge-empty':'badge-low'}">${p.stock}</span>
        </div>`).join("");
  }

  const busq = document.getElementById("buscador")?.value.toLowerCase()||"";
  renderizarTabla(busq ? todosLosProductos.filter(p=>p.nombre.toLowerCase().includes(busq)||p.codigo.toLowerCase().includes(busq)) : todosLosProductos);
}

window.filtrarInventario = function() {
  const q = document.getElementById("buscador").value.toLowerCase();
  renderizarTabla(q ? todosLosProductos.filter(p=>p.nombre.toLowerCase().includes(q)||p.codigo.toLowerCase().includes(q)) : todosLosProductos);
};

function renderizarTabla(prods) {
  const inv = document.getElementById("inventario");
  if (!inv) return;
  if (!prods.length) { inv.innerHTML=`<tr><td colspan="5" style="text-align:center;color:#aaa;padding:24px;font-family:'IBM Plex Mono',monospace;">Sin resultados</td></tr>`; return; }
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

// =============================================
// UI — VENTAS
// =============================================
function actualizarUIVentas() {
  const ahora = new Date();
  const hoyIni = new Date(ahora); hoyIni.setHours(0,0,0,0);
  const mesIni = new Date(ahora.getFullYear(),ahora.getMonth(),1);

  const ventasHoy = todasLasVentas.filter(v=>{const f=v.fecha?.toDate?v.fecha.toDate():new Date(v.fecha);return f>=hoyIni;});
  const ventasMes = todasLasVentas.filter(v=>{const f=v.fecha?.toDate?v.fecha.toDate():new Date(v.fecha);return f>=mesIni;});
  const totalHoy  = ventasHoy.reduce((s,v)=>s+(v.precio||0),0);
  const totalMes  = ventasMes.reduce((s,v)=>s+(v.precio||0),0);

  const svh = document.getElementById("stat-ventas-hoy");
  const sth = document.getElementById("stat-total-hoy");
  const stm = document.getElementById("stat-total-mes");
  if(svh) svh.textContent = ventasHoy.length;
  if(sth) sth.textContent = `S/${totalHoy.toFixed(2)}`;
  if(stm) stm.textContent = `S/${totalMes.toFixed(2)}`;

  const vvh = document.getElementById("v-ventas-hoy");
  const vth = document.getElementById("v-total-hoy");
  if(vvh) vvh.textContent = ventasHoy.length;
  if(vth) vth.textContent = `S/${totalHoy.toFixed(2)}`;

  const ch = document.getElementById("caja-hoy");
  const chc= document.getElementById("caja-hoy-count");
  const cm = document.getElementById("caja-mes");
  const cmc= document.getElementById("caja-mes-count");
  if(ch) ch.textContent  = `S/ ${totalHoy.toFixed(2)}`;
  if(chc)chc.textContent = `${ventasHoy.length} ventas hoy`;
  if(cm) cm.textContent  = `S/ ${totalMes.toFixed(2)}`;
  if(cmc)cmc.textContent = `${ventasMes.length} ventas este mes`;

  const ultimas = [...todasLasVentas].sort((a,b)=>{
    const fa=a.fecha?.toDate?a.fecha.toDate():new Date(a.fecha);
    const fb=b.fecha?.toDate?b.fecha.toDate():new Date(b.fecha);
    return fb-fa;
  }).slice(0,10);

  const htmlVentas = ultimas.length===0
    ? `<div style="text-align:center;color:#aaa;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;padding:20px;">Sin ventas aún...</div>`
    : ultimas.map(v=>{
        const f=v.fecha?.toDate?v.fecha.toDate():new Date(v.fecha);
        const hora=f.toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"});
        return `<div class="venta-item">
          <div><div style="font-weight:600;">${v.nombre}</div><div style="color:#888;font-size:0.7rem;">${hora}</div></div>
          <div style="color:var(--green);font-weight:700;">S/ ${parseFloat(v.precio).toFixed(2)}</div>
        </div>`;
      }).join("");

  const va = document.getElementById("ventas-admin");
  const vv = document.getElementById("ventas-vendedor");
  if(va) va.innerHTML = htmlVentas;
  if(vv) vv.innerHTML = htmlVentas;

  const rs = document.getElementById("resumen-semana");
  if(rs) {
    let html="";
    for(let i=6;i>=0;i--){
      const d=new Date(ahora); d.setDate(d.getDate()-i);
      const ini=new Date(d);ini.setHours(0,0,0,0);
      const fin=new Date(d);fin.setHours(23,59,59,999);
      const vd=todasLasVentas.filter(v=>{const f=v.fecha?.toDate?v.fecha.toDate():new Date(v.fecha);return f>=ini&&f<=fin;});
      const t=vd.reduce((s,v)=>s+(v.precio||0),0);
      html+=`<div style="display:flex;justify-content:space-between;padding:7px 11px;border-bottom:1px dashed #ddd;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;${i===0?'background:#f0fdf4;font-weight:700;':''}">
        <span>${i===0?'Hoy':d.toLocaleDateString("es-PE",{weekday:"short",day:"numeric",month:"short"})}</span>
        <span style="color:var(--green);">S/ ${t.toFixed(2)} <span style="color:#aaa;font-size:0.68rem;">(${vd.length})</span></span>
      </div>`;
    }
    rs.innerHTML=html;
  }

  const tp=document.getElementById("top-productos");
  if(tp){
    const cnt={};
    todasLasVentas.forEach(v=>cnt[v.nombre]=(cnt[v.nombre]||0)+1);
    const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,5);
    tp.innerHTML=top.length===0
      ? `<div style="text-align:center;color:#aaa;padding:20px;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">Sin datos</div>`
      : top.map(([n,c],i)=>`<div style="display:flex;justify-content:space-between;padding:7px 11px;border-bottom:1px dashed #ddd;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">
          <span>${['🥇','🥈','🥉','',''][i]} ${n}</span>
          <span style="font-weight:700;color:var(--accent);">${c}</span>
        </div>`).join("");
  }

  renderizarHistorial(todasLasVentas);
}

function renderizarHistorial(ventas) {
  const lista = document.getElementById("historial-lista");
  if (!lista) return;
  const ord = [...ventas].sort((a,b)=>{
    const fa=a.fecha?.toDate?a.fecha.toDate():new Date(a.fecha);
    const fb=b.fecha?.toDate?b.fecha.toDate():new Date(b.fecha);
    return fb-fa;
  }).slice(0,300);
  lista.innerHTML = ord.length===0
    ? `<div style="text-align:center;color:#aaa;padding:20px;font-family:'IBM Plex Mono',monospace;font-size:0.8rem;">Sin ventas</div>`
    : ord.map(v=>{
        const f=v.fecha?.toDate?v.fecha.toDate():new Date(v.fecha);
        const dt=f.toLocaleDateString("es-PE",{day:"2-digit",month:"2-digit",year:"2-digit"})+" "+f.toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"});
        return `<div class="hist-row"><span>${dt}</span><span style="font-weight:600;">${v.nombre}</span><span style="color:var(--green);font-weight:700;">S/ ${parseFloat(v.precio).toFixed(2)}</span><span style="color:#888;">${v.codigo||""}</span></div>`;
      }).join("");
}

window.filtrarHistorial = function() {
  const desde=document.getElementById("filtro-desde").value;
  const hasta=document.getElementById("filtro-hasta").value;
  let f=todasLasVentas;
  if(desde){const _d=desde.split("-").map(Number);const d=new Date(_d[0],_d[1]-1,_d[2],0,0,0,0);f=f.filter(v=>{const t=v.fecha?.toDate?v.fecha.toDate():new Date(v.fecha);return t>=d;});}
  if(hasta){const _h=hasta.split("-").map(Number);const h=new Date(_h[0],_h[1]-1,_h[2],23,59,59,999);f=f.filter(v=>{const t=v.fecha?.toDate?v.fecha.toDate():new Date(v.fecha);return t<=h;});}
  renderizarHistorial(f);
};

// =============================================
// AGREGAR PRODUCTO MANUAL
// =============================================
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

// =============================================
// IMPORTAR EXCEL
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
      const first = rows[0];
      if (!first.Nombre && !first.nombre) { mostrarMensaje("⚠️ Columna 'Nombre' no encontrada","error"); return; }

      const prev = document.getElementById("excel-preview");
      prev.innerHTML = `<div style="font-family:'IBM Plex Mono',monospace;font-size:0.78rem;color:#555;margin-bottom:8px;">
        ✅ ${rows.length} productos encontrados. ¿Importar todos?
      </div>
      <button onclick="confirmarImportacion()" class="btn btn-primary" style="margin-right:8px;">✅ Importar ${rows.length} productos</button>
      <button onclick="cancelarImportacion()" class="btn" style="background:#eee;">✕ Cancelar</button>`;
      window._excelRows = rows;
    } catch(err) { mostrarMensaje("❌ Error leyendo Excel: "+err.message,"error"); }
  };
  reader.readAsBinaryString(file);
};

window.confirmarImportacion = async function() {
  const rows = window._excelRows;
  if (!rows) return;
  let ok=0, err=0;
  mostrarMensaje("⏳ Importando...","warning");
  for (const row of rows) {
    const nombre = (row.Nombre||row.nombre||"").toString().trim();
    const stock  = parseInt(row.Stock||row.stock||0);
    const precio = parseFloat(row.Precio||row.precio||0);
    if (!nombre) { err++; continue; }
    const codigo = "LIB-"+Date.now().toString().slice(-8)+Math.random().toString(36).slice(-3);
    try {
      await addDoc(collection(db,"productos"),{codigo,nombre,stock:isNaN(stock)?0:stock,precio:isNaN(precio)?0:precio,creadoEn:new Date()});
      ok++;
    } catch(e) { err++; }
  }
  mostrarMensaje(`✅ ${ok} importados${err>0?` | ❌ ${err} errores`:""}`, ok>0?"ok":"error");
  document.getElementById("excel-preview").innerHTML="";
  document.getElementById("excel-input").value="";
  window._excelRows=null;
};

window.cancelarImportacion = function() {
  document.getElementById("excel-preview").innerHTML="";
  document.getElementById("excel-input").value="";
  window._excelRows=null;
};

window.descargarPlantilla = function() {
  const ws = XLSX.utils.json_to_sheet([{Nombre:"Producto Ejemplo", Stock:10, Precio:5.00}]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Productos");
  XLSX.writeFile(wb, "plantilla_productos.xlsx");
};

// =============================================
// EDITAR / ELIMINAR PRODUCTO
// =============================================
window.abrirEdicion = function(id,nombre,stock,precio){
  document.getElementById("edit-id").value    =id;
  document.getElementById("edit-nombre").value=nombre;
  document.getElementById("edit-stock").value =stock;
  document.getElementById("edit-precio").value=precio;
  document.getElementById("modal-editar").classList.add("active");
};
window.guardarEdicion = async function(){
  const id    =document.getElementById("edit-id").value;
  const nombre=document.getElementById("edit-nombre").value.trim();
  const stock =parseInt(document.getElementById("edit-stock").value);
  const precio=parseFloat(document.getElementById("edit-precio").value);
  if(!nombre||isNaN(stock)||isNaN(precio)){mostrarMensaje("⚠️ Completa todo","error");return;}
  await updateDoc(doc(db,"productos",id),{nombre,stock,precio});
  mostrarMensaje("✅ Actualizado","ok");
  cerrarModal("modal-editar");
};
window.eliminarProducto = async function(id,nombre){
  if(!confirm(`¿Eliminar "${nombre}"?`))return;
  await deleteDoc(doc(db,"productos",id));
  mostrarMensaje(`🗑 "${nombre}" eliminado`,"warning");
};

// =============================================
// EXPORTAR EXCEL
// =============================================
window.exportarExcel = function(){
  const datos=todosLosProductos.map(p=>({Nombre:p.nombre,Código:p.codigo,Stock:p.stock,Precio:p.precio}));
  const ws=XLSX.utils.json_to_sheet(datos);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Inventario");
  XLSX.writeFile(wb,`inventario_${new Date().toLocaleDateString("es-PE").replace(/\//g,"-")}.xlsx`);
};
window.exportarHistorialExcel = function(){
  const datos=todasLasVentas.map(v=>{const ft=v.fecha?.toDate?v.fecha.toDate():new Date(v.fecha);return{Fecha:ft.toLocaleDateString("es-PE"),Hora:ft.toLocaleTimeString("es-PE"),Producto:v.nombre,Precio:v.precio,Código:v.codigo||""};});
  const ws=XLSX.utils.json_to_sheet(datos);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Ventas");
  XLSX.writeFile(wb,`ventas_${new Date().toLocaleDateString("es-PE").replace(/\//g,"-")}.xlsx`);
};

// =============================================
// USUARIOS — VENDEDORES
// =============================================
window.crearVendedor = async function(){
  const nombre=document.getElementById("v-nombre").value.trim();
  const usuario=document.getElementById("v-user").value.trim();
  const pass=document.getElementById("v-pass").value;
  if(!nombre||!usuario||!pass){mostrarMensaje("⚠️ Completa todos los campos","error");return;}
  if(usuario===APP_CONFIG.ADMIN_USER){mostrarMensaje("⚠️ Ese usuario está reservado","error");return;}
  const snap=await getDocs(query(collection(db,"vendedores"),where("usuario","==",usuario)));
  if(!snap.empty){mostrarMensaje("⚠️ Usuario ya existe","error");return;}
  await addDoc(collection(db,"vendedores"),{nombre,usuario,password:pass,creadoEn:new Date()});
  mostrarMensaje(`✅ Vendedor "${nombre}" creado`,"ok");
  ["v-nombre","v-user","v-pass"].forEach(id=>document.getElementById(id).value="");
};

function renderizarVendedores(lista){
  const div=document.getElementById("lista-vendedores");
  if(!div)return;
  if(!lista.length){div.innerHTML=`<div style="text-align:center;color:#aaa;padding:20px;">Sin vendedores</div>`;return;}
  div.innerHTML=lista.map(v=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-bottom:1px dashed #ddd;font-family:'IBM Plex Mono',monospace;font-size:0.82rem;">
      <div><div style="font-weight:700;">${v.nombre}</div><div style="color:#888;font-size:0.7rem;">@${v.usuario}</div></div>
      <button onclick="eliminarVendedor('${v.id}','${v.nombre}')" class="btn btn-danger">🗑</button>
    </div>`).join("");
}
window.eliminarVendedor = async function(id,nombre){
  if(!confirm(`¿Eliminar vendedor "${nombre}"?`))return;
  await deleteDoc(doc(db,"vendedores",id));
  mostrarMensaje(`🗑 Vendedor "${nombre}" eliminado`,"warning");
};

// =============================================
// ETIQUETAS
// =============================================
function renderizarListaEtiquetas() {
  const div = document.getElementById("etq-lista-productos");
  if (!div) return;
  if (!todosLosProductos.length) { div.innerHTML = `<div style="text-align:center;color:#aaa;padding:20px;">No hay productos</div>`; return; }
  const tamOpts = `
    <option value="25x10">25×10 mm</option>
    <option value="30x20" selected>30×20 mm</option>
    <option value="50x30">50×30 mm</option>
    <option value="60x40">60×40 mm</option>`;
  div.innerHTML = todosLosProductos.map((p,i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px dashed #ddd;font-size:0.8rem;${i%2===1?'background:#fafaf8;':''}">
      <label><input type="checkbox" class="etq-check" data-id="${p.id}"></label>
      <span style="font-weight:600;flex:1;">${p.nombre}</span>
      <input type="number" class="etq-cant" data-id="${p.id}" value="1" min="1" style="width:50px;">
      <select class="etq-tam" data-id="${p.id}">${tamOpts}</select>
    </div>`).join("");
}

window.seleccionarTodosEtq = function(checked) {
  document.querySelectorAll(".etq-check").forEach(cb => cb.checked = checked);
};

window.generarEtiquetas = async function(){
  const checks = document.querySelectorAll(".etq-check:checked");
  if (!checks.length) { mostrarMensaje("⚠️ Selecciona al menos un producto", "warning"); return; }
  const tipo = document.getElementById("etq-tipo").value;
  const cols = parseInt(document.getElementById("etq-cols").value)||5;
  const items = [];
  checks.forEach(cb => {
    const id=cb.dataset.id; const prod=todosLosProductos.find(p=>p.id===id); if(!prod) return;
    const cant=parseInt(document.querySelector(`.etq-cant[data-id="${id}"]`).value)||1;
    const tam=document.querySelector(`.etq-tam[data-id="${id}"]`).value;
    for(let i=0;i<cant;i++) items.push({...prod, tam});
  });

  const tamMap = {"25x10":{w:95,h:38},"30x20":{w:113,h:76},"50x30":{w:189,h:113},"60x40":{w:227,h:151}};
  const prev = document.getElementById("preview-etiquetas");
  const printDiv = document.getElementById("etiquetas-print");
  prev.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  printDiv.innerHTML = `<div class="etq-grid" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:3px;padding:6px;"></div>`;
  const grid = printDiv.querySelector(".etq-grid");
  prev.innerHTML = "";

  for(const p of items){
    const dim = tamMap[p.tam] || tamMap["30x20"];
    const qrSize = Math.min(dim.h-14, dim.w-18);
    let imgHtml="";
    if(tipo==="qr"){
      const tmp = document.createElement("div");
      new QRCode(tmp, {text:p.codigo, width:qrSize, height:qrSize});
      await new Promise(r=>setTimeout(r,50));
      const qrImg = tmp.querySelector("img") || tmp.querySelector("canvas");
      imgHtml = `<img src="${qrImg.src || qrImg.toDataURL()}" style="width:${qrSize}px;height:${qrSize}px;margin:2px auto;">`;
    } else {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, p.codigo, {format:"CODE128", width:1, height:30, displayValue:false});
      imgHtml = `<img src="${canvas.toDataURL()}" style="max-width:100%;height:32px;margin:2px auto;">`;
    }
    const html=`<div style="font-size:8px;font-weight:700;">${p.nombre}</div>${imgHtml}<div style="font-size:8px;">${p.codigo}</div><div style="font-size:10px;font-weight:700;">S/ ${parseFloat(p.precio).toFixed(2)}</div>`;
    const d1=document.createElement("div"); d1.style.cssText=`background:white;border:1px solid #ccc;padding:4px;text-align:center;width:${dim.w}px;min-height:${dim.h}px;display:flex;flex-direction:column;justify-content:center;`;
    d1.innerHTML=html; prev.appendChild(d1);
    const d2=document.createElement("div"); d2.className="etq-item"; d2.style.cssText=`padding:3px;width:${dim.w}px;min-height:${dim.h}px;`;
    d2.innerHTML=html; grid.appendChild(d2);
  }
  mostrarMensaje(`✅ ${items.length} etiquetas generadas`,"ok");
};

window.imprimirEtiquetas = function(){ window.print(); };

// =============================================
// ESCÁNER
// =============================================
let bufferEscaner="", timerEscaner=null;

async function procesarCodigo(codigo, esSegunPlano = false){
  // Limpieza básica pero conservando el código original lo más posible
  const codigoLimpio = codigo.trim().replace(/[^a-zA-Z0-9\-]/g,"");
  if(!codigoLimpio) {
    logAuditoria("Código vacío o inválido tras limpieza", { original: codigo });
    return;
  }

  // Si no hay foco o se indica segundo plano, usamos la vía silenciosa
  if (!document.hasFocus() || esSegunPlano) {
    logAuditoria(`Captura en segundo plano: ${codigoLimpio}`);
    ejecutarVentaSilenciosa(codigoLimpio);
    return;
  }

  mostrarMensaje("🔍 Buscando: " + codigoLimpio, "ok");
  try{
    const q = query(collection(db, "productos"), where("codigo", "==", codigoLimpio));
    const snap = await getDocs(q);
    
    if(snap.empty){
      mostrarMensaje("❌ No encontrado: " + codigoLimpio, "error");
      logAuditoria(`Producto no encontrado: ${codigoLimpio}`);
      return;
    }
    
    for (const docSnap of snap.docs) {
      const p = docSnap.data();
      const ref = doc(db, "productos", docSnap.id);
      
      if(p.stock <= 0){
        mostrarMensaje("⚠️ Sin stock: " + p.nombre, "warning");
        logAuditoria(`Venta fallida por falta de stock: ${p.nombre} (${codigoLimpio})`);
        continue;
      }
      
      await updateDoc(ref, { stock: increment(-1) });
      await addDoc(collection(db, "ventas"), {
        codigo: p.codigo,
        nombre: p.nombre,
        precio: parseFloat(p.precio) || 0,
        fecha: new Date(),
        vendedor: nombreVendedor || "Sistema"
      });
      
      mostrarMensaje("✅ " + p.nombre + " — S/ " + (parseFloat(p.precio) || 0).toFixed(2), "ok");
      logAuditoria(`Venta procesada con éxito: ${p.nombre} (${codigoLimpio})`);
      
      // Alerta WhatsApp si el stock es bajo
      if(p.stock - 1 <= 5){
        try{
          fetch("https://api.factiliza.com/v1/whatsapp/send",{
            method:"POST",
            headers:{"Content-Type":"application/json","Authorization":"Bearer "+APP_CONFIG.FACTILIZA_TOKEN},
            body:JSON.stringify({number:APP_CONFIG.WHATSAPP_DESTINO,message:`⚠️ Stock bajo: ${p.nombre} (${p.stock-1} uds)`})
          });
        }catch(e){ console.error("Error WhatsApp", e); }
      }
    }
  } catch(err){
    mostrarMensaje("❌ Error: " + err.message, "error");
    logAuditoria(`Error crítico procesando venta: ${err.message}`, { codigoLimpio });
  }
}

// Procesa la venta sin tocar la interfaz (para modo segundo plano)
async function ejecutarVentaSilenciosa(codigo) {
  try {
    const q = query(collection(db, "productos"), where("codigo", "==", codigo));
    const snap = await getDocs(q);
    
    if(snap.empty) {
      logAuditoria(`[SILENCIOSO] Producto no encontrado: ${codigo}`);
      colaVentasFallidas.push({codigo, motivo: "No encontrado", fecha: new Date()});
      return;
    }

    for (const docSnap of snap.docs) {
      const p = docSnap.data();
      const ref = doc(db, "productos", docSnap.id);
      
      if(p.stock > 0) {
        await updateDoc(ref, { stock: increment(-1) });
        await addDoc(collection(db, "ventas"), {
          codigo: p.codigo,
          nombre: p.nombre,
          precio: parseFloat(p.precio) || 0,
          fecha: new Date(),
          vendedor: nombreVendedor || "Sistema (BG)"
        });
        logAuditoria(`[SILENCIOSO] Venta registrada: ${p.nombre}`);
        colaVentasPendientes.push(codigo);
      } else {
        logAuditoria(`[SILENCIOSO] Sin stock: ${p.nombre}`);
        colaVentasFallidas.push({codigo, nombre: p.nombre, motivo: "Sin stock", fecha: new Date()});
      }
    }
  } catch (err) {
    logAuditoria(`[SILENCIOSO] Error crítico: ${err.message}`);
    colaVentasFallidas.push({codigo, motivo: "Error: " + err.message, fecha: new Date()});
  }
}

// Sincronizar cola cuando la app recupera el foco
window.addEventListener("focus", () => {
  if (colaVentasPendientes.length > 0 || colaVentasFallidas.length > 0) {
    const exitosas = colaVentasPendientes.length;
    const fallidas = colaVentasFallidas.length;
    
    if (exitosas > 0) {
      mostrarMensaje(`✅ Se procesaron ${exitosas} ventas en segundo plano.`, "ok");
    }
    if (fallidas > 0) {
      mostrarMensaje(`⚠️ ${fallidas} ventas fallaron en segundo plano. Revisa los logs.`, "error");
      console.table(colaVentasFallidas);
    }
    
    logAuditoria(`Sincronización de cola: ${exitosas} exitosas, ${fallidas} fallidas`);
    colaVentasPendientes = [];
    colaVentasFallidas = [];
  }
});

scannerInput.addEventListener("keydown", e=>{
  if(["Shift","Alt","Control","Meta"].includes(e.key))return;
  if(e.key==="Enter"){
    const c=bufferEscaner; bufferEscaner=""; scannerInput.value=""; if(c) procesarCodigo(c); return;
  }
  if(e.key.length===1) bufferEscaner+=e.key;
  clearTimeout(timerEscaner);
  timerEscaner=setTimeout(()=>{bufferEscaner=""; scannerInput.value="";}, 150);
});

// =============================================
// CONFIGURACIÓN DE FOTOCOPIADORA
// =============================================
let PRECIO_COPIA = 0.10;

async function cargarConfigCopias() {
  const docRef = doc(db, "configuracion", "fotocopiadora");
  const d = await getDoc(docRef);
  if (d.exists()) {
    PRECIO_COPIA = d.data().precio || 0.10;
    const input = document.getElementById("cfg-precio-copia");
    if (input) input.value = PRECIO_COPIA;
  }
}

window.guardarConfigCopias = async function() {
  const nuevoPrecio = parseFloat(document.getElementById("cfg-precio-copia").value);
  if (isNaN(nuevoPrecio) || nuevoPrecio <= 0) {
    alert("❌ Por favor ingresa un precio válido.");
    return;
  }
  
  try {
    await setDoc(doc(db, "configuracion", "fotocopiadora"), { precio: nuevoPrecio });
    PRECIO_COPIA = nuevoPrecio;
    alert("✅ Configuración de fotocopiadora guardada.");
  } catch (e) {
    console.error(e);
    alert("❌ Error al guardar la configuración.");
  }
};
let clientesFiados = [];
function cargarClientesFiados() {
  onSnapshot(collection(db,"clientesFiados"), snap => {
    clientesFiados = snap.docs.map(d => ({id:d.id,...d.data()}));
    const opts = '<option value="">— Selecciona —</option>' + clientesFiados.map(c => `<option value="${c.id}">${c.nombre}</option>`).join("");
    ["v-fiada-sel","a-fiada-sel"].forEach(id=>{const el=document.getElementById(id); if(el) el.innerHTML=opts;});
  });
}

window.vFiadaSeleccionar = function() {
  const sel = document.getElementById("v-fiada-sel");
  const form = document.getElementById("v-fiada-form");
  if(sel.value) {
    form.style.display = "block";
    window.vFiadaCalc();
  } else {
    form.style.display = "none";
  }
};

window.aFiadaSeleccionar = function() {
  const sel = document.getElementById("a-fiada-sel");
  const form = document.getElementById("a-fiada-form");
  if(sel.value) {
    form.style.display = "block";
    window.aFiadaCalc();
  } else {
    form.style.display = "none";
  }
};

function cargarFiadasDia() {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  onSnapshot(collection(db,"copiasFiadas"), snap => {
    const fiadas = snap.docs.map(d=>d.data()).filter(f=>(f.fecha?.toDate?f.fecha.toDate():new Date(f.fecha))>=hoy);
    const tbody = document.getElementById("a-fiada-historial");
    if(tbody) {
      tbody.innerHTML = fiadas.length ? fiadas.map(f=>`<tr><td>${(f.fecha?.toDate?f.fecha.toDate():new Date(f.fecha)).toLocaleTimeString()}</td><td>${f.cliente}</td><td>${f.cara}</td><td>${f.duplex}</td><td>${f.contador}</td><td>S/${f.total.toFixed(2)}</td></tr>`).join("") : '<tr><td colspan="6">Sin datos</td></tr>';
      document.getElementById("a-fiada-total-dia").textContent = "S/ "+fiadas.reduce((s,f)=>s+f.total,0).toFixed(2);
    }
  });
}

async function agregarClienteFiado(nombre) {
  if(!nombre.trim()) return;
  await addDoc(collection(db,"clientesFiados"),{nombre:nombre.trim(), creado:new Date()});
  mostrarMensaje("✅ Cliente agregado");
}

window.vFiadaAgregarCliente = ()=>agregarClienteFiado(document.getElementById("v-fiada-nuevo").value);
window.aFiadaAgregarCliente = ()=>agregarClienteFiado(document.getElementById("a-fiada-nuevo").value);

window._fiadaCalc = (pfx) => {
  const c=parseInt(document.getElementById(pfx+"-fiada-cara").value)||0;
  const d=parseInt(document.getElementById(pfx+"-fiada-duplex").value)||0;
  document.getElementById(pfx+"-fiada-contador").textContent = c+(d*2);
  document.getElementById(pfx+"-fiada-r-total").textContent = "S/ "+((c+d)*PRECIO_COPIA).toFixed(2);
};
window.vFiadaCalc = ()=>window._fiadaCalc("v");
window.aFiadaCalc = ()=>window._fiadaCalc("a");

window._fiadaGuardar = async (pfx) => {
  const sel=document.getElementById(pfx+"-fiada-sel");
  const c=parseInt(document.getElementById(pfx+"-fiada-cara").value)||0;
  const d=parseInt(document.getElementById(pfx+"-fiada-duplex").value)||0;
  if(!sel.value || (c===0 && d===0)) return;
  const cli=clientesFiados.find(x=>x.id===sel.value);
  await addDoc(collection(db,"copiasFiadas"),{clienteId:sel.value, cliente:cli.nombre, cara:c, duplex:d, contador:c+(d*2), total:(c+d)*PRECIO_COPIA, fecha:new Date()});
  mostrarMensaje("✅ Guardado");
};
window.vFiadaGuardar = ()=>window._fiadaGuardar("v");
window.aFiadaGuardar = ()=>window._fiadaGuardar("a");

// =============================================
// BACKGROUND SCANNER (Python)
// =============================================
async function verificarEscanerFondo() {
  try {
    const r = await fetch("http://localhost:7777/poll");
    const d = await r.json();
    if (d.codigo) {
      // Procesar venta independientemente del foco, pero pasar flag
      procesarCodigo(d.codigo, !document.hasFocus());
    }
  } catch (e) {
    // console.error("Error conectando con el servicio de escáner local.");
  }
}

// Verificar estado del servicio y ofrecer recuperación
async function revisarEstadoServicio() {
  const dots = document.querySelectorAll(".dot");
  const diag = document.getElementById("diag-btn");
  
  try {
    const r = await fetch("http://localhost:7777/status", { mode: 'cors' });
    const d = await r.json();
    
    if (d.activo) {
      dots.forEach(el => { 
        el.style.background = "#22c55e";
        el.style.boxShadow = "0 0 15px #22c55e";
        el.title = "Servicio Activo"; 
      });
      if(diag) diag.style.display = "none";
    }
  } catch (e) {
    dots.forEach(el => { 
      el.style.background = "#ef4444";
      el.style.boxShadow = "0 0 15px #ef4444";
      el.title = "Servicio Bloqueado o Offline"; 
    });
    // Forzar visibilidad si hay error
    if(diag) {
      diag.style.display = "block";
      console.warn("⚠️ ESCÁNER NO DETECTADO: Mostrando botón de reparación.");
    }
  }
}

window.recuperarTeclado = async function() {
  try {
    mostrarMensaje("⏳ Intentando recuperar teclado...", "warning");
    const r = await fetch("http://localhost:7777/recuperar");
    const d = await r.json();
    if (d.status === "recuperado") {
      mostrarMensaje("✅ Teclado restaurado", "ok");
    }
  } catch (e) {
    mostrarMensaje("❌ Error al recuperar. Ejecuta el archivo de emergencia en el escritorio.", "error");
  }
};

setInterval(verificarEscanerFondo, 500);
setInterval(revisarEstadoServicio, 2000);
