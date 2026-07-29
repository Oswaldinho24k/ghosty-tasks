import { createFileRoute, Outlet, notFound, redirect } from '@tanstack/react-router'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Settings, Menu, Plus } from 'lucide-react'
import { getProjectShellFn, listProjectsFn } from '../server/projects'
import type { Task, Column, Project } from '../server/projects'
import { getAllTaskLabelsFn } from '../server/labels'
import type { Label } from '../server/labels'
import { ProjectSidebar } from '../components/ProjectSidebar'
import { AnimatePresence, motion } from 'motion/react'
import { TaskDetailPanel } from '../components/TaskDetailPanel'
import { ProjectSettingsPanel } from '../components/ProjectSettingsPanel'
import { CommandPalette } from '../components/CommandPalette'
import { SettingsModal } from '../components/SettingsModal'
import { CreateTaskModal } from '../components/CreateTaskModal'
import { AgentDrawer } from '../components/AgentDrawer'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useLiveStream } from '../hooks/useLiveStream'
import type { WwEvent } from '../server/bus.server'
import { ProjectContext } from '../utils/projectContext'
import { useWorkspaceMembers } from '../hooks/useWorkspaceMembers'

export const Route = createFileRoute('/p/$slug')({
  loader: async ({ params }) => {
    const [shell, projects] = await Promise.all([
      getProjectShellFn({ data: { slug: params.slug } }).catch(() => null),
      listProjectsFn(),
    ])
    if (!shell) {
      if (projects.length > 0) throw redirect({ to: '/p/$slug/board', params: { slug: projects[0].slug }, search: { q: undefined, priority: undefined, assignee: undefined } })
      throw notFound()
    }
    return { shell, projects }
  },
  component: ProjectShell,
})

