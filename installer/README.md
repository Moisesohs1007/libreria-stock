# Instalador (Conteo de Impresiones)

Este instalador automatiza la instalación del servicio de conteo de impresiones en Windows.

## Uso para cliente (1 clic)

1. Descarga `installer/setup_conteo_impresiones.cmd`
2. Ejecuta como Administrador
3. Verifica: `http://localhost:5056/api/prints/health`

## Qué hace

- Valida permisos (se auto-eleva con UAC).
- Crea punto de restauración si es posible.
- Hace backup de `C:\LibreriaPrintMonitor\app` antes de actualizar.
- Descarga el código desde GitHub (ZIP del branch main) y extrae `print_service`.
- Descarga Python embebido 3.12.x y lo instala en `C:\LibreriaPrintMonitor\runtime`.
- Instala dependencias con pip.
- Crea una tarea programada `LibreriaPrintMonitor` (SYSTEM) y la inicia.
- Escribe logs en `C:\LibreriaPrintMonitor\logs\installer.log` y `service.log`.

## Puntos de falla y recuperación

- Sin admin: se relanza con UAC. Si UAC es cancelado, se corta.
- Sin internet/bloqueo GitHub: falla descarga; no modifica app y restaura backup si aplica.
- Python/descarga corrupta: falla; restaura backup.
- Dependencias pip: falla; restaura backup.
- Puerto ocupado: cambia puerto usando `-Port` en el script.

## Comandos avanzados

- Instalar en puerto distinto:
  - `powershell -ExecutionPolicy Bypass -File conteo_impresiones.ps1 -Mode install -Port 5057`
- Con token:
  - `powershell -ExecutionPolicy Bypass -File conteo_impresiones.ps1 -Mode install -Token TU_TOKEN`
- Desinstalar:
  - `powershell -ExecutionPolicy Bypass -File conteo_impresiones.ps1 -Mode uninstall`

