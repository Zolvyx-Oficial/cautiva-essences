# Cautiva Essences — E-commerce de perfumería fina

Tienda en línea con catálogo, carrito, pagos con WOMPI, facturación en PDF y panel de administración.

**Stack:** Node.js + Express + SQLite (better-sqlite3) en el backend, HTML5 + CSS3 + JavaScript Vanilla en el frontend (sin build step, se edita directo en VS Code).

**Integraciones:** WOMPI Colombia · WhatsApp Business · facturación PDF (PDFKit) · correos transaccionales (Resend) · i18n ES/EN · SEO técnico (sitemap, robots, OpenGraph, Schema.org).

---

## 1. Estructura del proyecto

```
cautiva-essences/
├── server/
│   ├── index.js                 # Servidor Express principal
│   ├── db.js                    # Esquema SQLite + seed del catálogo inicial
│   ├── middleware/auth.js       # Autenticación JWT del panel admin
│   ├── routes/
│   │   ├── api.js               # Catálogo público, reseñas, productos relacionados
│   │   ├── admin.js             # Login + CRUD de productos, pedidos, categorías y marcas
│   │   ├── checkout.js          # Cálculo de envío, creación de pedidos, factura PDF
│   │   └── wompi.js             # Webhook de confirmación de pagos WOMPI
│   └── utils/
│       ├── shipping.js          # Motor de cálculo de envíos local/nacional
│       ├── whatsapp.js          # Generador del enlace wa.me con resumen de pedido
│       ├── invoice.js           # Generador de factura PDF con PDFKit
│       └── email.js             # Notificaciones por correo (Resend)
├── public/
│   ├── index.html, product.html, cart.html, checkout.html, wishlist.html, 404.html
│   ├── admin/                   # Panel de administración
│   │   ├── login.html, index.html
│   │   ├── forgot-password.html, reset-password.html
│   │   └── admin.js
│   ├── css/style.css            # Sistema de diseño "Dark Luxury"
│   ├── js/                      # i18n, carrito, catálogo, producto, checkout, favoritos
│   ├── locales/es.json, en.json
│   └── img/                     # Logo, placeholder, video del hero
├── data/                        # NO se sube al repositorio
│   ├── essenza.db               # Base de datos SQLite (se crea automáticamente)
│   └── products/                # Fotos de productos subidas desde el panel
├── reset-admin.js               # Utilidad para restablecer la contraseña del admin
├── package.json
└── .env.example
```

> **Importante:** el archivo de base de datos se llama `data/essenza.db` por razones históricas. **No lo renombres.** En producción vive dentro del volumen persistente de Railway; cambiarle el nombre crearía una base vacía y dejaría huérfanos todos los productos e imágenes.

---

## 2. Ejecutar el proyecto en local

### Requisitos

