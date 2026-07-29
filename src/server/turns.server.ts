// Turnos de agente en vuelo — permite detenerlos y saber cuáles están corriendo.
// Vive EN MEMORIA a propósito: si el server se reinicia, los turnos mueren con él.

export type LiveTurn = {
  turnId: string
  invokerSub: string
  startedAt: number
  controller: AbortController
  announce: (update: TurnUpdate) => void
  stopped?: boolean
}

export type TurnUpdate = {
  turnId: string
  state: 'running' | 'stopped'
  startedAt: number
}

const live = new Map<string, LiveTurn>()

export function registerTurn(t: Omit<LiveTurn, 'startedAt'> & { startedAt?: number }): void {
  const entry: LiveTurn = { ...t, startedAt: t.startedAt ?? Date.now() }
  live.set(entry.turnId, entry)
  entry.announce({ turnId: entry.turnId, state: 'running', startedAt: entry.startedAt })
}

export function finishTurn(turnId: string): void {
  const t = live.get(turnId)
  if (!t) return
  live.delete(turnId)
  // Only announce if not already stopped (avoids double fire)
  if (!t.stopped) {
    t.announce({ turnId, state: 'stopped', startedAt: t.startedAt })
  }
}

export function stopTurn(turnId: string, bySub: string): boolean {
  const t = live.get(turnId)
  if (!t) return false
  if (t.invokerSub !== bySub) return false
  t.stopped = true
  t.controller.abort()
  t.announce({ turnId, state: 'stopped', startedAt: t.startedAt })
  live.delete(turnId)
  return true
}
