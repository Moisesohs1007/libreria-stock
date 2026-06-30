# 📋 Guía Paso a Paso de Instalación y Configuración de la Librería

---

## 📦 Índice
1. [Requisitos previos](#requisitos-previos)
2. [Instalación de la App Web](#instalación-de-la-app-web)
3. [Configuración del Proxy SNMP para Fotocopiadoras](#configuración-del-proxy-snmp-para-fotocopiadoras)
4. [Instalación del Servicio de Conteo de Impresiones](#instalación-del-servicio-de-conteo-de-impresiones)
5. [Configuración de la PC del Vendedor](#configuración-de-la-pc-del-vendedor)
6. [Uso y Funcionalidades](#uso-y-funcionalidades)

---

## ✅ Requisitos previos

Antes de empezar, asegúrate de tener instalado:
- **Node.js** (versión LTS, para el proxy SNMP) → [Descargar aquí](https://nodejs.org/)
- **Python 3.10+** (para el servicio de conteo de impresiones) → [Descargar aquí](https://www.python.org/)
- Un servidor web para alojar la app (puedes usar XAMPP, WAMP, o incluso un servidor local con `python -m http.server`)
- Conexión a la red local para acceder a las fotocopiadoras y la impresora

---

## 🚀 Instalación de la App Web

### Paso 1: Obtén los archivos
Descarga o clona el repositorio de la app en tu servidor web.

### Paso 2: Configura Firebase
Asegúrate de que el archivo `firebase-config.js` tenga las credenciales correctas de tu proyecto Firebase.

### Paso 3: Aloja la app
- Si usas XAMPP: Coloca los archivos en la carpeta `htdocs`
- Si usas un servidor local: Abre la terminal en la carpeta de la app y ejecuta:
  ```bash
  python -m http.server 8000
  ```
Luego abre tu navegador y visita `http://localhost:8000`

---

## 🖨️ Configuración del Proxy SNMP para Fotocopiadoras

El proxy SNMP permite que la app se comunique con las fotocopiadoras a través de la red local.

### Paso 1: Descarga el proxy
1. Abre la app web y ve a **Configuración → Fotocopiadoras**
2. Haz clic en **Descargar proxy-fotocopiadora.js**
3. Guarda el archivo en una carpeta fácil de acceder (ej: `C:\LibreriaPOS\proxy`)

### Paso 2: Instala dependencias
Abre la terminal en la carpeta del proxy y ejecuta:
```bash
npm install express net-snmp cors
```

### Paso 3: Configura la fotocopiadora en la red
1. Asegúrate de que la fotocopiadora esté conectada a la misma red local que tu PC
2. Obtén la dirección IP de la fotocopiadora (en la mayoría de fotocopiadoras, puedes encontrarla en el menú de configuración de red)
3. Habilita SNMP en la fotocopiadora y establece la comunidad (normalmente es `public`)

### Paso 4: Agrega la fotocopiadora en la app
1. En la app web, ve a **Configuración → Fotocopiadoras**
2. Haz clic en **➕ Agregar Fotocopiadora** y escribe el nombre de la misma
3. Completa los campos:
   - **IP**: La dirección IP de la fotocopiadora
   - **Puerto Proxy**: El puerto donde se ejecutará el proxy (por defecto `3001`)
   - **Comunidad SNMP**: La comunidad configurada en la fotocopiadora (normalmente `public`)
   - **OID Total**: El OID para obtener el contador total de copias (para Ricoh MP5055 es `1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.1`)
   - **OID B/N**: El OID para obtener el contador de copias en blanco y negro
4. Guarda la configuración

### Paso 5: Inicia el proxy
En la terminal, ejecuta:
```bash
node proxy-fotocopiadora.js
```
Deberías ver el mensaje: `Proxy OK en 3001`

### Paso 6: Prueba la conexión
En la app web, haz clic en **Conectar y probar** para verificar que la conexión funcione.

---

## 🖨️ Instalación del Servicio de Conteo de Impresiones

Este servicio monitorea las impresiones y registra el número de páginas.

### Paso 1: Descarga los archivos
1. Ve a **Configuración → PC del Vendedor** en la app
2. Descarga los archivos de instalación
3. Colócalos en la PC donde está conectada la impresora

### Paso 2: Instala el servicio
Ejecuta el archivo `setup_conteo_impresiones.cmd` como administrador. Esto instalará todas las dependencias y configurará el servicio.

### Paso 3: Inicia el servicio
Ejecuta `iniciar_conteo_impresiones.cmd` para iniciar el servicio de monitoreo.

---

## 👩💼 Configuración de la PC del Vendedor

1. Instala el servicio de conteo de impresiones en la PC del vendedor (siguiendo los pasos anteriores)
2. Abre la app web en la PC del vendedor e inicia sesión con la cuenta de vendedor
3. Ve a la sección **Mi Conteo de Impresiones** para ver las estadísticas

---

## 📱 Uso y Funcionalidades

### Para Administradores
- **Gestión de productos**: Agrega, edita y elimina productos
- **Gestión de ventas**: Ver todas las ventas realizadas
- **Conteo de impresiones**: Ver el conteo de todas las impresiones por usuario o impresora
- **Fotocopiadoras**: Monitoriza varias fotocopiadoras al mismo tiempo y ver su historial de uso
- **Copias fiadas**: Gestiona las copias fiadas por cliente y ve el reporte de deudas

### Para Vendedores
- **Ventas**: Registra ventas escaneando códigos de barras
- **Conteo de impresiones**: Ver su propio conteo de impresiones
- **Copias fiadas**: Registra copias fiadas y ve el reporte de sus clientes

---

## 🛠️ Solución de Problemas

### El proxy SNMP no se conecta
- Verifica que la fotocopiadora esté encendida y conectada a la red
- Asegúrate de que la IP y la comunidad SNMP sean correctas
- Comprueba que el firewall de tu PC no esté bloqueando el puerto 3001

### El servicio de conteo no se inicia
- Ejecuta el script como administrador
- Asegúrate de que Python esté instalado correctamente
- Verifica que los permisos de la carpeta del servicio sean adecuados

---

¡Listo! Ahora ya puedes usar la app para gestionar tu librería. Si tienes alguna duda, revisa la sección de ayuda en la app o contacta a soporte.
