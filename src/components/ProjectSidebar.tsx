import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Plus, LayoutGrid, List, Target, Settings, Layers, Rocket, Palette, Moon, Sun, MessagesSquare } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import type { Project } from '../server/projects'
import { createProjectFn } from '../server/projects'
import { MemberAvatar } from './MemberAvatar'
import { getTheme, setThemePartial, subscribeTheme, resolveDark } from '../utils/theme'

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  Rocket,
  Layers,
  Target,
  Palette,
}

function useIsDark() {
  return useSyncExternalStore(
    subscribeTheme,
    () => resolveDark(getTheme().scheme),
    () => false,
  )
}

export function ProjectSidebar({
  projects,
  currentSlug,
  currentView,
  user,
  onProjectCreated,
  onClose,
  onSettingsOpen,
}: {
  projects: Project[]
  currentSlug: string
  currentView: string
  user: { name: string; avatar: string; handle: string }
  onProjectCreated: (p: Project) => void
  onClose?: () => void
  onSettingsOpen?: () => void
}) {
  const router = useRouter()
  const isDark = useIsDark()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const navItems = [
    { view: 'board', label: 'Board', icon: LayoutGrid },
    { view: 'list', label: 'Lista', icon: List },
    { view: 'goals', label: 'Goals', icon: Target },
  ]

  async function createProject() {
    if (!newName.trim()) return
    setBusy(true)
    const project = await createProjectFn({ data: { name: newName.trim() } })
    onProjectCreated(project)
    setNewName('')
    setCreating(false)
    setBusy(false)
    router.navigate({ to: '/p/$slug/board', params: { slug: project.slug }, search: { q: undefined, priority: undefined, assignee: undefined, task: undefined } })
  }

  function toggleScheme() {
    setThemePartial({ scheme: isDark ? 'light' : 'dark' })
  }

  return (
    <aside className="flex h-full w-56 flex-shrink-0 flex-col border-r border-border bg-surface-2">
      {/* Logo */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <img src="/ghosty.svg" alt="Ghosty" className="h-7 w-7" />
        <span className="text-sm font-bold text-ink">Ghosty Tasks</span>
      </div>

      {/* Projects list */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="mb-1 px-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Proyectos</p>
        </div>

        {projects.map((p) => {
          const Icon = ICON_MAP[p.icon ?? ''] ?? Layers
          const active = p.slug === currentSlug
          return (
            <div key={p.id}>
              <Link
                to="/p/$slug/board"
                params={{ slug: p.slug }}
                search={{ q: undefined, priority: undefined, assignee: undefined, task: undefined }}
                onClick={onClose}
                className={`mx-1 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors
                  ${active ? 'bg-brand/10 font-medium text-brand' : 'text-ink hover:bg-surface-3'}`}
              >
                <Icon size={14} color={p.color} />
                <span className="truncate">{p.name}</span>
              </Link>

              {/* Sub-nav when active */}
              {active && (
                <div className="mb-1 ml-5 mt-0.5 space-y-0.5">
                  {navItems.map(({ view, label, icon: NavIcon }) => (
                    <Link
                      key={view}
                      to={`/p/$slug/${view}` as '/p/$slug/board'}
                      params={{ slug: p.slug }}
                      search={{ q: undefined, priority: undefined, assignee: undefined, task: undefined }}
                      onClick={onClose}
                      className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors
                        ${currentView === view ? 'bg-brand/10 font-medium text-brand' : 'text-muted hover:bg-surface-3 hover:text-ink'}`}
                    >
                      <NavIcon size={12} />
                      {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Add project */}
        <AnimatePresence>
          {creating ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mx-1 mt-1 overflow-hidden"
            >
              <div className="rounded-lg border border-border bg-surface p-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createProject()
                    if (e.key === 'Escape') { setCreating(false); setNewName('') }
                  }}
                  placeholder="Nombre del proyecto…"
                  className="w-full rounded bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:ring-1 focus:ring-brand"
                />
                <div className="mt-2 flex gap-1">
                  <button
                    onClick={createProject}
                    disabled={!newName.trim() || busy}
                    className="flex-1 rounded bg-brand py-1 text-xs font-semibold text-brand-fg disabled:opacity-50"
                  >
                    {busy ? '…' : 'Crear'}
                  </button>
                  <button onClick={() => { setCreating(false); setNewName('') }} className="px-2 text-xs text-muted hover:text-ink">
                    ✕
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="mx-1 mt-1 flex w-[calc(100%-8px)] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-surface-3 hover:text-ink transition-colors"
            >
              <Plus size={12} />
              Nuevo proyecto
            </button>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom: volver a Teams + tema + ajustes + usuario */}
      <div className="border-t border-border p-3 space-y-1">
        {/* Al MISMO workspace, no al apex: quien está en business.tasks quiere
            business.teams. El slug sale del host, así que no hay nada que configurar y
            no puede apuntar al equipo equivocado. */}
        <TeamsLink />
        <div className="flex items-center gap-1">
          <button
            onClick={() => { onClose?.(); onSettingsOpen?.() }}
            className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface-3 hover:text-ink transition-colors"
          >
            <Settings size={13} />
            Ajustes
          </button>
          <button
            onClick={toggleScheme}
            title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-3 hover:text-ink transition-colors"
          >
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </div>
        <button
          onClick={() => { onClose?.(); onSettingsOpen?.() }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted hover:bg-surface-3 hover:text-ink transition-colors"
        >
          <MemberAvatar name={user.name} avatar={user.avatar} size={18} />
          <span className="truncate">{user.name}</span>
        </button>
      </div>
    </aside>
  )
}

/** Volver al Teams de ESTE workspace. Tasks y Teams son dos apps del mismo espacio y se
 *  salta entre ellas todo el día; sin esto hay que editar la URL a mano. */
function TeamsLink() {
  const [href, setHref] = useState<string | null>(null)
  useEffect(() => {
    // El slug es el primer label del host (`business.tasks.ghosty.studio`). En el apex o
    // en local no hay workspace que abrir → no se pinta el enlace.
    const parts = window.location.hostname.split('.')
    if (parts.length < 3 || parts[1] !== 'tasks') return
    setHref(`https://${parts[0]}.teams.${parts.slice(2).join('.')}`)
  }, [])
  if (!href) return null
  return (
    <a
      href={href}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface-3 hover:text-ink transition-colors"
    >
      <MessagesSquare size={13} />
      Ir a Teams
    </a>
  )
}
