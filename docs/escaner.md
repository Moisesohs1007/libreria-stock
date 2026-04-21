## Escáner de códigos (barra/QR) — Guía y pruebas

### Cómo funciona

El sistema soporta 2 modos:

1) **Modo normal (web)**  
   - El escáner funciona mientras la pestaña del navegador está abierta.
   - Recomendado cuando el cajero trabaja siempre dentro del sistema.

2) **Modo fondo (PC)**  
   - El escáner puede funcionar aunque otra aplicación esté activa.
   - Requiere que la PC tenga ejecutándose `escaner_fondo.py` (captura global de teclado) y que la web pueda consultar `http://localhost:7777`.

> Limitación del navegador: una página web no puede capturar teclas si la ventana/pestaña no está activa. Para “minimizado/segundo plano”, se requiere el modo fondo.

### Activación rápida

**Modo normal (web):**
- Iniciar sesión y escanear (no requiere configuración).

**Modo fondo (PC):**
- Ejecutar el instalador/servicio del escáner en la PC.
- En Chrome/Edge: icono de candado → Configuración del sitio → permitir **Contenido no seguro**.
- En la app: clic en el indicador **ESCÁNER** → confirmar habilitar “FONDO”.

### Diagnóstico rápido

- Verificar servicio modo fondo (en la PC donde corre el escáner):
  - `http://localhost:7777/health`
  - `http://localhost:7777/status`
- Revisar log del modo fondo:
  - `escaner_auditoria.log` (en la misma carpeta de `escaner_fondo.py`)
- Activar modo diagnóstico en la web (opcional):
  - En consola del navegador: `localStorage.setItem("scan_debug","1")`
  - Para apagar: `localStorage.removeItem("scan_debug")`

### Pruebas recomendadas (checklist)

#### A) Modo normal (web)
- Con la app abierta en “Ventas”, escanear un código que exista:
  - Debe decrementar stock y crear venta.
- Estando en otra pestaña interna (Inventario/Etiquetas), escanear:
  - Debe registrar la venta sin forzar cambios de pestaña.
- Escanear un código inexistente:
  - Debe mostrar “No encontrado”.
- Probar escáner que NO envía Enter:
  - Debe procesar el código por “timeout” (pausa breve después del último carácter).
- Abrir un modal (si aplica) y escanear:
  - No debe escribir en campos visibles del modal.

#### B) Modo fondo (PC)
- Con otra aplicación activa (Bloc de notas), escanear:
  - El código debe llegar al sistema sin tener la app en foco.
  - Debe minimizar escritura “accidental” en la otra aplicación.
- Con la app minimizada, escanear:
  - Al volver a la app, la venta debe aparecer registrada.
- Deshabilitar “FONDO” y repetir:
  - No debe capturar desde otras apps.

### Notas de seguridad

- El modo fondo usa captura de teclado a nivel sistema para detectar escaneos (PC local).
- Debe ejecutarse solo en equipos controlados por el negocio.
