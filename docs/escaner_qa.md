# Escaneo — Casos, fallos y protocolo de pruebas

## Componentes

- Web:
  - Captura teclado (modo normal).
  - Polling a `http://127.0.0.1:7777/poll` (modo fondo).
  - Registro de venta + actualización de inventario en Firestore.
- PC (modo fondo):
  - `escaner_fondo.py` (pynput + Flask) en puerto 7777.
  - Endpoints: `/status`, `/poll` (y opcional `/health`).

## Estados y banderas

- `rolActual`: `admin` / `vendedor`
- `bg_scanner_enabled` (localStorage): `1` activo / `0` desactivado
- Servicio 7777: responde `status/poll` o no
- Firestore: disponible o no (red/permisos)

## Criterio de éxito por escaneo

- Tiempo total (UI): ideal < 500ms (si el producto está en índice en memoria).
- Venta creada con:
  - `fecha`
  - `cantidad` (1)
  - `precio_unitario`
  - `total`
  - `vendedor`, `rol`, `fuente` (web/bg)
- Stock decrementado en inventario.

## Casos (modo normal)

1) App en foco, usuario en cualquier pantalla
- Esperado: captura por timing, normaliza código y registra venta.
- No debe dejar el código escrito en inputs si el scan es detectado.

2) App en foco, Firestore sin conexión
- Esperado: mensaje de error específico (sin permisos / sin conexión).
- No debe “colgar” la UI.

3) Producto inexistente
- Esperado: “No encontrado”.

## Casos (modo fondo)

4) Servicio 7777 activo + navegador permite contenido no seguro
- Esperado: ventas registran aunque otra app esté activa (con la web abierta).

5) Servicio 7777 apagado o bloqueado por el navegador
- Esperado: no habilita FONDO (mensaje claro) y el modo normal sigue funcionando.

## Puntos de fallo típicos y diagnóstico

- 7777 responde `/poll` pero 404 en `/` o `/health`:
  - No es crítico. Lo importante es `/status` y `/poll`.
- Se escriben prefijos como `$LIB-...` o `SLI` en otros programas:
  - Indica fuga de teclas antes del bloqueo total. Revisar configuración del escáner (prefijos) y modo fondo.

## Protocolo de pruebas (Admin y Vendedor)

- P1: Con la app en foco, escanear 3 productos existentes seguidos → 3 ventas + stock -3.
- P2: Escanear un código inexistente → “No encontrado” sin congelar UI.
- P3: Estar escribiendo en un input visible, escanear → no debe quedar escrito el código y debe registrarse venta.
- P4: Activar FONDO, poner WhatsApp en foco, escanear → venta se registra (web abierta).
- P5: Desactivar internet, escanear → mensaje “sin conexión” o “sin permisos” y no debe crear ventas.

