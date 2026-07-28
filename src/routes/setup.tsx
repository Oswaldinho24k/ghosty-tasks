import { createFileRoute, useRouter, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { me } from '../server/auth'
import { listProjectsFn, createProjectFn } from '../server/projects'
import { Rocket, Layers, Target, Palette } from 'lucide-react'

const PROJECT_ICONS = [
  { name: 'Rocket', icon: Rocket },
  { name: 'Layers', icon: Layers },
  { name: 'Target', icon: Target },
  { name: 'Palette', icon: Palette },
]

const PROJECT_COLORS = [
  '#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899',
]

export const Route = createFileRoute('/setup')({
  loader: async () => {
    const user = await me()
    if (!user) throw redirect({ to: '/login' })
    const projects = await listProjectsFn()
    if (projects.length > 0) {
      throw redirect({ to: '/p/$slug/board', params: { slug: projects[0].slug } })
    }
    return { user }
  },
  component: Setup,
})

function Setup() {
  const { user } = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#7c3aed')
  const [icon, setIcon] = useState('Rocket')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const project = await createProjectFn({ data: { name: name.trim(), icon, color } })
      router.navigate({ to: '/p/$slug/board', params: { slug: project.slug } })
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-surface p-6 text-ink">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-2 p-8">
        <div className="mb-6 flex items-center gap-3">
          <img src="/ghosty.svg" alt="Ghosty" className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-bold">Bienvenido, {user.name.split(' ')[0]}</h1>
            <p className="text-sm text-muted">Crea tu primer proyecto para empezar.</p>
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium">Nombre del proyecto</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              placeholder="Ej: Producto Principal, App v2…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Color</p>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full transition-transform hover:scale-110"
                  style={{ background: c, outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Ícono</p>
            <div className="flex gap-2">
              {PROJECT_ICONS.map(({ name: n, icon: Icon }) => (
                <button
                  key={n}
                  onClick={() => setIcon(n)}
                  className={`rounded-lg border p-2 transition-colors ${icon === n ? 'border-brand bg-brand/10' : 'border-border hover:border-brand/50'}`}
                >
                  <Icon size={18} style={{ color: icon === n ? color : undefined }} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <button
          onClick={create}
          disabled={!name.trim() || busy}
          className="mt-6 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-brand-fg transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Creando…' : 'Crear proyecto →'}
        </button>
      </div>
    </div>
  )
}
