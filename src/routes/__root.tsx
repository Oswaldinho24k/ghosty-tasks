import { useEffect } from 'react'
import { HeadContent, Scripts, createRootRoute, redirect } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import '../styles.css'
import { cachedMe } from '../server/auth'
import { THEME_BOOT, applyTheme, getTheme, watchSystemScheme } from '../utils/theme'

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (location.pathname === '/login' || location.pathname.startsWith('/join') || location.pathname === '/dev-login') {
      return { user: null }
    }
    const user = await cachedMe()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'Ghosty Tasks' },
      { name: 'theme-color', content: '#7c3aed' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'Ghosty Tasks' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/ghosty.svg' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyTheme(getTheme())
    const unsub = watchSystemScheme()
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    return unsub
  }, [])

  return (
    <html lang="es">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster richColors position="bottom-right" />
        <Scripts />
      </body>
    </html>
  )
}
