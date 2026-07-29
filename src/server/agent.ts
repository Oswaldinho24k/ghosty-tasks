import { createServerFn } from '@tanstack/react-start'
import { dbq } from '../dbq.server'
import { ensureSchema } from './schema.server'

// El agente de un tablero es UN AGENTE DEL EQUIPO: el mismo que ya activaste en Ghosty
// Teams (`gc_agents`, misma DB), corriendo en el runtime nativo de Ghosty Studio.
//
// Antes esto llamaba a EasyBits con un fleet id/token propios que no existían en la
// caja: el drawer respondía "el agente no está configurado" y punto. Y lo único que
// sabía hacer era crear tareas por un bloque JSON que el server sacaba con un regex,
// insertando en la tabla por su cuenta (sin bitácora, sin ver la UI moverse).
//
// Ahora las acciones son tools de verdad: viven en `actions/board.actions.ts`, las
// consume el agente por `/api/agent/tools`, y son las MISMAS que usa la interfaz.

async function session() {
  const { useSession } = await import('@tanstack/react-start/server')
  const { sessionConfig } = await import('./session.server')
  return useSession<{ user?: { sub: string; name: string } }>(sessionConfig())
}

/** Los agentes que se pueden elegir en este tablero. */
export const listAgentsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await ensureSchema()
  const { listAgents } = await import('./agent-runtime.server')
  const agents = await listAgents()
  return agents.map((a) => ({ handle: a.handle, name: a.name, avatar: a.avatar }))
})

