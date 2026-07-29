import { useState, useRef } from 'react'
import { Plus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import type { Task, Column } from '../server/projects'
import { createTaskFn, moveTaskFn } from '../server/tasks'
import { createColumnFn, updateColumnFn, deleteColumnFn } from '../server/columns'
import { TaskCard } from './TaskCard'
import { useProject } from '../utils/projectContext'

type Member = { sub: string; name: string; avatar: string; handle: string; role: string }

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgente', color: '#ef4444' },
  { value: 'high', label: 'Alta', color: '#f97316' },
  { value: 'medium', label: 'Media', color: '#eab308' },
  { value: 'low', label: 'Baja', color: '#60a5fa' },
]

const COL_COLORS = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6b7280', '#0ea5e9']

export function KanbanBoard({
  projectId,
  columns,
  tasks,
  members,
  onTaskClick,
  onColumnsChange,
  onTasksChange,
}: {
  projectId: number
  columns: Column[]
  tasks: Task[]
  members: Member[]
  onTaskClick: (task: Task) => void
  onColumnsChange: (cols: Column[]) => void
  onTasksChange: (tasks: Task[]) => void
}) {
  // Ver es de todo el workspace; arrastrar tarjetas, solo de quien participa.
  const { canEdit, projectName, onAskAgent } = useProject()
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [addingCol, setAddingCol] = useState(false)
  const [colName, setColName] = useState('')
  const [addingTaskCol, setAddingTaskCol] = useState<number | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState<string | null>(null)
  const [newTaskAssignee, setNewTaskAssignee] = useState<string | null>(null)
  const [newTaskDue, setNewTaskDue] = useState('')

  // Column actions
  const [colMenu, setColMenu] = useState<number | null>(null)
  const [renamingCol, setRenamingCol] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [wipDraft, setWipDraft] = useState<Record<number, string>>({})

  const dragOver = useRef<{ colId: number; pos: number | null }>({ colId: 0, pos: null })

  function tasksInCol(colId: number): Task[] {
    return tasks.filter((t) => t.column_id === colId && !t.parent_id).sort((a, b) => a.position - b.position)
  }

  function onDragStart(e: React.DragEvent, task: Task) {
    setDraggingId(task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragEnd() { setDraggingId(null) }

  function onDragOver(e: React.DragEvent, colId: number, afterPos: number | null) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    dragOver.current = { colId, pos: afterPos }
  }

  async function onDrop(e: React.DragEvent, colId: number) {
    e.preventDefault()
    if (draggingId == null) return
    const task = tasks.find((t) => t.id === draggingId)
    if (!task) return

    const colTasks = tasksInCol(colId)
    const { pos } = dragOver.current
    let prevPos: number | null = null
    let nextPos: number | null = null

    if (pos == null) {
      prevPos = colTasks.length > 0 ? colTasks[colTasks.length - 1].position : null
    } else {
      const idx = colTasks.findIndex((t) => t.position === pos)
      prevPos = idx > 0 ? colTasks[idx - 1].position : null
      nextPos = colTasks[idx]?.position ?? null
    }

    const newPosition = ((prevPos ?? 0) + (nextPos ?? (prevPos ?? 0) + 2000)) / 2
    onTasksChange(tasks.map((t) => t.id === draggingId ? { ...t, column_id: colId, position: newPosition } : t))

    await moveTaskFn({ data: { id: draggingId, project_id: projectId, column_id: colId, prev_position: prevPos, next_position: nextPos } })
    setDraggingId(null)
  }

  async function addColumn() {
    if (!colName.trim()) return
    try {
      const raw = await createColumnFn({ data: { project_id: projectId, name: colName.trim() } })
      const col: Column = { ...raw, wip_limit: null }
      onColumnsChange([...columns, col])
      setColName('')
      setAddingCol(false)
      toast.success(`Columna "${col.name}" creada`)
    } catch {
      toast.error('Error al crear columna')
    }
  }

  function cancelAddTask() {
    setAddingTaskCol(null)
    setNewTaskTitle('')
    setNewTaskPriority(null)
    setNewTaskAssignee(null)
    setNewTaskDue('')
  }

  async function addTask(colId: number) {
    if (!newTaskTitle.trim()) return
    const due = newTaskDue
      ? Math.floor(new Date(newTaskDue + 'T00:00:00').getTime() / 1000)
      : undefined
    try {
      const task = await createTaskFn({ data: {
        project_id: projectId,
        column_id: colId,
        title: newTaskTitle.trim(),
        priority: newTaskPriority ?? undefined,
        assignee_sub: newTaskAssignee ?? undefined,
        due_date: due,
      }})
      onTasksChange([...tasks, task])
      cancelAddTask()
      toast.success('Tarea creada')
    } catch {
      toast.error('Error al crear tarea')
    }
  }

  // ── Column actions ───────────────────────────────────────────────────────────

  async function saveColName(colId: number) {
    if (!renameDraft.trim()) { setRenamingCol(null); return }
    try {
      await updateColumnFn({ data: { id: colId, project_id: projectId, name: renameDraft.trim() } })
      onColumnsChange(columns.map((c) => c.id === colId ? { ...c, name: renameDraft.trim() } : c))
      toast.success('Columna renombrada')
    } catch {
      toast.error('Error al renombrar')
    }
    setRenamingCol(null)
  }

  async function changeColColor(colId: number, color: string) {
    try {
      await updateColumnFn({ data: { id: colId, project_id: projectId, color } })
      onColumnsChange(columns.map((c) => c.id === colId ? { ...c, color } : c))
    } catch {
      toast.error('Error al cambiar color')
    }
  }

  async function saveWipLimit(colId: number) {
    const raw = wipDraft[colId]
    const wip_limit = raw && raw.trim() !== '' ? parseInt(raw, 10) : null
    try {
      await updateColumnFn({ data: { id: colId, project_id: projectId, wip_limit } })
      onColumnsChange(columns.map((c) => c.id === colId ? { ...c, wip_limit } : c))
      setColMenu(null)
      toast.success(wip_limit ? `Límite WIP: ${wip_limit}` : 'Límite WIP eliminado')
    } catch {
      toast.error('Error al guardar límite WIP')
    }
  }

  async function deleteCol(col: Column) {
    const colTasks = tasksInCol(col.id)
    if (
      colTasks.length > 0 &&
      !confirm(`¿Eliminar "${col.name}"? Sus ${colTasks.length} tarea(s) se moverán a la primera columna.`)
    ) return
    try {
      await deleteColumnFn({ data: { id: col.id, project_id: projectId } })
      const remaining = columns.filter((c) => c.id !== col.id)
      if (remaining[0] && colTasks.length > 0) {
        onTasksChange(tasks.map((t) => t.column_id === col.id ? { ...t, column_id: remaining[0].id } : t))
      }
      onColumnsChange(remaining)
      toast.success(`Columna "${col.name}" eliminada`)
    } catch {
      toast.error('Error al eliminar columna')
    }
    setColMenu(null)
  }

  return (
    <>
      {/* Backdrop to close column menu */}
      {colMenu !== null && (
        <div className="fixed inset-0 z-40" onClick={() => setColMenu(null)} />
      )}

      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {columns.map((col) => {
          const colTasks = tasksInCol(col.id)
          const wipOver = col.wip_limit != null && colTasks.length > col.wip_limit
          return (
            <div
              key={col.id}
              onDragOver={(e) => onDragOver(e, col.id, null)}
              onDrop={(e) => onDrop(e, col.id)}
              className="flex w-64 flex-shrink-0 flex-col rounded-xl border border-border bg-surface-2"
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: col.color ?? '#6b7280' }}
                  />
                  {renamingCol === col.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => saveColName(col.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveColName(col.id)
                        if (e.key === 'Escape') setRenamingCol(null)
                      }}
                      className="min-w-0 flex-1 rounded border border-brand bg-surface px-1 text-xs font-semibold text-ink outline-none"
                    />
                  ) : (
                    <>
                      <span className="truncate text-xs font-semibold text-ink">{col.name}</span>
                      <span className={`flex-shrink-0 text-xs ${wipOver ? 'font-bold text-red-400' : 'text-muted'}`}>
                        {colTasks.length}{col.wip_limit != null ? `/${col.wip_limit}` : ''}
                      </span>
                    </>
                  )}
                </div>

                {/* Column menu */}
                <div className="relative flex-shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); setColMenu(colMenu === col.id ? null : col.id) }}
                    className="rounded p-0.5 text-muted hover:bg-surface-3 transition-colors"
                  >
                    <MoreHorizontal size={14} />
                  </button>

                  {colMenu === col.id && (
                    <div className="absolute right-0 top-7 z-50 w-52 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
                      {/* Rename */}
                      <button
                        onClick={() => { setRenamingCol(col.id); setRenameDraft(col.name); setColMenu(null) }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-surface-2"
                      >
                        <Pencil size={13} className="text-muted" /> Renombrar
                      </button>

                      {/* Color picker */}
                      <div className="border-t border-border px-3 py-2">
                        <p className="mb-1.5 text-[10px] font-medium text-muted">Color de columna</p>
                        <div className="flex gap-1.5">
                          {COL_COLORS.map((c) => (
                            <button
                              key={c}
                              onClick={() => changeColColor(col.id, c)}
                              className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${col.color === c ? 'scale-110 ring-2 ring-offset-1 ring-ink/30' : ''}`}
                              style={{ background: c }}
                            />
                          ))}
                        </div>
                      </div>

                      {/* WIP limit */}
                      <div className="border-t border-border px-3 py-2">
                        <label className="text-[10px] font-medium text-muted">Límite WIP</label>
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={99}
                            value={wipDraft[col.id] ?? col.wip_limit ?? ''}
                            onChange={(e) => setWipDraft((prev) => ({ ...prev, [col.id]: e.target.value }))}
                            placeholder="Sin límite"
                            className="w-20 rounded border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand"
                          />
                          <button
                            onClick={() => saveWipLimit(col.id)}
                            className="rounded bg-brand px-2 py-1 text-xs font-semibold text-brand-fg"
                          >
                            OK
                          </button>
                        </div>
                      </div>

                      {/* Delete */}
                      <div className="border-t border-border">
                        <button
                          onClick={() => deleteCol(col)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                        >
                          <Trash2 size={13} /> Eliminar columna
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Tasks */}
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {colTasks.map((task, idx) => (
                  <div
                    key={task.id}
                    onDragOver={(e) => onDragOver(e, col.id, task.position)}
                    onDrop={(e) => onDrop(e, col.id)}
                  >
                    <motion.div
                      layout
                      layoutId={`task-${task.id}`}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    >
                      <TaskCard
                        projectName={projectName}
                        onAskAgent={onAskAgent}
                        task={task}
                        members={members}
                        onClick={() => onTaskClick(task)}
                        draggable={canEdit}
                        onDragStart={(e) => onDragStart(e, task)}
                        onDragEnd={onDragEnd}
                        isDragging={draggingId === task.id}
                      />
                    </motion.div>
                    {draggingId != null && draggingId !== task.id && idx === colTasks.length - 1 && (
                      <div
                        onDragOver={(e) => onDragOver(e, col.id, null)}
                        className="mt-2 h-10 rounded-xl border-2 border-dashed border-brand/30"
                      />
                    )}
                  </div>
                ))}

                {colTasks.length === 0 && draggingId != null && (
                  <div className="h-16 rounded-xl border-2 border-dashed border-brand/30" />
                )}
              </div>

              {/* Add task */}
              <div className="px-2 pb-2">
                {addingTaskCol === col.id ? (
                  <div className="space-y-2 rounded-xl border border-border bg-surface p-3 shadow-sm">
                    <input
                      autoFocus
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) addTask(col.id)
                        if (e.key === 'Escape') cancelAddTask()
                      }}
                      placeholder="Título de la tarea…"
                      className="w-full bg-transparent text-sm font-medium text-ink outline-none placeholder:text-muted"
                    />

                    {/* Priority chips */}
                    <div className="flex flex-wrap gap-1">
                      {PRIORITY_OPTIONS.map((p) => (
                        <button
                          key={p.value}
                          onClick={() => setNewTaskPriority(newTaskPriority === p.value ? null : p.value)}
                          className="rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors"
                          style={
                            newTaskPriority === p.value
                              ? { background: p.color, borderColor: p.color, color: '#fff' }
                              : { background: 'transparent', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }
                          }
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    {/* Assignee + Due date */}
                    <div className="flex gap-2">
                      <select
                        value={newTaskAssignee ?? ''}
                        onChange={(e) => setNewTaskAssignee(e.target.value || null)}
                        className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand"
                      >
                        <option value="">Sin asignar</option>
                        {members.map((m) => (
                          <option key={m.sub} value={m.sub}>{m.name}</option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={newTaskDue}
                        onChange={(e) => setNewTaskDue(e.target.value)}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand"
                      />
                    </div>

                    <div className="flex gap-1.5 pt-0.5">
                      <button
                        onClick={() => addTask(col.id)}
                        disabled={!newTaskTitle.trim()}
                        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg disabled:opacity-50"
                      >
                        Añadir
                      </button>
                      <button onClick={cancelAddTask} className="px-2 text-xs text-muted hover:text-ink">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingTaskCol(col.id)}
                    className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface-3 hover:text-ink transition-colors"
                  >
                    <Plus size={12} />
                    Añadir tarea
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {/* Add column */}
        <div className="w-48 flex-shrink-0">
          {addingCol ? (
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <input
                autoFocus
                value={colName}
                onChange={(e) => setColName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addColumn()
                  if (e.key === 'Escape') { setAddingCol(false); setColName('') }
                }}
                placeholder="Nombre de columna…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
              />
              <div className="mt-2 flex gap-1">
                <button onClick={addColumn} className="rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-brand-fg">
                  Crear
                </button>
                <button onClick={() => { setAddingCol(false); setColName('') }} className="px-2 text-xs text-muted hover:text-ink">
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingCol(true)}
              className="flex w-full items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted hover:border-brand hover:text-brand transition-colors"
            >
              <Plus size={13} />
              Nueva columna
            </button>
          )}
        </div>
      </div>
    </>
  )
}
