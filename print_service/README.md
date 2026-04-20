# Conteo de Impresiones (Servicio Local)

Este módulo agrega un servicio local (Windows) que captura trabajos de impresión, registra páginas y discrimina BN/Color, persiste en SQLite y expone una API para consumo desde la web de la librería.

## Criterio de conteo (impresión real)

- Un trabajo se registra como `completed` solo cuando el spool job deja de existir y no se detecta estado de error asociado.
- Si se detecta estado de impresora con `DetectedErrorState` (por ejemplo `JAMMED`) o banderas de error del job, se registra como `failed` y no suma páginas.
- Si el driver no provee páginas, se marca como `failed` con `UNKNOWN_PAGES`.

## Ejecución

- Instalar dependencias:
  - `py -m pip install -r print_service/requirements.txt`
- Iniciar servicio:
  - `py -m print_service.server`

## Instalación rápida desde el panel admin

- En la pestaña **Conteo de Impresiones** descarga:
  - `instalar_conteo_impresiones.bat`
  - `iniciar_conteo_impresiones.bat`
  - `desinstalar_conteo_impresiones.bat`
- Ejecuta el instalador en la PC donde está conectada la impresora.

Variables de entorno:
- `PRINT_HOST` (default `0.0.0.0`)
- `PRINT_PORT` (default `5056`)
- `PRINT_DB_PATH` (default `%ProgramData%\LibreriaPrintMonitor\print_jobs.sqlite3`)
- `PRINT_API_TOKEN` (opcional; si se define, requiere header `X-Print-Token`)
- `PRINT_LOGO_PATH` (opcional; PNG para el PDF)
- `PRINT_POLL_S` (default `1`)

## API REST

Base URL (default): `http://localhost:5056`

Autenticación (opcional):
- Header: `X-Print-Token: <token>`

### Health

`GET /api/prints/health`

200:
```json
{"ok":true,"ts":"2026-01-01T00:00:00+00:00"}
```

curl:
```bash
curl http://localhost:5056/api/prints/health
```

### Metadatos (listas para filtros)

`GET /api/prints/meta`

200:
```json
{"printers":["P1"],"users":["usuario@PC"]}
```

curl:
```bash
curl http://localhost:5056/api/prints/meta
```

### Listado + totales

`GET /api/prints`

Query params:
- `from` ISO8601 (UTC recomendado) ejemplo `2026-01-01T00:00:00+00:00`
- `to` ISO8601 ejemplo `2026-01-31T23:59:59+00:00`
- `printers` lista separada por coma (valores exactos) ejemplo `P1,P2`
- `users` lista separada por coma (valores exactos) ejemplo `usuario,usuario@PC`
- `type` uno de `BN|Color|Desconocido`
- `status` uno de `started|completed|failed`
- `q` búsqueda por `document|printer_name|user_id`
- `limit` (1..2000)
- `offset` (>=0)

200:
```json
{"rows":[...],"totals":{"pages_total":0,"pages_bn":0,"pages_color":0,"failed_jobs":0,"completed_jobs":0}}
```

curl:
```bash
curl "http://localhost:5056/api/prints?from=2026-01-01T00:00:00+00:00&to=2026-01-31T23:59:59+00:00&printers=P1"
```

### Dashboard (totales + agregación por impresora)

`GET /api/prints/summary`

Mismos filtros que `/api/prints`.

200:
```json
{"totals":{...},"by_printer":[{"printer_name":"P1","pages_total":0,"pages_bn":0,"pages_color":0,"jobs_completed":0,"jobs_failed":0}]}
```

### Resumen por usuario (vendedor)

`GET /api/prints/my-summary?user_id=<id>`

Este endpoint suma por coincidencia exacta y también por `user_id@%` para cubrir el formato `usuario@PC`.

200:
```json
{"user_id":"maria2024","totals":{"pages_total":0,"pages_bn":0,"pages_color":0,"failed_jobs":0,"completed_jobs":0}}
```

### Eliminar un registro (admin)

`DELETE /api/prints/<id>`

200:
```json
{"ok":true}
```

curl:
```bash
curl -X DELETE http://localhost:5056/api/prints/123
```

### Exportar Excel

`GET /api/prints/export/excel`

Mismos filtros que `/api/prints`.

Retorna un archivo `.xlsx` con tabla + totales.

### Exportar PDF

`GET /api/prints/export/pdf`

Mismos filtros que `/api/prints`.

Retorna un `.pdf` con cabecera (logo opcional), resumen y tabla.

## WebSockets

Socket.IO sobre la misma base URL.

Eventos emitidos por el servidor:
- `prints:finalized` `{ id, ts }`
- `prints:deleted` `{ id, ts }`

## Esquema de base de datos (SQLite)

Tabla `print_jobs`:
- `id` INTEGER PK
- `printer_name` TEXT NOT NULL
- `pages` INTEGER NOT NULL (>=0)
- `print_type` TEXT NOT NULL (`BN|Color|Desconocido`)
- `ts_created` TEXT NOT NULL (ISO8601 con zona horaria)
- `ts_completed` TEXT NULL
- `document` TEXT NOT NULL
- `user_id` TEXT NOT NULL
- `windows_owner` TEXT NULL
- `windows_machine` TEXT NULL
- `spool_job_id` INTEGER NULL
- `status` TEXT NOT NULL (`started|completed|failed`)
- `error_code` TEXT NULL
- `raw_status` INTEGER NULL

Índices:
- `printer_name`, `user_id`, `ts_created`, `ts_completed`, `status`

Tabla `print_events` (auditoría):
- `id` INTEGER PK
- `print_job_id` FK -> `print_jobs(id)` ON DELETE CASCADE
- `ts` TEXT NOT NULL
- `event_type` TEXT NOT NULL
- `details` TEXT NULL

## Manual de usuario (por rol)

### Administrador

Ruta:
- Panel Admin → Reportes → Conteo de Impresiones

Uso:
- Configura la URL del servicio (por defecto `http://localhost:5056`) y guarda.
- Usa filtros `Desde/Hasta`, multi-select de impresoras y usuarios, y filtra por tipo/estado.
- El dashboard se actualiza automáticamente cada 30s y también por eventos en tiempo real.
- Exporta Excel/PDF desde los botones del módulo.

### Vendedor

Ruta:
- Dashboard vendedor → tarjeta “Mi Conteo de Impresiones”

Uso:
- Muestra solo totales (Total, BN, Color) para el usuario logueado.
- No expone detalle ni filtros.
