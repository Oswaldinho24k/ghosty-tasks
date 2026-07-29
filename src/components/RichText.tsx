import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown as MarkdownExt } from 'tiptap-markdown'
import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'

// tiptap-markdown cuelga su API del storage del editor y no la tipa.
const md = (ed: Editor): string =>
  (ed.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()

// Editor de texto enriquecido, calcado del compositor de Ghosty Teams: mismas extensiones
// y mismo criterio de guardar MARKDOWN (no HTML), para que el contenido siga siendo
// legible en la DB, en el agente y en cualquier otra superficie.
//
// Lo que NO se trae: la extensión Mention (en una descripción no hay a quién mencionar) y
// los adjuntos del chat.
export function RichText({
  value,
  placeholder,
  editable = true,
  onSave,
}: {
  value: string
  placeholder?: string
  editable?: boolean
  /** Se llama al SALIR del campo, con el markdown resultante. */
  onSave: (markdown: string) => void
}) {
  const lastSaved = useRef(value)

  const editor = useEditor({
    // Obligatorio con SSR de TanStack Start: sin esto hay mismatch de hidratación.
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
      Placeholder.configure({ placeholder: placeholder ?? 'Escribe…' }),
      MarkdownExt.configure({
        html: false,
        bulletListMarker: '-',
        linkify: false,
        breaks: false,
        transformPastedText: true,
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class:
          'min-h-[4.5rem] max-h-80 overflow-y-auto rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand',
      },
    },
    onBlur: ({ editor: ed }) => {
      const text = md(ed)
      // Solo si cambió: un blur sin edición no debe escribir en la DB ni ensuciar la
      // bitácora de la tarea.
      if (text === lastSaved.current) return
      lastSaved.current = text
      onSave(text)
    },
  })

  // Contenido de FUERA (cambiar de tarea, refresco en vivo). Se ignora si es lo mismo que
  // ya hay: reescribirlo mientras escribes te mueve el cursor al inicio.
  useEffect(() => {
    if (!editor) return
    const current = md(editor)
    if (value !== current) {
      lastSaved.current = value
      editor.commands.setContent(value, { emitUpdate: false })
    }
  }, [value, editor])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  if (!editor) return null

  // Barra de formato: sin ella el editor se ve igual que el textarea de antes y nadie
  // descubre que hay negritas o listas. Aparece al enfocar para no ensuciar la lectura.
  const tools = [
    { on: 'bold', run: () => editor.chain().focus().toggleBold().run(), label: 'B', className: 'font-bold' },
    { on: 'italic', run: () => editor.chain().focus().toggleItalic().run(), label: 'i', className: 'italic' },
    { on: 'bulletList', run: () => editor.chain().focus().toggleBulletList().run(), label: '•', className: '' },
    { on: 'orderedList', run: () => editor.chain().focus().toggleOrderedList().run(), label: '1.', className: '' },
    { on: 'code', run: () => editor.chain().focus().toggleCode().run(), label: '</>', className: 'font-mono text-[10px]' },
  ]

  return (
    <div className="group">
      <div className="mb-1 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {tools.map((t) => (
          <button
            key={t.on}
            type="button"
            // mousedown + preventDefault: con click, el editor pierde el foco antes de
            // aplicar el formato (y dispararía el guardado del onBlur).
            onMouseDown={(e) => { e.preventDefault(); t.run() }}
            className={`h-6 w-6 rounded text-xs transition-colors ${t.className} ${
              editor.isActive(t.on) ? 'bg-brand/15 text-brand' : 'text-muted hover:bg-surface-3 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
