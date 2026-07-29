import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

// Bypass de auth SOLO en desarrollo. En producción lanza 403.
// Acceder: http://localhost:3001/dev-login
const devLogin = createServerFn({ method: 'GET' }).handler(async () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('forbidden')
  }
  const { useSession } = await import('@tanstack/react-start/server')
  const { sessionConfig } = await import('../server/session.server')
  const { ensureSchema } = await import('../server/schema.server')
  const { upsertUser } = await import('../users.server')

  await ensureSchema()
  // En dev el rol lo damos nosotros: no hay control-plane que consultar.
  const user = await upsertUser(
    { sub: 'dev-local', email: 'dev@local.test', name: 'Dev Local', avatar: '' },
    'OWNER',
  )
  const s = await useSession<{ user?: typeof user }>(sessionConfig())
  await s.update({ user })
  return { ok: true }
})

export const Route = createFileRoute('/dev-login')({
  loader: async () => {
    await devLogin()
    throw redirect({ to: '/' })
  },
  component: () => null,
})
