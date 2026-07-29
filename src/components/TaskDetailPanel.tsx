import { useEffect, useState, useRef } from 'react'
import { X, Check, Plus, Trash2, ChevronDown, ChevronUp, Tag, MessageCircle, Target, Pencil, Layers, Calendar } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { toast } from 'sonner'
import { getTaskDetailFn, updateTaskFn, deleteTaskFn, createTaskFn } from '../server/tasks'
import { addChecklistItemFn, updateChecklistItemFn, deleteChecklistItemFn } from '../server/checklist'
import { getCommentsFn, addCommentFn, updateCommentFn, deleteCommentFn } from '../server/comments'
import type { Comment } from '../server/comments'
import { getTaskLabelsFn, setTaskLabelsFn, getProjectLabelsFn } from '../server/labels'
import type { Label } from '../server/labels'
import { getGoalsFn, linkTaskToGoalFn, unlinkTaskFromGoalFn, getTaskGoalsFn } from '../server/goals'
import { PriorityBadge, PrioritySelect } from './PriorityBadge'
import { MemberAvatar } from './MemberAvatar'
import { useWorkspaceMembers } from '../hooks/useWorkspaceMembers'
import { AssigneePicker } from './AssigneePicker'
import { registerModalEsc } from '../utils/modal-esc'
import { taskRef } from '../utils/taskRef'

type Member = { sub: string; name: string; avatar: string; handle: string; role: string }
type Detail = Awaited<ReturnType<typeof getTaskDetailFn>>

