import { createFileRoute, Link } from '@tanstack/react-router'
import { me } from '../server/auth'
import { listWorkspaceUsersFn } from '../server/members'
import { Users, Crown, Shield, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MemberAvatar } from '../components/MemberAvatar'

export const Route = createFileRoute('/settings')({
  loader: async () => {
    const [user, workspaceMembers] = await Promise.all([
      me(),
      // Solo los últimos que entraron: el resto se busca. Cargar el padrón completo
      // funciona con ocho personas y es inmanejable con cien.
      listWorkspaceUsersFn({ data: { limit: 12 } }),
    ])
    return { user, workspaceMembers }
  },
  component: Settings,
})

function Settings() {
  const { user, workspaceMembers } = Route.useLoaderData()
  const [members, setMembers] = useState(workspaceMembers)
  const [q, setQ] = useState('')

  // Buscar consulta al servidor (con un respiro para no pedir por cada tecla): la lista
  // que se ve son los últimos activos, no todo el equipo.
  useEffect(() => {
    const t = setTimeout(() => {
      listWorkspaceUsersFn({ data: { q: q.trim(), limit: q.trim() ? 20 : 12 } })
        .then(setMembers)
        .catch(() => {})
    }, 220)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="mx-auto max-w-lg py-10 px-6 space-y-5">
      <h1 className="text-xl font-bold text-ink">Ajustes del workspace</h1>

      {/* Profile */}
      {user && (
        <section className="rounded-xl border border-border bg-surface-2 p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted">Tu perfil</p>
          <div className="flex items-center gap-4">
            <MemberAvatar name={user.name} avatar={user.avatar} size={48} />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-base font-semibold text-ink">{user.name}</p>
                {user.isOwner && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
                    <Crown size={9} /> Owner
                  </span>
                )}
              </div>
              <p className="text-sm text-muted">@{user.handle}</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted">
            Tu nombre y avatar se sincronizan automáticamente desde Formmy.
          </p>
        </section>
      )}

      {/* Workspace members */}
      <section className="rounded-xl border border-border bg-surface-2 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users size={16} className="text-muted" />
          <h2 className="text-sm font-semibold text-ink">Miembros del workspace</h2>
        </div>
        {/* Buscador: la lista muestra a los últimos que entraron, no a todo el equipo —
            con cien personas nadie la lee entera y cargarla completa es tirar datos. */}
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 focus-within:border-brand">
          <Search size={13} className="shrink-0 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar a alguien del equipo…"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </div>
        <div className="space-y-1">
          {members.length === 0 && (
            <p className="py-4 text-center text-sm text-muted">Nadie coincide con esa búsqueda.</p>
          )}
          {members.map((m) => (
            <div key={m.sub} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-3 transition-colors">
              <MemberAvatar name={m.name} avatar={m.avatar} size={32} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{m.name}</p>
                <p className="text-[10px] text-muted">@{m.handle}</p>
              </div>
              {m.isOwner ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand flex-shrink-0">
                  <Crown size={9} /> Owner
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-muted flex-shrink-0">
                  <Shield size={9} /> Miembro
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* La lista de arriba YA es el padrón del workspace; agregar gente es cosa de
          Ghosty Teams, así que aquí solo se dice dónde. */}
      <p className="px-1 text-xs text-muted">
        El equipo es el mismo que en Ghosty Teams: quien entra ahí entra aquí. Se invita
        desde el workspace, en Ajustes → Invitar miembros.
      </p>

      <div className="pt-2">
        <Link to="/" className="text-sm text-brand hover:underline">← Volver</Link>
      </div>
    </div>
  )
}
