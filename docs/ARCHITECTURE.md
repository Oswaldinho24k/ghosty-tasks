# Ghosty Tasks — Arquitectura

Gestión de tareas (Kanban + lista + goals) con **tiempo real vía SSE**, identidad delegada
a **ghosty.studio** y estado en **sqld self-host**. Compute stateless; **un proceso sirve
a todos los workspaces**, separados por namespace.

---

## 1. Las tres capas

```
┌──────────────────────────────────────────────────────────────┐
│  GHOSTY.STUDIO  (www.ghosty.studio)                          │
│  · Identity Provider: login con Google                       │
│  · Padrón del workspace: quién pertenece al equipo (HMAC)    │
│  · Handshake firmado → devuelve la identidad a la app        │
└───────────────┬──────────────────────────────────────────────┘
                │ redirect 302 con ?payload&sig
                ▼
┌──────────────────────────────────────────────────────────────┐
│  SQLD (libsql-server, self-host en el bare metal)            │
│  · UN NAMESPACE POR WORKSPACE = una DB                       │
│  · La MISMA que usa el chat: task_* junto a gc_*             │
│  · Sin ORM — cliente HTTP al protocolo pipeline (dbq.server) │
└───────────────┬──────────────────────────────────────────────┘
                │ POST /v2/pipeline  (header x-namespace)
                ▼
┌──────────────────────────────────────────────────────────────┐
│  GHOSTY TASKS  (TanStack Start, un solo proceso)             │
│  · <slug>.tasks.ghosty.studio → slug = namespace             │
│  · Kanban, lista, goals, labels, comentarios, checklist      │
│  · El agente del equipo, con herramientas reales             │
│  · SSE in-process (bus.server.ts, sin Redis) POR NAMESPACE   │
└──────────────────────────────────────────────────────────────┘
```

⚠️ **Nada global en memoria.** Un proceso atiende varios workspaces: cachés, canales SSE y
memos de schema van **por namespace** o filtran datos de un equipo a otro. Ya pasó con el
bus (canales globales) y con `ensureSchema` (un `done` global hacía que el segundo
workspace se saltara sus migraciones → "no such table").

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Framework | TanStack Start (SSR, Nitro) + TanStack Router (file-based) |
| UI | React 19 + Tailwind 4 + Motion |
| Editor | TipTap 3 + `tiptap-markdown` (descripciones en markdown) |
| DB | sqld / libSQL, protocolo pipeline (`src/dbq.server.ts`) |
| Auth | ghosty.studio (redirect server-side + firma de partner) |
| Session | `useSession` de TanStack Start (`gw_session`, 30 días) |
| Realtime | SSE in-process (`/api/stream`, `bus.server.ts`) |
| Agente | runtime nativo de gs, por HMAC de partner |
| PWA | `manifest.webmanifest` + `public/sw.js` |

---

## 3. Multi-tenancy — `src/server/tenant.server.ts`

El **subdominio** manda: `business.tasks.ghosty.studio` → slug `business`. El slug se
canjea por el namespace preguntándole a gs con **firma de partner**
(`HMAC(GHOSTY_PARTNER_SECRET, "${ts}.${slug}")`), con caché de 60s y respuesta rancia si
gs no contesta. El ápice (sin slug) cae a `SQLD_NAMESPACE`.

El **padrón** también vive en gs (`membership.server.ts`): quién es del equipo y con qué
rol. Local sólo está el perfil (`gc_users`, compartido con el chat) y la pertenencia **por
proyecto** (`task_project_members`).

---

## 4. Cliente DB y schema

`dbq(sql, args)` habla el protocolo pipeline de sqld y resuelve el namespace del request
en cada llamada. `ensureSchema()` aplica DDL aditivo e idempotente —memoizado **por
namespace**— en un solo round-trip; las columnas nuevas se agregan verificando antes con
`PRAGMA table_info`.

Prefijos: **`task_*`** son de este producto; **`gc_*`** son del chat y sólo se toca
`gc_users`, que es el perfil compartido a propósito.

```ts
// Env:
SQLD_URL=http://172.20.0.1:8100
SQLD_NAMESPACE=ghostytasks   // sólo el fallback del ápice
GHOSTY_PARTNER_SECRET=...    // firma contra gs (namespace, padrón, storage)
```

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
# DB (sqld self-host, por el bridge; no pide token en esa red)
SQLD_URL=http://172.20.0.1:8100
SQLD_NAMESPACE=ghostytasks            # SÓLO el fallback del ápice: lo normal es que el
                                      # namespace lo dicte el subdominio del workspace

# Identity Provider + padrón del workspace
GHOSTY_IDENTITY_URL=https://www.ghosty.studio  # default, raramente se cambia
GHOSTY_PARTNER_SECRET=               # REQUERIDO: firma el canje slug→namespace, el padrón,
                                     # el storage de imágenes y las tools del agente
TASKS_ROOT_DOMAIN=tasks.ghosty.studio

# Sesión
SESSION_SECRET=<hex 32 bytes>        # distinto al de ghosty-teams; genera con:
                                     # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Override del origin (opcional, lo detecta del request si no está)
APP_URL=

# Agente: se resuelve desde gc_config.agent_runtime_url del workspace; este env es el
# respaldo cuando la fila no lo dice.
GHOSTY_RUNTIME_URL=
```

---

## 11. Diferencias vs ghosty-teams

| Aspecto | ghosty-teams | ghosty-tasks |
|---|---|---|
| Dominio | `*.teams.ghosty.studio` | `*.tasks.ghosty.studio` (mismo slug) |
| DB | sqld/libSQL directo (`SQLD_URL`) | el MISMO sqld y el MISMO namespace |
| Deploy | microVM Firecracker + rebake template | caja propia + CI (push a main) |
| Auth secret | `GHOSTY_PARTNER_SECRET` requerido | requerido también |
| Tablas | `gc_*` | `task_*` (+ `gc_users` compartido) |
| Schema seed | Ghosty Studio crea el namespace + seed | `ensureSchema()` al primer request |
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
