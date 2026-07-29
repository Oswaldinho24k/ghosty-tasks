# Ghosty Tasks — Arquitectura

Gestión de tareas single-workspace (Kanban + lista + goals) con **tiempo real vía
SSE**, identidad delegada a **ghosty.studio** y estado persistido en **EasyBits**.
Compute stateless; una instancia, un equipo.

---

## 1. Las tres capas

```
┌──────────────────────────────────────────────────────────────┐
│  GHOSTY.STUDIO  (www.ghosty.studio)                           │
│  · Identity Provider: login con Google                        │
│  · Handshake firmado HMAC → devuelve identidad al app         │
│  · Single-logout: /logout limpia la sesión del IdP            │
└───────────────┬──────────────────────────────────────────────┘
                │ redirect 302 con ?payload&sig
                ▼
┌──────────────────────────────────────────────────────────────┐
│  EASYBITS  (www.easybits.cloud)                               │
│  · DB aislada por instancia (HTTP API sobre libSQL)           │
│  · Un DB_ID por workspace; todas las tablas gw_* ahí          │
│  · Sin ORM — cliente HTTP directo (src/dbq.server.ts)         │
└───────────────┬──────────────────────────────────────────────┘
                │ POST /api/v2/databases/:DB_ID/query
                ▼
┌──────────────────────────────────────────────────────────────┐
│  GHOSTY TASKS INSTANCE  (TanStack Start, una por equipo)      │
│  · Kanban, lista, goals, labels, comments, checklist          │
│  · Estado → DB EasyBits (gw_* tables)                         │
│  · Login → redirect server-side a ghosty.studio               │
│  · SSE in-process (bus.server.ts, sin Redis)                  │
└──────────────────────────────────────────────────────────────┘
```

A diferencia de ghosty-teams (que usa sqld/libSQL directo y corre en microVMs
Firecracker por workspace), ghosty-tasks consume EasyBits como API HTTP y es
single-workspace: una instancia = un equipo.

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Framework | TanStack Start (SSR, Nitro) + TanStack Router (file-based) |
| UI | React 19 + Tailwind 4 + Motion (framer) |
| Iconos | Lucide React |
| Toasts | Sonner (`<Toaster richColors />`) |
| DB | EasyBits HTTP API (`src/dbq.server.ts`) |
| Auth | ghosty.studio (redirect server-side, HMAC opcional) |
| Session | `useSession` de TanStack Start (`gw_session`, 30 días) |
| Realtime | SSE in-process (`/api/stream`, `bus.server.ts`) |
| Tema | CSS vars en `<html>` + 12 presets en `PRESETS[]` |
| PWA | `manifest.webmanifest` + `public/sw.js` |

---

## 3. Cliente DB — `src/dbq.server.ts`

Todo acceso a la DB pasa por `dbq(sql, args)`. El cliente habla HTTP contra
EasyBits: un `POST` con el SQL y los parámetros, recibe columnas + filas y
devuelve `Row[]` (objetos planos). Sin migraciones en archivos; el schema se
aplica en runtime vía `ensureSchema()`.

```ts
// Env vars requeridas:
EASYBITS_BASE_URL=https://www.easybits.cloud
EASYBITS_API_KEY=eb_sk_live_...
EASYBITS_DB_ID=ghostytasks
```

`dbq` lanza en dev si las vars no están. Los helpers `num(v)` y `str(v)` colapsan
`null | undefined` a cero o cadena vacía — úsalos al leer filas.

---

## 4. Schema — `src/server/schema.server.ts`

`ensureSchema()` corre migraciones aditivas e idempotentes al arrancar (en el
primer login). Todo es `IF NOT EXISTS` + `addColumn` con verificación previa via
`PRAGMA table_info`. Si falla, se resetea y el siguiente request reintenta.

**Tabla `gw_users`** — espejo local de la identidad de ghosty.studio:

```sql
sub TEXT PRIMARY KEY, email, name, avatar, handle TEXT UNIQUE,
is_owner INTEGER DEFAULT 0, banned INTEGER DEFAULT 0,
created_at INTEGER DEFAULT (unixepoch())
```

`banned = 1` bloquea el login antes de tocar la sesión (chequeado en
`completeGhostyLogin`).

**14 tablas `gw_*` en total:**

| Tabla | Propósito |
|---|---|
| `gw_users` | Miembros del workspace |
| `gw_invites` | Tokens de invitación (un solo uso) |
| `gw_config` | Key-value de configuración del workspace |
| `gw_projects` | Proyectos (slug único, color, icono) |
| `gw_project_members` | Rol por proyecto (owner/member) |
| `gw_columns` | Columnas Kanban por proyecto |
| `gw_tasks` | Tareas (título, descripción, prioridad, asignado, posición REAL) |
| `gw_task_labels` | Labels chip por tarea (texto + color) |
| `gw_checklist_items` | Items de checklist por tarea |
| `gw_task_comments` | Comentarios humanos en tareas |
| `gw_task_activities` | Log de actividad por tarea |
| `gw_goals` | Goals / épicas ligeras por proyecto |
| `gw_goal_tasks` | Relación goal ↔ tarea |
| `gw_bridge_tokens` | Tokens para webhook Bridge (ghosty-teams → ghosty-tasks) |

