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

Alternativa a Jira/ClickUp construida sobre el stack Ghosty. Un tablero por equipo, con
el mismo equipo (y el mismo agente) que ya tienes en Ghosty Teams.

- 📋 **Kanban + lista** — drag-and-drop entre columnas; posición `REAL` con gap.
- 🎯 **Goals** — épicas ligeras; progreso calculado desde tareas vinculadas.
- 🏷️ **Labels + checklist + comentarios** — sin plugins, ya incluido.
- ⌘ **Command palette** — buscar tareas, proyectos y vistas sin levantar el mouse.
- 🎨 **12 paletas de tema** — Protanopia incluida; fuente/tamaño/movimiento persistidos.
- ⚡ **Tiempo real vía SSE** — toda la UI actualiza instantáneo sin polling.
- 📱 **PWA instalable** — funciona en desktop, Android e iOS.
- 🤖 **El agente de tu equipo, con manos** — el mismo que usas en Ghosty Teams, capaz de
  mover, asignar, etiquetar y comentar en el tablero. Ver abajo.

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

## El agente

En el tablero hablas con **los agentes que ya activaste en Ghosty Teams** — no con uno
propio de Tasks. Salen de `gc_agents`, que vive en la misma DB del workspace, y corren en
el runtime nativo de Ghosty Studio. Si el equipo tiene varios, se elige en el drawer y la
elección se recuerda por tablero.

**Puede trabajar, no solo conversar.** *"Mueve la tarea de Oswaldo a Done y ponle la
etiqueta de producción"* son tres acciones y una búsqueda, y las hace:
`list_board`, `find_tasks`, `create_task`, `move_task`, `update_task`, `set_labels`,
`comment_task`, `add_checklist_item`, `delete_task`.

Cómo está construido, y por qué así:

- **Una acción, dos superficies.** Cada acción se define una vez (`schema` + `run`, en
  `src/server/actions/`) y de ahí salen tanto el server-fn que usa la interfaz como el
  catálogo que ve el agente — la idea de [agent-native](https://github.com/BuilderIO/agent-native).
  Así el agente no puede hacer nada que la UI no pueda, y el schema no se escribe dos
  veces para luego divergir.
- **Actúa como tú.** El turno lleva un token de capacidad firmado (`sub` + tablero, 15
  min): la bitácora y los comentarios quedan a nombre de quien pidió el trabajo, no de
  "el sistema". El secreto maestro nunca entra a la caja del agente.
- **Se ve al instante.** Cada acción publica en el bus SSE igual que la interfaz: si el
  agente mueve una tarjeta, se mueve en la pantalla de todos.
- **Ante la duda, pregunta.** Dos tareas de la misma persona → devuelve las dos en vez de
  elegir. Borrar exige confirmación.
- **Conserva tus conectores.** El canal de tools del turno es uno solo; Tasks sirve las
  del tablero y reenvía el resto (Deník, Calendly…) a Teams.
- **Imágenes**: se arrastran o se pegan en el drawer, van al storage del workspace (el de
  Teams, sin bucket propio) y al agente le llega una URI — no los bytes, que se comerían
  el contexto del turno.
- **Referencias a tareas**: se escribe `#` y se elige; la referencia (`GStudio-4`) queda
  como chip DENTRO del campo y se quita con su ✕. El texto es la fuente de verdad — el
  chip sólo lo pinta —, así que el agente recibe la frase tal cual se lee.
- **Las herramientas se ven**: cada acción se anuncia mientras corre, las repetidas se
  agrupan con `×n` y dicen sobre qué tarea actuaron. Seis líneas de "Actualizó una tarea"
  no dicen nada.

**Lo que sabe en cada tablero** se compone de dos capas, visibles en Ajustes → *Ghosty en
este tablero*:

1. **De fábrica** (solo lectura): la plomería —qué herramientas tiene, que las
   descripciones son markdown, quién le está hablando, la fecha de hoy—. Se enseña porque
   cuando el agente hace algo raro la primera pregunta es "¿qué le dijeron?", y esa
   respuesta vivía sólo en el código.
2. **Reglas del tablero** (editables): las de la casa — *"nada pasa a Done sin
   comentario"*. Se guardan en `task_config` (`instructions:<projectId>`) y van al FINAL
   del prompt, así que pesan más que lo genérico. Son por proyecto y no por agente: la
   persona del agente es compartida con Teams.

### Permisos, en una línea

Todo el equipo del workspace **ve** un tablero; **participan** los miembros del proyecto,
y se entra siendo asignado. Por eso hay dos listas y no conviene confundirlas: la
**fusionada** (equipo + proyecto) existe sólo para pintar caras —un asignado que no está
en el tablero igual necesita avatar— y la del **proyecto**, que es la que mandan Ajustes,
el modal de miembros y el selector de asignado.

Lo que **todavía no** hace aquí: artefactos y notas de voz. El agente los sabe emitir,
pero el pipeline que los detecta, publica y pinta vive en Ghosty Teams.

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
