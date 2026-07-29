import { createFileRoute, redirect } from '@tanstack/react-router'
import { startGhostyLogin, completeGhostyLogin, clearMeCache } from '../server/auth'

export type LoginSearch = { payload?: string; sig?: string; attempted?: boolean }

export function parseLoginSearch(s: Record<string, unknown>): LoginSearch {
  return {
    payload: typeof s.payload === 'string' ? s.payload : undefined,
    sig: typeof s.sig === 'string' ? s.sig : undefined,
    attempted:
      s.attempted === '1' || s.attempted === 1 || s.attempted === true || s.attempted === 'true'
        ? true
        : undefined,
  }
}

// Loader isomórfico: todo server-side, sin iframe ni popup.
//   1. Sin params → 302 al IdP con return=<path>?attempted=true
//   2. Vuelta con ?payload&sig → completa sesión y 302 a "/"
//   3. Vuelta con ?attempted sin payload → muestra LoginCard (fallback manual, anti-loop)
export async function runLoginLoader(search: LoginSearch) {
  if (search.payload) {
    let error: string | null = null
    try {
      await completeGhostyLogin({ data: { payload: search.payload, sig: search.sig ?? '' } })
    } catch (e) {
      error = (e as Error)?.message || 'No se pudo iniciar sesión'
    }
    if (!error) {
      clearMeCache()
      throw redirect({ to: '/' })
    }
    return { error }
  }
  if (search.attempted) {
    return { error: null as string | null }
  }
  const { url } = await startGhostyLogin({ data: {} })
  const retPath = '/login?attempted=true'
  const sep = url.includes('?') ? '&' : '?'
  throw redirect({ href: `${url}${sep}return=${encodeURIComponent(retPath)}` })
}

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>) => parseLoginSearch(s),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => runLoginLoader(deps),
  component: Login,
})

function Login() {
  const { error } = Route.useLoaderData()
  return <LoginCard error={error} retryTo="/login" />
}

export function LoginCard({
  error,
  retryTo,
  subtitle,
}: {
  error: string | null
  retryTo: string
  subtitle?: string
}) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-surface p-6 text-ink">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-2 p-8 text-center">
        <img src="/ghosty.svg" alt="Ghosty" className="mx-auto h-16 w-16" />
        <h1 className="mt-4 text-xl font-bold tracking-tight">Ghosty Tasks</h1>
        <p className="mt-1 text-sm text-muted">{subtitle ?? 'Gestión de tareas sin burocracia.'}</p>
        <p className="mt-1 text-xs text-muted">Entra con tu cuenta de Ghosty.</p>
        <a
          href={retryTo}
          className="mt-5 block w-full min-h-[44px] cursor-pointer rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-brand-fg transition hover:brightness-110 hover:shadow-lg hover:shadow-brand/30 active:scale-[0.98]"
        >
          Continuar con Ghosty
        </a>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  )
}
