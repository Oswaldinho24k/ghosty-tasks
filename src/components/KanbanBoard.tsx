import { useState, useEffect } from 'react'
import { Plus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import type { Task, Column } from '../server/projects'
import { createTaskFn, moveTaskFn } from '../server/tasks'
import { createColumnFn, updateColumnFn, deleteColumnFn } from '../server/columns'
import { TaskCard } from './TaskCard'
import { useProject } from '../utils/projectContext'
import { PRIORITIES as PRIORITY_OPTIONS } from '../utils/priority'

type Member = { sub: string; name: string; avatar: string; handle: string; role: string }

const COL_COLORS = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6b7280', '#0ea5e9']

// ── Componente interno: tarea arrastrable ────────────────────────────────────

function SortableTaskCard({
  task,
  members,
  projectName,
  onAskAgent,
  canEdit,
  onClick,
}: {
  task: Task
  members: Member[]
  projectName: string
  onAskAgent?: (ref: string) => void
  canEdit: boolean
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: 'none',
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...(canEdit ? listeners : {})}
    >
      <TaskCard
        task={task}
        members={members}
        projectName={projectName}
        onAskAgent={onAskAgent}
        onClick={onClick}
        isDragging={isDragging}
      />
    </div>
  )
}

// ── Componente interno: columna vacía (zona de drop) ─────────────────────────

function DroppableEmptyCol({ colId }: { colId: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${colId}` })
  return (
    <div
      ref={setNodeRef}
      className={`h-16 rounded-xl border-2 border-dashed transition-colors ${
        isOver ? 'border-brand bg-brand/5' : 'border-border/30'
      }`}
    />
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

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
  const { canEdit, projectName, onAskAgent } = useProject()

  // Estado local de tareas durante el drag (para preview inmediato)
  const [localTasks, setLocalTasks] = useState(tasks)
  useEffect(() => {
    // No sobreescribir mientras se está arrastrando (evita que un SSE cancele el drag)
    if (!activeTask) setLocalTasks(tasks)
  }, [tasks])

  const [activeTask, setActiveTask] = useState<Task | null>(null)
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

  // ── Sensores dnd-kit ──────────────────────────────────────────────────────
  const sensors = useSensors(
    // Mouse/trackpad: activar tras 8px de movimiento (evita drag accidental en click)
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Touch: long press 250ms (no interfiere con el scroll de columnas)
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  function tasksInCol(colId: number): Task[] {
    return localTasks.filter((t) => t.column_id === colId && !t.parent_id).sort((a, b) => a.position - b.position)
  }

  // ── Handlers DnD ─────────────────────────────────────────────────────────

  function handleDragStart({ active }: DragStartEvent) {
    setActiveTask(localTasks.find((t) => t.id === active.id) ?? null)
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over || active.id === over.id) return
    const dragged = localTasks.find((t) => t.id === active.id)
    if (!dragged) return

    const overId = over.id.toString()
    const targetColId = overId.startsWith('col-')
      ? parseInt(overId.replace('col-', ''))
      : localTasks.find((t) => t.id === over.id)?.column_id

    if (!targetColId || targetColId === dragged.column_id) return

    // Cross-column: mover tarea en estado local para el preview
    setLocalTasks((prev) => {
      const overTask = prev.find((t) => t.id === over.id)
      const overColTasks = prev
        .filter((t) => t.column_id === targetColId && !t.parent_id)
        .sort((a, b) => a.position - b.position)
      const insertAtPos = overTask?.position
        ?? ((overColTasks[overColTasks.length - 1]?.position ?? 0) + 1000)
      return prev.map((t) =>
        t.id === active.id ? { ...t, column_id: targetColId, position: insertAtPos - 0.5 } : t,
      )
    })
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    const moved = localTasks.find((t) => t.id === active.id)
    setActiveTask(null)

    if (!over || !moved) {
      setLocalTasks(tasks)
      return
    }

    const colId = moved.column_id
    const colTasks = localTasks
      .filter((t) => t.column_id === colId && !t.parent_id)
      .sort((a, b) => a.position - b.position)
    const idx = colTasks.findIndex((t) => t.id === active.id)
    const prevPos = idx > 0 ? colTasks[idx - 1].position : null
    const nextPos = idx < colTasks.length - 1 ? colTasks[idx + 1].position : null

    onTasksChange(localTasks)

    try {
      await moveTaskFn({
        data: {
          id: active.id as number,
          project_id: projectId,
          column_id: colId,
          prev_position: prevPos,
          next_position: nextPos,
        },
      })
    } catch {
      toast.error('Error al mover la tarea')
      setLocalTasks(tasks)
    }
  }

  // ── Column actions ────────────────────────────────────────────────────────

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
      const task = await createTaskFn({
        data: {
          project_id: projectId,
          column_id: colId,
          title: newTaskTitle.trim(),
          priority: newTaskPriority ?? undefined,
          assignee_sub: newTaskAssignee ?? undefined,
          due_date: due,
        },
      })
      onTasksChange([...tasks, task])
      cancelAddTask()
      toast.success('Tarea creada')
    } catch {
      toast.error('Error al crear tarea')
    }
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {colMenu !== null && (
        <div className="fixed inset-0 z-40" onClick={() => setColMenu(null)} />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full gap-3 overflow-x-auto p-4">
          {columns.map((col) => {
            const colTasks = tasksInCol(col.id)
            const wipOver = col.wip_limit != null && colTasks.length > col.wip_limit
            return (
              <div
                key={col.id}
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
                        <button
                          onClick={() => { setRenamingCol(col.id); setRenameDraft(col.name); setColMenu(null) }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-surface-2"
                        >
                          <Pencil size={13} className="text-muted" /> Renombrar
                        </button>

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
                <SortableContext items={colTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                    {colTasks.map((task) => (
                      <motion.div
                        key={task.id}
                        layout
                        layoutId={`task-${task.id}`}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      >
                        <SortableTaskCard
                          task={task}
                          members={members}
                          projectName={projectName}
                          onAskAgent={onAskAgent}
                          canEdit={canEdit}
                          onClick={() => onTaskClick(task)}
                        />
                      </motion.div>
                    ))}
                    {colTasks.length === 0 && (
                      <DroppableEmptyCol colId={col.id} />
                    )}
                  </div>
                </SortableContext>

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

        {/* Overlay: la tarjeta que sigue al cursor/dedo mientras se arrastra */}
        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="rotate-1 shadow-2xl">
              <TaskCard
                task={activeTask}
                members={members}
                projectName={projectName}
                onAskAgent={onAskAgent}
                onClick={() => {}}
                isDragging={false}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </>
  )
}
