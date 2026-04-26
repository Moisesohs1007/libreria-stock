function _toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function toDateAny(x) {
  try {
    if (!x) return null;
    if (x instanceof Date) return x;
    if (typeof x?.toDate === "function") return x.toDate();
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function _isoDate(d) {
  if (!(d instanceof Date)) return "";
  return d.toISOString().slice(0, 10);
}

function _isoTime(d) {
  if (!(d instanceof Date)) return "";
  return d.toISOString().slice(11, 19);
}

export function buildVentasExport(ventas, range) {
  const from = range?.from instanceof Date ? range.from : null;
  const to = range?.to instanceof Date ? range.to : null;
  let arr = Array.isArray(ventas) ? ventas.slice() : [];
  if (from) arr = arr.filter(v => {
    const d = toDateAny(v?.fecha);
    return d && d >= from;
  });
  if (to) arr = arr.filter(v => {
    const d = toDateAny(v?.fecha);
    return d && d <= to;
  });
  arr.sort((a, b) => {
    const da = toDateAny(a?.fecha)?.getTime() ?? 0;
    const db = toDateAny(b?.fecha)?.getTime() ?? 0;
    return da - db;
  });

  const rows = arr.map(v => {
    const d = toDateAny(v?.fecha) || new Date();
    const cant = _toNum(v?.cantidad) || 1;
    const total = _toNum(v?.total) || _toNum(v?.precio) || (_toNum(v?.precio_unitario) * cant);
    const unit = _toNum(v?.precio_unitario) || (cant ? (total / cant) : total);
    return {
      Fecha: _isoDate(d),
      Hora: _isoTime(d),
      Producto: String(v?.nombre || "").trim(),
      Cantidad: cant,
      "Precio unitario": unit,
      Total: total
    };
  });

  const total = rows.reduce((s, r) => s + _toNum(r.Total), 0);
  const unidades = rows.reduce((s, r) => s + _toNum(r.Cantidad), 0);
  const ventasCount = rows.length;
  const ticket = ventasCount ? (total / ventasCount) : 0;
  const first = rows[0]?.Fecha || "";
  const last = rows[rows.length - 1]?.Fecha || "";

  const stats = {
    ventas: ventasCount,
    unidades,
    total,
    ticketPromedio: ticket,
    primeraFecha: first,
    ultimaFecha: last
  };

  const columns = [
    { Columna: "Fecha", Descripción: "Fecha de la venta (formato ISO YYYY-MM-DD)." },
    { Columna: "Hora", Descripción: "Hora de la venta (HH:MM:SS)." },
    { Columna: "Producto", Descripción: "Nombre del producto registrado en la venta." },
    { Columna: "Cantidad", Descripción: "Cantidad vendida." },
    { Columna: "Precio unitario", Descripción: "Precio unitario de venta (estimado si no existe en el registro)." },
    { Columna: "Total", Descripción: "Total de la venta (monto)." }
  ];

  return { rows, stats, columns };
}

export function buildMovimientosExport(movs, range) {
  const from = range?.from instanceof Date ? range.from : null;
  const to = range?.to instanceof Date ? range.to : null;
  let arr = Array.isArray(movs) ? movs.slice() : [];
  if (from) arr = arr.filter(m => {
    const d = toDateAny(m?.fecha);
    return d && d >= from;
  });
  if (to) arr = arr.filter(m => {
    const d = toDateAny(m?.fecha);
    return d && d <= to;
  });
  arr.sort((a, b) => {
    const da = toDateAny(a?.fecha)?.getTime() ?? 0;
    const db = toDateAny(b?.fecha)?.getTime() ?? 0;
    return da - db;
  });

  const rows = arr.map(m => {
    const d = toDateAny(m?.fecha) || new Date();
    return {
      Fecha: _isoDate(d),
      Tipo: String(m?.tipo || ""),
      Categoría: String(m?.categoria || ""),
      Cuenta: String(m?.cuenta || ""),
      Proveedor: String(m?.proveedor || ""),
      Descripción: String(m?.descripcion || ""),
      Monto: _toNum(m?.monto),
      Impuesto: _toNum(m?.impuesto_monto),
      Descuento: _toNum(m?.descuento_monto),
      "Comprobante URL": String(m?.comprobante_url || m?.comprobante?.url || "")
    };
  });

  const totIng = rows.filter(r => String(r.Tipo).toLowerCase() === "ingreso").reduce((s, r) => s + _toNum(r.Monto), 0);
  const totEgr = rows.filter(r => String(r.Tipo).toLowerCase() === "egreso").reduce((s, r) => s + _toNum(r.Monto), 0);
  const stats = { ingresos: totIng, egresos: totEgr, neto: totIng - totEgr, movimientos: rows.length };

  const columns = [
    { Columna: "Fecha", Descripción: "Fecha del movimiento (formato ISO YYYY-MM-DD)." },
    { Columna: "Tipo", Descripción: "Ingreso o egreso." },
    { Columna: "Categoría", Descripción: "Categoría del movimiento." },
    { Columna: "Cuenta", Descripción: "Cuenta/caja/banco asociado." },
    { Columna: "Proveedor", Descripción: "Proveedor asociado (si aplica)." },
    { Columna: "Descripción", Descripción: "Detalle libre del movimiento." },
    { Columna: "Monto", Descripción: "Monto principal del movimiento." },
    { Columna: "Impuesto", Descripción: "Impuesto aplicado al movimiento (monto)." },
    { Columna: "Descuento", Descripción: "Descuento aplicado al movimiento (monto)." },
    { Columna: "Comprobante URL", Descripción: "Enlace al comprobante (si existe)." }
  ];

  return { rows, stats, columns };
}

