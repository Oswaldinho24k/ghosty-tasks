import { useEffect } from 'react'
import { Users, Crown, Shield, X } from 'lucide-react'
import { MemberAvatar } from './MemberAvatar'
import { registerModalEsc } from '../utils/modal-esc'

type Member = { sub: string; name: string; avatar: string; handle?: string; role?: string }

// Quién participa en ESTE tablero. Antes listaba a todo el workspace, que con un equipo
// grande es una lista larga que además no dice nada útil: lo que importa aquí es quién
// puede trabajar el proyecto.
//
// Se entra asignando: pones a alguien en una tarea y queda dentro. Por eso no hay un
// "agregar" — sería un segundo camino para lo mismo.
export function WorkspaceMembersModal({
  open,
  onClose,
  members,
}: {
  open: boolean
  onClose: () => void
  members: Member[]
}) {
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
              <Users size={15} className="text-muted" /> Miembros del proyecto
            </h2>
            <p className="mt-0.5 text-xs text-muted">Quiénes pueden trabajar este tablero.</p>
          </div>
          <button onClick={onClose} className="text-muted transition hover:text-ink" aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {members.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nadie todavía.</p>
          ) : (
            members.map((m) => (
              <div key={m.sub} className="flex items-center gap-3 py-2">
                <MemberAvatar name={m.name} avatar={m.avatar} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{m.name}</p>
                  {m.handle && <p className="text-[10px] text-muted">@{m.handle}</p>}
                </div>
                {m.role === 'owner' ? (
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
            Todo el equipo puede VER este tablero; participan quienes están aquí. Para sumar
            a alguien, asígnale una tarea.
          </p>
        </div>
      </div>
    </div>
  )
}
