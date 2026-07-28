import { createServerFn } from '@tanstack/react-start'
import { dbq, num } from '../dbq.server'

const FLEET_BASE = process.env.EASYBITS_BASE_URL ?? 'https://www.easybits.cloud'

type ProjectCtx = {
  projectName: string
  userName: string
  columnList: Array<{ id: number; name: string; count: number }>
  memberList: Array<{ name: string }>
  totalTasks: number
  urgentTasks: number
}

type TaskSpec = { title: string; column_id: number; priority?: string }

async function buildProjectContext(projectId: number, userSub: string): Promise<ProjectCtx> {
  const [project, columns, tasks, members, currentUser] = await Promise.all([
    dbq('SELECT name FROM gw_projects WHERE id = ?', [projectId]),
    dbq('SELECT id, name FROM gw_columns WHERE project_id = ? ORDER BY position', [projectId]),
    dbq('SELECT column_id, priority FROM gw_tasks WHERE project_id = ? AND parent_id IS NULL', [projectId]),
    dbq(
      `SELECT u.name FROM gw_project_members m
       JOIN gw_users u ON u.sub = m.user_sub
       WHERE m.project_id = ?`,
      [projectId]
    ),
    dbq('SELECT name FROM gw_users WHERE sub = ?', [userSub]),
  ])

  const colMap = new Map<number, { name: string; count: number }>(
    columns.map(c => [num(c.id), { name: c.name ?? '', count: 0 }])
  )

  let urgentTasks = 0
  for (const t of tasks) {
    const col = colMap.get(num(t.column_id))
    if (col) col.count++
    if (t.priority === 'urgent') urgentTasks++
  }

  return {
    projectName: project[0]?.name ?? 'Proyecto',
    userName: currentUser[0]?.name ?? 'Usuario',
    columnList: columns.map(c => ({
      id: num(c.id),
      name: c.name ?? '',
      count: colMap.get(num(c.id))?.count ?? 0,
    })),
    memberList: members.map(m => ({ name: m.name ?? '' })),
    totalTasks: tasks.length,
    urgentTasks,
  }
}

function buildSystemPrompt(ctx: ProjectCtx): string {
  const colLines = ctx.columnList
    .map(c => `  - "${c.name}" (column_id: ${c.id}, ${c.count} tareas)`)
    .join('\n')
  const memberLines = ctx.memberList.map(m => `  - ${m.name}`).join('\n') || '  (sin miembros)'

  return `Eres Ghosty, el asistente AI del proyecto "${ctx.projectName}" en Ghosty Tasks.

ESTADO ACTUAL DEL TABLERO:
Columnas:
${colLines}
Miembros:
${memberLines}
Total de tareas: ${ctx.totalTasks}
Tareas urgentes: ${ctx.urgentTasks}

Puedes crear tareas directamente. Si el usuario te pide crear tareas, incluye al FINAL de tu respuesta un bloque JSON con este formato exacto:
\`\`\`json
{"create_tasks": [{"title": "Título de la tarea", "column_id": <número>, "priority": "high"}]}
\`\`\`
Valores válidos de priority: urgent, high, medium, low. Omite el campo si no hay prioridad específica.
IMPORTANTE: Usa solo los column_id del listado de columnas arriba.

Responde siempre en español, de forma concisa y directa. No incluyas el bloque JSON si el usuario no pide crear tareas.`
}

function parseCreateTasks(text: string): TaskSpec[] {
  const match = text.match(/```(?:json)?\s*(\{[\s\S]*?"create_tasks"[\s\S]*?\})\s*```/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1])
    if (Array.isArray(parsed.create_tasks)) {
      return (parsed.create_tasks as unknown[]).filter(
        (t): t is TaskSpec =>
          typeof (t as TaskSpec).title === 'string' &&
          typeof (t as TaskSpec).column_id === 'number'
      )
    }
  } catch {}
  return []
}

