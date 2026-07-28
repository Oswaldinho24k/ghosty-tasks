import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Link2, Crown, Shield, Sun, Moon, Monitor } from 'lucide-react'
import { me } from '../server/auth'
import { listWorkspaceUsersFn } from '../server/members'
import { MemberAvatar } from './MemberAvatar'
import {
  PRESETS, getTheme, setThemePartial, resolveDark, subscribeTheme,
} from '../utils/theme'
import { registerModalEsc } from '../utils/modal-esc'
import { useSyncExternalStore } from 'react'

type Tab = 'perfil' | 'apariencia' | 'workspace'
type UserInfo = Awaited<ReturnType<typeof me>>
type Member = Awaited<ReturnType<typeof listWorkspaceUsersFn>>[number]

function useTheme() {
  return useSyncExternalStore(subscribeTheme, getTheme, getTheme)
}

export function SettingsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('perfil')
  const [user, setUser] = useState<UserInfo>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(false)
  const theme = useTheme()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([me(), listWorkspaceUsersFn()])
      .then(([u, ws]) => { setUser(u); setMembers(ws) })
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    return registerModalEsc(onClose)
  }, [open, onClose])

  const TABS: { id: Tab; label: string }[] = [
    { id: 'perfil', label: 'Perfil' },
    { id: 'apariencia', label: 'Apariencia' },
    { id: 'workspace', label: 'Workspace' },
  ]

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="relative z-10 flex w-full max-w-lg flex-col rounded-2xl border border-border bg-surface shadow-2xl"
            style={{ maxHeight: 'min(90vh, 600px)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-ink">Ajustes</h2>
              <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-3 transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-border px-5 pt-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`rounded-t-lg px-3 py-2 text-xs font-medium transition-colors
                    ${tab === t.id ? 'border-b-2 border-brand text-brand' : 'text-muted hover:text-ink'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading ? (
                <div className="space-y-3 animate-pulse">
                  <div className="h-12 rounded-lg bg-surface-3" />
                  <div className="h-4 w-1/2 rounded bg-surface-3" />
                  <div className="h-4 w-1/3 rounded bg-surface-3" />
                </div>
              ) : (
                <>
                  {/* ── Perfil ── */}
                  {tab === 'perfil' && user && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface-2 p-4">
                        <MemberAvatar name={user.name} avatar={user.avatar} size={52} />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-ink">{user.name}</p>
                            {user.isOwner && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
                                <Crown size={9} /> Owner
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted">@{user.handle}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted">
                        Tu nombre y avatar se sincronizan automáticamente desde ghosty.studio.
                      </p>
                    </div>
                  )}

                  {/* ── Apariencia ── */}
                  {tab === 'apariencia' && (
                    <div className="space-y-5">
                      {/* Scheme */}
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Modo</p>
                        <div className="flex gap-2">
                          {([
                            { value: 'system', label: 'Sistema', Icon: Monitor },
                            { value: 'light', label: 'Claro', Icon: Sun },
                            { value: 'dark', label: 'Oscuro', Icon: Moon },
                          ] as const).map(({ value, label, Icon }) => (
                            <button
                              key={value}
                              onClick={() => setThemePartial({ scheme: value })}
                              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-colors
                                ${theme.scheme === value ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-ink'}`}
                            >
                              <Icon size={13} /> {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Presets */}
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Paleta</p>
                        <div className="grid grid-cols-4 gap-2">
                          {PRESETS.map((p) => {
                            const dark = resolveDark(theme.scheme)
                            const pal = dark ? p.dark : p.light
                            const active = theme.preset === p.id
                            return (
                              <button
                                key={p.id}
                                onClick={() => setThemePartial({ preset: p.id })}
                                title={p.label}
                                className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-all
                                  ${active ? 'border-brand ring-2 ring-brand/30' : 'border-border hover:border-brand/50'}`}
                              >
                                <span className="flex gap-0.5">
                                  <span className="h-4 w-4 rounded-full" style={{ background: pal.brand }} />
                                  <span className="h-4 w-4 rounded-full" style={{ background: pal.surface }} />
                                </span>
                                <span className="text-[10px] text-muted truncate w-full text-center">{p.label}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Text size */}
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Tamaño de texto</p>
                        <div className="flex gap-2">
                          {([
                            { value: 'tiny', label: 'Pequeño' },
                            { value: 'regular', label: 'Normal' },
                            { value: 'large', label: 'Grande' },
                          ] as const).map(({ value, label }) => (
                            <button
                              key={value}
                              onClick={() => setThemePartial({ textSize: value })}
                              className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors
                                ${theme.textSize === value ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-ink'}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Font */}
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Fuente</p>
                        <div className="flex gap-2">
                          {([
                            { value: 'default', label: 'Auto' },
                            { value: 'serif', label: 'Serif' },
                            { value: 'mono', label: 'Mono' },
                          ] as const).map(({ value, label }) => (
                            <button
                              key={value}
                              onClick={() => setThemePartial({ font: value })}
                              className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors
                                ${theme.font === value ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-ink'}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Toggles */}
                      <div className="space-y-2">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Opciones</p>
                        {([
                          { key: 'darkSidebar', label: 'Sidebar oscura', desc: 'Panel lateral siempre oscuro, independiente del tema' },
                          { key: 'reduceMotion', label: 'Reducir movimiento', desc: 'Menos animaciones para mayor comodidad visual' },
                        ] as const).map(({ key, label, desc }) => (
                          <button
                            key={key}
                            onClick={() => setThemePartial({ [key]: !theme[key] })}
                            className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                          >
                            <div>
                              <p className="text-xs font-medium text-ink">{label}</p>
                              <p className="text-[10px] text-muted">{desc}</p>
                            </div>
                            <div className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${theme[key] ? 'bg-brand' : 'bg-surface-3'}`}>
                              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${theme[key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Workspace ── */}
                  {tab === 'workspace' && (
                    <div className="space-y-5">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                          Miembros ({members.length})
                        </p>
                        <div className="space-y-1">
                          {members.map((m) => (
                            <div key={m.sub} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                              <MemberAvatar name={m.name} avatar={m.avatar} size={32} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-ink">{m.name}</p>
                                <p className="text-[10px] text-muted">@{m.handle}</p>
                              </div>
                              {m.isOwner ? (
                                <span className="inline-flex items-center gap-0.5 flex-shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
                                  <Crown size={9} /> Owner
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 flex-shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-muted">
                                  <Shield size={9} /> Miembro
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {user?.isOwner && (
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Equipo</p>
                          <p className="mb-2 text-sm text-muted">
                            Los miembros son los del workspace; se agregan en Ghosty Teams.
                          </p>
                          <a
                            href="https://www.ghosty.studio/app"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 transition-colors"
                          >
                            <Link2 size={14} />
                            Gestionar el equipo
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
