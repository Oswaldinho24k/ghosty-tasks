// Referencia humana de una tarea: `GStudio-4`. Es la convención de Linear y Jira (prefijo
// del tablero + número) y gana a un id pelado porque se lee en una frase: "mueve
// GStudio-4 a Done" — que es justo como se le habla al agente.
//
// El número es el id real, no un contador aparte: uno propio se desincroniza a la primera
// tarea creada fuera de la app (por el agente, por un import) y obliga a mantener estado
// para nada.

/**
 * Prefijo del tablero: su nombre tal cual, sin espacios. "GStudio" → "GStudio".
 *
 * Recortarlo a 3 letras (estilo Jira, "GST") es más corto pero críptico al leerlo, y el
 * ahorro no compensa: la referencia se usa hablando ("mueve GStudio-4 a Done"). Se acota
 * a 12 caracteres para que un nombre largo no se coma la tarjeta.
 */
export function projectKey(name: string): string {
  const clean = (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
  return clean.slice(0, 12) || 'Tarea'
}

export function taskRef(projectName: string, taskId: number): string {
  return `${projectKey(projectName)}-${taskId}`
}

/**
 * El número dentro de una referencia, venga como sea: "GStudio-4", "gstudio 4", "#4" o "4".
 * Se usa del lado del agente, donde el texto lo escribe una persona (o un modelo).
 */
export function parseTaskRef(input: string | number | null | undefined): number | null {
  if (input == null) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  const m = String(input).match(/(\d+)\s*$/)
  return m ? Number(m[1]) : null
}
