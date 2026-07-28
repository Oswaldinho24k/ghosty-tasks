import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { KanbanBoard } from '../components/KanbanBoard'
import { FilterBar, type Filters, EMPTY_FILTERS, applyFilters } from '../components/FilterBar'
import { useProject } from '../utils/projectContext'

export const Route = createFileRoute('/p/$slug/board')({
  component: BoardView,
})

function BoardView() {
  const ctx = useProject()
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)

  const visibleTasks = applyFilters(ctx.tasks, filters)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <FilterBar filters={filters} members={ctx.members} onFiltersChange={setFilters} />
      <div className="flex-1 overflow-hidden">
        <KanbanBoard
          projectId={ctx.projectId}
          columns={ctx.columns}
          tasks={visibleTasks}
          members={ctx.members}
          onTaskClick={ctx.onTaskClick}
          onColumnsChange={ctx.onColumnsChange}
          onTasksChange={ctx.onTasksChange}
        />
      </div>
    </div>
  )
}
