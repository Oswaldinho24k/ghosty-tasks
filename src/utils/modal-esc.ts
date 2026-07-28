// Stack de modales abiertos. Solo el modal de ARRIBA (el último abierto) responde a ESC.
// El stack vive en `window` (no en el módulo) para que dos chunks que importan este archivo
// compartan una sola instancia en lugar de tener dos stacks independientes.
//
// Uso: useEffect(() => registerModalEsc(onClose), [onClose]);

function getStack(): symbol[] {
  const w = window as unknown as { __modalEscStack?: symbol[] };
  return (w.__modalEscStack ??= []);
}

export function registerModalEsc(onClose: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const id = Symbol("modal");
  getStack().push(id);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const stack = getStack();
    if (stack[stack.length - 1] !== id) return;
    onClose();
  };
  window.addEventListener("keydown", onKey);
  return () => {
    const stack = getStack();
    const i = stack.indexOf(id);
    if (i !== -1) stack.splice(i, 1);
    window.removeEventListener("keydown", onKey);
  };
}
