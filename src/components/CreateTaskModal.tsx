import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { createTaskFn } from '../server/tasks'
import { registerModalEsc } from '../utils/modal-esc'
import type { Column, Task } from '../server/projects'

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgente', color: '#ef4444' },
  { value: 'high', label: 'Alta', color: '#f97316' },
  { value: 'medium', label: 'Media', color: '#eab308' },
  { value: 'low', label: 'Baja', color: '#60a5fa' },
]

export function CreateTaskModal({
  open,
  onClose,
  projectId,
  columns,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  projectId: number
  columns: Column[]
  onCreated: (task: Task) => void
}) {
  const [title, setTitle] = useState('')
  const [columnId, setColumnId] = useState<number>(0)
  const [priority, setPriority] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setPriority(null)
      setColumnId(columns[0]?.id ?? 0)
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    return registerModalEsc(onClose)
  }, [open, onClose])

  async function submit() {
    const t = title.trim()
    if (!t || !columnId) return
    setBusy(true)
    try {
      const task = await createTaskFn({ data: {
        project_id: projectId,
        column_id: columnId,
        title: t,
        priority: priority ?? undefined,
      } })
      onCreated(task)
      toast.success('Tarea creada')
      onClose()
    } catch (e) {
      toast.error((e as Error).message ?? 'Error al crear tarea')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-ink">Nueva tarea</h2>
              <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-3 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <input
                ref={inputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                placeholder="Título de la tarea…"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-brand focus:ring-1 focus:ring-brand"
              />

              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">Columna</p>
                <div className="flex flex-wrap gap-1.5">
                  {columns.map((col) => (
                    <button
                      key={col.id}
                      onClick={() => setColumnId(col.id)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors
                        ${columnId === col.id ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-ink'}`}
                    >
                      <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: col.color ?? '#6b7280' }} />
                      {col.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">Prioridad <span className="font-normal">(opcional)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {PRIORITY_OPTIONS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setPriority(priority === p.value ? null : p.value)}
                      className="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
                      style={
                        priority === p.value
                          ? { background: p.color, borderColor: p.color, color: '#fff' }
                          : { background: 'transparent', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button
                onClick={onClose}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-ink transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={!title.trim() || !columnId || busy}
                className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-brand-fg transition hover:brightness-110 disabled:opacity-50"
              >
                {busy ? 'Creando…' : 'Crear tarea'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
