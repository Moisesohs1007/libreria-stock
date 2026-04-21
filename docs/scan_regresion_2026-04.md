# Informe técnico — Módulo de escaneo (Abril 2026)

## 1) Hallazgos del diagnóstico

### Fallas reportadas y causas probables

- “No encontrado” al escanear en Ventas:
  - El lookup dependía de una consulta directa a Firestore por `productos.codigo == <valor>`, lo cual es sensible a variaciones (mayúsculas, ceros a la izquierda, caracteres extra) y a latencia/red.
  - Si el listener de productos ya estaba cargado, igual se volvía a consultar, generando puntos de falla innecesarios.

- Alertas / comportamiento intrusivo fuera de Ventas:
  - El escáner podía capturar teclas a nivel documento y, cuando se completaba un buffer, forzaba navegación a Ventas (interrupción de flujo).
  - La captura por teclado podía “confundir” escritura humana (pulsaciones lentas) con un escaneo si no existía un filtro temporal.

- “No registra ninguna venta”:
  - La actualización de stock y el registro de venta se hacían con operaciones separadas (update + add). Bajo errores intermedios o concurrencia, se podía romper el flujo o dejar datos inconsistentes.

## 2) Revisión histórica (Git) solicitada (días 10–14)

- En el repositorio local no existen commits entre **2026-04-10** y **2026-04-14**.
- Los cambios relevantes del mes están concentrados en **2026-04-19** y **2026-04-20**.

Commits relevantes al escáner (2026-04-20):
- `58afb73` — robustecer captura web y mejorar modo fondo.
- `2f9f022` — botón ESCÁNER en vendedor + fallback si el modo fondo no responde.
- `c7df28e` — no robar foco del escáner fuera de Ventas (arregla Etiquetas).
- `1ead5d0` — detectar escaneo fuera de ventas sin romper otras secciones.

## 3) Correcciones implementadas (estado actual)

### Frontend (web)

- Lookup robusto de productos:
  - Se indexan productos en memoria desde `todosLosProductos` y se busca por variantes del código.
  - Se mantiene fallback por consulta a Firestore si aún no se cargó el snapshot.

- Registro de venta atómico:
  - Se utiliza transacción: valida stock y aplica decremento + inserta venta de forma consistente.

- Anti-interferencia:
  - Se filtra por “timing” para diferenciar tecleo humano vs escaneo (secuencia rápida).
  - Se eliminó el forzado de cambio de pestaña al completar un escaneo.

Archivos:
- `app.js`
- `scanner_utils.js`

### Modo fondo (PC)

- Se agregó logging consistente en `escaner_auditoria.log`.
- Se añadió endpoint `GET /health`.
- Se mejoró la supresión: cuando el primer carácter se “filtra” por heurística (caso borde), se intenta borrar con un Backspace inyectado al detectarse que era escaneo.

Archivo:
- `escaner_fondo.py`

## 4) Pruebas y validación

### Tests de utilidades (browser)

- Abrir con un servidor local (recomendado) y ejecutar:
  - `tests/scanner_utils.test.html`

### Checklist funcional

La guía actualizada de pruebas está en:
- `docs/escaner.md`

