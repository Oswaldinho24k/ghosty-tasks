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

  return <EditorContent editor={editor} />
}
