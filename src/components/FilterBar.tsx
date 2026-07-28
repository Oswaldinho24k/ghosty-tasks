import { Search, X } from 'lucide-react'
import { MemberAvatar } from './MemberAvatar'

export type Filters = {
  q: string
  priorities: string[]
  assignees: string[]
}

export const EMPTY_FILTERS: Filters = { q: '', priorities: [], assignees: [] }

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgente', color: '#ef4444' },
  { value: 'high', label: 'Alta', color: '#f97316' },
  { value: 'medium', label: 'Media', color: '#eab308' },
  { value: 'low', label: 'Baja', color: '#60a5fa' },
]

export function applyFilters<T extends { title: string; priority?: string | null; assignee_sub?: string | null; parent_id?: number | null }>(
  tasks: T[],
  filters: Filters,
): T[] {
  return tasks.filter((t) => {
    if (t.parent_id) return false
    if (filters.q && !t.title.toLowerCase().includes(filters.q.toLowerCase())) return false
    if (filters.priorities.length && !filters.priorities.includes(t.priority ?? '')) return false
    if (filters.assignees.length && !filters.assignees.includes(t.assignee_sub ?? '')) return false
    return true
  })
}

export function FilterBar({
  filters,
  members,
  onFiltersChange,
}: {
  filters: Filters
  members: { sub: string; name: string; avatar: string }[]
  onFiltersChange: (f: Filters) => void
}) {
  const hasFilters = filters.q || filters.priorities.length > 0 || filters.assignees.length > 0

  function togglePriority(value: string) {
    const active = filters.priorities.includes(value)
    onFiltersChange({
      ...filters,
      priorities: active ? filters.priorities.filter((x) => x !== value) : [...filters.priorities, value],
    })
  }

  function toggleAssignee(sub: string) {
    const active = filters.assignees.includes(sub)
    onFiltersChange({
      ...filters,
      assignees: active ? filters.assignees.filter((x) => x !== sub) : [...filters.assignees, sub],
    })
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2">
      {/* Search input */}
      <div className="flex min-w-0 max-w-xs flex-1 items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5">
        <Search size={12} className="flex-shrink-0 text-muted" />
        <input
          value={filters.q}
          onChange={(e) => onFiltersChange({ ...filters, q: e.target.value })}
          placeholder="Buscar tareas…"
          className="flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted"
        />
        {filters.q && (
          <button onClick={() => onFiltersChange({ ...filters, q: '' })}>
            <X size={11} className="text-muted hover:text-ink" />
          </button>
        )}
      </div>

      {/* Priority chips */}
      <div className="flex gap-1">
        {PRIORITY_OPTIONS.map((p) => {
          const active = filters.priorities.includes(p.value)
          return (
            <button
              key={p.value}
              onClick={() => togglePriority(p.value)}
              className="rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={
                active
                  ? { background: p.color, borderColor: p.color, color: '#fff' }
                  : { background: 'transparent', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }
              }
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* Assignee avatars */}
      {members.length > 0 && (
        <div className="flex -space-x-1">
          {members.map((m) => {
            const active = filters.assignees.includes(m.sub)
            return (
              <button
                key={m.sub}
                onClick={() => toggleAssignee(m.sub)}
                title={m.name}
                className={`rounded-full border-2 transition-all ${active ? 'scale-110 border-brand' : 'border-surface hover:border-brand/50'}`}
              >
                <MemberAvatar name={m.name} avatar={m.avatar} size={22} />
              </button>
            )
          })}
        </div>
      )}

      {/* Clear all */}
      {hasFilters && (
        <button
          onClick={() => onFiltersChange(EMPTY_FILTERS)}
          className="text-xs text-muted hover:text-ink transition-colors"
        >
          Limpiar
        </button>
      )}
    </div>
  )
}