function ProjectShell() {
  const { shell: initial, projects: initialProjects } = Route.useLoaderData()
  const { slug } = Route.useParams()

  const [projects, setProjects] = useState(initialProjects)
  const [project, setProject] = useState(initial.project)
  const [projectMembers, setMembers] = useState(initial.members)
  const [columns, setColumns] = useState(initial.columns)
  const [tasks, setTasks] = useState(initial.tasks)
  const [taskLabels, setTaskLabels] = useState<Record<number, Label[]>>({})
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentSeed, setAgentSeed] = useState<string | null>(null)
  // El panel de detalle se recarga cuando llega un evento de SU tarea: el agente puede
  // añadirle checklist o comentarios mientras lo tienes abierto, y antes se quedaba
  // congelado hasta cerrarlo y volverlo a abrir.
  const [detailRefresh, setDetailRefresh] = useState(0)
  // Quién está conectado ahora mismo. El bus ya lo emitía y nadie lo escuchaba.
  const [online, setOnline] = useState<string[]>([])
  const selectedTaskRef = useRef<number | null>(null)
  selectedTaskRef.current = selectedTaskId
  const agentEventCallback = useRef<((ev: WwEvent) => void) | null>(null)

  const currentView = typeof window !== 'undefined'
    ? window.location.pathname.split('/').pop() ?? 'board'
    : 'board'

  // Para PINTAR a alguien (avatar del asignado, autor de un comentario) sirve todo el
  // equipo, no solo los miembros del proyecto: si no, una tarea asignada a alguien que no
  // está en el tablero salía sin cara.
  const team = useWorkspaceMembers()
  const members = useMemo(() => {
    type M = (typeof projectMembers)[number]
    const bySub = new Map<string, M>(
      team.map((t) => [t.sub, { sub: t.sub, name: t.name, avatar: t.avatar, handle: t.handle, role: 'member' } as M])
    )
    for (const m of projectMembers) bySub.set(m.sub, { ...bySub.get(m.sub), ...m })
    return [...bySub.values()]
  }, [team, projectMembers])

  // Ver es de todo el workspace; participar, de los miembros del tablero.
  const canEdit = initial.canEdit ?? true

  const currentUser = members.find((m) => m.sub === initial.currentSub)

  useEffect(() => {
    getAllTaskLabelsFn({ data: { project_id: initial.project.id } })
      .then(setTaskLabels)
      .catch(() => {})
  }, [initial.project.id])

  // ⌘K command palette
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Refresh shell data on SSE reconnect
  const reloadShell = useCallback(async () => {
    try {
      const shell = await getProjectShellFn({ data: { slug } })
      setProject(shell.project)
      setMembers(shell.members)
      setColumns(shell.columns)
      setTasks(shell.tasks)
    } catch {}
  }, [slug])

  // ¿Este evento habla de la tarea que tengo abierta?
  const touchesOpenTask = (ev: WwEvent): boolean => {
    const id = selectedTaskRef.current
    if (id == null) return false
    if (ev.t === 'checklist:updated' || ev.t === 'comment:created' || ev.t === 'comment:updated' || ev.t === 'comment:deleted') {
      return ev.task_id === id
    }
    if (ev.t === 'task:updated' || ev.t === 'task:moved') return ev.id === id
    return false
  }

  useLiveStream({
    onEvent: (ev: WwEvent) => {
      // Si el evento habla de la tarea que tengo abierta, recargar su panel: el agente
      // puede añadirle checklist o comentarios mientras la miras.
      if (touchesOpenTask(ev)) setDetailRefresh((n) => n + 1)
      if (ev.t === 'presence:init') setOnline(ev.online)
      if (ev.t === 'presence') {
        setOnline((prev) =>
          ev.status === 'online' ? [...new Set([...prev, ev.sub])] : prev.filter((s) => s !== ev.sub)
        )
      }
      if (ev.t === 'task:created') {
        if (ev.task.project_id === initial.project.id) {
          setTasks((prev) => {
            if (prev.find((t) => t.id === ev.task.id)) return prev
            return [...prev, {
              id: ev.task.id,
              project_id: ev.task.project_id,
              column_id: ev.task.column_id,
              parent_id: null,
              title: ev.task.title,
              description: null,
              status: ev.task.status,
              priority: ev.task.priority,
              assignee_sub: ev.task.assignee_sub,
              due_date: null,
              position: ev.task.position,
              created_by: '',
              created_at: 0,
              updated_at: 0,
            }]
          })
        }
      } else if (ev.t === 'task:updated') {
        if (ev.patch.labels !== undefined) {
          const labels = ev.patch.labels as Label[]
          setTaskLabels((prev) => ({ ...prev, [ev.id]: labels }))
          const { labels: _l, ...rest } = ev.patch
          if (Object.keys(rest).length > 0) {
            setTasks((prev) => prev.map((t) => t.id === ev.id ? { ...t, ...rest } as Task : t))
          }
        } else {
          setTasks((prev) => prev.map((t) => t.id === ev.id ? { ...t, ...ev.patch } as Task : t))
        }
      } else if (ev.t === 'task:moved') {
        setTasks((prev) => prev.map((t) => t.id === ev.id ? { ...t, column_id: ev.column_id, position: ev.position } : t))
      } else if (ev.t === 'task:deleted') {
        setTasks((prev) => prev.filter((t) => t.id !== ev.id))
        setTaskLabels((prev) => { const n = { ...prev }; delete n[ev.id]; return n })
      } else if (ev.t === 'column:created') {
        setColumns((prev) => {
          if (prev.find((c) => c.id === ev.column.id)) return prev
          return [...prev, ev.column as Column]
        })
      } else if (ev.t === 'column:updated') {
        setColumns((prev) => prev.map((c) => c.id === ev.id ? { ...c, ...ev.patch } as Column : c))
      } else if (ev.t === 'column:deleted') {
        setColumns((prev) => prev.filter((c) => c.id !== ev.id))
      } else if (ev.t === 'columns:reordered') {
        setColumns((prev) => {
          const map = new Map(prev.map((c) => [c.id, c]))
          return ev.ordered_ids.map((id, i) => ({ ...map.get(id)!, position: i })).filter(Boolean)
        })
      } else if (ev.t === 'agent:chunk' || ev.t === 'agent:tool' || ev.t === 'agent:done') {
        agentEventCallback.current?.(ev)
      }
    },
    onReconnect: reloadShell,
  })

  const sidebar = (
    <ProjectSidebar
      projects={projects}
      currentSlug={slug}
      currentView={currentView}
      user={{
        name: currentUser?.name ?? initial.currentSub,
        avatar: currentUser?.avatar ?? '',
        handle: currentUser?.handle ?? '',
      }}
      onProjectCreated={(p) => setProjects((prev) => [...prev, p])}
      onClose={() => setSidebarOpen(false)}
      onSettingsOpen={() => setSettingsModalOpen(true)}
    />
  )

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-ink">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        {sidebar}
      </div>

      {/* Mobile sidebar drawer */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed inset-y-0 left-0 z-50 md:hidden"
              style={{ paddingLeft: 'env(safe-area-inset-left)' }}
            >
              {sidebar}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Project header */}
        {/* z-30: por encima de la capa que cierra el detalle al hacer clic fuera. Si no,
            abrir una tarea bloqueaba "Nueva tarea" y el botón del agente. */}
        {/* data-keep-detail: tocar la barra no cierra el detalle. Abrir el chat teniendo
            una tarea abierta debe hacer las dos cosas a la vez, no cerrar una. */}
        <div data-keep-detail className="relative z-30 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Hamburger (mobile only) */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-3 transition-colors md:hidden"
            >
              <Menu size={18} />
            </button>
            <div>
              <h1 className="text-base font-bold text-ink">{project.name}</h1>
              {project.description && (
                <p className="text-xs text-muted">{project.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Sin fila de caras aquí: el filtro por persona, justo debajo, ya muestra a
                los mismos — dos veces lo mismo en la misma pantalla. */}
            {canEdit && (
              <button
                onClick={() => setCreateTaskOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-fg transition hover:brightness-110"
                title="Nueva tarea"
              >
                <Plus size={13} />
                <span className="hidden sm:inline">Nueva tarea</span>
              </button>
            )}
            <button
              onClick={() => setAgentOpen((v) => !v)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                agentOpen
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border text-muted hover:bg-surface-3 hover:text-ink'
              }`}
              title="Ghosty AI"
            >
              <img src="/ghosty.svg" alt="" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Ghosty</span>
            </button>
            <button
              data-settings-toggle
              onClick={() => setSettingsOpen((v) => !v)}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-3 hover:text-ink transition-colors"
              title="Ajustes del proyecto"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>

        {/* Solo lectura: decirlo en vez de dejar botones que fallan al tocarlos. */}
        {!canEdit && (
          <p className="border-b border-border bg-surface-2 px-4 py-1.5 text-center text-[11px] text-muted">
            Solo lectura — no participas en este tablero. Te suman asignándote una tarea.
          </p>
        )}

        {/* View content via React Context */}
        <div className="flex-1 overflow-hidden">
          <ProjectContext.Provider value={{
            projectId: initial.project.id,
            projectName: project.name,
            onAskAgent: (ref: string) => {
              // Abrir el chat ya hablando de ESA tarjeta: sin esto había que copiar el id
              // a mano, que es justo lo que la referencia visible vino a evitar.
              setAgentSeed(`${ref} `)
              setAgentOpen(true)
            },
            columns,
            tasks,
            members,
            projectMembers,
            online,
            canEdit,
            taskLabels,
            onTaskClick: (t: Task) => setSelectedTaskId(t.id),
            onColumnsChange: setColumns,
            onTasksChange: setTasks,
            onTaskLabelsChange: setTaskLabels,
          }}>
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </ProjectContext.Provider>
        </div>
      </main>

      {/* Task detail panel */}
      <AnimatePresence>
        {selectedTaskId != null && (
          <TaskDetailPanel
            key={selectedTaskId}
            taskId={selectedTaskId}
            projectId={initial.project.id}
            members={projectMembers}
            onClose={() => setSelectedTaskId(null)}
            onDeleted={(id) => {
              setTasks((prev) => prev.filter((t) => t.id !== id))
              setTaskLabels((prev) => { const n = { ...prev }; delete n[id]; return n })
            }}
            onLabelsChange={(taskId, labels) => setTaskLabels((prev) => ({ ...prev, [taskId]: labels }))}
            agentOpen={agentOpen}
            settingsOpen={settingsOpen}
            refreshKey={detailRefresh}
            projectName={project.name}
            onTaskChanged={(id, patch) =>
              setTasks((prev) => prev.map((t) => (t.id === id ? ({ ...t, ...patch } as Task) : t)))
            }
          />
        )}
        {settingsOpen && (
          <ProjectSettingsPanel
            project={project}
            members={members}
            isOwner={initial.isOwner}
            currentSub={initial.currentSub}
            onClose={() => setSettingsOpen(false)}
            onProjectUpdated={(patch) => setProject((p) => ({ ...p, ...patch } as Project))}
            onMemberRemoved={(sub) => setMembers((prev) => prev.filter((m) => m.sub !== sub))}
          />
        )}
      </AnimatePresence>

      {/* Command palette */}
      <AnimatePresence>
        {paletteOpen && (
          <CommandPalette
            projects={projects}
            tasks={tasks}
            columns={columns}
            slug={slug}
            onClose={() => setPaletteOpen(false)}
            onTaskClick={(id) => { setSelectedTaskId(id); setPaletteOpen(false) }}
          />
        )}
      </AnimatePresence>

      {/* Settings modal */}
      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
      />

      {/* Create task modal (global) */}
      <CreateTaskModal
        members={projectMembers}
        open={createTaskOpen}
        onClose={() => setCreateTaskOpen(false)}
        projectId={initial.project.id}
        columns={columns}
        onCreated={(task) => setTasks((prev) => {
          if (prev.find((t) => t.id === task.id)) return prev
          return [...prev, task]
        })}
      />

      {/* Ghosty AI drawer */}
      <AnimatePresence>
        {agentOpen && (
          <AgentDrawer
            tasks={tasks}
            projectName={project.name}
            seed={agentSeed}
            onSeedUsed={() => setAgentSeed(null)}
            onClose={() => setAgentOpen(false)}
            projectId={initial.project.id}
            columns={columns}
            onRegisterEventCallback={(cb) => { agentEventCallback.current = cb as ((ev: WwEvent) => void) | null }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
