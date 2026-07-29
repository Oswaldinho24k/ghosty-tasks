import { useEffect, useState } from 'react'
import { Users, Crown, Shield, X } from 'lucide-react'
import { listWorkspaceUsersFn } from '../server/members'
import { MemberAvatar } from './MemberAvatar'
import { registerModalEsc } from '../utils/modal-esc'

type Member = Awaited<ReturnType<typeof listWorkspaceUsersFn>>[number]

// Quién está en el equipo: SOLO LECTURA. Antes había un botón que sacaba de la app hacia
// Ghosty Teams para ver una lista — un rodeo para una pregunta trivial. Agregar gente
// sigue siendo cosa del workspace (allá), aquí solo se mira.
//
// El padrón sale del control-plane (gs) y el perfil de `gc_users`, así que aparece
// también quien todavía no ha abierto ningún producto: ese sale con su correo.
export function WorkspaceMembersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [members, setMembers] = useState<Member[] | null>(null)

  useEffect(() => {
    if (!open) return
    listWorkspaceUsersFn()
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [open])

  useEffect(() => {
    if (!open) return
    return registerModalEsc(onClose)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface-2 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Users size={15} className="text-muted" /> Miembros
            </h2>
            <p className="mt-0.5 text-xs text-muted">Personas del equipo en este workspace.</p>
          </div>
          <button onClick={onClose} className="text-muted transition hover:text-ink" aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {members === null ? (
            <p className="py-6 text-center text-sm text-muted">Cargando…</p>
          ) : members.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nadie todavía.</p>
          ) : (
            members.map((m) => (
              <div key={m.sub} className="flex items-center gap-3 py-2">
                <MemberAvatar name={m.name} avatar={m.avatar} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{m.name}</p>
                  {m.handle && <p className="text-[10px] text-muted">@{m.handle}</p>}
                </div>
                {m.isOwner ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
                    <Crown size={9} /> Owner
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-muted">
                    <Shield size={9} /> Miembro
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border px-5 py-3">
          <p className="text-xs text-muted">
            El equipo es el mismo que en Ghosty Teams: quien entra ahí entra aquí. Se invita
            desde el workspace, en Ajustes → Invitar miembros.
          </p>
        </div>
      </div>
    </div>
  )
}
