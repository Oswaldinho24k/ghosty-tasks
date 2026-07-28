# Tiempo real — cómo fluyen los eventos

Referencia del sistema SSE de Ghosty Tasks. Sin Redis, sin WebSockets: un bus
in-process que funciona mientras el app corra en un proceso (suficiente para
single-workspace).

---

## Los dos archivos

| Archivo | Rol |
|---|---|
| `src/server/bus.server.ts` | Bus server-side: clientes, canales, presencia, publish |
| `src/hooks/useLiveStream.ts` | Hook cliente: `EventSource`, reconnect, visibilitychange |

El endpoint SSE es `src/routes/api.stream.ts` → `GET /api/stream`.

---

## Canales

```ts
ch.project(id)   // "project:42"  — cambios en tareas/columnas/goals del proyecto
ch.task(id)      // "task:7"      — cambios en un task específico (comments, checklist)
ch.user(sub)     // "user:abc"    — futuro (eventos personales)
ch.presence()    // "presence"    — online/offline de miembros
```

Un cliente SSE suscribe a los canales que le interesan. `publish(channel, ev)`
itera los clientes y entrega solo a los suscritos.

---

## Catálogo de eventos (`WwEvent`)

```ts
// Tareas
{ t: "task:created"; task: { id, project_id, column_id, title, priority, assignee_sub, position, status } }
{ t: "task:updated"; id; patch: Record<string, unknown> }
{ t: "task:moved";   id; column_id; position }
{ t: "task:deleted"; id; project_id }

// Columnas
{ t: "column:created";    column: { id, project_id, name, position, color } }
{ t: "column:updated";    id; patch }
{ t: "column:deleted";    id; project_id }
{ t: "columns:reordered"; project_id; ordered_ids: number[] }

// Detalle de tarea
{ t: "checklist:updated"; task_id }
{ t: "comment:created";   task_id; comment: { id, task_id, sender_sub, sender_name, avatar, body, edited_at, created_at } }
{ t: "comment:updated";   task_id; comment: { ... } }
{ t: "comment:deleted";   task_id; comment_id }

// Goals
{ t: "goal:created"; goal: { id, project_id, title, description, status, due_date, created_by, created_at, total_tasks, completed_tasks } }
{ t: "goal:updated"; id; project_id }
{ t: "goal:deleted"; id; project_id }

// Presencia
{ t: "presence";      sub; name; status: "online" | "offline" }
{ t: "presence:init"; online: string[] }
```

Al agregar un tipo de evento nuevo: **definirlo en `WwEvent`** (bus.server.ts) y
publicarlo desde el server fn que lo produce. El tipo sirve de contrato — el
compilador avisa si el handler del cliente no lo cubre.

---

## Presencia

`addClient(sub, name, channels, listener)` retorna un cleanup. El bus lleva
`Map<sub, refcount>`:

- Primera conexión de un `sub` → `publish(presence, { status: "online" })`
- Última desconexión del `sub` → `publish(presence, { status: "offline" })`
- Múltiples pestañas del mismo user suman al refcount; no se emiten dobles.

Al conectarse el cliente recibe `presence:init` con los `sub` ya online (snapshot
instantáneo).

---

## Hook cliente — `useLiveStream`

```ts
useLiveStream({
  onEvent(ev) { /* reacciona al evento tipado */ },
  onReconnect() { /* recarga los datos frescos */ },
})
```

`onReconnect` dispara en **dos momentos**:
1. Al abrir la conexión SSE (incluso la primera vez).
2. Al volver la pestaña visible (`visibilitychange → "visible"`).

Esto garantiza catch-up lossless si se perdieron eventos con la pestaña oculta o
durante un corte de red. El servidor puede emitir heartbeats (`:ping\n\n`) para
evitar timeouts de proxy; el cliente los ignora (JSON.parse falla → catch vacío).

---

## Publicar un evento nuevo

1. Añadir el tipo a `WwEvent` en `bus.server.ts`.
2. En el server fn que produce el cambio (ej. `src/server/tasks.ts`):
   ```ts
   import { publish, ch } from './bus.server'
   publish(ch.project(projectId), { t: "task:updated", id, patch })
   ```
3. En el handler de la UI (`p.$slug.tsx`, `onEvent`), añadir el case:
   ```ts
   case 'task:updated':
     // actualiza estado local
     break
   ```

El bus no persiste: un evento perdido durante reconexión se recupera via
`onReconnect` (que recarga la vista desde la DB). No hagas lógica que dependa de
recibir todos los eventos — la DB siempre es la fuente de verdad.

---

## Limitaciones conocidas

- **In-process** → no escala a múltiples réplicas. Si se despliega con más de un
  proceso (clustering), los eventos publicados en el proceso A no llegan a los
  clientes conectados al proceso B. Para multi-proceso, añadir un broker externo
  (Redis pub/sub, etc.) como intermediario de `bus.server.ts`.
- **Sin persistencia** → eventos perdidos durante downtime no se reenvían. El
  mecanismo de catch-up es `onReconnect` + recarga de DB.
- **Sin autenticación de SSE** → el endpoint `/api/stream` confía en que el guard
  de `__root.tsx` ya exige sesión activa para las rutas del proyecto. Verificar que
  ninguna ruta expone el stream sin auth al añadir rutas nuevas.
