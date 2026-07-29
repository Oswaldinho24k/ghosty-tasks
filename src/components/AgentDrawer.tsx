import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { X, Send, Sparkles, CheckSquare2, ChevronDown, Check, ImagePlus } from 'lucide-react'
import { askAgentFn, listAgentsFn, getProjectAgentFn, setProjectAgentFn, getAgentHistoryFn } from '../server/agent'
import { MemberAvatar } from './MemberAvatar'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { registerModalEsc } from '../utils/modal-esc'
import type { WwEvent } from '../server/bus.server'
import type { Column } from '../server/projects'

type AgentEvent =
  | Extract<WwEvent, { t: 'agent:chunk' }>
  | Extract<WwEvent, { t: 'agent:tool' }>
  | Extract<WwEvent, { t: 'agent:done' }>

type Agent = { handle: string; name: string; avatar: string }

// Nombre legible de cada herramienta: el usuario debe poder mirar el drawer y saber qué
// está tocando el agente en SU tablero.
// El runtime las anuncia como `gs_connector:list_board` (van por el canal de los
// conectores), así que hay que quitarle el prefijo antes de buscar la etiqueta.
function toolLabel(raw: string): string {
  const name = raw.replace(/^gs[_ ]connector:/, '').replace(/ /g, '_')
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ')
}

const TOOL_LABELS: Record<string, string> = {
  list_board: 'Miró el tablero',
  find_tasks: 'Buscó tareas',
  create_task: 'Creó una tarea',
  move_task: 'Movió una tarea',
  update_task: 'Actualizó una tarea',
  set_labels: 'Cambió etiquetas',
  comment_task: 'Comentó',
  add_checklist_item: 'Añadió al checklist',
  delete_task: 'Borró una tarea',
}

type Msg = {
  id: string
  role: 'user' | 'agent'
  content: string
  streaming: boolean
  created_tasks: Array<{ id: number; title: string; column_id: number }>
  tools?: string[]
}

function stripJsonBlock(text: string): string {
  return text
    .replace(/```(?:json)?\s*\{[\s\S]*?"create_tasks"[\s\S]*?\}\s*```/g, '')
    .trim()
}