const LABEL_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#06b6d4',
]

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('es', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function TaskDetailPanel({
  taskId,
  projectId,
  members,
  onClose,
  onDeleted,
  onLabelsChange,
  onTaskChanged,
  agentOpen,
  refreshKey,
  projectName,
}: {
  taskId: number
  projectId: number
  members: Member[]
  onClose: () => void
  onDeleted?: (id: number) => void
  onLabelsChange?: (taskId: number, labels: Label[]) => void
  /**
   * Lo que cambió, para la tarjeta del tablero. El panel ya lo sabe: hacerlo esperar al
   * evento SSE dejaba la tarjeta vieja hasta recargar (p. ej. te asignabas una tarea y tu
   * avatar no aparecía). El evento sigue llegando para los DEMÁS.
   */
  onTaskChanged?: (taskId: number, patch: Record<string, unknown>) => void
  /** Con el chat abierto, el detalle se recorre para no taparlo (ni taparse). */
  agentOpen?: boolean
  /** Cambia cuando llega un evento de ESTA tarea (p. ej. el agente le añadió checklist). */
  refreshKey?: number
  projectName?: string
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [newItem, setNewItem] = useState('')
  const [addingItem, setAddingItem] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  // Comments
  const [comments, setComments] = useState<Comment[]>([])
  const [commentDraft, setCommentDraft] = useState('')
  const [sendingComment, setSendingComment] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editCommentDraft, setEditCommentDraft] = useState('')

  // Labels
  const [labels, setLabels] = useState<Label[]>([])
  const [projectLabels, setProjectLabels] = useState<Label[]>([])
  const [showLabelPicker, setShowLabelPicker] = useState(false)
  const [newLabelText, setNewLabelText] = useState('')
  const [newLabelColor, setNewLabelColor] = useState(LABEL_COLORS[0])

  // Goals
  const [taskGoals, setTaskGoals] = useState<{ id: number; title: string; status: string }[]>([])
  const [allGoals, setAllGoals] = useState<{ id: number; title: string; status: string }[]>([])
  const [showGoalPicker, setShowGoalPicker] = useState(false)

  // Subtasks
  const [newSubtask, setNewSubtask] = useState('')
  const [addingSubtask, setAddingSubtask] = useState(false)

  async function load() {
    try {
      const [d, cms, lbls, pLabels, tGoals, goals] = await Promise.all([
        getTaskDetailFn({ data: { id: taskId } }),
        getCommentsFn({ data: { task_id: taskId } }),
        getTaskLabelsFn({ data: { task_id: taskId } }),
        getProjectLabelsFn({ data: { project_id: projectId } }),
        getTaskGoalsFn({ data: { task_id: taskId } }),
        getGoalsFn({ data: { project_id: projectId } }),
      ])
      setDetail(d)
      setTitleDraft(d.task.title)
      setComments(cms)
      setLabels(lbls)
      setProjectLabels(pLabels)
      setTaskGoals(tGoals)
      setAllGoals(goals.map((g) => ({ id: g.id, title: g.title, status: g.status })))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Get current user sub from session (approximate via who created the task on panel open)
    // We use a simple heuristic: the first member who matches — for edit/delete guards we compare server-side
    // Actually we'll rely on the server to enforce ownership; client just shows buttons
  }, [taskId])

  useEffect(() => {
    if (editingTitle && titleRef.current) titleRef.current.focus()
  }, [editingTitle])

  async function saveTitle() {
    if (!detail || !titleDraft.trim()) return
    setEditingTitle(false)
    if (titleDraft === detail.task.title) return
    await updateTaskFn({ data: { id: taskId, project_id: projectId, title: titleDraft } })
    setDetail((d) => d ? { ...d, task: { ...d.task, title: titleDraft } } : d)
    onTaskChanged?.(taskId, { title: titleDraft })
  }

  async function toggleDone() {
    if (!detail) return
    const newStatus = detail.task.status === 'done' ? 'open' : 'done'
    await updateTaskFn({ data: { id: taskId, project_id: projectId, status: newStatus } })
    setDetail((d) => d ? { ...d, task: { ...d.task, status: newStatus } } : d)
    onTaskChanged?.(taskId, { status: newStatus })
  }

  async function changePriority(priority: string | null) {
    if (!detail) return
    await updateTaskFn({ data: { id: taskId, project_id: projectId, priority } })
    setDetail((d) => d ? { ...d, task: { ...d.task, priority } } : d)
    onTaskChanged?.(taskId, { priority })
  }

  async function changeAssignee(sub: string | null) {
    if (!detail) return
    await updateTaskFn({ data: { id: taskId, project_id: projectId, assignee_sub: sub } })
    setDetail((d) => d ? { ...d, task: { ...d.task, assignee_sub: sub } } : d)
    onTaskChanged?.(taskId, { assignee_sub: sub })
  }

  async function addItem() {
    if (!newItem.trim() || !detail) return
    setAddingItem(true)
    const item = await addChecklistItemFn({ data: { task_id: taskId, body: newItem.trim() } })
    setDetail((d) => d ? { ...d, checklist: [...d.checklist, item] } : d)
    setNewItem('')
    setAddingItem(false)
  }

  async function toggleItem(id: number, done: boolean) {
    await updateChecklistItemFn({ data: { id, task_id: taskId, done } })
    setDetail((d) => d ? { ...d, checklist: d.checklist.map((c) => c.id === id ? { ...c, done } : c) } : d)
  }

  async function removeItem(id: number) {
    await deleteChecklistItemFn({ data: { id, task_id: taskId } })
    setDetail((d) => d ? { ...d, checklist: d.checklist.filter((c) => c.id !== id) } : d)
  }

  async function handleDelete() {
    setConfirmArchive(false)
    try {
      await deleteTaskFn({ data: { id: taskId, project_id: projectId } })
      onDeleted?.(taskId)
      onClose()
    } catch {
      toast.error('No se pudo archivar la tarea')
    }
  }

  // --- Comments ---
  async function sendComment() {
    if (!commentDraft.trim()) return
    setSendingComment(true)
    try {
      const c = await addCommentFn({ data: { task_id: taskId, body: commentDraft.trim() } })
      setComments((prev) => [...prev, c])
      setCommentDraft('')
    } catch {
      toast.error('Error al enviar comentario')
    } finally {
      setSendingComment(false)
    }
  }

  async function saveEditComment(id: number) {
    if (!editCommentDraft.trim()) return
    const c = await updateCommentFn({ data: { id, task_id: taskId, body: editCommentDraft.trim() } })
    setComments((prev) => prev.map((cm) => cm.id === id ? c : cm))
    setEditingCommentId(null)
  }

  async function deleteComment(id: number) {
    await deleteCommentFn({ data: { id, task_id: taskId } })
    setComments((prev) => prev.filter((c) => c.id !== id))
  }

  // --- Labels ---
  async function removeLabel(label: string) {
    const updated = labels.filter((l) => l.label !== label)
    await setTaskLabelsFn({ data: { task_id: taskId, labels: updated } })
    setLabels(updated)
    onLabelsChange?.(taskId, updated)
  }

  /** Renombra o recolorea una etiqueta de esta tarea. */
  async function editLabel(oldLabel: string, label: string, color: string) {
    const updated = labels.map((l) => (l.label === oldLabel ? { label, color } : l))
    await setTaskLabelsFn({ data: { task_id: taskId, labels: updated } })
    setLabels(updated)
    onLabelsChange?.(taskId, updated)
    setEditingLabel(null)
  }

  async function addLabel(label: string, color: string) {
    if (labels.find((l) => l.label === label)) return
    const updated = [...labels, { label, color }]
    await setTaskLabelsFn({ data: { task_id: taskId, labels: updated } })
    setLabels(updated)
    onLabelsChange?.(taskId, updated)
    // Update project labels cache
    if (!projectLabels.find((l) => l.label === label)) {
      setProjectLabels((prev) => [...prev, { label, color }])
    }
  }

  async function addNewLabel() {
    if (!newLabelText.trim()) return
    try {
      await addLabel(newLabelText.trim(), newLabelColor)
      setNewLabelText('')
      setNewLabelColor(LABEL_COLORS[0])
      toast.success('Label agregada')
    } catch (e) {
      // El mensaje real, no un genérico: "Error al agregar label" no dice si fue permiso,
      // sesión caída o la DB, y obliga a ir al log del servidor para cada reporte.
      toast.error((e as Error)?.message || 'No se pudo agregar la etiqueta')
    }
  }

  // --- Goals ---
  // --- Due date ---
  function tsToDateStr(ts: number | null): string {
    if (!ts) return ''
    return new Date(ts * 1000).toISOString().slice(0, 10)
  }
  async function changeDueDate(dateStr: string) {
    const ts = dateStr ? Math.floor(new Date(dateStr + 'T00:00:00').getTime() / 1000) : null
    await updateTaskFn({ data: { id: taskId, project_id: projectId, due_date: ts } })
    setDetail((d) => d ? { ...d, task: { ...d.task, due_date: ts } } : d)
    onTaskChanged?.(taskId, { due_date: ts })
  }

  // --- Subtasks ---
  async function addSubtask() {
    if (!newSubtask.trim() || !detail) return
    setAddingSubtask(true)
    try {
      const sub = await createTaskFn({ data: {
        project_id: projectId,
        column_id: detail.task.column_id,
        title: newSubtask.trim(),
        parent_id: taskId,
      }})
      setDetail((d) => d ? { ...d, subtasks: [...d.subtasks, sub] } : d)
      setNewSubtask('')
    } catch {
      toast.error('Error al crear subtarea')
    } finally {
      setAddingSubtask(false)
    }
  }
  async function toggleSubtask(id: number, currentStatus: string) {
    const newStatus = currentStatus === 'done' ? 'open' : 'done'
    await updateTaskFn({ data: { id, project_id: projectId, status: newStatus } })
    setDetail((d) => d ? { ...d, subtasks: d.subtasks.map((s) => s.id === id ? { ...s, status: newStatus } : s) } : d)
  }
  async function deleteSubtask(id: number) {
    await deleteTaskFn({ data: { id, project_id: projectId } })
    setDetail((d) => d ? { ...d, subtasks: d.subtasks.filter((s) => s.id !== id) } : d)
  }

  async function linkGoal(goalId: number) {
    await linkTaskToGoalFn({ data: { goal_id: goalId, task_id: taskId, project_id: projectId } })
    const goal = allGoals.find((g) => g.id === goalId)
    if (goal) setTaskGoals((prev) => [...prev, goal])
    setShowGoalPicker(false)
  }

  async function unlinkGoal(goalId: number) {
    await unlinkTaskFromGoalFn({ data: { goal_id: goalId, task_id: taskId, project_id: projectId } })
    setTaskGoals((prev) => prev.filter((g) => g.id !== goalId))
  }

  // A quién se puede asignar DESDE LA UI: los del tablero. Traer a alguien de fuera es
  // capacidad del agente ("mete a Oscar"), para que esta lista no sea el workspace entero.
  const assignables = members
  // Para PINTAR (autor de un comentario, avatar de una actividad) sí hace falta el equipo
  // completo: alguien que ya no participa no debe quedar sin cara.
  const team = useWorkspaceMembers(taskId != null)

  // Esc cierra, como cualquier otro panel de la app.
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [editingLabel, setEditingLabel] = useState<string | null>(null)

  useEffect(() => registerModalEsc(onClose), [onClose])

  // Recargar cuando algo cambió esta tarea desde fuera (el agente, otra persona).
  useEffect(() => {
    if (refreshKey) load()
  }, [refreshKey])
  const everyone = team.length ? [...team, ...members.filter((m) => !team.some((t) => t.sub === m.sub))] : members
  const nameOf = (sub: string | null) => (sub ? everyone.find((m) => m.sub === sub)?.name ?? sub.slice(0, 8) : '')
  const assignee = detail ? everyone.find((m) => m.sub === detail.task.assignee_sub) : null
  const doneCount = detail?.checklist.filter((c) => c.done).length ?? 0
  const totalCount = detail?.checklist.length ?? 0
  const linkedGoalIds = new Set(taskGoals.map((g) => g.id))
  const unlinkableGoals = allGoals.filter((g) => !linkedGoalIds.has(g.id))

  return (
    <>
    {/* Clic fuera cierra el detalle. Va DEBAJO del chat del agente (z-40) a propósito:
        tocar el chat no debe cerrarte la tarea que estás mirando, y perder lo que estás
        escribiendo ahí sería peor. */}
    <div className="fixed inset-0 z-20" onClick={onClose} />
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      // Detrás del chat del agente, y recorrido a la izquierda cuando está abierto: así
      // se ven los dos y el chat manda (es donde estás escribiendo).
      className={`fixed inset-y-0 z-30 flex w-full max-w-lg flex-col border-l border-border bg-surface shadow-xl ${
        agentOpen ? 'right-0 sm:right-[24rem]' : 'right-0'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleDone}
            disabled={loading}
            className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors
              ${detail?.task.status === 'done' ? 'border-brand bg-brand text-brand-fg' : 'border-border hover:border-brand'}`}
          >
            {detail?.task.status === 'done' && <Check size={11} />}
          </button>
          {/* La misma referencia que se ve en la tarjeta y con la que le hablas al agente. */}
          <span className="font-mono text-xs text-muted">{projectName ? taskRef(projectName, taskId) : `#${taskId}`}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setConfirmArchive(true)} className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-500 transition-colors">
            <Trash2 size={15} />
          </button>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-3 transition-colors">
            <X size={17} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-6 w-2/3 rounded bg-surface-3" />
            <div className="h-4 w-1/2 rounded bg-surface-3" />
          </div>
        ) : detail ? (
          <>
            {/* Title */}
            <div>
              {editingTitle ? (
                <input
                  ref={titleRef}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setEditingTitle(false); setTitleDraft(detail.task.title) } }}
                  className="w-full rounded-lg border border-brand bg-surface px-2 py-1 text-base font-semibold text-ink outline-none"
                />
              ) : (
                <h2
                  onClick={() => setEditingTitle(true)}
                  className={`cursor-text text-base font-semibold text-ink leading-snug hover:text-brand transition-colors
                    ${detail.task.status === 'done' ? 'line-through text-muted' : ''}`}
                >
                  {detail.task.title}
                </h2>
              )}
            </div>

            {/* Meta */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-xs text-muted font-medium">Prioridad</p>
                <PrioritySelect value={detail.task.priority} onChange={changePriority} />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted font-medium">Asignado a</p>
                <AssigneePicker
                  value={detail.task.assignee_sub ?? null}
                  members={assignables}
                  onChange={changeAssignee}
                />
              </div>
            </div>

            {/* Due date */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                {/* Es un vencimiento: sin nombre, un campo de fecha suelto no dice si es
                    cuándo empieza, cuándo vence o cuándo se creó. */}
                <Calendar size={13} className="text-muted flex-shrink-0" />
                <span className="text-xs text-muted">Vence</span>
                <input
                  type="date"
                  value={tsToDateStr(detail.task.due_date)}
                  onChange={(e) => changeDueDate(e.target.value)}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand"
                />
              </div>
              {detail.task.due_date && (
                <button
                  onClick={() => changeDueDate('')}
                  className="text-xs text-muted hover:text-red-400 transition-colors"
                  title="Quitar fecha"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {assignee && (
              <div className="flex items-center gap-2">
                <MemberAvatar name={assignee.name} avatar={assignee.avatar} size={28} />
                <span className="text-sm text-ink">{assignee.name}</span>
                <PriorityBadge priority={detail.task.priority} showLabel />
              </div>
            )}

            {/* Description */}
            <div>
              <button
                onClick={() => setDescExpanded((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink mb-2"
              >
                {descExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                Descripción
              </button>
              {descExpanded && (
                <textarea
                  defaultValue={detail.task.description ?? ''}
                  onBlur={async (e) => {
                    await updateTaskFn({ data: { id: taskId, project_id: projectId, description: e.target.value } })
                    setDetail((d) => d ? { ...d, task: { ...d.task, description: e.target.value } } : d)
                  }}
                  rows={4}
                  placeholder="Agrega contexto, links, notas…"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand resize-none"
                />
              )}
            </div>

            {/* Labels */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1 text-xs font-medium text-muted">
                  <Tag size={12} />
                  Labels
                </span>
                <button
                  onClick={() => setShowLabelPicker((v) => !v)}
                  className="text-xs text-brand hover:underline"
                >
                  + Agregar
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((l) =>
                  editingLabel === l.label ? (
                    // Editar en el sitio: cambiar el texto o el color no debería obligar a
                    // borrarla y volver a crearla (perdiendo el color que ya tenía).
                    <span key={l.label} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5">
                      <input
                        autoFocus
                        defaultValue={l.label}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const v = (e.target as HTMLInputElement).value.trim()
                            if (v) editLabel(l.label, v, l.color)
                          }
                          if (e.key === 'Escape') setEditingLabel(null)
                        }}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v && v !== l.label) editLabel(l.label, v, l.color)
                          else setEditingLabel(null)
                        }}
                        className="w-24 bg-transparent text-xs text-ink outline-none"
                      />
                      {LABEL_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => editLabel(l.label, l.label, c)}
                          title="Cambiar color"
                          className={`h-3 w-3 rounded-full ${c === l.color ? 'ring-2 ring-offset-1 ring-brand' : ''}`}
                          style={{ background: c }}
                        />
                      ))}
                    </span>
                  ) : (
                    <span
                      key={l.label}
                      className="group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                      style={{ background: l.color }}
                    >
                      <button onClick={() => setEditingLabel(l.label)} title="Editar etiqueta">
                        {l.label}
                      </button>
                      <button onClick={() => removeLabel(l.label)} className="opacity-0 transition-opacity group-hover:opacity-100">
                        <X size={10} />
                      </button>
                    </span>
                  )
                )}
              </div>
              {showLabelPicker && (
                <div className="mt-2 rounded-lg border border-border bg-surface-2 p-3 space-y-3">
                  {/* Existing project labels */}
                  {projectLabels.filter((l) => !labels.find((lx) => lx.label === l.label)).length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted font-medium mb-1.5">Labels del proyecto</p>
                      <div className="flex flex-wrap gap-1.5">
                        {projectLabels
                          .filter((l) => !labels.find((lx) => lx.label === l.label))
                          .map((l) => (
                            <button
                              key={l.label}
                              onClick={() => addLabel(l.label, l.color)}
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white hover:opacity-80"
                              style={{ background: l.color }}
                            >
                              {l.label}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                  {/* Create new label */}
                  <div>
                    <p className="text-[10px] text-muted font-medium mb-1.5">Nueva label</p>
                    <div className="flex gap-2 items-center">
                      <input
                        value={newLabelText}
                        onChange={(e) => setNewLabelText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addNewLabel()}
                        placeholder="Nombre…"
                        className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand"
                      />
                      <div className="flex gap-1">
                        {LABEL_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setNewLabelColor(c)}
                            className={`h-4 w-4 rounded-full transition-transform ${newLabelColor === c ? 'scale-125 ring-2 ring-offset-1 ring-ink/30' : ''}`}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                      <button
                        onClick={addNewLabel}
                        disabled={!newLabelText.trim()}
                        className="rounded-md bg-brand px-2 py-1 text-xs font-semibold text-brand-fg disabled:opacity-50"
                      >
                        OK
                      </button>
                    </div>
                  </div>
                  <button onClick={() => setShowLabelPicker(false)} className="text-xs text-muted hover:text-ink">
                    Cerrar
                  </button>
                </div>
              )}
            </div>

            {/* Goals */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1 text-xs font-medium text-muted">
                  <Target size={12} />
                  Goals
                </span>
                {unlinkableGoals.length > 0 && (
                  <button
                    onClick={() => setShowGoalPicker((v) => !v)}
                    className="text-xs text-brand hover:underline"
                  >
                    + Vincular
                  </button>
                )}
              </div>
              {taskGoals.length === 0 && !showGoalPicker && (
                <p className="text-xs text-muted italic">Sin objetivo</p>
              )}
              <div className="space-y-1">
                {taskGoals.map((g) => (
                  <div key={g.id} className="group flex items-center justify-between rounded-lg px-2 py-1 bg-surface-2">
                    <span className="text-xs text-ink">{g.title}</span>
                    <div className="flex items-center gap-1">
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-medium ${g.status === 'done' ? 'bg-brand/10 text-brand' : 'bg-surface-3 text-muted'}`}>
                        {g.status === 'done' ? 'Completado' : 'Abierto'}
                      </span>
                      <button
                        onClick={() => unlinkGoal(g.id)}
                        className="hidden group-hover:block text-muted hover:text-red-400 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {showGoalPicker && unlinkableGoals.length > 0 && (
                <div className="mt-2 rounded-lg border border-border bg-surface-2 p-2 space-y-1">
                  {unlinkableGoals.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => linkGoal(g.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs text-ink hover:bg-surface-3"
                    >
                      <Target size={11} className="text-muted flex-shrink-0" />
                      {g.title}
                    </button>
                  ))}
                  <button onClick={() => setShowGoalPicker(false)} className="text-xs text-muted hover:text-ink px-2">
                    Cancelar
                  </button>
                </div>
              )}
            </div>

            {/* Checklist */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted">
                  Checklist {totalCount > 0 && `(${doneCount}/${totalCount})`}
                </span>
                {totalCount > 0 && (
                  <div className="h-1 flex-1 mx-3 rounded-full bg-surface-3 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand transition-all"
                      style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1">
                {detail.checklist.map((item) => (
                  <div key={item.id} className="group flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2">
                    <button
                      onClick={() => toggleItem(item.id, !item.done)}
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors
                        ${item.done ? 'border-brand bg-brand text-brand-fg' : 'border-border hover:border-brand'}`}
                    >
                      {item.done && <Check size={10} />}
                    </button>
                    <span className={`flex-1 text-sm ${item.done ? 'line-through text-muted' : 'text-ink'}`}>
                      {item.body}
                    </span>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="hidden text-muted group-hover:block hover:text-red-400 transition-colors"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addItem()}
                  placeholder="Añadir ítem…"
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand"
                />
                <button
                  onClick={addItem}
                  disabled={!newItem.trim() || addingItem}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg disabled:opacity-50"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {/* Subtasks */}
            <div>
              <p className="flex items-center gap-1 mb-2 text-xs font-medium text-muted">
                <Layers size={12} />
                Subtareas
                {detail.subtasks.length > 0 && (
                  <span className="ml-1">
                    ({detail.subtasks.filter((s) => s.status === 'done').length}/{detail.subtasks.length})
                  </span>
                )}
              </p>
              <div className="space-y-1">
                {detail.subtasks.map((sub) => (
                  <div key={sub.id} className="group flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2">
                    <button
                      onClick={() => toggleSubtask(sub.id, sub.status)}
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors
                        ${sub.status === 'done' ? 'border-brand bg-brand text-brand-fg' : 'border-border hover:border-brand'}`}
                    >
                      {sub.status === 'done' && <Check size={10} />}
                    </button>
                    <span className={`flex-1 text-sm ${sub.status === 'done' ? 'line-through text-muted' : 'text-ink'}`}>
                      {sub.title}
                    </span>
                    <button
                      onClick={() => deleteSubtask(sub.id)}
                      className="hidden group-hover:block text-muted hover:text-red-400 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addSubtask()}
                  placeholder="Añadir subtarea…"
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-brand"
                />
                <button
                  onClick={addSubtask}
                  disabled={!newSubtask.trim() || addingSubtask}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg disabled:opacity-50"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {/* Comments */}
            <div>
              <p className="flex items-center gap-1 mb-3 text-xs font-medium text-muted">
                <MessageCircle size={12} />
                Comentarios {comments.length > 0 && `(${comments.length})`}
              </p>
              <div className="space-y-3">
                {comments.map((c) => {
                  const author = everyone.find((m) => m.sub === c.sender_sub)
                  return (
                    <div key={c.id} className="group flex gap-2">
                      <MemberAvatar name={c.sender_name} avatar={c.avatar ?? author?.avatar ?? ''} size={24} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-medium text-ink">{c.sender_name}</span>
                          <span className="text-[10px] text-muted">{fmtTime(c.created_at)}</span>
                          {c.edited_at && <span className="text-[10px] text-muted">(editado)</span>}
                        </div>
                        {editingCommentId === c.id ? (
                          <div className="space-y-1">
                            <textarea
                              autoFocus
                              value={editCommentDraft}
                              onChange={(e) => setEditCommentDraft(e.target.value)}
                              rows={2}
                              className="w-full rounded-lg border border-brand bg-surface px-2 py-1.5 text-sm text-ink outline-none resize-none"
                            />
                            <div className="flex gap-1">
                              <button
                                onClick={() => saveEditComment(c.id)}
                                className="rounded bg-brand px-2 py-0.5 text-xs font-semibold text-brand-fg"
                              >
                                Guardar
                              </button>
                              <button
                                onClick={() => setEditingCommentId(null)}
                                className="text-xs text-muted hover:text-ink"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-ink whitespace-pre-wrap break-words">{c.body}</p>
                        )}
                        <div className="mt-0.5 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => { setEditingCommentId(c.id); setEditCommentDraft(c.body) }}
                            className="flex items-center gap-0.5 text-[10px] text-muted hover:text-ink"
                          >
                            <Pencil size={9} /> Editar
                          </button>
                          <button
                            onClick={() => deleteComment(c.id)}
                            className="flex items-center gap-0.5 text-[10px] text-muted hover:text-red-400"
                          >
                            <Trash2 size={9} /> Eliminar
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* New comment input */}
              <div className="mt-3 flex gap-2">
                <textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment() } }}
                  placeholder="Escribe un comentario… (Enter para enviar)"
                  rows={2}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand resize-none"
                />
                <button
                  onClick={sendComment}
                  disabled={!commentDraft.trim() || sendingComment}
                  className="self-end rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg disabled:opacity-50"
                >
                  Enviar
                </button>
              </div>
            </div>

            {/* Activity */}
            {detail.activities.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted">Actividad</p>
                <div className="space-y-1">
                  {detail.activities.map((a) => {
                    const m = everyone.find((mb) => mb.sub === a.user_sub)
                    return (
                      <div key={a.id} className="flex items-start gap-2 text-xs text-muted">
                        {m && <MemberAvatar name={m.name} avatar={m.avatar} size={16} />}
                        <span>{m?.name ?? 'Alguien'} {activityLabel(a.action, a.old_val, a.new_val, nameOf)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    {confirmArchive && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmArchive(false)}>
          <div className="w-full max-w-xs rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-ink">¿Archivar esta tarea?</h3>
            <p className="mt-1.5 text-sm text-muted">
              Sale del tablero pero no se pierde: conserva comentarios, checklist y bitácora,
              y se puede recuperar.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmArchive(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-muted transition hover:bg-surface-3 hover:text-ink"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-fg transition hover:brightness-110"
              >
                Archivar
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
    </>
  )
}

function activityLabel(
  action: string,
  _old: string | null,
  newVal: string | null,
  nameOf: (sub: string | null) => string
): string {
  switch (action) {
    case 'created': return 'creó la tarea'
    case 'moved': return `movió la tarea`
    // El valor guardado es el `sub`: mostrarlo crudo ("asignó a cms5aafs0…") no le dice
    // nada a nadie.
    case 'assigned': return newVal ? `asignó a ${nameOf(newVal)}` : 'quitó el asignado'
    case 'archived': return 'archivó la tarea'
    case 'restored': return 'restauró la tarea'
    case 'priority_changed': return newVal ? `cambió la prioridad a ${newVal}` : 'quitó la prioridad'
    case 'status_changed': return `cambió el estado a ${newVal}`
    default: return action
  }
}

export { AnimatePresence }
