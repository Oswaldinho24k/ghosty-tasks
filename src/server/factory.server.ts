// La Software Factory de Ghosty Teams, vista desde Tasks.
//
// Teams y Tasks comparten namespace, así que se LEE directo: la app instalada
// (`gt_installed_apps`) y el handle `@plan` (`gc_agents`). Lo único que se ESCRIBE hacia
// Teams es el aviso de "te asignaron esta tarea", por `api/internal/factory-task`, firmado
// como el resto de los `api.internal.*` de Teams (`ts.<cuerpo>` con GHOSTY_PARTNER_SECRET).
import { dbq } from '../dbq.server'

/** Sub con que se guarda en `assignee_sub` una tarea asignada al rol @plan de la fábrica. */
export const FACTORY_PLAN_SUB = 'agent:plan'

export function isAgentSub(sub: string | null | undefined): boolean {
  return !!sub && sub.startsWith('agent:')
}

/** Config de la fábrica instalada, o null (tabla inexistente, sin instalar o desinstalada). */
export async function factoryConfig(): Promise<{ roomId?: number; boardId?: number | null } | null> {
  const rows = await dbq(
    "SELECT config, uninstalled_at FROM gt_installed_apps WHERE app = 'factory'",
  ).catch(() => [])
  const r = rows[0]
  if (!r || r.uninstalled_at) return null
  try {
    return JSON.parse(String(r.config ?? '{}'))
  } catch {
    return {}
  }
}

/**
 * `@plan` como asignable, SÓLO en el tablero de la fábrica: Teams sigue la tarea (etiquetas,
 * columna, PR) llamando a Tasks con ese tablero, así que en otro no podría.
 */
export async function factoryAssignees(projectId: number) {
  const cfg = await factoryConfig()
  if (!cfg?.boardId || Number(cfg.boardId) !== Number(projectId)) return []
  const rows = await dbq("SELECT name, avatar FROM gc_agents WHERE handle = 'plan' AND enabled = 1").catch(() => [])
  if (!rows[0]) return []
  return [{ sub: FACTORY_PLAN_SUB, name: '@plan', avatar: String(rows[0].avatar ?? ''), handle: 'plan' }]
}

/** Avisa a Teams que una tarea se asignó a @plan: abre la corrida. Nunca lanza. */
export async function notifyFactoryTask(task: { id: number; title: string; description: string | null }, sub: string) {
  try {
    const { currentSlug } = await import('./tenant.server')
    const slug = await currentSlug()
    const secret = process.env.GHOSTY_PARTNER_SECRET
    if (!slug || !secret) return
    const crypto = await import('node:crypto')
    const body = JSON.stringify({
      taskRef: String(task.id),
      title: task.title,
      description: task.description ?? '',
      requestedBy: sub,
    })
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
    const root = process.env.TEAMS_ROOT_DOMAIN ?? 'teams.ghosty.studio'
    const res = await fetch(`https://${slug}.${root}/api/internal/factory-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ghosty-ts': ts, 'x-ghosty-sig': sig },
      body,
    })
    if (!res.ok) console.error(`[factory] Teams contestó ${res.status} al asignar #${task.id} a @plan`)
  } catch (e) {
    console.error('[factory] no pude avisar a Teams', e)
  }
}
