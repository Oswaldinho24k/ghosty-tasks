import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, UserRound } from 'lucide-react'
import { MemberAvatar } from './MemberAvatar'
import { registerModalEsc } from '../utils/modal-esc'

// Lo mínimo para pintar a alguien: así sirve tanto con el roster del workspace como con
// los miembros del proyecto (el fallback cuando gs no contesta).
type Pickable = { sub: string; name: string; avatar: string; handle?: string }

// Un <select> nativo no puede mostrar la cara de nadie: con ocho compañeros, elegir
// entre ocho nombres pelados es más lento que reconocer un avatar.
export function AssigneePicker({
  value,
  members,
  onChange,
}: {
  value: string | null
  members: Pickable[]
  onChange: (sub: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const current = members.find((m) => m.sub === value) ?? null

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    const offEsc = registerModalEsc(() => setOpen(false))
    return () => {
      document.removeEventListener('mousedown', onDown)
      offEsc()
    }
  }, [open])

  const pick = (sub: string | null) => {
    onChange(sub)
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none transition-colors hover:border-brand/50"
      >
        {current ? (
          <>
            <MemberAvatar name={current.name} avatar={current.avatar} size={18} />
            <span className="min-w-0 flex-1 truncate text-left">{current.name}</span>
          </>
        ) : (
          <>
            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-surface-3 text-muted">
              <UserRound size={11} />
            </span>
            <span className="flex-1 text-left text-muted">Sin asignar</span>
          </>
        )}
        <ChevronDown size={13} className="shrink-0 text-muted" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-2 py-1 shadow-xl">
          <button
            onClick={() => pick(null)}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-muted transition-colors hover:bg-surface-3"
          >
            <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-surface-3">
              <UserRound size={12} />
            </span>
            <span className="flex-1 text-left">Sin asignar</span>
            {!value && <Check size={12} className="text-brand" />}
          </button>
          {members.map((m) => (
            <button
              key={m.sub}
              onClick={() => pick(m.sub)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-ink transition-colors hover:bg-surface-3"
            >
              <MemberAvatar name={m.name} avatar={m.avatar} size={22} />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate">{m.name}</span>
                {m.handle && <span className="block truncate text-[10px] text-muted">@{m.handle}</span>}
              </span>
              {value === m.sub && <Check size={12} className="shrink-0 text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
