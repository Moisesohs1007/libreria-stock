# Sistema de diseño (UI)

Este documento describe el sistema de diseño implementado en `style.css` para mantener una interfaz moderna, consistente y accesible.

## Principios

- Minimalismo: menos bordes duros, más aire, jerarquía tipográfica clara
- Consistencia: mismos radios, sombras, espaciados y colores en toda la app
- Accesibilidad: foco visible, contraste adecuado, respeto por `prefers-reduced-motion`
- Responsive: navegación móvil (sidebar) y navegación escritorio (dropdown)

## Tokens (CSS variables)

Ubicación: `:root` en `style.css`.

### Colores

- `--paper`: fondo general
- `--surface`, `--surface-2`, `--surface-3`: superficies (tarjetas, paneles, tablas)
- `--ink`: texto principal
- `--muted`: texto secundario
- `--border`: bordes y separadores
- `--accent`: color principal (acciones primarias)
- `--green`: éxito/estado OK
- `--yellow`: advertencia (para componentes secundarios)

### Radios

- `--radius-sm`, `--radius-md`, `--radius-lg`

### Sombras

- `--shadow-sm`, `--shadow-md`, `--shadow-lg`

### Accesibilidad

- `--ring`: anillo de foco (se aplica con `:focus-visible`)

## Componentes

### Botones

Base: `.btn`

Variantes:

- `.btn-primary`: acción principal
- `.btn-danger`: acción destructiva
- `.btn-info`: acción informativa
- `.btn-excel`: exportaciones
- `.btn-edit`: edición secundaria
- `.btn-print`: impresión
- `.btn-orange`: acciones de advertencia

Guía:

- Usar `.btn-primary` para acciones principales por pantalla
- Evitar múltiples botones “primarios” en el mismo bloque

### Inputs

- `.input-field`: campos de texto/number/password
- `.input-label`: etiquetas

Guía:

- Mantener `placeholder` solo como ejemplo, no como sustituto de etiqueta
- Usar foco visible por accesibilidad (ya incluido)

### Cards

- `.card`: contenedor base
- `.card-title`: título/sección

Guía:

- Agrupar información relacionada en una card
- Usar títulos cortos y consistentes

### Tablas

- `.tabla`: tabla base moderna (borde + zebra leve + hover)
- `.badge-stock` + `.badge-ok`/`.badge-low`/`.badge-empty`: estados

### Modal

- `.modal-overlay` y `.modal-box`

### Navegación

- Móvil: `.mobile-nav-bar` + sidebar
- Escritorio: `.desktop-tab-nav` + dropdown (`.dt-group`, `.dt-dropdown`)

## Responsive

- `< 768px`: se muestra `mobile-nav-bar` y sidebar
- `>= 768px`: se muestra `desktop-tab-nav`

## WCAG 2.1 (checklist)

- Foco visible: `:focus-visible` aplica `--ring`
- Contraste: `--ink` sobre `--paper` y `--surface` con alto contraste
- Movimiento reducido: `prefers-reduced-motion` desactiva animaciones/transiciones

## Notas de implementación

- Se mantiene Tailwind CDN para layout (grid/spacing utilitario) en el HTML.
- `style.css` define el look and feel del sistema (tokens + componentes).
