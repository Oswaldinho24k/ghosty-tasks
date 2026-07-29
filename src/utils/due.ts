// Qué tan cerca está una tarea de su fecha límite, en UN solo sitio.
//
// La escala es la de Linear (rojo = hoy o vencida, ámbar = dentro de la semana, gris
// después), que es la más legible de las tres que usa la comunidad: Trello va de
// transparente a amarillo a rojo —"transparente" no dice nada a tamaño de punto— y
// Asana pinta verde el día de hoy, que se lee como "está bien" justo cuando no lo está.
//
// Se compara por DÍA, no por instante: una tarea que vence hoy a las 9am no está
// "vencida" a las 10am, está para hoy. Vencida = un día anterior al de hoy.

export type DueLevel = 'overdue' | 'today' | 'soon' | 'upcoming' | 'far' | 'done'

const COLORS: Record<DueLevel, string> = {
  overdue: '#dc2626', // rojo
  today: '#dc2626',
  soon: '#f59e0b', // ámbar — mañana y el resto de la semana
  upcoming: '#f59e0b',
  far: '#94a3b8', // gris
  done: '#94a3b8',
}

const LABELS: Record<DueLevel, string> = {
  overdue: 'Vencida',
  today: 'Vence hoy',
  soon: 'Vence mañana',
  upcoming: 'Vence esta semana',
  far: 'Con tiempo',
  done: 'Completada',
}

/** Días de diferencia entre dos fechas, contando días de calendario. */
function daysUntil(due: Date, now: Date): number {
  const a = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((a - b) / 86400000)
}

export function dueLevel(due: Date, status?: string | null, now: Date = new Date()): DueLevel {
  if (status === 'done') return 'done'
  const d = daysUntil(due, now)
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  if (d === 1) return 'soon'
  if (d <= 7) return 'upcoming'
  return 'far'
}

export function dueColor(level: DueLevel): string {
  return COLORS[level]
}

export function dueLabel(level: DueLevel, due: Date, now: Date = new Date()): string {
  if (level === 'overdue') {
    const d = -daysUntil(due, now)
    return d === 1 ? 'Venció ayer' : `Vencida hace ${d} días`
  }
  if (level === 'upcoming') {
    return `Vence en ${daysUntil(due, now)} días`
  }
  if (level === 'far') return `Vence en ${daysUntil(due, now)} días`
  return LABELS[level]
}
