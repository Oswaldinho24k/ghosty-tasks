import { createFileRoute, Link } from '@tanstack/react-router'
import { me } from '../server/auth'
import { listWorkspaceUsersFn } from '../server/members'
import { createInvite } from '../server/invites'
import { useState } from 'react'
import { Users, Link2, Copy, Check, Crown, Shield } from 'lucide-react'
import { MemberAvatar } from '../components/MemberAvatar'

export const Route = createFileRoute('/settings')({
  loader: async () => {
    const [user, workspaceMembers] = await Promise.all([
      me(),
      listWorkspaceUsersFn(),
    ])
    return { user, workspaceMembers }
  },
  component: Settings,
})

function Settings() {
  const { user, workspaceMembers } = Route.useLoaderData()
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function genInvite() {
    const { url } = await createInvite()
    setInviteUrl(url)
  }

  function copy() {
    if (!inviteUrl) return
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
          <span className="text-xs text-muted">({workspaceMembers.length})</span>
        </div>
        <div className="space-y-1">
          {workspaceMembers.map((m) => (
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

      {/* Invite */}
      <section className="rounded-xl border border-border bg-surface-2 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Link2 size={16} className="text-muted" />
          <h2 className="text-sm font-semibold text-ink">Invitar al workspace</h2>
        </div>
        {user?.isOwner ? (
          <div>
            <p className="text-sm text-muted mb-3">
              Genera un link de un solo uso para invitar a alguien.
            </p>
            {inviteUrl ? (
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink outline-none"
                />
                <button
                  onClick={copy}
                  className="flex items-center gap-1 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-brand-fg"
                >
                  {copied ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar</>}
                </button>
              </div>
            ) : (
              <button
                onClick={genInvite}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:brightness-110 transition-all"
              >
                <Link2 size={14} />
                Generar link de invitación
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">Solo el owner puede invitar miembros.</p>
        )}
      </section>

      <div className="pt-2">
        <Link to="/" className="text-sm text-brand hover:underline">← Volver</Link>
      </div>
    </div>
  )
}
