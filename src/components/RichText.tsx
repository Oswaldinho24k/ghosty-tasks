import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown as MarkdownExt } from 'tiptap-markdown'
import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { Bold, Italic, Strikethrough, Link2, List, ListOrdered, Quote, Code } from 'lucide-react'

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
      // ⚠️ Los tres estaban apagados y el resultado era que un enlace **existía pero no lo
      // parecía**: `openOnClick:false` hacía que el clic sólo moviera el cursor, y sin
      // `autolink` una URL pegada a secas se quedaba en texto. El agente escribía la liga
      // del PR y quien abría la tarea no tenía cómo llegar.
      //
      // `openOnClick` con Cmd/Ctrl: en un editor, un clic normal tiene que poder colocar el
      // cursor DENTRO del enlace para editarlo — eso es lo que protegía el false.
      StarterKit.configure({
        link: {
          openOnClick: true,
          autolink: true,
          defaultProtocol: 'https',
          HTMLAttributes: { target: '_blank', rel: 'noreferrer noopener' },
        },
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Escribe…' }),
      MarkdownExt.configure({
        // Se acepta HTML al PARSEAR: si algo llega con etiquetas (el agente lo hizo una
        // vez), se convierte en nodos de verdad en vez de enseñarse crudo. Al guardar
        // siempre sale markdown.
        html: true,
        bulletListMarker: '-',
        // URLs a secas del agente → enlaces al PARSEAR, no sólo al teclear.
        linkify: true,
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

  // Calcado del compositor de Ghosty Teams: íconos, no letras sueltas, y siempre visible
  // —esconderla en hover la vuelve un secreto—.
  const tools = [
    { icon: Bold, title: 'Negrita', active: editor.isActive('bold'), fn: () => editor.chain().focus().toggleBold().run() },
    { icon: Italic, title: 'Itálica', active: editor.isActive('italic'), fn: () => editor.chain().focus().toggleItalic().run() },
    { icon: Strikethrough, title: 'Tachado', active: editor.isActive('strike'), fn: () => editor.chain().focus().toggleStrike().run() },
    {
      icon: Link2,
      title: 'Enlace',
      active: editor.isActive('link'),
      fn: () => {
        const prev = editor.getAttributes('link').href as string | undefined
        const url = window.prompt('URL del enlace', prev || 'https://')
        if (url === null) return
        if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
        else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      },
    },
    { icon: List, title: 'Lista', active: editor.isActive('bulletList'), fn: () => editor.chain().focus().toggleBulletList().run() },
    { icon: ListOrdered, title: 'Lista numerada', active: editor.isActive('orderedList'), fn: () => editor.chain().focus().toggleOrderedList().run() },
    { icon: Quote, title: 'Cita', active: editor.isActive('blockquote'), fn: () => editor.chain().focus().toggleBlockquote().run() },
    { icon: Code, title: 'Código', active: editor.isActive('code'), fn: () => editor.chain().focus().toggleCode().run() },
  ]

  return (
    <div>
      <div className="mb-1 flex items-center gap-0.5">
        {tools.map((tool, i) => (
          <button
            key={i}
            type="button"
            title={tool.title}
            // No robarle el foco al editor: con click se pierde y además dispara el guardado.
            onMouseDown={(e) => e.preventDefault()}
            onClick={tool.fn}
            className={`grid h-7 w-7 place-items-center rounded-md transition hover:bg-surface-2 hover:text-ink ${
              tool.active ? 'bg-surface-2 text-brand' : 'text-muted'
            }`}
          >
            <tool.icon size={15} />
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