**Posición de tareas:** `REAL` (gap de 65 536 entre tareas). Reorder = UPDATE de
una sola fila; el compactado (cuando `gap < 1`) renombra todas las posiciones.
Nunca se actualizan N filas por drag-and-drop.

---

## 5. Auth — `src/server/auth.ts`

Flujo server-side puro (sin iframe ni popup, como ghosty-teams). Ver detalle en
[`docs/GHOSTY-STUDIO.md`](GHOSTY-STUDIO.md).

### `startGhostyLogin`

Server fn GET. Construye `?o=<origin>&ts=<unix>&sig=<hmac>` y devuelve el URL
del IdP. El origin se deriva de headers del request (`x-ghosty-origin` →
`x-forwarded-host` → host crudo), o de `APP_URL` si está seteado.

### `completeGhostyLogin`

Server fn POST. Recibe `{ payload, sig?, inviteToken? }`:
1. Verifica HMAC solo si `GHOSTY_PARTNER_SECRET` Y `sig` están presentes.
2. Decodifica `payload` (base64url JSON): `{ sub, email, name, avatar, ts }`.
3. Verifica que `ts ± 300s` (ventana de 5 min).
4. Llama `ensureSchema()` (garantiza columnas nuevas en el primer login del workspace).
5. Consume el invite si lo hay (`consumeInvite`).
6. Verifica `isBanned(sub)` — si está expulsado, rechaza.
7. `upsertUser` (crea si es el primero → `is_owner = 1`).
8. Verifica acceso: `isOwner || invited || isKnownUser`.
9. Escribe sesión con `useSession`.

### `me` / `cachedMe` / `peekMe`

- `me()` — server fn GET, lee la cookie.
- `cachedMe()` — en cliente, cachea el primer resultado y revalida en background.
  Evita que cada navegación espere un round-trip de red antes de pintar.
- `peekMe()` — lectura SÍNCRONA del cache (sin red). Útil para leer la identidad
  al instante en componentes sin suspense.

### Sesión (`src/server/session.server.ts`)

Cookie `gw_session`, cifrada AES via `useSession`, `maxAge 30d`, `sameSite: lax`,
`httpOnly`, `secure`. Requiere `SESSION_SECRET` (32 bytes hex aleatorios, distinto
al de ghosty-teams).

### Logout

Limpia la sesión local y devuelve `{ next: IDP + "/logout" }` para que el cliente
también limpie la sesión del IdP (single sign-out). La implementación en
`ProjectSidebar` redirige al `next` recibido.

---

## 6. SSE Tiempo real — `src/server/bus.server.ts`

Bus in-process (en memoria del proceso Nitro). Sin Redis ni broker externo: funciona
mientras el app corra en un solo proceso (suficiente para single-workspace).

**Canales:**
- `project:<id>` — cambios en tareas, columnas, goals del proyecto
- `task:<id>` — cambios en un task específico (comentarios, checklist)
- `user:<sub>` — eventos personales (futuro)
- `presence` — online/offline de miembros

**Presencia:** el bus lleva un `Map<sub, refcount>`. Al conectarse el primer SSE
de un usuario se emite `presence { status: "online" }`; al cerrar el último
`status: "offline"`. Múltiples pestañas del mismo user suman refcount.

**Cliente — `src/hooks/useLiveStream.ts`:**
```ts
useLiveStream({ onEvent, onReconnect })
```
Una conexión SSE por pestaña (`EventSource /api/stream`). `onReconnect` dispara al
abrir el socket Y al volver la pestaña visible (`visibilitychange`) — garantiza
catch-up lossless si se perdieron eventos. El server emite heartbeat `:ping` para
evitar timeouts de proxy.

**Tipos de evento — `WwEvent`:** ver `bus.server.ts` para el catálogo completo. Los
handlers de UI reaccionan en `p.$slug.tsx` via `onEvent`.

---

## 7. Rutas — `src/routes/`

Convención file-based de TanStack Router:

```
__root.tsx              → shell global (tema, toaster, PWA, auth guard)
index.tsx               → redirect a /, muestra el primer proyecto
login.tsx               → flujo de login (redirect al IdP o callback)
join.$token.tsx         → flujo de invitación (consume token + login)
setup.tsx               → configuración inicial si no hay proyectos
settings.tsx            → ruta /settings (abre SettingsModal)
p.$slug.tsx             → layout del proyecto (sidebar, SSE, command palette)
p.$slug.board.tsx       → vista Kanban
p.$slug.list.tsx        → vista lista
p.$slug.goals.tsx       → vista goals
api.stream.ts           → endpoint SSE (/api/stream)
```

El guard vive en `__root.tsx` `beforeLoad`: si no hay sesión → redirect a `/login`.
Las rutas `/login` y `/join/*` no pasan por el guard.

---

## 8. Tema — `src/utils/theme.ts`

