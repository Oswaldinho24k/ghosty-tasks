// Las prioridades, en UN solo sitio. Estaban copiadas en cinco componentes y ya
// divergieron: la franja de la tarjeta decía gris para "Baja" mientras el detalle la
// pintaba azul. Cualquier cambio de paleta tiene que verse igual en todos lados.
//
// Se separan por TONO, no por matiz: naranja y amarillo (alta/media) se confundían en
// una franja de 4px o un punto de 6px.
export type PriorityValue = 'urgent' | 'high' | 'medium' | 'low'

export const PRIORITIES: Array<{ value: PriorityValue; label: string; color: string }> = [
  { value: 'urgent', label: 'Urgente', color: '#ef4444' },
  { value: 'high', label: 'Alta', color: '#f97316' },
  { value: 'medium', label: 'Media', color: '#3b82f6' },
  { value: 'low', label: 'Baja', color: '#94a3b8' },
]

const BY_VALUE = new Map(PRIORITIES.map((p) => [p.value as string, p]))

export function priorityColor(p: string | null | undefined): string {
  return (p && BY_VALUE.get(p)?.color) || 'transparent'
}

export function priorityLabel(p: string | null | undefined): string {
  return (p && BY_VALUE.get(p)?.label) || ''
}