// Mismo bloque que en Ghosty Teams: una sola herramienta va en una línea (el header y
// la fila dirían lo mismo), varias se agrupan en una tarjeta colapsable con contador.
// Abierto por defecto: lo que se quiere es ver qué está tocando en el tablero.
function ToolGroup({ names, running }: { names: string[]; running: boolean }) {
  const [open, setOpen] = useState(true)
  if (!names.length) return null

  const line = (name: string, last: boolean) => (
    <>
      {running && last ? (
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-muted/40 border-t-brand" />
      ) : (
        <Check size={13} className="shrink-0 text-emerald-500" />
      )}
      <span className="truncate">{toolLabel(name)}</span>
    </>
  )

  if (names.length === 1) {
    return (
      <div className="mb-1.5 flex max-w-md items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-2.5 py-1.5 text-xs text-ink">
        <img src="/ghosty.svg" alt="" className="h-3.5 w-3.5 shrink-0" />
        {line(names[0], true)}
      </div>
    )
  }

  return (
    <div className="mb-1.5 max-w-md overflow-hidden rounded-lg border border-border bg-surface-2/50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-3/40"
      >
        <img src="/ghosty.svg" alt="" className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-medium text-ink">
          {names.length} herramientas
        </span>
        {running ? (
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-muted/40 border-t-brand" />
        ) : (
          <Check size={12} className="shrink-0 text-emerald-500" />
        )}
        <ChevronDown size={14} className={`ml-auto shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border/60 px-2.5 py-1.5">
          {names.map((n, i) => (
            <div key={`${n}-${i}`} className="flex items-center gap-2 py-0.5 text-xs text-muted">
              {line(n, i === names.length - 1)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AgentDrawer({
  onClose,
  projectId,
  columns,
  seed,
  onSeedUsed,
  onRegisterEventCallback,
}: {
  onClose: () => void
  projectId: number
  columns: Column[]
  /** Texto con el que abrir el input (p. ej. la referencia de una tarea). */
  seed?: string | null
  onSeedUsed?: () => void
  onRegisterEventCallback: (cb: ((ev: AgentEvent) => void) | null) => void
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [handle, setHandle] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Adjuntos del PRÓXIMO mensaje. Van inline en base64: son capturas y mockups, no
  // archivos pesados — por eso hay tope y no almacenamiento.
  const [files, setFiles] = useState<Array<{ name: string; mimeType: string; bytes: string; preview: string }>>([])
  const [dragging, setDragging] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const colMap = new Map(columns.map(c => [c.id, c.name]))
  const current = agents.find((a) => a.handle === handle) ?? agents[0] ?? null

  // Register event handler with parent SSE
  const handleAgentRef = useRef<(ev: AgentEvent) => void>(() => {})
  handleAgentRef.current = useCallback((ev: AgentEvent) => {
    if (ev.t === 'agent:chunk') {
      setMessages(prev =>
        prev.map(m => m.id === ev.turnId ? { ...m, content: m.content + ev.value } : m)
      )
    } else if (ev.t === 'agent:tool') {
      setMessages(prev =>
        prev.map(m => m.id === ev.turnId ? { ...m, tools: [...(m.tools ?? []), ev.name] } : m)
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
      // Devolver el foco al terminar el turno: seguir la conversación no debería costar
      // un clic, igual que en Ghosty Teams.
      setTimeout(() => inputRef.current?.focus(), 30)
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

  // Llegaste desde una tarjeta: el input arranca con su referencia y el cursor al final.
  useEffect(() => {
    if (!seed) return
    setInput((prev) => (prev.includes(seed.trim()) ? prev : prev ? `${prev} ${seed}` : seed))
    setTimeout(() => inputRef.current?.focus(), 40)
    onSeedUsed?.()
  }, [seed])

  // Los agentes del EQUIPO (los que activaste en Ghosty Teams) y cuál quedó elegido
  // para este tablero. La elección vive en la DB, así que es la misma en el teléfono.
  useEffect(() => {
    let alive = true
    Promise.all([listAgentsFn(), getProjectAgentFn({ data: { projectId } })])
      .then(([list, chosen]) => {
        if (!alive) return
        setAgents(list)
        setHandle(chosen.handle ?? list[0]?.handle ?? null)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [projectId])

  // Historial: antes la conversación se perdía al recargar.
  useEffect(() => {
    if (!handle) return
    let alive = true
    getAgentHistoryFn({ data: { projectId, handle } })
      .then((rows) => {
        if (!alive || !rows.length) return
        setMessages(rows.map((r, i) => ({
          id: `h-${i}`,
          role: r.role,
          content: r.body,
          streaming: false,
          created_tasks: [],
        })))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [projectId, handle])

  async function pickAgent(h: string) {
    setHandle(h)
    setPickerOpen(false)
    setMessages([])
    await setProjectAgentFn({ data: { projectId, handle: h } }).catch(() => {})
  }

  // Ya no viaja dentro del turno (va al storage del workspace), así que el tope es el
  // del storage, no el del contexto.
  const MAX_BYTES = 20_000_000

  async function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((f) => f.type.startsWith('image/'))
    for (const f of incoming) {
      if (f.size > MAX_BYTES) {
        // Mejor decirlo que mandar 8MB en base64 por un server-fn.
        setMessages((prev) => [
          ...prev,
          { id: `e-${Date.now()}`, role: 'agent', content: `"${f.name}" pesa demasiado (máx. 20 MB).`, streaming: false, created_tasks: [] },
        ])
        continue
      }
      const buf = await f.arrayBuffer()
      let bin = ''
      const bytesArr = new Uint8Array(buf)
      for (let i = 0; i < bytesArr.length; i++) bin += String.fromCharCode(bytesArr[i])
      const b64 = btoa(bin)
      setFiles((prev) => [...prev, { name: f.name, mimeType: f.type, bytes: b64, preview: `data:${f.type};base64,${b64}` }])
    }
  }

  async function send() {
    const text = input.trim()
    if ((!text && !files.length) || busy) return

    const turnId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now())

    setMessages(prev => [
      ...prev,
      { id: `u-${turnId}`, role: 'user', content: text, streaming: false, created_tasks: [] },
      { id: turnId, role: 'agent', content: '', streaming: true, created_tasks: [] },
    ])
    setInput('')
    // El foco se queda donde estabas escribiendo (enviar no lo pierde).
    inputRef.current?.focus()
    const attachments = files.map((f) => ({ name: f.name, mimeType: f.mimeType, bytes: f.bytes }))
    setFiles([])
    setBusy(true)

    try {
      await askAgentFn({ data: { projectId, message: text, turnId, handle: handle ?? undefined, attachments } })
    } catch {
      setMessages(prev =>
        prev.map(m =>
          m.id === turnId
            ? { ...m, content: 'Ocurrió un error al contactar al agente.', streaming: false }
            : m
        )
      )
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
      }}
      className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l bg-surface shadow-xl transition-colors ${
        dragging ? 'border-brand ring-2 ring-brand/40' : 'border-border'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        {/* Con quién hablas. Son los agentes del equipo, no uno propio de Tasks: si hay
            varios, se elige aquí y la elección se recuerda por tablero. */}
        <div className="relative min-w-0">
          <button
            onClick={() => agents.length > 1 && setPickerOpen((v) => !v)}
            className={`flex min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 ${agents.length > 1 ? 'transition-colors hover:bg-surface-3' : 'cursor-default'}`}
          >
            {current?.avatar ? (
              <MemberAvatar name={current.name} avatar={current.avatar} size={28} />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10">
                <Sparkles size={14} className="text-brand" />
              </div>
            )}
            <div className="min-w-0 text-left">
              <p className="truncate text-sm font-semibold text-ink">{current?.name ?? 'Ghosty'}</p>
              <p className="text-[10px] text-muted">
                {current ? `@${current.handle} · del equipo` : 'Asistente del tablero'}
              </p>
            </div>
            {agents.length > 1 && <ChevronDown size={13} className="shrink-0 text-muted" />}
          </button>
          {pickerOpen && (
            <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-border bg-surface-2 py-1 shadow-xl">
              {agents.map((a) => (
                <button
                  key={a.handle}
                  onClick={() => pickAgent(a.handle)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-ink transition-colors hover:bg-surface-3"
                >
                  <MemberAvatar name={a.name} avatar={a.avatar} size={22} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate">{a.name}</span>
                    <span className="block truncate text-[10px] text-muted">@{a.handle}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
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
              {/* Lo que fue tocando en el tablero, mientras lo hacía. */}
              {msg.role === 'agent' && msg.tools?.length ? (
                <ToolGroup names={msg.tools} running={msg.streaming} />
              ) : null}
              <div
                className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-brand text-brand-fg rounded-br-sm'
                    : 'bg-surface-2 text-ink rounded-bl-sm'
                }`}
              >
                {msg.role === 'agent' ? (
                  // El agente responde en markdown (negritas, listas, código): en crudo
                  // se leían los asteriscos.
                  <div className="gt-md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                      {stripJsonBlock(msg.content) || (msg.streaming ? '' : '…')}
                    </ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
                {msg.streaming && (
                  <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse rounded-full bg-current opacity-70" />
                )}
              </div>
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
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="group relative">
                <img src={f.preview} alt={f.name} className="h-14 w-14 rounded-lg border border-border object-cover" />
                <button
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-border bg-surface text-muted transition hover:text-ink"
                  aria-label={`Quitar ${f.name}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand transition-colors">
          <label className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition hover:bg-surface-3 hover:text-ink" title="Adjuntar imagen">
            <ImagePlus size={15} />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
            />
          </label>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
              if (imgs.length) { e.preventDefault(); addFiles(imgs) }
            }}
            placeholder="Escribe un mensaje…"
            rows={1}
            disabled={busy}
            className="flex-1 resize-none bg-transparent text-sm text-ink outline-none placeholder:text-muted disabled:opacity-50"
            style={{ maxHeight: '120px', overflowY: 'auto' }}
          />
          <button
            onClick={send}
            disabled={(!input.trim() && !files.length) || busy}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-brand text-brand-fg transition hover:brightness-110 disabled:opacity-40"
          >
            <Send size={13} />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted">
          Enter para enviar · arrastra o pega una imagen
        </p>
      </div>
    </motion.div>
  )
}
