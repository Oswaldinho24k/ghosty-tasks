import { createFileRoute, redirect } from '@tanstack/react-router'
import { listProjectsFn } from '../server/projects'
import { tenantStatusFn, listMyWorkspacesFn } from '../server/workspaces'
import { me } from '../server/auth'

// Dos caras según el host:
//   <slug>.tasks.ghosty.studio → el tablero de ese equipo (lo de siempre)
//   tasks.ghosty.studio        → selector: en cuál quieres trabajar. Una persona puede
//                                pertenecer a varios workspaces (su tier marca el tope).
export const Route = createFileRoute('/')({
  loader: async () => {
    const { slug } = await tenantStatusFn()
    if (!slug) {
      const user = await me()
      if (!user) throw redirect({ to: '/login' })
      const { workspaces, portal } = await listMyWorkspacesFn()
      // Con uno solo no tiene sentido preguntar.
      if (workspaces.length === 1) throw redirect({ href: workspaces[0].url })
      // El correo viaja al picker: cuando la lista sale vacía, lo primero que hay que
      // poder ver es CON QUÉ CUENTA estás mirando. Sin eso, una sesión de otra cuenta se
      // ve idéntica a "no tienes equipos" y no hay por dónde empezar.
      return { picker: true as const, workspaces, portal, email: user.email ?? '' }
    }
    const projects = await listProjectsFn()
    if (projects.length > 0) {
      throw redirect({ to: '/p/$slug/board', params: { slug: projects[0].slug }, search: { q: undefined, priority: undefined, assignee: undefined } })
    }
    throw redirect({ to: '/setup' })
  },
  component: WorkspacePicker,
})

function WorkspacePicker() {
  const data = Route.useLoaderData()
  if (!data?.picker) return null
  const { workspaces, portal, email } = data

  return (
    <div className="mx-auto max-w-md py-16 px-6">
      <h1 className="text-xl font-bold text-ink">Tus equipos</h1>
      <p className="mt-1 text-sm text-muted">
        Cada equipo tiene su tablero, con los miembros de ese workspace.
      </p>

      {workspaces.length > 0 ? (
        <div className="mt-6 space-y-2">
          {workspaces.map((w) => (
            <a
              key={w.slug}
              href={w.url}
              className="group flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3 transition-colors hover:border-brand/50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-ink">{w.slug}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted">{w.role}</span>
              </span>
              <span className="shrink-0 text-xs text-muted transition-colors group-hover:text-brand">Abrir →</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-border bg-surface-2 px-4 py-6 text-sm text-muted">
          <p>
            {email ? <>La cuenta <span className="text-ink">{email}</span> no</> : 'No'} pertenece a
            ningún equipo. Crea uno en Ghosty Studio, o entra con otra cuenta.
          </p>
          {/* Sin esta salida la pantalla es un callejón: el loader sólo manda a /login
              cuando NO hay sesión, así que con la sesión de otra cuenta te quedas
              atrapado viendo una lista vacía y sin forma de cambiarla. */}
          <button
            type="button"
            onClick={async () => {
              const { logout } = await import('../server/auth')
              const r = await logout()
              window.location.href = r.next
            }}
            className="mt-3 text-brand hover:underline"
          >
            Cerrar sesión y entrar con otra cuenta
          </button>
        </div>
      )}

      <a href={`${portal}/app`} className="mt-6 inline-block text-sm text-brand hover:underline">
        Ir a Ghosty Studio →
      </a>
    </div>
  )
}