async function runAgentTurn({
  userSub,
  projectId,
  message,
  turnId,
  ctx,
}: {
  userSub: string
  projectId: number
  message: string
  turnId: string
  ctx: ProjectCtx
}) {
  const bus = await import('./bus.server')
  const fleetId = process.env.EASYBITS_FLEET_ID
  const fleetToken = process.env.EASYBITS_FLEET_TOKEN

  if (!fleetId || !fleetToken) {
    bus.publish(bus.ch.user(userSub), {
      t: 'agent:done',
      turnId,
      value: 'El agente no está configurado. Agrega `EASYBITS_FLEET_ID` y `EASYBITS_FLEET_TOKEN` al `.env`.',
      created_tasks: [],
    })
    return
  }

  let res: Response
  try {
    res = await fetch(`${FLEET_BASE}/api/v2/fleet-agents/${fleetId}/message-stream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fleetToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        groupId: `ghostytasks_${projectId}_${userSub}`,
        sender: ctx.userName,
        text: message,
        appendSystemPrompt: buildSystemPrompt(ctx),
      }),
    })
  } catch {
    bus.publish(bus.ch.user(userSub), {
      t: 'agent:done',
      turnId,
      value: 'No se pudo conectar con el agente. Verifica tu conexión.',
      created_tasks: [],
    })
    return
  }

  if (!res.ok || !res.body) {
    bus.publish(bus.ch.user(userSub), {
      t: 'agent:done',
      turnId,
      value: `Error del agente (${res.status}). Intenta de nuevo.`,
      created_tasks: [],
    })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const ev = JSON.parse(line.slice(6))
        if (ev.type === 'chunk' && typeof ev.value === 'string') {
          fullText += ev.value
          bus.publish(bus.ch.user(userSub), { t: 'agent:chunk', turnId, value: ev.value })
        }
      } catch {}
    }
  }

  // Create tasks the agent requested
  const specs = parseCreateTasks(fullText)
  const created: Array<{ id: number; title: string; column_id: number }> = []

  for (const spec of specs) {
    try {
      const posRows = await dbq(
        'SELECT COALESCE(MAX(position), 0) as m FROM gw_tasks WHERE column_id = ? AND parent_id IS NULL',
        [spec.column_id]
      )
      const position = parseFloat(posRows[0]?.m ?? '0') + 1000
      const rows = await dbq(
        `INSERT INTO gw_tasks (project_id, column_id, title, priority, position, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, unixepoch()) RETURNING *`,
        [projectId, spec.column_id, spec.title, spec.priority ?? null, position, userSub]
      )
      const row = rows[0]
      if (row) {
        const taskId = num(row.id)
        created.push({ id: taskId, title: spec.title, column_id: spec.column_id })
        bus.publish(bus.ch.project(projectId), {
          t: 'task:created',
          task: {
            id: taskId,
            project_id: projectId,
            column_id: spec.column_id,
            title: spec.title,
            priority: spec.priority ?? null,
            assignee_sub: null,
            position,
            status: 'open',
          },
        })
      }
    } catch {
      // Skip failed task silently
    }
  }

  bus.publish(bus.ch.user(userSub), {
    t: 'agent:done',
    turnId,
    value: fullText,
    created_tasks: created,
  })
}

export const askAgentFn = createServerFn({ method: 'POST' })
  .validator((d: { projectId: number; message: string; turnId: string }) => d)
  .handler(async ({ data }) => {
    const { useSession } = await import('@tanstack/react-start/server')
    const { sessionConfig } = await import('./session.server')
    const s = await useSession<{ user?: { sub: string; name: string } }>(sessionConfig())
    const user = s.data.user
    if (!user) throw new Error('unauthorized')

    const ctx = await buildProjectContext(data.projectId, user.sub)

    // Fire and forget — SSE chunks arrive via /api/stream
    runAgentTurn({
      userSub: user.sub,
      projectId: data.projectId,
      message: data.message,
      turnId: data.turnId,
      ctx,
    }).catch(() => {})

    return { ok: true }
  })
