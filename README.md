# Essenza Studio — E-commerce de perfumería fina

Stack: **Node.js + Express + SQLite (better-sqlite3)** en el backend, **HTML5 + CSS3 + JavaScript Vanilla** en el frontend (sin build step, ideal para editar directo en VS Code). Integraciones: **WOMPI Colombia**, **WhatsApp Business**, **facturación en PDF (PDFKit)**, **i18n ES/EN** y **SEO técnico** (sitemap, robots, OpenGraph, Schema.org).

---

## 1. Estructura del proyecto

```
essenza-studio/
├── server/
│   ├── index.js            # Servidor Express principal
│   ├── db.js                # Esquema SQLite + seed del catálogo inicial
│   ├── middleware/auth.js   # Autenticación JWT del panel admin
│   ├── routes/
│   │   ├── api.js           # Catálogo público (categorías, marcas, productos)
│   │   ├── admin.js         # Login + CRUD de productos (protegido)
│   │   ├── checkout.js      # Cálculo de envío, creación de pedidos, factura PDF
│   │   └── wompi.js         # Webhook de confirmación de pagos WOMPI
│   └── utils/
│       ├── shipping.js      # Motor de cálculo de envíos local/nacional
│       ├── whatsapp.js      # Generador del enlace wa.me con resumen de pedido
│       └── invoice.js       # Generador de factura PDF con PDFKit
├── public/
│   ├── index.html, product.html, cart.html, checkout.html, 404.html
│   ├── admin/                # Panel de administración (login + dashboard)
│   ├── css/style.css         # Sistema de diseño "Dark Luxury"
│   ├── js/                   # Lógica de frontend (i18n, carrito, catálogo, checkout)
│   ├── locales/es.json, en.json
│   └── img/                  # Logo, placeholder e imágenes subidas de productos
├── data/essenza.db           # Base de datos SQLite (se crea automáticamente)
├── package.json
└── .env.example
```

---

## 2. Cómo ejecutar el proyecto en VS Code

### Requisitos
- Node.js 18 o superior instalado.
- VS Code con la extensión "SQLite Viewer" (opcional, para inspeccionar la base de datos).

### Pasos

1. **Abrir la carpeta `essenza-studio` en VS Code.**

