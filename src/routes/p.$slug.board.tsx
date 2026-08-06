import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { KanbanBoard } from '../components/KanbanBoard'
import { FilterBar, type Filters, applyFilters } from '../components/FilterBar'
import { useProject } from '../utils/projectContext'

export const Route = createFileRoute('/p/$slug/board')({
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    priority: typeof s.priority === 'string' && s.priority ? s.priority : undefined,
    assignee: typeof s.assignee === 'string' && s.assignee ? s.assignee : undefined,
  }),
  component: BoardView,
})

function BoardView() {
  const ctx = useProject()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const filters: Filters = {
    q: search.q ?? '',
    priorities: search.priority ? search.priority.split(',') : [],
    assignees: search.assignee ? search.assignee.split(',') : [],
  }

  function setFilters(f: Filters) {
    // La forma de actualizador CONSERVA `task`: filtrar no puede cerrar la tarea que tienes
    // abierta. Con un objeto literal se perdería en cada tecla del buscador.
    navigate({
      search: (prev) => ({
        ...prev,
        q: f.q || undefined,
        priority: f.priorities.length ? f.priorities.join(',') : undefined,
        assignee: f.assignees.length ? f.assignees.join(',') : undefined,
      }),
      replace: true,
    })
  }

  const visibleTasks = applyFilters(ctx.tasks, filters)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <FilterBar filters={filters} members={ctx.projectMembers} onFiltersChange={setFilters} />
      <div className="flex-1 overflow-hidden">
        <KanbanBoard
          projectId={ctx.projectId}
          columns={ctx.columns}
          tasks={visibleTasks}
          members={ctx.projectMembers}
          onTaskClick={ctx.onTaskClick}
          onColumnsChange={ctx.onColumnsChange}
          onTasksChange={ctx.onTasksChange}
        />
      </div>
    </div>
  )
}
