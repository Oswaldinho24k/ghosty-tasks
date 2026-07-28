// El workspace de Ghosty Teams al que pertenece este tablero. Es el mismo subdominio
// cambiando el producto (acme.tasks.ghosty.studio → acme.teams.ghosty.studio): el
// slug vive en el host, así que no hace falta preguntárselo al servidor.
//
// En el apex (sin slug) no hay workspace concreto: se cae al portal.
export function teamsUrl(): string {
  if (typeof window === 'undefined') return 'https://www.ghosty.studio/app'
  const host = window.location.host
  if (!host.includes('.tasks.')) return 'https://www.ghosty.studio/app'
  return `https://${host.replace('.tasks.', '.teams.')}`
}
