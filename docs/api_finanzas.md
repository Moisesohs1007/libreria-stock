# API REST (futura) — Finanzas

Este documento define una API REST para integraciones futuras (contabilidad, BI, apps móviles). En el estado actual, el sistema opera directo con Firestore desde el frontend.

## Autenticación

Recomendado:

- Bearer token (Firebase Auth ID token) con verificación en backend (Cloud Functions / Cloud Run).
- Roles/claims: `admin`, `vendedor`.

Headers:

- Authorization: Bearer <token>
- Content-Type: application/json

## Convenciones

- Fechas en ISO 8601, zona horaria local o UTC, pero consistente en todo el sistema.
- Respuestas paginadas:
  - `limit`, `cursor`
  - `nextCursor`

## Endpoints

### Categorías (movimientos)

GET /api/finanzas/categorias

- Query: `q` (opcional)
- Respuesta: `{ items: [{ id, nombre, creadoEn }] }`

POST /api/finanzas/categorias

Body:

```json
{ "nombre": "Servicios" }
```

DELETE /api/finanzas/categorias/{id}

### Proveedores (movimientos)

GET /api/finanzas/proveedores

POST /api/finanzas/proveedores

```json
{ "nombre": "Distribuidora X" }
```

DELETE /api/finanzas/proveedores/{id}

### Movimientos

GET /api/finanzas/movimientos

Query:

- `from` (YYYY-MM-DD)
- `to` (YYYY-MM-DD)
- `tipo` (ingreso|egreso) opcional
- `categoria` opcional
- `cuenta` opcional
- `proveedor` opcional
- `limit`, `cursor`

Respuesta:

```json
{
  "items": [
    {
      "id": "abc",
      "tipo": "egreso",
      "fecha": "2026-04-26",
      "monto": 120.5,
      "cuenta": "Caja",
      "categoria": "Compras",
      "proveedor": "Distribuidora X",
      "impuesto_monto": 0,
      "descuento_monto": 0,
      "descripcion": "Compra mercadería",
      "comprobante_url": "",
      "comprobante": { "url": "", "path": "", "name": "", "size": 0, "type": "" },
      "creadoEn": "2026-04-26T10:00:00Z",
      "actualizadoEn": "2026-04-26T10:00:00Z"
    }
  ],
  "nextCursor": null
}
```

POST /api/finanzas/movimientos

Body:

```json
{
  "tipo": "egreso",
  "fecha": "2026-04-26",
  "monto": 120.5,
  "cuenta": "Caja",
  "categoria": "Compras",
  "proveedor": "Distribuidora X",
  "impuesto_monto": 0,
  "descuento_monto": 0,
  "descripcion": "Compra mercadería",
  "comprobante_url": "https://..."
}
```

PATCH /api/finanzas/movimientos/{id}

- Permite actualizar campos editables (monto, cuenta, categoría, proveedor, descripción, comprobante_url, etc.)

DELETE /api/finanzas/movimientos/{id}

### Subida de comprobantes

POST /api/finanzas/movimientos/{id}/comprobante

- Multipart form-data
- Campo: `file`

Respuesta:

```json
{ "url": "https://...", "path": "comprobantes/2026-04/...", "name": "x.pdf", "size": 12345, "type": "application/pdf" }
```

### Análisis de ganancias

GET /api/finanzas/ganancias

Query:

- `from` (YYYY-MM-DD)
- `to` (YYYY-MM-DD)
- `categoriaProducto` opcional
- `proveedorProducto` opcional
- `includeOperativos` (bool) opcional (incluye egresos registrados)

Respuesta:

```json
{
  "from": "2026-04-01",
  "to": "2026-04-26",
  "ingresos": 1000.0,
  "costos": 600.0,
  "egresos_operativos": 120.0,
  "utilidad": 280.0,
  "tendencia": [
    { "date": "2026-04-01", "utilidad_bruta": 20.0 },
    { "date": "2026-04-02", "utilidad_bruta": 35.0 }
  ],
  "margenPorProducto": [
    { "codigo": "LIB-123", "producto": "Cuaderno", "cantidad": 5, "ingresos": 50.0, "costos": 30.0, "utilidad": 20.0, "margen": 0.4 }
  ]
}
```

### Estado de resultados (EERR)

GET /api/finanzas/eerr

Query:

- `periodo` (rango|mensual|trimestral|anual)
- `from`,`to` (si periodo=rango)
- `year`, `month` (si mensual)
- `year`, `quarter` (si trimestral)
- `year` (si anual)
- `compare` (bool) opcional

Respuesta:

```json
{
  "periodo": { "from": "2026-04-01", "to": "2026-04-30" },
  "ventas_netas": 1000.0,
  "costo_ventas": 600.0,
  "utilidad_bruta": 400.0,
  "otros_ingresos": 50.0,
  "egresos": 120.0,
  "utilidad_neta": 330.0,
  "comparativo": {
    "periodo": { "from": "2026-03-01", "to": "2026-03-31" },
    "utilidad_neta": 280.0
  }
}
```

## Auditoría

Recomendado:

- Middleware que registre `audit_logs` en backend para toda mutación (create/update/delete).
- No depender solo del cliente.

