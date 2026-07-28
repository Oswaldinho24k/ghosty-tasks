import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { Target, Plus } from 'lucide-react'
import { getGoalsFn, createGoalFn } from '../server/goals'
import type { Goal } from '../server/goals'
import { GoalCard } from '../components/GoalCard'
import { useProject } from '../utils/projectContext'

export const Route = createFileRoute('/p/$slug/goals')({
  component: GoalsView,
})

function GoalsView() {
  const { projectId, tasks } = useProject()
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getGoalsFn({ data: { project_id: projectId } })
      .then(setGoals)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  async function createGoal() {
    if (!newTitle.trim()) return
    setSaving(true)
    const goal = await createGoalFn({ data: { project_id: projectId, title: newTitle.trim() } })
    setGoals((prev) => [...prev, goal])
    setNewTitle('')
    setCreating(false)
    setSaving(false)
  }

  function handleDeleted(id: number) {
    setGoals((prev) => prev.filter((g) => g.id !== id))
  }

  function handleUpdated(id: number, patch: Partial<Goal>) {
    setGoals((prev) => prev.map((g) => g.id === id ? { ...g, ...patch } : g))
  }

  // Tasks available to link (any task in this project)
  const linkableTasks = tasks.map((t) => ({ id: t.id, title: t.title }))

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-brand" />
          <h2 className="text-sm font-semibold text-ink">Goals</h2>
          {!loading && (
            <span className="text-xs text-muted">({goals.length})</span>
          )}
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg hover:brightness-110 transition-all"
        >
          <Plus size={13} />
          Nuevo goal
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {/* New goal form */}
        {creating && (
          <div className="mb-4 rounded-xl border border-brand bg-surface p-4">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createGoal()
                if (e.key === 'Escape') { setCreating(false); setNewTitle('') }
              }}
              placeholder="Nombre del goal…"
              className="w-full bg-transparent text-sm font-semibold text-ink outline-none placeholder:text-muted"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={createGoal}
                disabled={!newTitle.trim() || saving}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg disabled:opacity-50"
              >
                {saving ? 'Creando…' : 'Crear'}
              </button>
              <button
                onClick={() => { setCreating(false); setNewTitle('') }}
                className="text-xs text-muted hover:text-ink"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="animate-pulse space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-surface p-4 space-y-2">
                <div className="h-4 w-1/2 rounded bg-surface-3" />
                <div className="h-2 rounded-full bg-surface-3" />
              </div>
            ))}
          </div>
        )}

        {/* Goals list */}
        {!loading && goals.length === 0 && !creating && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Target size={40} className="text-muted" />
            <h3 className="text-base font-semibold text-ink">Sin goals aún</h3>
            <p className="max-w-xs text-sm text-muted">
              Agrupa tareas en objetivos ligeros. Sin ceremony — solo un título y progreso automático.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="mt-1 flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:brightness-110"
            >
              <Plus size={14} />
              Crear primer goal
            </button>
          </div>
        )}

        <div className="space-y-3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              projectId={projectId}
              linkableTasks={linkableTasks}
              onDeleted={handleDeleted}
              onUpdated={handleUpdated}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
