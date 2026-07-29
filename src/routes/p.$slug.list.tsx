import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { PriorityBadge } from '../components/PriorityBadge'
import { MemberAvatar } from '../components/MemberAvatar'
import { FilterBar, type Filters, applyFilters } from '../components/FilterBar'
import { Check, Calendar } from 'lucide-react'
import { useProject } from '../utils/projectContext'

export const Route = createFileRoute('/p/$slug/list')({
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    priority: typeof s.priority === 'string' && s.priority ? s.priority : undefined,
    assignee: typeof s.assignee === 'string' && s.assignee ? s.assignee : undefined,
  }),
  component: ListView,
})

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

function ListView() {
  const { tasks, columns, members, onTaskClick, projectMembers } = useProject()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const filters: Filters = {
    q: search.q ?? '',
    priorities: search.priority ? search.priority.split(',') : [],
    assignees: search.assignee ? search.assignee.split(',') : [],
  }

  function setFilters(f: Filters) {
    navigate({
      search: {
        q: f.q || undefined,
        priority: f.priorities.length ? f.priorities.join(',') : undefined,
        assignee: f.assignees.length ? f.assignees.join(',') : undefined,
      },
      replace: true,
    })
  }

  const colMap = new Map(columns.map((c) => [c.id, c]))
  const filtered = applyFilters(tasks, filters)
  const sorted = [...filtered].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority ?? ''] ?? 99
    const pb = PRIORITY_ORDER[b.priority ?? ''] ?? 99
    return pa - pb || a.title.localeCompare(b.title)
  })

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <FilterBar filters={filters} members={projectMembers} onFiltersChange={setFilters} />
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="w-8 px-4 py-2" />
              <th className="px-3 py-2 font-medium">Tarea</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Prioridad</th>
              <th className="px-3 py-2 font-medium">Asignado</th>
              <th className="px-3 py-2 font-medium">Vence</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((task) => {
              const col = colMap.get(task.column_id)
              const assignee = members.find((m) => m.sub === task.assignee_sub)
              const dueDate = task.due_date ? new Date(task.due_date * 1000) : null
              const overdue = dueDate && dueDate < new Date() && task.status !== 'done'

              return (
                <tr
                  key={task.id}
                  onClick={() => onTaskClick(task)}
                  className="cursor-pointer border-b border-border transition-colors hover:bg-surface-2"
                >
                  <td className="px-4 py-2">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border-2 transition-colors
                      ${task.status === 'done' ? 'border-brand bg-brand text-brand-fg' : 'border-border'}`}>
                      {task.status === 'done' && <Check size={9} />}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`font-medium text-ink ${task.status === 'done' ? 'line-through text-muted' : ''}`}>
                      {task.title}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ background: col?.color ? `${col.color}22` : undefined }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: col?.color ?? '#6b7280' }} />
                      {col?.name ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <PriorityBadge priority={task.priority} showLabel />
                  </td>
                  <td className="px-3 py-2">
                    {assignee ? (
                      <div className="flex items-center gap-1.5">
                        <MemberAvatar name={assignee.name} avatar={assignee.avatar} size={20} />
                        <span className="text-xs text-muted">{assignee.name.split(' ')[0]}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {dueDate ? (
                      <span className={`inline-flex items-center gap-1 text-xs ${overdue ? 'text-red-400' : 'text-muted'}`}>
                        <Calendar size={11} />
                        {dueDate.toLocaleDateString('es', { month: 'short', day: 'numeric' })}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="py-16 text-center text-sm text-muted">
                  {filters.q || filters.priorities.length || filters.assignees.length
                    ? 'No hay tareas que coincidan con los filtros.'
                    : 'No hay tareas todavía.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
