import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { X, Send, Sparkles, CheckSquare2, Square } from 'lucide-react'
import { askAgentFn, stopTurnFn } from '../server/agent.server'
import { registerModalEsc } from '../utils/modal-esc'
import type { WwEvent } from '../server/bus.server'
import type { Column } from '../server/projects'

type AgentEvent =
  | Extract<WwEvent, { t: 'agent:chunk' }>
  | Extract<WwEvent, { t: 'agent:done' }>
  | Extract<WwEvent, { t: 'agent:turn' }>

type Msg = {
  id: string
  role: 'user' | 'agent'
  content: string
  streaming: boolean
  created_tasks: Array<{ id: number; title: string; column_id: number }>
}

// Frases rotativas para el placeholder — cambian cada hora por proyecto
const AGENT_HINTS = [
  'Pídele a Ghosty algo…',
  '¿Cuántas tareas están urgentes?',
  'Crea el plan de lanzamiento',
  '¿Qué está bloqueado?',
  'Genera subtareas para la tarea X',
  'Resume el estado del proyecto',
  '¿Vamos a llegar al deadline?',
  'Prioriza las tareas pendientes',
  'Crea tareas para el MVP',
]

function agentHint(projectId: number): string {
  const seed = `${projectId}·${Math.floor(Date.now() / 3_600_000)}`
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AGENT_HINTS[h % AGENT_HINTS.length]
}

function stripJsonBlock(text: string): string {
  return text
    .replace(/```(?:json)?\s*\{[\s\S]*?"create_tasks"[\s\S]*?\}\s*```/g, '')
    .trim()
}

function formatElapsed(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000))
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`
}

export function AgentDrawer({
  onClose,
  projectId,
  columns,
  onRegisterEventCallback,
}: {
  onClose: () => void
  projectId: number
  columns: Column[]
  onRegisterEventCallback: (cb: ((ev: AgentEvent) => void) | null) => void
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Turn tracking for stop button + elapsed timer
  const [turnInfo, setTurnInfo] = useState<{ turnId: string; startedAt: number } | null>(null)
  const [now, setNow] = useState(Date.now())
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const placeholder = agentHint(projectId)

  const colMap = new Map(columns.map(c => [c.id, c.name]))

  // Tick every second while a turn is running
  useEffect(() => {
    if (!turnInfo) return
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [turnInfo])

  // Register event handler with parent SSE
  const handleAgentRef = useRef<(ev: AgentEvent) => void>(() => {})
  handleAgentRef.current = useCallback((ev: AgentEvent) => {
    if (ev.t === 'agent:turn') {
      if (ev.state === 'running') {
        setTurnInfo({ turnId: ev.turnId, startedAt: ev.startedAt })
        setNow(Date.now())
      } else {
        setTurnInfo(null)
      }
    } else if (ev.t === 'agent:chunk') {
      setMessages(prev =>
        prev.map(m => m.id === ev.turnId ? { ...m, content: m.content + ev.value } : m)
      )
    } else if (ev.t === 'agent:done') {
      setMessages(prev =>
        prev.map(m =>
          m.id === ev.turnId
            ? { ...m, content: ev.value, streaming: false, created_tasks: ev.created_tasks }
            : m
        )
      )
      setBusy(false)
      setTurnInfo(null)
    }
  }, [])

  useEffect(() => {
    onRegisterEventCallback((ev) => handleAgentRef.current(ev))
    return () => onRegisterEventCallback(null)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    return registerModalEsc(onClose)
  }, [onClose])

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  async function send() {
    const text = input.trim()
    if (!text || busy) return

    const turnId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now())

    setMessages(prev => [
      ...prev,
      { id: `u-${turnId}`, role: 'user', content: text, streaming: false, created_tasks: [] },
      { id: turnId, role: 'agent', content: '', streaming: true, created_tasks: [] },
    ])
    setInput('')
    setBusy(true)

    try {
      await askAgentFn({ data: { projectId, message: text, turnId } })
    } catch {
      setMessages(prev =>
        prev.map(m =>
          m.id === turnId
            ? { ...m, content: 'Ocurrió un error al contactar al agente.', streaming: false }
            : m
        )
      )
      setBusy(false)
      setTurnInfo(null)
    }
  }

  async function stop() {
    if (!turnInfo) return
    try {
      await stopTurnFn({ data: { turnId: turnInfo.turnId } })
    } catch {}
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const elapsed = turnInfo ? formatElapsed(now - turnInfo.startedAt) : ''

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-border bg-surface shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10">
            <Sparkles size={14} className="text-brand" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Ghosty</p>
            <p className="text-[10px] text-muted">Asistente AI del proyecto</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted hover:bg-surface-3 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10">
              <Sparkles size={22} className="text-brand" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink mb-1">Hola, soy Ghosty</p>
              <p className="text-xs text-muted max-w-[220px]">
                Pregúntame sobre el proyecto, pídeme crear tareas o analizar el tablero.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 w-full mt-2">
              {[
                '¿Cuántas tareas tenemos?',
                'Crea las tareas para el sprint de lanzamiento',
                '¿Qué está pendiente con urgencia?',
              ].map(s => (
                <button
                  key={s}
                  onClick={() => { setInput(s); inputRef.current?.focus() }}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-muted text-left hover:bg-surface-2 hover:text-ink transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'agent' && (
              <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand/10">
                <Sparkles size={11} className="text-brand" />
              </div>
            )}
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-first' : ''}`}>
              <div
                className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-brand text-brand-fg rounded-br-sm'
                    : 'bg-surface-2 text-ink rounded-bl-sm'
                }`}
              >
                {msg.role === 'agent'
                  ? (stripJsonBlock(msg.content) || (msg.streaming ? '' : '…'))
                  : msg.content}
                {msg.streaming && (
                  <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse rounded-full bg-current opacity-70" />
                )}
              </div>

              {/* Turn controls: elapsed + stop button */}
              {msg.streaming && turnInfo?.turnId === msg.id && (
                <div className="mt-1.5 flex items-center gap-2 px-1">
                  <span className="tabular-nums text-[10px] text-muted opacity-70">{elapsed}</span>
                  <button
                    onClick={stop}
                    title="Detener"
                    className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted transition hover:border-red-400/40 hover:text-red-400"
                  >
                    <Square size={9} />
                    Detener
                  </button>
                </div>
              )}

              {msg.created_tasks.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-[10px] font-medium text-muted px-1">
                    {msg.created_tasks.length === 1 ? 'Tarea creada' : `${msg.created_tasks.length} tareas creadas`}
                  </p>
                  {msg.created_tasks.map(t => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
                    >
                      <CheckSquare2 size={12} className="flex-shrink-0 text-brand" />
                      <span className="flex-1 min-w-0 truncate text-ink">{t.title}</span>
                      {colMap.get(t.column_id) && (
                        <span className="flex-shrink-0 text-[10px] text-muted">
                          {colMap.get(t.column_id)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={busy}
            className="flex-1 resize-none bg-transparent text-sm text-ink outline-none placeholder:text-muted disabled:opacity-50"
            style={{ maxHeight: '120px', overflowY: 'auto' }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || busy}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-brand text-brand-fg transition hover:brightness-110 disabled:opacity-40"
          >
            <Send size={13} />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted">
          Enter para enviar · Shift+Enter para nueva línea
        </p>
      </div>
    </motion.div>
  )
}
