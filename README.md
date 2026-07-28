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
  La app redirige al IdP y recibe la identidad firmada de vuelta.
- **[EasyBits](https://easybits.cloud)** → base de datos. Cliente HTTP simple:
  `POST /api/v2/databases/:dbId/query`. Sin ORM, sin migraciones manuales.
- **La app** → [TanStack Start](https://tanstack.com/start) (React 19 SSR) +
  Tailwind 4. Compute stateless; estado durable en EasyBits.

Detalle en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

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