/** Agente elegido para un tablero. Se guarda en la DB, no en el navegador. */
export const getProjectAgentFn = createServerFn({ method: 'GET' })
  .validator((d: { projectId: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema()
    const rows = await dbq('SELECT v FROM task_config WHERE k = ?', [`agent:${data.projectId}`])
    return { handle: rows[0]?.v ?? null }
  })

export const setProjectAgentFn = createServerFn({ method: 'POST' })
  .validator((d: { projectId: number; handle: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema()
    await dbq(
      `INSERT INTO task_config (k, v, updated_at) VALUES (?, ?, unixepoch())
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
      [`agent:${data.projectId}`, data.handle]
    )
    return { ok: true as const }
  })

// `task_ghosty_messages` estaba declarada y nadie la usaba: la conversación vivía solo
// en el cliente y se perdía al recargar. Se reusa con `task_id` NEGATIVO = conversación
// del tablero (los ids de tarea son positivos), y `sender_name` = handle del agente.
async function remember(projectId: number, handle: string, sub: string, body: string, kind: 'user' | 'agent') {
  if (!body) return
  await dbq(
    `INSERT INTO task_ghosty_messages (task_id, sender_sub, sender_name, body, kind)
     VALUES (?, ?, ?, ?, ?)`,
    [-projectId, sub, handle, body, kind]
  ).catch(() => {})
}

/** Historial de la conversación con ESE agente en ESE tablero. */
export const getAgentHistoryFn = createServerFn({ method: 'GET' })
  .validator((d: { projectId: number; handle: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema()
    const rows = await dbq(
      `SELECT body, kind, created_at FROM task_ghosty_messages
        WHERE task_id = ? AND sender_name = ?
        ORDER BY created_at ASC LIMIT 100`,
      [-data.projectId, data.handle]
    )
    return rows.map((r) => ({
      role: r.kind === 'agent' ? ('agent' as const) : ('user' as const),
      body: r.body ?? '',
      at: Number(r.created_at ?? 0),
    }))
  })

/**
 * Sube cada adjunto y arma sus `parts`. Si el storage no responde, cae a los bytes
 * inline: mejor un turno más caro que perder la imagen que la persona arrastró.
 */
async function buildParts(
  attachments: Array<{ name?: string; mimeType: string; bytes: string }>
): Promise<MediaPart[]> {
  if (!attachments.length) return []
  const { storeAttachment } = await import('./uploads.server')
  const out: MediaPart[] = []
  for (const a of attachments) {
    const stored = await storeAttachment({ name: a.name ?? 'imagen', mimeType: a.mimeType, bytes: a.bytes })
    out.push(
      stored
        ? { kind: 'file', file: { name: stored.name, mimeType: stored.mimeType, uri: stored.uri } }
        : { kind: 'file', file: { name: a.name, mimeType: a.mimeType, bytes: a.bytes } }
    )
  }
  return out
}

function systemPrompt(projectName: string, who: { name: string; handle: string }): string {
  return [
    `Estás dentro de Ghosty Tasks, en el tablero "${projectName}".`,
    // Quién habla: sin esto preguntaba "¿cuál de los miembros eres tú?" cuando alguien
    // decía "asígnamela a mí".
    `Quien te está hablando es ${who.name}${who.handle ? ` (@${who.handle})` : ""}. Cuando diga "a mí", "mío" o "yo", se refiere a esa persona: pasa "yo" como valor de assignee y las herramientas lo resuelven.`,
    // Cómo llegar a ellas: el worker es code-mode y las tools de este turno se sirven
    // por el módulo `connectors` del SDK. Sin esta línea el agente no las busca y
    // responde que no puede tocar el tablero.
    `Tus herramientas para ESTE tablero están en /opt/gs-sdk/connectors.mjs: importa ese módulo, llama a list() para ver sus firmas y a run(name, args) para ejecutarlas.`,
    `Son: list_board, find_tasks, create_task, move_task, update_task, set_labels, comment_task, add_checklist_item, add_member, delete_task.`,
    `Puedes asignarle una tarea a cualquiera del equipo aunque no participe en el tablero: al asignarla queda dentro. También puedes sumar a alguien con add_member. La interfaz no permite eso, tú sí.`,
    `Confía en lo que te devuelve la herramienta, no en lo que pediste: si la respuesta no trae "assigned_to", NO digas que quedó asignada.`,
    `Úsalas en vez de describir lo que harías: si te piden mover una tarea, muévela.`,
    `Antes de actuar sobre "la tarea de alguien" o un nombre de columna, resuélvelo con find_tasks o list_board — no inventes ids.`,
    `Si algo es ambiguo (varias tareas coinciden, una etiqueta que no existe), PREGUNTA en vez de elegir por tu cuenta.`,
    `Hoy es ${new Date().toISOString().slice(0, 10)}: úsalo para calcular vencimientos ("en dos semanas" = suma los días).`,
    `Responde en español, breve, y menciona las tareas por su título, no por su id.`,
  ].join(' ')
}

// Una imagen arrastrada al drawer se guarda en el storage del workspace (el de Teams) y
// al agente le llega la URI, no los bytes: así no se come el contexto del turno y la
// imagen sigue existiendo después. Ver uploads.server.ts.
export type MediaPart = { kind: 'file'; file: { name?: string; mimeType: string; uri?: string; bytes?: string } }

async function runAgentTurn(opts: {
  userSub: string
  userName: string
  who: { name: string; handle: string }
  parts: MediaPart[]
  projectId: number
  projectName: string
  handle: string
  message: string
  turnId: string
  origin: string
}) {
  const bus = await import('./bus.server')
  const done = (value: string) =>
    bus.publish(bus.ch.user(opts.userSub), { t: 'agent:done', turnId: opts.turnId, value, created_tasks: [] })

  const { getAgent, runtimeBase, partnerHeaders, taskGroupId } = await import('./agent-runtime.server')
  const agent = await getAgent(opts.handle)
  if (!agent) return done('Ese agente ya no está activo en este equipo. Elige otro.')

  const base = await runtimeBase()
  if (!base) return done('Este workspace no tiene runtime de agentes configurado.')

  const { mintToolToken } = await import('./tool-token.server')
  // El token acota al invocador Y al tablero: el agente actúa como esta persona, aquí.
  // Los dos campos viajan SIEMPRE juntos — el worker firma su sesión con las CLAVES del
  // env del turno, así que un set que oscila le tira el warm en cada mensaje.
  const body = JSON.stringify({
    groupId: await taskGroupId(agent, opts.projectId),
    configGroupId: 'tasks',
    sender: opts.userName,
    text: opts.message,
    parts: opts.parts,
    appendSystemPrompt: systemPrompt(opts.projectName, opts.who),
    toolToken: mintToolToken(opts.userSub, opts.projectId),
    toolsUrl: `${opts.origin}/api/agent/tools`,
  })

  let res: Response
  try {
    res = await fetch(`${base}/api/v2/fleet-agents/${agent.fleetId}/message-stream`, {
      method: 'POST',
      headers: await partnerHeaders(body),
      body,
    })
  } catch {
    return done('No pude contactar al agente. Intenta de nuevo.')
  }
  if (!res.ok || !res.body) {
    return done(`El agente respondió ${res.status}. Intenta de nuevo.`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''

  while (true) {
    const { done: fin, value } = await reader.read()
    if (fin) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const ev = JSON.parse(line.slice(6))
        if (ev.type === 'chunk' && typeof ev.value === 'string') {
          full += ev.value
          bus.publish(bus.ch.user(opts.userSub), { t: 'agent:chunk', turnId: opts.turnId, value: ev.value })
        } else if (ev.type === 'tool' && ev.phase === 'start' && typeof ev.name === 'string') {
          // Lo que hace, mientras lo hace: sin esto el drawer se queda mudo justo
          // cuando el agente está moviendo cosas en el tablero.
          bus.publish(bus.ch.user(opts.userSub), { t: 'agent:tool', turnId: opts.turnId, name: ev.name })
        } else if (ev.type === 'done' && typeof ev.value === 'string' && ev.value) {
          full = ev.value
        } else if (ev.type === 'error') {
          full = full || `⚠️ ${ev.message ?? 'el agente falló'}`
        }
      } catch {}
    }
  }

  await remember(opts.projectId, opts.handle, opts.userSub, full, 'agent')
  done(full)
}

export const askAgentFn = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      projectId: number
      message: string
      turnId: string
      handle?: string
      attachments?: Array<{ name?: string; mimeType: string; bytes: string }>
    }) => d
  )
  .handler(async ({ data }) => {
    await ensureSchema()
    const s = await session()
    const user = s.data.user
    if (!user) throw new Error('unauthorized')

    const { listAgents } = await import('./agent-runtime.server')
    const agents = await listAgents()
    if (!agents.length) {
      throw new Error('Este equipo no tiene agentes activados. Se activan en Ghosty Teams → Ajustes → Agentes.')
    }

    // El elegido para este tablero; si no hay, el primero del equipo.
    let handle = data.handle
    if (!handle) {
      const rows = await dbq('SELECT v FROM task_config WHERE k = ?', [`agent:${data.projectId}`])
      handle = rows[0]?.v ?? undefined
    }
    const agent = agents.find((a) => a.handle === handle) ?? agents[0]

    const proj = await dbq('SELECT name FROM task_projects WHERE id = ?', [data.projectId])
    const { reqOrigin } = await import('../origin.server')
    const origin = await reqOrigin()

    await remember(data.projectId, agent.handle, user.sub, data.message, 'user')

    const { listWorkspaceMembers } = await import('../users.server')
    const me = (await listWorkspaceMembers().catch(() => [])).find((m) => m.sub === user.sub)

    // Fire-and-forget: la respuesta va por SSE (/api/stream).
    runAgentTurn({
      userSub: user.sub,
      userName: user.name,
      who: { name: me?.name ?? user.name, handle: me?.handle ?? '' },
      parts: await buildParts(data.attachments ?? []),
      projectId: data.projectId,
      projectName: proj[0]?.name ?? 'este tablero',
      handle: agent.handle,
      message: data.message,
      turnId: data.turnId,
      origin,
    }).catch(() => {})

    return { ok: true as const, handle: agent.handle }
  })
