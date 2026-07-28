import { createContext, useContext } from 'react'
import type { Task, Column } from '../server/projects'
import type { Label } from '../server/labels'

export type Member = { sub: string; name: string; avatar: string; handle: string; role: string }

export type ProjectContextValue = {
  projectId: number
  columns: Column[]
  tasks: Task[]
  members: Member[]
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
