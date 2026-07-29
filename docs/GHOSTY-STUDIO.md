# Ghosty Studio — handoff para quien trabaja desde Ghosty Tasks

> Doc cross-repo. Estás en **Ghosty Tasks** (`~/ghosty-work`, la app de tareas).
> Este documento explica **Ghosty Studio**, el IdP del que Tasks depende.

## Qué es

**Ghosty Studio** es el **Identity Provider (IdP) + control-plane** del ecosistema
Ghosty. Vive en `www.ghosty.studio`. Ghosty Tasks no persiste contraseñas ni
proveedores OAuth directamente: delega 100 % de la autenticación a Studio.

## Flujo de login (server-side redirect)

Sin iframe ni popup. Un `302` puro en cada paso — idéntico al patrón de
ghosty-teams.

```
Browser                  Ghosty Tasks              Ghosty Studio
   |                          |                          |
   |-- GET /login             |                          |
   |                    startGhostyLogin()               |
   |                    construye ?o&ts&sig              |
   |<--- 302 /identity/connect?o&ts&sig&return ----------|
   |                                                     |
   |--- GET /identity/connect --------------------------->|
   |                                    (Google login si no hay sesión)
   |<--- 302 <return>?payload&sig -----|
   |                                                     |
   |-- GET /login?payload=...&sig=...  |                 |
   |                    completeGhostyLogin()             |
   |                    verifica HMAC (si hay secreto)   |
   |                    decodifica payload               |
   |                    ensureSchema / isBanned / upsert |
   |                    escribe gw_session cookie        |
   |<--- 302 /                         |                 |
```

El `return` que construye `startGhostyLogin` es:
```
/login?attempted=true          (ruta normal)
/join/<token>?attempted=true   (ruta de invitación)
```

El flag `?attempted=true` es el anti-loop: si el redirect del IdP vuelve SIN
`payload` (p.ej. el user canceló), el loader muestra la `LoginCard` en vez de
redirigir de nuevo al IdP.

## Endpoint que expone Studio a Tasks

### `GET /identity/connect`

```
?o=<origin>      URL de la instancia Tasks (ej. https://tasks.ghosty.studio)
&ts=<unix>       timestamp de la firma
&sig=<hmac>      HMAC-SHA256 de "${ts}.${origin}" con GHOSTY_PARTNER_SECRET
&return=<path>   path al que Studio redirige de vuelta (relativo a o)
```

Studio verifica la firma, muestra Google login si no hay sesión activa, y redirige:
```
<o><return>?payload=<base64url>&sig=<hmac>
```

`payload` es un JSON base64url: `{ sub, email, name, avatar, ts }`.
`sig` es `HMAC-SHA256(payload)` con el mismo secreto compartido.

### `GET /logout`

Single-logout. Limpia la sesión de ghosty.studio (la de Google) para que el
próximo `/login` no auto-autentique silencioso. La app redirige aquí tras limpiar
la cookie `gw_session` local.

## HMAC — `GHOSTY_PARTNER_SECRET`

ghosty-teams lo requiere como obligatorio. En ghosty-tasks es **opcional**:

- **Sin `GHOSTY_PARTNER_SECRET`**: la app no firma la petición saliente a Studio
  ni verifica la firma del callback. Útil en dev local mientras se configura.
- **Con `GHOSTY_PARTNER_SECRET`**: se firma la petición saliente (`ts.origin`) y
  se verifica el callback (`HMAC(payload)`) con `timingSafeEqual`. **Actívalo en
  producción** si Studio lo provee.

El secreto lo proporciona el panel de ghosty.studio (o el dev master del ecosistema).
Es DIFERENTE al `SESSION_SECRET`.

## Identidad en la sesión

Tras `completeGhostyLogin` exitoso, la sesión `gw_session` contiene:

```ts
type SessionUser = {
  sub: string;      // User.id de Studio — llave de identidad en todo el ecosistema
  email: string;
  name: string;
  avatar: string;
  isOwner: boolean; // calculado en gc_users al primer login (primer user = owner)
  handle: string;   // slug derivado del email, único en el workspace
}
```

El `sub` es el identificador primario. Todas las tablas `task_*` lo usan para
relacionar acciones con usuarios.

## Primer usuario = owner

`completeGhostyLogin` → `upsertUser` → `SELECT COUNT(*) FROM gc_users`. Si es 0,
`is_owner = 1`. Los demás necesitan un link de invitación (un solo uso, tabla
`task_invites`).

## Expulsión (`banned`)

La columna `banned INTEGER DEFAULT 0` en `gc_users` bloquea el login antes del
upsert:

```ts
if (await isBanned(id.sub)) throw new Error("sin acceso a este workspace")
```

El owner puede setear `banned = 1` directamente en la DB (aún no hay UI).

## Cache de identidad en el cliente

```
me()         → server fn (round-trip a la cookie)
cachedMe()   → resuelve desde cache en memoria; revalida en background
peekMe()     → lee el cache SÍNCRONO (sin network, sin suspense)
clearMeCache() → al hacer logout, para que el guard redirija correctamente
```

`__root.tsx` `beforeLoad` llama `cachedMe()` en cada navegación. Sin el cache, cada
transición de página esperaría la red antes de pintar — en ghosty-teams se notaba
como "recarga total" al volver de `/settings`.
