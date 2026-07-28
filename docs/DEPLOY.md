# Deploy — Ghosty Tasks

Ghosty Tasks es una app TanStack Start (Nitro) stateless: el estado vive en
EasyBits y la identidad en ghosty.studio. Deploy = dar una IP/dominio al proceso
Node y pasarle las env vars. Sin rebake de template ni Docker obligatorio.

---

## Dev local

```bash
npm install
# Crea .env con las vars de ARCHITECTURE.md §Env vars
npm run dev       # → http://localhost:3001
```

El primer login del workspace crea el owner. Las tablas `gw_*` se crean
automáticamente via `ensureSchema()` en ese primer login — no hay `npm run migrate`.

---

## Env vars requeridas en prod

```bash
EASYBITS_BASE_URL=https://www.easybits.cloud
EASYBITS_API_KEY=eb_sk_live_...
EASYBITS_DB_ID=ghostytasks
GHOSTY_IDENTITY_URL=https://www.ghosty.studio
SESSION_SECRET=<hex 32 bytes>          # genera con:
                                       # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
APP_URL=https://tasks.tu-dominio.com   # override del origin (recomendado en prod)
GHOSTY_PARTNER_SECRET=<secreto>        # si ghosty.studio lo proporciona
```

`APP_URL` es importante en prod: sin él el app deriva el origin del request
(`x-forwarded-host`/`x-ghosty-origin`), lo que puede fallar detrás de ciertos
proxies. Setearlo explícito evita surpresas.

---

## Build

```bash
npm run build
# Salida en .output/
node .output/server/index.mjs
```

Nitro genera un bundle autocontenido. Puede correr con Node puro, en una caja de
EasyBits, en Fly.io, Railway, etc. — sin deps del OS más allá de Node 22.

---

## Migraciones de schema

`ensureSchema()` (`src/server/schema.server.ts`) corre en el primer login tras
deploy. Es idempotente: `IF NOT EXISTS` + `addColumn` con verificación previa.
Si falla (blip de DB), se resetea y el siguiente request reintenta.

**No hay archivos de migración separados.** Al agregar columnas nuevas:
1. Añadir `await addColumn("gw_tabla", "col", "TIPO DEFAULT x")` dentro de `migrate()`.
2. En el próximo deploy, la columna aparece en el primer login.

Los workspaces existentes reciben la columna via `addColumn` (aditivo). Los nuevos
la reciben desde el `CREATE TABLE IF NOT EXISTS` inicial.

---

## Verificación post-deploy

1. `GET /` → redirige a `/login` → redirige a ghosty.studio → login con Google →
   regresa → dashboard.
2. `GET /api/stream` con cookie `gw_session` → responde `text/event-stream`.
3. Crear una tarea → aparece instantáneo en otra pestaña (SSE).
4. Settings → Apariencia → cambiar paleta → persiste en reload (THEME_BOOT).

---

## Incidente frecuente: "firma inválida" en dev local

Si ghosty.studio devuelve un `sig` en el callback pero `GHOSTY_PARTNER_SECRET` no
está seteado, el código actual **no verifica** (la verificación solo corre si hay
secreto). Si sigue apareciendo el error, causas posibles:

1. **Cache de Nitro viejo** — borrar `.output` y `.tanstack` y reiniciar:
   ```bash
   rm -rf .output .tanstack && npm run dev
   ```
2. **`GHOSTY_PARTNER_SECRET` seteado en el entorno del shell** sin aparecer en
   `.env` — verificar con `printenv | grep GHOSTY`.
3. **ghosty.studio requiere el secreto** aunque no esté seteado localmente. En ese
   caso, obtener el valor en el panel de ghosty.studio y agregarlo al `.env`.

---

## Notas de infra

- **SSE y proxies**: si se antepone un proxy L7 (Caddy, nginx), desactivar el
  buffering para `/api/stream`. El endpoint emite `X-Accel-Buffering: no`.
- **Single-process**: el bus SSE es in-process. Con múltiples réplicas los eventos
  no cruzan procesos (ver `docs/REALTIME.md §Limitaciones`).
- **SESSION_SECRET ≠ GHOSTY_PARTNER_SECRET**: son dos secretos distintos con
  propósitos distintos. El primero cifra las cookies locales; el segundo firma el
  handshake con el IdP.

---

## Deploy real (2026-07-28): caja propia en el host OVH

Ghosty Tasks vive en **https://tasks.ghosty.studio**, en una caja del host OVH
(template `node`, **1 vCPU / 512 MB**, `sb_c4cec06e-32ac-4d93-b72e-0f21e853ad38`).
La caja **duerme por inactividad** (`suspendOnIdle`, TTL 900s) y despierta sola
con el primer request público — el proxy del host hace `acquire` antes de rutear.

- App en `/app/ghosty-tasks/.output`, unit systemd `ghosty-tasks`, puerto 3001.
- Env en `/app/ghosty-tasks/.env` (0600). ⚠️ `ExecStart` usa `/usr/local/bin/node`:
  en ese template no existe `/usr/bin/node` y systemd falla con 203/EXEC.
- Ingress: puerto 3001 expuesto + `domain:tasks.ghosty.studio` registrado en la
  caja; Caddy resuelve el host y saca el cert con on-demand TLS.
- DNS: A `tasks.ghosty.studio` → 54.38.94.14 (Route53).

**Deploy hoy:** `./scripts/deploy_tasks.sh` (build local → push del `.output` por
la API del host → restart del unit). ~20s.

### La DB NO es EasyBits

La cuenta topó las **10 DBs del plan Mega**, así que `src/dbq.server.ts` habla el
protocolo pipeline del **sqld self-host** del propio bare metal
(`http://172.20.0.1:8100/v2/pipeline`, header `x-namespace`), namespace
`ghostytasks`. Es el mismo sqld que sirve a Ghosty Teams. El contrato de salida no
cambió (filas `{ [col]: string|null }`), así que ningún caller se tocó.

Vars vivas: `SQLD_URL`, `SQLD_NAMESPACE`, `SQLD_AUTH_TOKEN` (hoy vacío: el sqld no
pide token en la red del bridge). Ya NO se usan `EASYBITS_*`.

### CI — falta un paso que necesita admin del repo

`.github/workflows/deploy-ovh.yml` está listo y reusa la caja `ci-runner` de
ghosty-studio (hibernada entre deploys). Para encenderlo hace falta ser **admin de
este repo**:

1. Registrar en esa caja un runner de ESTE repo con labels
   `[self-hosted, ovh, ghosty]` — un runner self-hosted pertenece a un repo, y el
   de ghosty-studio no toma estos jobs.
2. Webhook **Workflow jobs** → `https://www.ghosty.studio/api/ci/runner`, con el
   mismo secreto que usa ghosty-studio. Sin él la caja no despierta y el job se
   queda encolado. (El waker filtra por labels, no por repo, así que no hay que
   cambiarle nada.)

Hasta entonces el deploy es el script.
