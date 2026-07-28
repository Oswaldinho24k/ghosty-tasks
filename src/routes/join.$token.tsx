import { createFileRoute } from '@tanstack/react-router'
import { parseLoginSearch, runLoginLoader, LoginCard } from './login'
import type { LoginSearch } from './login'

export const Route = createFileRoute('/join/$token')({
  validateSearch: (s: Record<string, unknown>) => parseLoginSearch(s),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }: { params: { token: string }; deps: LoginSearch }) =>
    runLoginLoader(deps, params.token),
  component: Join,
})

function Join() {
  const { error } = Route.useLoaderData()
  const { token } = Route.useParams()
  return (
    <LoginCard
      error={error}
      retryTo={`/join/${token}`}
      subtitle="Te invitaron a Ghosty Tasks. Entra con Ghosty para unirte."
    />
  )
}
