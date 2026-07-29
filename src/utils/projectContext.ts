import { createContext, useContext } from 'react'
import type { Task, Column } from '../server/projects'
import type { Label } from '../server/labels'

export type Member = { sub: string; name: string; avatar: string; handle: string; role: string }

export type ProjectContextValue = {
  projectId: number
  projectName: string
  /** Abre el chat del agente con la referencia de una tarea ya escrita. */
  onAskAgent: (ref: string) => void
  columns: Column[]
  tasks: Task[]
  /** Equipo completo del workspace: sirve para PINTAR a cualquiera (autores, asignados). */
  members: Member[]
  /** Los del tablero: es lo que se ofrece para filtrar y asignar desde la interfaz. */
  projectMembers: Member[]
  /** ¿Esta persona participa en el tablero? Si no, la UI va en solo lectura. */
  canEdit: boolean
  taskLabels: Record<number, Label[]>
  onTaskClick: (t: Task) => void
  onColumnsChange: (cols: Column[]) => void
  onTasksChange: (tasks: Task[]) => void
  onTaskLabelsChange: (labels: Record<number, Label[]>) => void
}

export const ProjectContext = createContext<ProjectContextValue | null>(null)

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProject must be inside ProjectShell')
  return ctx
}
