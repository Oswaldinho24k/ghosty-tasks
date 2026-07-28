import { createFileRoute, redirect } from '@tanstack/react-router'
import { listProjectsFn } from '../server/projects'

export const Route = createFileRoute('/')({
  loader: async () => {
    const projects = await listProjectsFn()
    if (projects.length > 0) {
      throw redirect({ to: '/p/$slug/board', params: { slug: projects[0].slug }, search: { q: undefined, priority: undefined, assignee: undefined } })
    }
    throw redirect({ to: '/setup' })
  },
})
