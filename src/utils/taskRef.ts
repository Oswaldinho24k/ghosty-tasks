// Referencia humana de una tarea: `GST-4`. Es la convención de Linear y Jira (prefijo
// del tablero + número) y gana a un id pelado porque se lee en una frase: "mueve GST-4 a
// Done" — que es justo como se le habla al agente.
//
// El número es el id real, no un contador aparte: uno propio se desincroniza a la primera
// tarea creada fuera de la app (por el agente, por un import) y obliga a mantener estado
// para nada.

/** Prefijo del tablero: 3 letras de su nombre, mayúsculas. "GStudio" → "GST". */
export function projectKey(name: string): string {
  const clean = (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
  return (clean.slice(0, 3) || 'TSK').toUpperCase()
}

export function taskRef(projectName: string, taskId: number): string {
  return `${projectKey(projectName)}-${taskId}`
}

/**
 * El número dentro de una referencia, venga como sea: "GST-4", "gst 4", "#4" o "4".
 * Se usa del lado del agente, donde el texto lo escribe una persona (o un modelo).
 */
export function parseTaskRef(input: string | number | null | undefined): number | null {
  if (input == null) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  const m = String(input).match(/(\d+)\s*$/)
  return m ? Number(m[1]) : null
}
