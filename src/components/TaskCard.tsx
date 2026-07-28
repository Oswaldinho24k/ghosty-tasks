import type { Task } from '../server/projects'
import { PriorityBadge } from './PriorityBadge'
import { MemberAvatar } from './MemberAvatar'
import { CheckSquare, Calendar } from 'lucide-react'
import { useProject } from '../utils/projectContext'

type Member = { sub: string; name: string; avatar: string }

export function TaskCard({
  task,
  members,
  checklistTotal,
  checklistDone,
  onClick,
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
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  isDragging?: boolean
}) {
  const { taskLabels } = useProject()
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
      {/* Priority dot */}
      {task.priority && (
        <div className="absolute left-0 top-3 h-3/4 w-0.5 rounded-r-full" style={{ background: priorityColor(task.priority) }} />
      )}

      <p className={`text-sm font-medium leading-snug text-ink ${task.status === 'done' ? 'line-through text-muted' : ''}`}>
        {task.title}
      </p>

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
          <MemberAvatar name={assignee.name} avatar={assignee.avatar} size={20} />
        )}
      </div>
    </div>
  )
}

function priorityColor(p: string): string {
  return { urgent: '#ef4444', high: '#f97316', medium: '#eab308', low: '#60a5fa' }[p] ?? 'transparent'
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('es', { month: 'short', day: 'numeric' })
}
