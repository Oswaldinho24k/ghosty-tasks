// Acciones: el trabajo se define UNA vez y lo usan todas las superficies — la UI (por
// su server-fn), el agente (por el endpoint de tools) y mañana un CLI o un MCP.
//
// La idea es de agent-native (BuilderIO): en vez de que el agente adivine la API o
// maneje la UI, la app declara sus capacidades. Lo importante para nosotros es el
// efecto secundario: el agente NO puede hacer nada que la UI no pueda, porque es el
// mismo `run`, y el schema no se escribe dos veces (una para el server-fn y otra para
// el catálogo de tools) — que es como esas dos listas se separan con el tiempo.
//
// Schema propio y minúsculo en vez de zod: lo que necesitamos es validar diez formas
// planas y poder EMITIR JSON Schema para el agente. Zod habría que traducirlo igual.

export type FieldType = "string" | "number" | "boolean" | "string[]";

export type Field = {
  type: FieldType;
  description: string;
  required?: boolean;
  /** Valores admitidos; se le muestran al agente y se validan de verdad. */
  enum?: string[];
};

export type Schema = Record<string, Field>;

/** Quién pide la acción. El mismo para la UI y para el agente: siempre hay una persona. */
export type ActionCtx = {
  sub: string;
  /** Tablero al que está acotada esta invocación (el token del agente lo fija). */
  projectId: number;
};

export type Action<I = Record<string, unknown>, O = unknown> = {
  name: string;
  description: string;
  schema: Schema;
  /** Cambia datos → el agente debe confirmarla si además es destructiva. */
  destructive?: boolean;
  run: (ctx: ActionCtx, input: I) => Promise<O>;
};

export function defineAction<I extends Record<string, unknown>, O>(a: Action<I, O>): Action<I, O> {
  return a;
}

/** JSON Schema para el `list` que consume el agente. */
export function toJsonSchema(schema: Schema) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, f] of Object.entries(schema)) {
    const type = f.type === "string[]" ? "array" : f.type;
    properties[key] = {
      type,
      description: f.description,
      ...(f.type === "string[]" ? { items: { type: "string" } } : {}),
      ...(f.enum ? { enum: f.enum } : {}),
    };
    if (f.required) required.push(key);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

export class ActionInputError extends Error {}

/**
 * Valida y coacciona. Es de verdad: el `validator` de los server-fn de TanStack es solo
 * un cast de TypeScript, y aquí del otro lado hay un modelo que puede mandar cualquier
 * cosa (un id como texto, una prioridad inventada).
 */
export function parseInput(schema: Schema, raw: unknown): Record<string, unknown> {
  const input = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // Una clave que no existe NO se ignora: se avisa. Ignorarla en silencio es cómo el
  // agente creó una tarea "asignada a oscar" que quedó sin asignar — mandó `assignee_sub`
  // (un nombre viejo del parámetro), el validador lo tiró, y el modelo reportó éxito
  // porque nadie le dijo lo contrario.
  const unknown = Object.keys(input).filter((k) => !(k in schema));
  if (unknown.length) {
    throw new ActionInputError(
      `no existe${unknown.length > 1 ? "n" : ""} ${unknown.map((k) => `"${k}"`).join(", ")}. ` +
        `Los campos de esta herramienta son: ${Object.keys(schema).join(", ")}`
    );
  }
  for (const [key, f] of Object.entries(schema)) {
    const v = input[key];
    if (v === undefined || v === null || v === "") {
      if (f.required) throw new ActionInputError(`falta "${key}"`);
      continue;
    }
    if (f.type === "number") {
      const n = typeof v === "number" ? v : Number(String(v));
      if (!Number.isFinite(n)) throw new ActionInputError(`"${key}" debe ser un número`);
      out[key] = n;
    } else if (f.type === "boolean") {
      out[key] = typeof v === "boolean" ? v : String(v) === "true";
    } else if (f.type === "string[]") {
      const arr = Array.isArray(v) ? v : [v];
      out[key] = arr.map((x) => String(x)).filter(Boolean);
    } else {
      const s = String(v);
      if (f.enum && !f.enum.includes(s)) {
        throw new ActionInputError(`"${key}" debe ser uno de: ${f.enum.join(", ")}`);
      }
      out[key] = s;
    }
  }
  return out;
}
