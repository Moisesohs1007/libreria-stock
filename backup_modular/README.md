# Librería Virgen de la Puerta - Sistema de Control de Stock

Este proyecto es un sistema híbrido para la gestión de inventario y ventas, diseñado para funcionar con un escáner de códigos de barras/QR en segundo plano.

## Estructura del Proyecto

- `index.html`: Punto de entrada de la aplicación web.
- `app.js`: Lógica principal del frontend (ES Modules).
- `style.css`: Estilos de la aplicación (Tailwind CSS + Custom CSS).
- `firebase-config.js`: Configuración de Firebase y constantes de la aplicación.
- `escaner_fondo.py`: Servidor backend en Python para captura de teclado global.
- `test_escaner.py`: Pruebas unitarias para el backend.
- `INSTALAR_INICIO_AUTOMATICO.bat`: Script de instalación para Windows.

## Mejoras Realizadas

### 1. Modularización
Se ha separado el código monolítico de `index.html` en archivos independientes (`app.js`, `style.css`, `firebase-config.js`). Esto mejora significativamente la mantenibilidad y legibilidad del código.

### 2. Seguridad
- Se han extraído las credenciales hardcodeadas a `firebase-config.js` como un primer paso para una gestión de configuración más segura.
- Se recomienda en el futuro implementar **Firebase Auth** para eliminar completamente la validación de contraseñas en texto plano.

### 3. Optimización del Backend
- Se ha implementado el módulo `logging` de Python para un seguimiento profesional de eventos y errores.
- Se ha añadido manejo de excepciones robusto en el servidor Flask y el listener de teclado.
- Se han incluido pruebas unitarias (`test_escaner.py`) para validar la lógica de conversión de teclas y los endpoints de la API.

### 4. Rendimiento y Usabilidad
- Limpieza de código duplicado en el frontend.
- Mejora en la consistencia de la interfaz de usuario.

## Requisitos

- Python 3.x
- Dependencias Python: `pip install pynput flask flask-cors`
- Conexión a Internet (para Firebase SDK y librerías externas).

## Cómo empezar

1. Ejecuta `INSTALAR_INICIO_AUTOMATICO.bat` como administrador para configurar el escáner en segundo plano.
2. Abre `index.html` en un navegador moderno.
3. Inicia sesión con tus credenciales.

## Desarrollo

Para ejecutar las pruebas del backend:
```bash
python test_escaner.py
```
