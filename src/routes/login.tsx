import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { startGhostyLogin, completeGhostyLogin, clearMeCache, requestAccess, NOT_MEMBER } from '../server/auth'

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
/** Entró con una cuenta de Ghosty que no es miembro de este espacio: la puerta sabe quién y dónde. */
export type Denied = { email: string; slug: string; staff: boolean; idp: string; payload: string; sig: string }

export async function runLoginLoader(search: LoginSearch): Promise<{ error: string | null; denied?: Denied }> {
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
    if (error.startsWith(NOT_MEMBER)) {
      try {
        const d = JSON.parse(error.slice(NOT_MEMBER.length)) as Omit<Denied, 'payload' | 'sig'>
        return { error: null, denied: { ...d, payload: search.payload, sig: search.sig ?? '' } }
      } catch {
        return { error: 'no eres miembro de este workspace' }
      }
    }
    return { error }
  }
  if (search.attempted) {
    return { error: null }
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
  const { error, denied } = Route.useLoaderData()
  if (denied) return <NoAccessCard denied={denied} />
  return <LoginCard error={error} retryTo="/login" />
}

/**
 * La puerta cuando la cuenta no es miembro (patrón Notion/Linear/Slack): dice con qué cuenta
 * entraste y a qué espacio, y da salidas. «Continuar con Ghosty» NO va aquí: volvía a firmar con
 * la misma sesión y repetía el error.
 */
function NoAccessCard({ denied }: { denied: Denied }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'already' | 'member' | 'error'>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const here = typeof window === 'undefined' ? '' : window.location.origin
  const back = `${here}/login`
  const ask = async () => {
    setState('sending')
    setProblem(null)
    try {
      const r = await requestAccess({ data: { payload: denied.payload, sig: denied.sig } })
      setState(r.already ? 'member' : r.sent ? 'sent' : r.reason === 'ya_pedido' ? 'already' : 'error')
      if (!r.sent && !r.already && r.reason !== 'ya_pedido') setProblem('No se pudo mandar el aviso. Inténtalo en un rato.')
    } catch (e) {
      setState('error')
      setProblem((e as Error)?.message || 'No se pudo mandar el aviso.')
    }
  }
  const primary =
    'mt-5 block w-full min-h-[44px] cursor-pointer rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-brand-fg transition hover:brightness-110 hover:shadow-lg hover:shadow-brand/30 active:scale-[0.98] disabled:opacity-60'
  const secondary = 'text-sm text-muted underline-offset-4 transition hover:text-ink hover:underline'
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-surface p-6 text-ink">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-2 p-8 text-center">
        <img src="/ghosty.svg" alt="Ghosty" className="mx-auto h-16 w-16" />
        <h1 className="mt-4 text-xl font-bold tracking-tight">No tienes acceso a {denied.slug}</h1>
        <p className="mt-2 text-sm text-muted">
          Entraste como <b className="text-ink">{denied.email}</b>, que no es miembro de este espacio.
        </p>
        {denied.staff ? (
          <a
            href={`${denied.idp}/staff/join/${encodeURIComponent(denied.slug)}?return=${encodeURIComponent(back)}`}
            className={primary}
          >
            Entrar como soporte
          </a>
        ) : state === 'sent' ? (
          <p className="mt-5 rounded-lg border border-border px-4 py-3 text-sm">
            Listo: le avisamos a quien administra {denied.slug}. Te llegará una invitación a {denied.email}.
          </p>
        ) : state === 'already' ? (
          <p className="mt-5 rounded-lg border border-border px-4 py-3 text-sm">
            Ya lo habías pedido hoy; le avisamos a quien administra {denied.slug}.
          </p>
        ) : state === 'member' ? (
          <a href="/login" className={primary}>
            Ya tienes acceso: entrar
          </a>
        ) : (
          <button type="button" onClick={ask} disabled={state === 'sending'} className={primary}>
            {state === 'sending' ? 'Pidiendo…' : 'Pedir acceso'}
          </button>
        )}
        {problem && <p className="mt-3 text-sm text-red-400">{problem}</p>}
        <div className="mt-4 flex flex-col items-center gap-2">
          <a href={`${denied.idp}/logout?next=${encodeURIComponent(back)}`} className={secondary}>
            Usar otra cuenta
          </a>
          <a href={`${denied.idp}/app`} className={secondary}>
            Ir a mis espacios
          </a>
        </div>
      </div>
    </div>
  )
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