**Fuente única de verdad:** el array `PRESETS` (12 paletas). Cada preset define
`{ id, label, font, light: Palette, dark: Palette }`.

**Aplicación:** `applyTheme(state)` escribe CSS vars (`--color-brand`, etc.) y
`data-theme`/`data-preset` directamente en `<html>`. Sin clases de Tailwind en el
DOM; los componentes solo usan `bg-surface`, `text-ink`, `bg-brand`, etc.

**FOUC prevention:** `THEME_BOOT` es un script inline en `<head>` (antes de
cualquier CSS/JS) que lee localStorage y aplica el tema antes del primer paint. Sin
él la UI flashea blanco al recargar en tema oscuro.

**Estado persistido en localStorage** (prefijo `gt.*`): preset, scheme, textSize,
font, reduceMotion, darkSidebar.

**Store reactivo sin deps:** `subscribeTheme` / `getTheme` / `setThemePartial`.
Los componentes usan `useSyncExternalStore(subscribeTheme, getTheme, getTheme)`.

---

## 9. Modales y ESC — `src/utils/modal-esc.ts`

`registerModalEsc(onClose)` mantiene un stack global de modales en `window.__modalEscStack`.
Solo el modal de ARRIBA (el último abierto) responde a ESC — los de abajo esperan.

```ts
// En un modal:
useEffect(() => registerModalEsc(onClose), [onClose])
```

Usado en `SettingsModal` y `CommandPalette`. Sin esto, ESC sobre el palette
también cerraba el settings modal de abajo.

---

## 10. Env vars

```bash
# DB (EasyBits)
EASYBITS_BASE_URL=https://www.easybits.cloud
EASYBITS_API_KEY=eb_sk_live_...       # API key de la cuenta EasyBits
EASYBITS_DB_ID=ghostytasks            # ID de la base de datos

# Identity Provider
GHOSTY_IDENTITY_URL=https://www.ghosty.studio  # default, raramente se cambia
GHOSTY_PARTNER_SECRET=               # opcional — si ghosty.studio lo provee, verifica HMAC

# Sesión
SESSION_SECRET=<hex 32 bytes>        # distinto al de ghosty-teams; genera con:
                                     # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Override del origin (opcional, lo detecta del request si no está)
APP_URL=

# EasyBits Fleet (agente Ghosty AI — futuro)
EASYBITS_FLEET_ID=
EASYBITS_FLEET_TOKEN=
```

---

## 11. Diferencias vs ghosty-teams

| Aspecto | ghosty-teams | ghosty-tasks |
|---|---|---|
| Dominio | `*.teams.ghosty.studio` (multi-tenant) | URL única (single-workspace) |
| DB | sqld/libSQL directo (`SQLD_URL`) | EasyBits HTTP API |
| Deploy | microVM Firecracker + rebake template | proceso único (Node/Nitro) |
| Auth secret | `GHOSTY_PARTNER_SECRET` requerido | `GHOSTY_PARTNER_SECRET` opcional |
| Tablas | `gc_*` | `gw_*` |
| Schema seed | Ghosty Studio crea el namespace + seed | `ensureSchema()` en el primer login |
| Realtime | Bus in-process (mismo patrón) | Bus in-process |
| SSE keys | `gt.*` en localStorage | `gt.*` en localStorage |
| Presets | 12 | 12 (idénticos) |


## El agente del tablero

Ver el README para el resumen. Los detalles que cuesta descubrir:

- **Transporte**: `POST {runtimeBase}/api/v2/fleet-agents/{fleet_id}/message-stream` con
  firma de partner (`x-ghosty-ts` / `x-ghosty-ws` / `x-ghosty-sig`,
  `HMAC(secret, ts.namespace.rawBody)`). La base sale de `gc_config.agent_runtime_url` y
  si no, del env `GHOSTY_RUNTIME_URL`.
- **Memoria**: `groupId = ws-<ns>-ghosty-tasks-<handle>-p<projectId>` — por agente y por
  tablero, separada a propósito de la conversación del canal en Teams.
- **Tools**: `POST /api/agent/tools` habla el MISMO contrato que los conectores de Teams
  (`{action:"list"}` / `{action:"run", name, args}` + Bearer). Eso es deliberado: el
  worker ya trae un módulo que lo consume, así que las herramientas existen sin tocar el
  runtime ni rehornear la caja, y el schema se descubre en caliente. No es MCP.
- ⚠️ El `appendSystemPrompt` DEBE decirle dónde están (`/opt/gs-sdk/connectors.mjs`,
  `list()` / `run()`). Sin esa línea el agente no las busca y responde que no puede tocar
  el tablero.
- ⚠️ `toolToken` y `toolsUrl` viajan **siempre juntos**: el worker firma su sesión con las
  CLAVES del env del turno, así que un set que oscila le recicla la sesión y le tira el
  warm en cada mensaje.
- **Historial**: `task_ghosty_messages`, con `task_id` NEGATIVO = conversación del tablero
  (los ids de tarea son positivos) y `sender_name` = handle del agente.