- **Node.js 22 LTS.** Con Node 24 falla la compilación de `better-sqlite3` (no hay binarios precompilados). Se recomienda gestionarlo con [nvm-windows](https://github.com/coreybutler/nvm-windows):
  ```bash
  nvm install 22.14.0
  nvm use 22.14.0
  node -v          # debe decir v22.x
  ```
- No guardes el proyecto dentro de OneDrive, Dropbox o iCloud. Sincronizar `node_modules` y `.git` provoca conflictos y pérdida de archivos. Usa una ruta local como `C:\Proyectos\cautiva-essences`.

### Pasos

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/Zolvyx-Oficial/cautiva-essences.git
   cd cautiva-essences
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Configurar variables de entorno.** Copia `.env.example` a `.env` y completa:

   | Variable | Para qué sirve |
   |---|---|
   | `JWT_SECRET` | Cadena larga y aleatoria. Firma las sesiones del panel admin. |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Credenciales iniciales del panel. |
   | `APP_URL` | `http://localhost:3000` en local; la URL pública en producción. |
   | `NODE_ENV` | `development` en local, `production` en el servidor. |
   | `WOMPI_ENV` | `test` o `production`. Determina qué llaves se usan. |
   | `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET` | Llaves del comercio, desde [comercios.wompi.co](https://comercios.wompi.co) → Desarrolladores. |
   | `RESEND_API_KEY` | Correos de pedido nuevo, pago aprobado y recuperación de contraseña. Opcional: si falta, el servidor arranca igual y solo omite los envíos. |
   | `WHATSAPP_SALES_NUMBER` | Número de ventas en formato internacional sin símbolos. Viene precargado. |

   > El `.env` nunca se sube al repositorio (está en `.gitignore`). Las llaves privadas y los secretos no deben compartirse por chat ni capturas.

4. **Iniciar el servidor:**
   ```bash
   npm start
   ```
   La primera vez, `server/db.js` crea `data/essenza.db` y siembra el catálogo inicial (Lattafa, Al Haramain, Orientica, Bharara, Bond No. 9, Carolina Herrera, Chanel, Ariana Grande) más el usuario administrador con las credenciales del `.env`.

   Para reinicio automático durante el desarrollo:
   ```bash
   npm run dev
   ```

5. **Abrir en el navegador:**
   - Tienda: http://localhost:3000
   - Panel admin: http://localhost:3000/admin/login.html

### Qué NO funciona en local (y es normal)

| Función | Local | Motivo |
|---|---|---|
| Catálogo, carrito, favoritos, reseñas | ✅ | — |
| Panel admin completo | ✅ | — |
| Fotos de productos | ❌ | Viven en `data/products/`, que no se versiona. Las reales están en el volumen de Railway. |
| Pago con WOMPI | ❌ | WOMPI rechaza `localhost` como URL de redirección (devuelve un 403 de CloudFront). |
| Webhook de WOMPI | ❌ | Necesita URL pública. Se puede simular con un túnel ([ngrok](https://ngrok.com/) `ngrok http 3000`) registrando la URL + `/wompi/webhook` en el panel de WOMPI. |

Los pagos y las fotos se prueban siempre contra el despliegue de Railway.

---

## 3. Despliegue en Railway

El proyecto está desplegado en **Railway**, con auto-deploy desde la rama `main` de GitHub.

### Por qué Railway y no Vercel/Netlify

SQLite necesita un disco que persista entre peticiones y despliegues, y las imágenes de producto se guardan como archivos. Las plataformas serverless reinician el sistema de archivos en cada invocación, así que perderían tanto la base de datos como las fotos. Railway ofrece un contenedor de larga vida con volumen persistente.

### Configuración

1. **Volumen persistente montado en `/app/data`.** Ahí viven `essenza.db` y `products/`.

   > Railway permite **un solo volumen por servicio**. Por eso las imágenes subidas no van a `public/img/products/` sino a `data/products/`, y `server/index.js` las publica con una ruta estática dedicada **antes** del middleware estático general:
   > ```js
   > app.use('/img/products', express.static(path.join(__dirname, '..', 'data', 'products')));
   > app.use(express.static(path.join(__dirname, '..', 'public')));
   > ```

2. **Variables de entorno** en Railway → servicio → *Variables* → *Raw Editor*. Son las mismas del `.env`, con `APP_URL` apuntando a la URL pública y `NODE_ENV=production`.

3. **Comando de inicio:** `npm start`.

4. **Webhook de WOMPI:** registrar `https://<tu-dominio>/wompi/webhook` en el panel de WOMPI, sección *Desarrolladores → URL de eventos*. Los ambientes de pruebas y producción se configuran **por separado**.

### Consola de Railway

La pestaña *Console* abre una sesión dentro del contenedor en ejecución, útil para correr `node reset-admin.js` o inspeccionar la base. Dos advertencias:

- Si acabas de desplegar, la consola puede seguir conectada al contenedor **anterior**. Espera a que el servicio esté *ACTIVE* y pulsa **Reconnect**.
- Al salir puede aparecer `Aborted` o `Assertion failed: (env) != nullptr`. Es ruido del cierre de better-sqlite3; la escritura ya se confirmó.

### Pasar WOMPI a producción

1. Reemplazar las cuatro llaves por las de producción y poner `WOMPI_ENV=production`.
2. Registrar la URL de eventos en el ambiente de **producción** de WOMPI (es una configuración distinta a la de pruebas).
3. Probar una compra real de monto bajo antes de anunciar la tienda.

### Dominio propio

Al comprar el dominio hay que actualizar, en este orden:

1. *Custom Domain* en Railway (y los registros DNS que indique).
2. `APP_URL` en las variables de Railway.
3. La URL del sitio y la URL de eventos en el panel de WOMPI.
4. Dar de alta el sitio en Google Search Console.

---

## 4. Funcionalidades

### Tienda

- Catálogo con filtros por categoría, marca, búsqueda y **rango de precio**
- **Paginación** con botón "Cargar más"
- Ficha de producto con notas olfativas, galería y **productos relacionados**
- **Reseñas de clientes** con calificación por estrellas (requieren aprobación del admin antes de publicarse)
- **Favoritos / wishlist** (guardados en el navegador)
- Aviso de **"quedan pocas unidades"** cuando el stock baja del umbral
- **Precio de oferta**: precio tachado y etiqueta de descuento
- **Precio mayorista** visible, con cantidad mínima y enlace de cotización por WhatsApp
- Carrito persistente, cálculo de envío local/nacional
- Checkout que redirige directo a WOMPI; la factura solo se genera **después** de que el pago sea aprobado
- Bilingüe ES/EN

### Panel de administración

- Productos: alta, edición, pausa y eliminación
- **Galería de imágenes**: subir varias, quitarlas con ✕ y reordenarlas con ◀ ▶. La primera imagen es la **Principal**, la que se muestra en el catálogo
- Pedidos: listado con **detalle de productos y cantidades**, cambio de estado, descarga de factura, enlace directo a WhatsApp del cliente y eliminación
- Moderación de reseñas (publicar / ocultar / eliminar)
- Categorías y marcas editables, con protección contra borrar una que tenga productos asociados
- Recuperación de contraseña por correo

---

## 5. Notas de mantenimiento

- **Precios:** en pesos colombianos sin decimales.
- **Envíos:** las tarifas de `server/utils/shipping.js` son de referencia; actualizarlas según el tarifario vigente de Interrapidísimo y ENVÍA.
- **Logo:** debe llamarse exactamente `public/img/logo.jpg`. Lo usan el header, el favicon y las facturas PDF. **Debe ser un JPEG baseline** — PDFKit no admite JPEG progresivo y la factura falla si lo es.
- **Seguridad:** rotar `JWT_SECRET`, `ADMIN_PASSWORD` y las llaves de WOMPI antes de salir a producción. Si alguna llave privada se expone (captura, chat, repositorio), regenerarla desde el panel del comercio.
- **Reseñas:** se guardan siempre con `approved = 0`. Nada se publica sin que el admin lo apruebe.
- **Respaldos:** programar una copia periódica de `data/essenza.db` desde el volumen de Railway.
- **Restablecer el admin:** `node reset-admin.js` lee `ADMIN_EMAIL` y `ADMIN_PASSWORD` del entorno y actualiza el usuario. El seed solo crea el administrador **la primera vez**; cambiar las variables después no basta por sí solo.

---

Sitio desarrollado por **Zolvyx**.