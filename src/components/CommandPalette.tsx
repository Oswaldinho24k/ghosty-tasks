import { useState, useEffect, useRef, useCallback } from 'react'
import { registerModalEsc } from '../utils/modal-esc'
import { motion } from 'motion/react'
import { Search, LayoutGrid, List, Target, Layers, Rocket, Palette, ArrowRight } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import type { Task, Column, Project } from '../server/projects'

const VIEW_ITEMS = [
  { view: 'board', label: 'Board', icon: LayoutGrid },
  { view: 'list', label: 'Lista', icon: List },
  { view: 'goals', label: 'Goals', icon: Target },
]

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  Rocket, Layers, Target, Palette,
}

type Item =
  | { kind: 'project'; id: number; slug: string; name: string; color: string; icon: string | null }
  | { kind: 'view'; view: string; label: string; icon: React.ComponentType<{ size?: number }> }
  | { kind: 'task'; id: number; title: string; column: string }

export function CommandPalette({
  projects,
  tasks,
  columns,
  slug,
  onClose,
  onTaskClick,
}: {
  projects: Project[]
  tasks: Task[]
  columns: Column[]
  slug: string
  onClose: () => void
  onTaskClick: (id: number) => void
}) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => registerModalEsc(onClose), [onClose])

  const colMap = new Map(columns.map((c) => [c.id, c.name]))

  const items: Item[] = q.trim()
    ? [
        // Projects matching q
        ...projects
          .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
          .map((p): Item => ({ kind: 'project', id: p.id, slug: p.slug, name: p.name, color: p.color, icon: p.icon })),
        // Views matching q
        ...VIEW_ITEMS
          .filter((v) => v.label.toLowerCase().includes(q.toLowerCase()))
          .map((v): Item => ({ kind: 'view', view: v.view, label: v.label, icon: v.icon })),
        // Tasks matching q (current project only)
        ...tasks
          .filter((t) => !t.parent_id && t.title.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 8)
          .map((t): Item => ({ kind: 'task', id: t.id, title: t.title, column: colMap.get(t.column_id) ?? '' })),
      ]
    : [
        // Default: current project views + recent projects
        ...VIEW_ITEMS.map((v): Item => ({ kind: 'view', view: v.view, label: v.label, icon: v.icon })),
        ...projects
          .slice(0, 5)
          .map((p): Item => ({ kind: 'project', id: p.id, slug: p.slug, name: p.name, color: p.color, icon: p.icon })),
      ]

  const boundedCursor = Math.min(cursor, Math.max(0, items.length - 1))

  function selectItem(item: Item) {
    if (item.kind === 'project') {
      navigate({ to: '/p/$slug/board', params: { slug: item.slug } })
    } else if (item.kind === 'view') {
      navigate({ to: `/p/$slug/${item.view}` as '/p/$slug/board', params: { slug } })
    } else if (item.kind === 'task') {
      onTaskClick(item.id)
    }
    onClose()
  }

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      const item = items[boundedCursor]
      if (item) selectItem(item)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }, [items, boundedCursor])

  useEffect(() => {
    setCursor(0)
  }, [q])

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[boundedCursor] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [boundedCursor])

  function renderItem(item: Item, idx: number) {
    const active = idx === boundedCursor
    const base = `flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer ${active ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-surface-2'}`

    if (item.kind === 'project') {
      const Icon = ICON_MAP[item.icon ?? ''] ?? Layers
      return (
        <button key={`p-${item.id}`} onClick={() => selectItem(item)} className={base} onMouseEnter={() => setCursor(idx)}>
          <Icon size={14} color={item.color} />
          <span className="flex-1 truncate">{item.name}</span>
          <span className="text-[10px] text-muted">Proyecto</span>
        </button>
      )
    }

    if (item.kind === 'view') {
      const Icon = item.icon
      return (
        <button key={`v-${item.view}`} onClick={() => selectItem(item)} className={base} onMouseEnter={() => setCursor(idx)}>
          <Icon size={14} />
          <span className="flex-1">{item.label}</span>
          <span className="text-[10px] text-muted">Vista</span>
        </button>
      )
    }

    return (
      <button key={`t-${item.id}`} onClick={() => selectItem(item)} className={base} onMouseEnter={() => setCursor(idx)}>
        <ArrowRight size={13} className="text-muted flex-shrink-0" />
        <span className="flex-1 truncate">{item.title}</span>
        {item.column && <span className="text-[10px] text-muted truncate max-w-[80px]">{item.column}</span>}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search size={16} className="flex-shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar tareas, proyectos o vistas…"
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Sin resultados para "{q}"</p>
          ) : (
            items.map((item, idx) => renderItem(item, idx))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-border px-4 py-2">
          <span className="text-[10px] text-muted">↑↓ navegar</span>
          <span className="text-[10px] text-muted">↵ seleccionar</span>
          <span className="text-[10px] text-muted">Esc cerrar</span>
        </div>
      </motion.div>
    </div>
  )
}
