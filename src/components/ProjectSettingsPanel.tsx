import { useEffect, useRef, useState } from 'react'
import { X, Trash2, Users, UserMinus, Bot, ChevronDown, Search } from 'lucide-react'
import { motion } from 'motion/react'
import { registerModalEsc } from '../utils/modal-esc'
import { Rocket, Layers, Target, Palette } from 'lucide-react'
import { toast } from 'sonner'
import { updateProjectFn } from '../server/projects'
import type { Project } from '../server/projects'
import { removeProjectMemberFn } from '../server/members'
import { MemberAvatar } from './MemberAvatar'
import { WorkspaceMembersModal } from './WorkspaceMembersModal'
import { getBoardInstructionsFn, setBoardInstructionsFn, baseInstructionsFn } from '../server/agent'

type Member = { sub: string; name: string; avatar: string; handle: string; role: string }

const PROJECT_ICONS = [
  { name: 'Rocket', icon: Rocket },
  { name: 'Layers', icon: Layers },
  { name: 'Target', icon: Target },
  { name: 'Palette', icon: Palette },
]

const PROJECT_COLORS = [
  '#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899',
]

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  Rocket, Layers, Target, Palette,
}

export function ProjectSettingsPanel({
  project,
  members,
  isOwner,
  currentSub,
  onClose,
  onProjectUpdated,
  onMemberRemoved,
}: {
  project: Project
  members: Member[]
  isOwner: boolean
  currentSub: string
  onClose: () => void
  onProjectUpdated: (patch: Partial<Project>) => void
  onMemberRemoved: (sub: string) => void
}) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [color, setColor] = useState(project.color)
  const [icon, setIcon] = useState(project.icon ?? 'Rocket')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [membersOpen, setMembersOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [memberQuery, setMemberQuery] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  const q = memberQuery.trim().toLowerCase()
  const shownMembers = q
    ? members.filter((m) => `${m.name} @${m.handle}`.toLowerCase().includes(q))
    : members

  // Esc y clic fuera cierran, como el resto de paneles. El engrane queda exento porque
  // ya alterna: si no, el clic cerraría y el toggle volvería a abrir.
  useEffect(() => registerModalEsc(onClose), [onClose])
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (panelRef.current?.contains(t)) return
      if (t.closest('[data-settings-toggle]')) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const ProjectIcon = ICON_MAP[icon] ?? Layers

  async function saveProject() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await updateProjectFn({ data: {
        id: project.id,
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        icon,
      }})
      onProjectUpdated({ name: name.trim(), description: description.trim() || null, color, icon })
      toast.success('Proyecto guardado')
    } catch {
      toast.error('Error al guardar proyecto')
    } finally {
      setSaving(false)
    }
  }

  async function removeMember(sub: string) {
    setRemoving(sub)
    try {
      await removeProjectMemberFn({ data: { project_id: project.id, user_sub: sub } })
      onMemberRemoved(sub)
      toast.success('Miembro eliminado del proyecto')
    } catch {
      toast.error('Error al eliminar miembro')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <motion.div
      // Sin este ref el `contains` del clic-fuera era siempre falso y CUALQUIER clic
      // dentro del panel lo cerraba.
      ref={panelRef}
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      // data-keep-detail: cerrar Ajustes no debe cerrarte además la tarea que tenías
      // abierta detrás — son dos paneles distintos y el clic era uno solo.
      data-keep-detail
      // z-50 (encima del chat) y debajo de la barra: son ajustes que se abren a propósito
      // y sobre todo lo demás, pero taparte la barra te deja sin salida.
      className="fixed bottom-0 right-0 top-14 z-50 flex w-full max-w-md flex-col border-l border-t border-border bg-surface shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: color + '20' }}
          >
            <ProjectIcon size={16} color={color} />
          </div>
          <h2 className="text-sm font-semibold text-ink">Ajustes del proyecto</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-3 transition-colors">
          <X size={17} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 px-5 py-4">
        {/* Project details */}
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Proyecto</p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Nombre</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Descripción</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Descripción opcional…"
                className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </div>

            {/* Color */}
            <div>
              <label className="mb-2 block text-xs font-medium text-muted">Color</label>
              <div className="flex gap-2">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`h-7 w-7 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-offset-2 ring-ink/20' : 'hover:scale-110'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>

            {/* Icon */}
            <div>
              <label className="mb-2 block text-xs font-medium text-muted">Ícono</label>
              <div className="flex gap-2">
                {PROJECT_ICONS.map(({ name: n, icon: Icon }) => (
                  <button
                    key={n}
                    onClick={() => setIcon(n)}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border-2 transition-colors
                      ${icon === n ? 'border-brand bg-brand/10' : 'border-border hover:border-brand/50'}`}
                  >
                    <Icon size={16} color={icon === n ? color : undefined} />
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={saveProject}
              disabled={saving || !name.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-all hover:brightness-110 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </section>

        {/* Members */}
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Miembros ({members.length})</p>

          {/* Con nueve ya cuesta encontrar a alguien; con treinta es scroll a ciegas. */}
          {members.length > 6 && (
            <div className="relative mb-2">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                placeholder="Buscar por nombre o @handle"
                className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-brand"
              />
            </div>
          )}

          <div className="space-y-1">
            {shownMembers.length === 0 && (
              <p className="py-4 text-center text-xs text-muted">Nadie con ese nombre.</p>
            )}
            {shownMembers.map((m) => (
              <div key={m.sub} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-2">
                <MemberAvatar name={m.name} avatar={m.avatar} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{m.name}</p>
                  <p className="text-[10px] text-muted">@{m.handle}</p>
                </div>
                <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${m.role === 'owner' ? 'bg-brand/10 text-brand' : 'bg-surface-3 text-muted'}`}>
                  {m.role === 'owner' ? 'Owner' : 'Miembro'}
                </span>
                {isOwner && m.sub !== currentSub && (
                  <button
                    onClick={() => removeMember(m.sub)}
                    disabled={removing === m.sub}
                    className="hidden items-center gap-0.5 rounded text-[10px] text-muted group-hover:flex hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    <UserMinus size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Quién está en el equipo: se mira aquí mismo, sin salir de la app. */}
        <section>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Equipo del tablero</p>
          <button
            onClick={() => setMembersOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <Users size={14} />
            Ver miembros del proyecto
          </button>
        </section>

        <WorkspaceMembersModal open={membersOpen} onClose={() => setMembersOpen(false)} members={members} />

        <AgentInstructions projectId={project.id} projectName={project.name} />

        {/* Danger zone */}
        {isOwner && (
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-red-400">Zona de peligro</p>
            <button
              onClick={() => setConfirmArchive(true)}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:border-red-500 hover:bg-red-500/10"
            >
              <Trash2 size={14} />
              Archivar proyecto
            </button>
          </section>
        )}
      </div>
      {confirmArchive && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmArchive(false)}>
          <div className="w-full max-w-xs rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-ink">¿Archivar "{project.name}"?</h3>
            <p className="mt-1.5 text-sm text-muted">
              El tablero deja de aparecer, pero no se borra: sus tareas, comentarios y
              bitácora se conservan y se puede restaurar.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmArchive(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-muted transition hover:bg-surface-3 hover:text-ink"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setConfirmArchive(false)
                  try {
                    await updateProjectFn({ data: { id: project.id, archived: true } })
                    toast.success('Proyecto archivado')
                    window.location.href = '/'
                  } catch {
                    toast.error('No se pudo archivar el proyecto')
                  }
                }}
                className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-600"
              >
                Archivar
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

/**
 * Lo que Ghosty sabe en ESTE tablero. Dos capas a propósito:
 *
 * - **De fábrica** (solo lectura): la plomería —qué tools tiene, que las descripciones son
 *   markdown, quién le habla—. Se enseña porque cuando el agente hace algo raro la primera
 *   pregunta es "¿qué le dijeron?", y hasta hoy la respuesta vivía sólo en el código.
 * - **Reglas del tablero** (editables): las de la casa. Van al FINAL del prompt, así que
 *   pesan más que lo genérico.
 */
function AgentInstructions({ projectId, projectName }: { projectId: number; projectName: string }) {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [base, setBase] = useState<string | null>(null)
  const [showBase, setShowBase] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getBoardInstructionsFn({ data: { projectId } })
      .then((r) => { setText(r.text); setSaved(r.text) })
      .catch(() => {})
  }, [projectId])

  const save = async () => {
    if (text === saved) return
    setSaving(true)
    try {
      await setBoardInstructionsFn({ data: { projectId, text } })
      setSaved(text)
      toast.success('Instrucciones guardadas')
    } catch {
      toast.error('No se pudieron guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
        <Bot size={13} /> Ghosty en este tablero
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        rows={4}
        placeholder={'Reglas de la casa. Ej.: "nada pasa a Done sin comentario", "las tareas de soporte van con prioridad alta".'}
        className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-brand"
      />
      <p className="mt-1 text-[11px] text-muted">
        {saving ? 'Guardando…' : 'Se aplican en cada turno del agente en este tablero.'}
      </p>

      <button
        onClick={async () => {
          if (!base) {
            try {
              const r = await baseInstructionsFn({ data: { projectName } })
              setBase(r.text)
            } catch { return }
          }
          setShowBase((v) => !v)
        }}
        className="mt-3 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-ink"
      >
        <ChevronDown size={13} className={`transition-transform ${showBase ? 'rotate-180' : ''}`} />
        Lo que ya sabe de fábrica
      </button>
      {showBase && base && (
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2/50 p-3 text-[11px] leading-relaxed text-muted">
          {base}
        </pre>
      )}
    </section>
  )
}
