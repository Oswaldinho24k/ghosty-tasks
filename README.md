<p align="center">
  <img src="public/ghosty.svg" width="100" alt="Ghosty" />
</p>

<h1 align="center">Ghosty Tasks</h1>

<p align="center">
  <b>Gestión de tareas sin burocracia.</b><br/>
  Kanban + lista + goals — single-workspace, cloud-native.
</p>

<p align="center">
  <a href="https://easybits.cloud">☁️ EasyBits</a> ·
  <a href="https://www.ghosty.studio">🔑 ghosty.studio</a>
</p>

---

Alternativa a Jira/ClickUp construida sobre el stack Ghosty. Una instancia = un
equipo; sin enterprise pricing ni tableros de configuración interminable.

- 📋 **Kanban + lista** — drag-and-drop entre columnas; posición `REAL` con gap.
- 🎯 **Goals** — épicas ligeras; progreso calculado desde tareas vinculadas.
- 🏷️ **Labels + checklist + comentarios** — sin plugins, ya incluido.
- ⌘ **Command palette** — buscar tareas, proyectos y vistas sin levantar el mouse.
- 🎨 **12 paletas de tema** — Protanopia incluida; fuente/tamaño/movimiento persistidos.
- ⚡ **Tiempo real vía SSE** — toda la UI actualiza instantáneo sin polling.
- 📱 **PWA instalable** — funciona en desktop, Android e iOS.

## Cómo funciona

- **[ghosty.studio](https://www.ghosty.studio)** → identidad (login con Google).
  La app redirige al IdP y recibe la identidad firmada de vuelta. Mismo handshake
  que usa Ghosty Teams.
- **sqld (libsql-server)** → base de datos, self-host en el mismo bare metal.
  Cliente HTTP directo al protocolo pipeline, namespace `ghostytasks`. Sin ORM y
  sin migraciones manuales: `ensureSchema()` crea las tablas `gw_*` en el primer
  login. (Antes era EasyBits; se movió al topar el límite de DBs del plan.)
- **La app** → [TanStack Start](https://tanstack.com/start) (React 19 SSR) +
  Tailwind 4. Compute stateless; el estado durable vive en el sqld.

Detalle en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) y
[`docs/DEPLOY.md`](docs/DEPLOY.md).

## Producción

Vive en **[tasks.ghosty.studio](https://tasks.ghosty.studio)**, en una caja propia
del host OVH (1 vCPU / 512 MB). La caja **duerme por inactividad** y despierta sola
con el primer request — no hay nada encendido esperando visitas.

Deploy: **push a `main`**. El pipeline
([`.github/workflows/deploy-ovh.yml`](.github/workflows/deploy-ovh.yml)) corre en
un runner self-hosted que también está hibernado entre deploys; un sondeo del lado
del host lo despierta al ver la cola. De punta a punta, con todo dormido: **~95s**.

Para deployar a mano (break-glass): `./scripts/deploy_tasks.sh`.

## Local

```bash
# 1. Instala deps
npm install

# 2. Crea .env (ver docs/ARCHITECTURE.md §Env vars)
cp .env.example .env   # o crea .env desde cero

# 3. Levanta el servidor dev
npm run dev            # → http://localhost:3001
```

El primer usuario en hacer login se convierte en **owner** automáticamente. Los
demás necesitan un link de invitación (Settings → Workspace → Generar link).
