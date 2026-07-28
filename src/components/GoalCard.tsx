import { useState } from 'react'
import { ChevronDown, ChevronUp, Check, Circle, Trash2, Link2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Goal, GoalTask } from '../server/goals'
import { getGoalTasksFn, deleteGoalFn, updateGoalFn, unlinkTaskFromGoalFn, linkTaskToGoalFn } from '../server/goals'

type LinkableTask = { id: number; title: string }

export function GoalCard({
  goal,
  projectId,
  linkableTasks,
  onDeleted,
  onUpdated,
}: {
  goal: Goal
  projectId: number
  linkableTasks: LinkableTask[]
  onDeleted: (id: number) => void
  onUpdated: (id: number, patch: Partial<Goal>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [tasks, setTasks] = useState<GoalTask[] | null>(null)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [showLinkPicker, setShowLinkPicker] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(goal.title)

  const pct = goal.total_tasks > 0 ? Math.round((goal.completed_tasks / goal.total_tasks) * 100) : 0
  const isDone = goal.status === 'done'

  async function toggleExpand() {
    if (!expanded && tasks === null) {
      setLoadingTasks(true)
      try {
        const t = await getGoalTasksFn({ data: { goal_id: goal.id } })
        setTasks(t)
      } finally {
        setLoadingTasks(false)
      }
    }
    setExpanded((v) => !v)
  }

  async function toggleStatus() {
    const newStatus = isDone ? 'open' : 'done'
    await updateGoalFn({ data: { id: goal.id, project_id: projectId, status: newStatus } })
    onUpdated(goal.id, { status: newStatus as 'open' | 'done' })
  }

  async function saveTitle() {
    setEditingTitle(false)
    if (!titleDraft.trim() || titleDraft === goal.title) { setTitleDraft(goal.title); return }
    await updateGoalFn({ data: { id: goal.id, project_id: projectId, title: titleDraft.trim() } })
    onUpdated(goal.id, { title: titleDraft.trim() })
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar el goal "${goal.title}"?`)) return
    try {
      await deleteGoalFn({ data: { id: goal.id, project_id: projectId } })
      onDeleted(goal.id)
      toast.success('Goal eliminado')
    } catch {
      toast.error('Error al eliminar goal')
    }
  }

  async function linkTask(taskId: number) {
    await linkTaskToGoalFn({ data: { goal_id: goal.id, task_id: taskId, project_id: projectId } })
    const linked = linkableTasks.find((t) => t.id === taskId)
    if (linked) {
      setTasks((prev) => [...(prev ?? []), { id: linked.id, title: linked.title, status: 'open', priority: null, assignee_sub: null }])
      onUpdated(goal.id, { total_tasks: goal.total_tasks + 1 })
    }
    setShowLinkPicker(false)
  }

  async function unlinkTask(taskId: number) {
    await unlinkTaskFromGoalFn({ data: { goal_id: goal.id, task_id: taskId, project_id: projectId } })
    setTasks((prev) => (prev ?? []).filter((t) => t.id !== taskId))
    onUpdated(goal.id, { total_tasks: Math.max(0, goal.total_tasks - 1) })
  }

  const linkedTaskIds = new Set((tasks ?? []).map((t) => t.id))
  const availableToLink = linkableTasks.filter((t) => !linkedTaskIds.has(t.id))

  return (
    <div className={`rounded-xl border bg-surface p-4 shadow-sm transition-all ${isDone ? 'opacity-70' : ''} border-border`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={toggleStatus}
          className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors
            ${isDone ? 'border-brand bg-brand text-brand-fg' : 'border-border hover:border-brand'}`}
        >
          {isDone && <Check size={11} />}
        </button>

        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setEditingTitle(false); setTitleDraft(goal.title) } }}
              className="w-full rounded border border-brand bg-surface px-1.5 py-0.5 text-sm font-semibold text-ink outline-none"
            />
          ) : (
            <h3
              onClick={() => setEditingTitle(true)}
              className={`cursor-text text-sm font-semibold text-ink hover:text-brand transition-colors ${isDone ? 'line-through text-muted' : ''}`}
            >
              {goal.title}
            </h3>
          )}

          {/* Progress bar */}
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-surface-3 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[10px] font-medium text-muted whitespace-nowrap">
              {goal.completed_tasks}/{goal.total_tasks} · {pct}%
            </span>
          </div>

          {goal.due_date && (
            <p className="mt-1 text-[10px] text-muted">
              Vence: {new Date(goal.due_date * 1000).toLocaleDateString('es', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${isDone ? 'bg-brand/10 text-brand' : 'bg-surface-3 text-muted'}`}>
            {isDone ? 'Completado' : 'Abierto'}
          </span>
          <button onClick={handleDelete} className="rounded p-0.5 text-muted hover:text-red-400 transition-colors">
            <Trash2 size={13} />
          </button>
          <button onClick={toggleExpand} className="rounded p-0.5 text-muted hover:text-ink transition-colors">
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* Expanded: linked tasks */}
      {expanded && (
        <div className="mt-3 ml-8 space-y-1">
          {loadingTasks && (
            <div className="animate-pulse space-y-1">
              <div className="h-4 w-2/3 rounded bg-surface-3" />
              <div className="h-4 w-1/2 rounded bg-surface-3" />
            </div>
          )}
          {(tasks ?? []).map((t) => (
            <div key={t.id} className="group flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2">
              {t.status === 'done'
                ? <Check size={12} className="text-brand flex-shrink-0" />
                : <Circle size={12} className="text-muted flex-shrink-0" />
              }
              <span className={`flex-1 text-xs ${t.status === 'done' ? 'line-through text-muted' : 'text-ink'}`}>
                {t.title}
              </span>
              <button
                onClick={() => unlinkTask(t.id)}
                className="hidden group-hover:block text-muted hover:text-red-400 transition-colors"
              >
                <X size={11} />
              </button>
            </div>
          ))}
          {(tasks ?? []).length === 0 && !loadingTasks && (
            <p className="text-xs text-muted italic px-2">Sin tareas vinculadas</p>
          )}

          {/* Link task button */}
          {availableToLink.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowLinkPicker((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-brand hover:bg-surface-2 transition-colors"
              >
                <Link2 size={11} />
                Vincular tarea
              </button>
              {showLinkPicker && (
                <div className="absolute left-0 top-full mt-1 z-20 w-64 rounded-lg border border-border bg-surface shadow-lg overflow-hidden">
                  <div className="max-h-48 overflow-y-auto">
                    {availableToLink.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => linkTask(t.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink hover:bg-surface-2 transition-colors"
                      >
                        <Circle size={11} className="text-muted flex-shrink-0" />
                        <span className="truncate">{t.title}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowLinkPicker(false)} className="w-full px-3 py-1.5 text-xs text-muted hover:text-ink border-t border-border text-left">
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