2. **Instalar dependencias** (abre una terminal integrada con `` Ctrl+` ``):
   ```bash
   npm install
   ```

3. **Configurar variables de entorno:**
   ```bash
   cp .env.example .env
   ```
   Edita `.env` y completa como mínimo:
   - `JWT_SECRET`: cualquier cadena larga y aleatoria.
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD`: credenciales del panel `/admin`.
   - `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET`: se obtienen en tu panel de comercio de [WOMPI](https://comercios.wompi.co) (sección "Llaves API"). Usa las llaves de **pruebas** (`pub_test_...`) mientras desarrollas.
   - `WHATSAPP_SALES_NUMBER`: ya viene precargado con el número de Diana (+57 319 681 2111) en formato internacional sin símbolos: `573196812111`.

4. **Colocar el logo de la marca:**
   Copia tu archivo `EssenzaStudioLogo.jpg` a `public/img/logo.jpg` (el nombre debe ser exactamente `logo.jpg`, ya que así lo referencian el header, el favicon y las facturas PDF).

5. **Iniciar el servidor:**
   ```bash
   npm start
   ```
   La primera vez, `server/db.js` crea automáticamente `data/essenza.db` y siembra el catálogo con las marcas y perfumes indicados (Lattafa, Al Haramain, Orientica, Bharara, Bond No. 9, Carolina Herrera, Chanel, Ariana Grande), además de un usuario administrador con las credenciales de tu `.env`.

6. **Abrir en el navegador:**
   - Tienda: [http://localhost:3000](http://localhost:3000)
   - Panel admin: [http://localhost:3000/admin/login.html](http://localhost:3000/admin/login.html)

   Para reinicio automático durante el desarrollo:
   ```bash
   npm run dev
   ```

### Probar pagos WOMPI en modo pruebas
Con las llaves `pub_test_...`, WOMPI muestra un checkout de pruebas donde puedes simular tarjetas aprobadas/rechazadas sin cobros reales. Consulta [la documentación oficial](https://docs.wompi.co/docs/colombia/como-empezar/) para tarjetas de prueba.

Para que el webhook de confirmación de pago (`/wompi/webhook`) reciba eventos en local, usa un túnel como [ngrok](https://ngrok.com/) (`ngrok http 3000`) y registra la URL pública + `/wompi/webhook` en tu panel de comercio WOMPI, en la sección "Eventos".

---

## 3. Despliegue a producción con dominio propio

### Opción recomendada: VPS (DigitalOcean, Hetzner, AWS Lightsail, etc.)

1. **Aprovisiona un servidor** Ubuntu 22.04 y conéctate por SSH.
2. **Instala Node.js** (vía [nvm](https://github.com/nvm-sh/nvm)) y **PM2** (gestor de procesos):
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   nvm install --lts
   npm install -g pm2
   ```
3. **Sube el proyecto** al servidor (vía `git clone` de tu repositorio o `scp`).
4. Dentro de la carpeta del proyecto:
   ```bash
   npm install --production
   cp .env.example .env   # y edítalo con tus llaves de producción (pub_..., no pub_test_...)
   npm run seed            # solo si data/essenza.db no existe aún
   pm2 start server/index.js --name essenza-studio
   pm2 save
   pm2 startup             # sigue las instrucciones para que arranque con el servidor
   ```
5. **Instala Nginx** como proxy reverso:
   ```bash
   sudo apt install nginx
   ```
   Crea `/etc/nginx/sites-available/essenzastudio.co`:
   ```nginx
   server {
     listen 80;
     server_name essenzastudio.co www.essenzastudio.co;

     location / {
       proxy_pass http://localhost:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection 'upgrade';
       proxy_set_header Host $host;
       proxy_cache_bypass $http_upgrade;
     }
   }
   ```
   ```bash
   sudo ln -s /etc/nginx/sites-available/essenzastudio.co /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
6. **Apunta tu dominio** (comprado en Namecheap, GoDaddy, etc.) con un registro `A` hacia la IP del servidor.
7. **Activa HTTPS gratis con Let's Encrypt:**
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d essenzastudio.co -d www.essenzastudio.co
   ```
8. **Actualiza `.env`** con `APP_URL=https://essenzastudio.co` y `NODE_ENV=production`, luego reinicia:
   ```bash
   pm2 restart essenza-studio
   ```
9. **Registra el webhook de producción** en tu panel WOMPI: `https://essenzastudio.co/wompi/webhook`.

### Alternativa rápida (sin servidor propio)
Plataformas como **Railway** o **Render** permiten desplegar este proyecto Node.js directamente desde un repositorio Git: configuras las mismas variables de entorno del `.env` en su panel, defines el comando de inicio `npm start`, y conectas tu dominio propio desde la sección de dominios personalizados de la plataforma. Ten en cuenta que en estos servicios el disco puede no ser persistente entre despliegues — si tu plan lo requiere, migra `data/essenza.db` a PostgreSQL administrado (Supabase o el add-on de Postgres de la plataforma) reemplazando las consultas de `better-sqlite3` por un cliente `pg`.

---

## 4. Notas importantes

- **Precios**: todos los precios del catálogo semilla están en pesos colombianos (COP) sin decimales. Ajusta los valores reales desde el panel `/admin`.
- **Envíos**: las tarifas en `server/utils/shipping.js` son de referencia — actualízalas según el tarifario real vigente de Interrapidísimo y ENVÍA.
- **Seguridad**: cambia `JWT_SECRET`, `ADMIN_PASSWORD` y todas las llaves de WOMPI antes de salir a producción. Nunca subas tu `.env` a un repositorio público (ya está excluido en `.gitignore`).
- **Backups**: programa una copia periódica de `data/essenza.db` (o migra a PostgreSQL/Supabase para mayor robustez en alto volumen).
