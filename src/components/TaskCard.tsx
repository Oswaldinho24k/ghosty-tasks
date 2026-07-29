import type { Task } from '../server/projects'
import { PriorityBadge } from './PriorityBadge'
import { MemberAvatar } from './MemberAvatar'
import { CheckSquare, Calendar } from 'lucide-react'
import { taskRef } from '../utils/taskRef'
import { useProject } from '../utils/projectContext'

type Member = { sub: string; name: string; avatar: string }

export function TaskCard({
  task,
  members,
  checklistTotal,
  checklistDone,
  onClick,
  onAskAgent,
  projectName,
  draggable,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  task: Task
  members: Member[]
  checklistTotal?: number
  checklistDone?: number
  onClick: () => void
  /** Abre el chat con la referencia ya escrita: hablar de una tarjeta sin teclear su id. */
  onAskAgent?: (ref: string) => void
  projectName: string
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  isDragging?: boolean
}) {
  const { taskLabels, online } = useProject()
  const labels = taskLabels[task.id] ?? []
  const assignee = members.find((m) => m.sub === task.assignee_sub)
  const hasDue = task.due_date != null
  const dueDate = hasDue ? new Date(task.due_date! * 1000) : null
  const isOverdue = dueDate ? dueDate < new Date() && task.status !== 'done' : false
  const hasChecklist = (checklistTotal ?? 0) > 0

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group relative rounded-xl border bg-surface p-3 shadow-sm transition-all
        hover:shadow-md hover:border-brand/30 cursor-pointer select-none
        ${isDragging ? 'opacity-40 scale-95' : ''}
        ${task.status === 'done' ? 'opacity-60' : ''}
        border-border`}
    >
      {/* Prioridad como barra SUPERIOR: se lee como parte de la tarjeta y no compite con
          el borde izquierdo de la columna. */}
      {task.priority && (
        <div
          className="absolute inset-x-0 top-0 h-1 rounded-t-xl"
          style={{ background: priorityColor(task.priority) }}
        />
      )}

      <div className="flex items-start gap-2">
        <p className={`flex-1 text-sm font-medium leading-snug text-ink ${task.status === 'done' ? 'line-through text-muted' : ''}`}>
          {task.title}
        </p>
        {onAskAgent && (
          <button
            onClick={(e) => { e.stopPropagation(); onAskAgent(taskRef(projectName, task.id)) }}
            title={`Hablar de ${taskRef(projectName, task.id)} con Ghosty`}
            className="hidden shrink-0 rounded-md p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-surface-3 hover:text-brand sm:block"
          >
            <img src="/ghosty.svg" alt="" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Labels */}
      {labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {labels.slice(0, 3).map((l) => (
            <span
              key={l.label}
              className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white leading-none"
              style={{ background: l.color }}
            >
              {l.label}
            </span>
          ))}
          {labels.length > 3 && (
            <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium text-muted bg-surface-3 leading-none">
              +{labels.length - 3}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* La referencia que se usa para hablar de esta tarea (estilo Linear/Jira). */}
          <span className="font-mono text-[10px] text-muted/70">{taskRef(projectName, task.id)}</span>
          <PriorityBadge priority={task.priority} />
          {hasChecklist && (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted">
              <CheckSquare size={11} />
              {checklistDone}/{checklistTotal}
            </span>
          )}
          {dueDate && (
            <span className={`inline-flex items-center gap-0.5 text-xs ${isOverdue ? 'text-red-400' : 'text-muted'}`}>
              <Calendar size={11} />
              {fmtDate(dueDate)}
            </span>
          )}
        </div>
        {assignee && (
          <MemberAvatar name={assignee.name} avatar={assignee.avatar} size={20} online={online.includes(assignee.sub)} />
        )}
      </div>
    </div>
  )
}

function priorityColor(p: string): string {
  // Alta y media eran naranja y amarillo: a este tamaño (una franja de 4px, un punto de
  // 8px) se confunden. Se separan por TONO, no por matiz: rojo, naranja, azul, gris.
  return { urgent: '#ef4444', high: '#f97316', medium: '#3b82f6', low: '#94a3b8' }[p] ?? 'transparent'
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('es', { month: 'short', day: 'numeric' })
}
