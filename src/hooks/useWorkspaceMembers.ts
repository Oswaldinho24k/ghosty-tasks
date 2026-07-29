import { useEffect, useState } from 'react'
import { listWorkspaceUsersFn } from '../server/members'

export type WorkspaceMember = Awaited<ReturnType<typeof listWorkspaceUsersFn>>[number]

// A quién se le puede asignar una tarea = TODO el equipo del workspace, no los miembros
// del proyecto. `task_project_members` solo se llena a mano, así que en la práctica tenía
// una fila (quien creó el tablero) y el desplegable de "Asignado a" ofrecía una persona:
// tú. El equipo ya es el mismo que en Ghosty Teams; ése es el padrón que importa.
//
// Cache a nivel de módulo: el roster viaja a gs y no cambia entre modales.
let cache: WorkspaceMember[] | null = null
let inflight: Promise<WorkspaceMember[]> | null = null

export function useWorkspaceMembers(enabled = true): WorkspaceMember[] {
  const [members, setMembers] = useState<WorkspaceMember[]>(cache ?? [])

  useEffect(() => {
    if (!enabled || cache) return
    let alive = true
    inflight = inflight ?? listWorkspaceUsersFn({ data: {} }).then((r) => (cache = r))
    inflight
      .then((r) => { if (alive) setMembers(r) })
      .catch(() => {})
      .finally(() => { inflight = null })
    return () => { alive = false }
  }, [enabled])

  return cache ?? members
}
