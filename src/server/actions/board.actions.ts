import { dbq, num } from "../../dbq.server";
import { defineAction, ActionInputError, type Action } from "./define";
import { parseTaskRef, taskRef } from "../../utils/taskRef";
import * as ops from "../ops/tasks.ops";

// Las acciones del tablero. Cada una es lo mismo que haría una persona con el mouse, y
// queda a nombre de quien la pidió (la bitácora usa `ctx.sub`).
//
// Regla que atraviesa todo: ante ambigüedad NO se elige. "La tarea de Oswaldo" con dos
// candidatas devuelve las dos y se pregunta — un agente que adivina y mueve la tarjeta
// equivocada cuesta más que uno que repregunta.

type Row = Record<string, string | null>;

const PRIORITIES = ["urgent", "high", "medium", "low"];

/**
 * Fecha de vencimiento en epoch (segundos). Acepta ISO ("2026-08-15") y las formas en las
 * que la gente habla: "hoy", "mañana", "none" para quitarla.
 */
function parseDue(v: string): number | null {
  const q = v.trim().toLowerCase();
  if (!q || q === "none" || q === "ninguna" || q === "sin fecha") return null;
  const day = 86400;
  const midnight = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  if (q === "hoy" || q === "today") return midnight;
  if (q === "mañana" || q === "manana" || q === "tomorrow") return midnight + day;
  const m = q.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return Math.floor(new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).getTime() / 1000);
  throw new ActionInputError(`no entiendo la fecha "${v}". Usa AAAA-MM-DD, "hoy" o "mañana"`);
}

async function taskOf(projectId: number, ref: number | string): Promise<Row> {
  // Acepta "GST-4", "#4" o 4: la gente le habla al agente con la referencia que ve en la
  // tarjeta, no con el id interno.
  const id = parseTaskRef(ref);
  if (!id) throw new ActionInputError(`no entiendo la referencia "${ref}"`);
  const rows = await dbq("SELECT * FROM task_tasks WHERE id = ? AND project_id = ?", [id, projectId]);
  // Acotado al tablero del token: un id de otro proyecto no existe para esta sesión.
  if (!rows[0]) throw new ActionInputError(`no encuentro la tarea ${id} en este tablero`);
  return rows[0];
}

/**
 * Resuelve a una persona por nombre, @handle, correo — o "yo"/"mí", que es como habla
 * quien te está pidiendo el trabajo. Sin esto el agente tenía que mapear nombres a
 * `sub` de memoria, y terminaba preguntando "¿cuál de los miembros eres tú?".
 */
async function memberBy(ctx: { sub: string }, q: string): Promise<{ sub: string; name: string } | { candidates: Array<{ sub: string; name: string; handle: string }> }> {
  const { listWorkspaceMembers } = await import("../../users.server");
  const members = await listWorkspaceMembers().catch(() => []);
  const needle = q.trim().replace(/^@/, "").toLowerCase();
  if (["yo", "mi", "mí", "me", "myself"].includes(needle)) {
    const me = members.find((m) => m.sub === ctx.sub);
    return { sub: ctx.sub, name: me?.name ?? "tú" };
  }
  const hits = members.filter(
    (m) =>
      m.sub === q ||
      m.handle?.toLowerCase() === needle ||
      m.email?.toLowerCase() === needle ||
      m.name.toLowerCase().includes(needle)
  );
  if (!hits.length) throw new ActionInputError(`no encuentro a "${q}" en el equipo`);
  if (hits.length > 1) {
    return { candidates: hits.map((m) => ({ sub: m.sub, name: m.name, handle: m.handle })) };
  }
  return { sub: hits[0].sub, name: hits[0].name };
}

async function columnByName(projectId: number, name: string) {
  const cols = await dbq("SELECT id, name FROM task_columns WHERE project_id = ? ORDER BY position", [projectId]);
  const norm = (s: string) => s.trim().toLowerCase();
  const exact = cols.filter((c) => norm(c.name ?? "") === norm(name));
  const partial = cols.filter((c) => norm(c.name ?? "").includes(norm(name)));
  const hit = exact[0] ?? (partial.length === 1 ? partial[0] : null);
  if (!hit) {
    throw new ActionInputError(
      `no hay una columna "${name}". Las que existen: ${cols.map((c) => c.name).join(", ")}`
    );
  }
  return { id: num(hit.id), name: hit.name ?? "" };
}

const listBoard = defineAction({
  name: "list_board",
  description:
    "El estado del tablero: columnas con sus tareas, etiquetas usadas y miembros del equipo. Úsala antes de mover o asignar para saber qué ids existen.",
  schema: {},
  async run(ctx) {
    const [cols, tasks, labels] = await Promise.all([
      dbq("SELECT id, name, position FROM task_columns WHERE project_id = ? ORDER BY position", [ctx.projectId]),
      dbq(
        `SELECT id, title, column_id, status, priority, assignee_sub, due_date
           FROM task_tasks WHERE project_id = ? AND parent_id IS NULL AND COALESCE(archived,0) = 0
          ORDER BY column_id, position`,
        [ctx.projectId]
      ),
      dbq(
        `SELECT DISTINCT l.label, l.color FROM task_labels l
           JOIN task_tasks t ON t.id = l.task_id WHERE t.project_id = ?`,
        [ctx.projectId]
      ),
    ]);
    const { listWorkspaceMembers } = await import("../../users.server");
    const members = await listWorkspaceMembers().catch(() => []);
    const byId = new Map(members.map((m) => [m.sub, m.name]));
    const proj = await dbq("SELECT name FROM task_projects WHERE id = ?", [ctx.projectId]);
    const pname = proj[0]?.name ?? "";
    return {
      columns: cols.map((c) => ({ id: num(c.id), name: c.name })),
      // `ref` es lo que la persona ve en la tarjeta: úsalo al hablar de una tarea.
      tasks: tasks.map((t) => ({
        ref: taskRef(pname, num(t.id)),
        id: num(t.id),
        title: t.title,
        column_id: num(t.column_id),
        status: t.status,
        priority: t.priority,
        assignee: t.assignee_sub ? byId.get(t.assignee_sub) ?? t.assignee_sub : null,
        assignee_sub: t.assignee_sub,
        due_date: t.due_date ? num(t.due_date) : null,
      })),
      labels: labels.map((l) => ({ label: l.label, color: l.color })),
      members: members.map((m) => ({ sub: m.sub, name: m.name, handle: m.handle })),
    };
  },
});

const findTasks = defineAction({
  name: "find_tasks",
  description:
    "Busca tareas por texto, persona asignada, columna, prioridad o estado. Devuelve candidatas: si hay más de una y el usuario habló de UNA, pregúntale cuál en vez de elegir tú.",
  schema: {
    text: { type: "string", description: "Texto en el título o la descripción" },
    assignee: { type: "string", description: "Nombre, @handle o correo de la persona asignada" },
    column: { type: "string", description: "Nombre de la columna" },
    priority: { type: "string", description: "Prioridad", enum: PRIORITIES },
    status: { type: "string", description: "open | done" },
  },
  async run(ctx, input: { text?: string; assignee?: string; column?: string; priority?: string; status?: string }) {
    const where: string[] = ["project_id = ?", "parent_id IS NULL", "COALESCE(archived,0) = 0"];
    const args: unknown[] = [ctx.projectId];

    if (input.text) {
      where.push("(lower(title) LIKE ? OR lower(COALESCE(description,'')) LIKE ?)");
      const like = `%${input.text.toLowerCase()}%`;
      args.push(like, like);
    }
    if (input.priority) { where.push("priority = ?"); args.push(input.priority); }
    if (input.status) { where.push("status = ?"); args.push(input.status); }
    if (input.column) {
      const col = await columnByName(ctx.projectId, input.column);
      where.push("column_id = ?");
      args.push(col.id);
    }
    if (input.assignee) {
      const who = await memberBy(ctx, input.assignee);
      if ("candidates" in who) {
        return {
          needs: "disambiguation" as const,
          reason: `hay varias personas que coinciden con "${input.assignee}"`,
          candidates: who.candidates,
        };
      }
      where.push("assignee_sub = ?");
      args.push(who.sub);
    }

    const rows = await dbq(
      `SELECT id, title, column_id, status, priority, assignee_sub FROM task_tasks
        WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT 25`,
      args
    );
    const proj = await dbq("SELECT name FROM task_projects WHERE id = ?", [ctx.projectId]);
    const pname = proj[0]?.name ?? "";
    return {
      count: rows.length,
      tasks: rows.map((t) => ({
        ref: taskRef(pname, num(t.id)),
        id: num(t.id),
        title: t.title,
        column_id: num(t.column_id),
        status: t.status,
        priority: t.priority,
        assignee_sub: t.assignee_sub,
      })),
    };
  },
});

const createTask = defineAction({
  name: "create_task",
  description: "Crea una tarea en el tablero.",
  schema: {
    title: { type: "string", description: "Título", required: true },
    column: { type: "string", description: "Nombre de la columna (por defecto, la primera)" },
    description: {
      type: "string",
      description:
        "Descripción en MARKDOWN (## títulos, **negritas**, listas con -, > citas, `código`). Nada de HTML: el editor guarda markdown.",
    },
    priority: { type: "string", description: "Prioridad", enum: PRIORITIES },
    assignee: {
      type: "string",
      description: 'A quién se asigna: nombre, @handle, correo — o "yo" para quien te está hablando',
    },
    labels: { type: "string[]", description: "Etiquetas a ponerle" },
    due: { type: "string", description: 'Fecha de vencimiento: AAAA-MM-DD, "hoy" o "mañana"' },
  },
  async run(ctx, input: { title: string; column?: string; description?: string; priority?: string; assignee?: string; labels?: string[]; due?: string }) {
    let columnId: number;
    if (input.column) {
      columnId = (await columnByName(ctx.projectId, input.column)).id;
    } else {
      const first = await dbq("SELECT id FROM task_columns WHERE project_id = ? ORDER BY position LIMIT 1", [ctx.projectId]);
      if (!first[0]) throw new ActionInputError("el tablero no tiene columnas");
      columnId = num(first[0].id);
    }
    let assigneeSub: string | undefined;
    let assigneeName: string | undefined;
    if (input.assignee) {
      const who = await memberBy(ctx, input.assignee);
      if ("candidates" in who) {
        return { needs: "disambiguation" as const, reason: `¿a cuál te refieres?`, candidates: who.candidates };
      }
      assigneeSub = who.sub;
      assigneeName = who.name;
    }
    const task = await ops.createTask(ctx.sub, {
      project_id: ctx.projectId,
      column_id: columnId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      assignee_sub: assigneeSub,
      due_date: input.due ? parseDue(input.due) ?? undefined : undefined,
    });
    if (input.labels?.length) {
      await setLabelsOn(ctx, task.id, input.labels, []);
    }
    // Se devuelve a QUIÉN quedó asignada (no lo que se pidió): si el agente cuenta que la
    // asignó, que sea porque el tablero lo dice.
    return {
      id: task.id,
      title: task.title,
      column_id: task.column_id,
      assigned_to: assigneeName ?? null,
      labels: input.labels ?? [],
    };
  },
});

const moveTask = defineAction({
  name: "move_task",
  description: "Mueve una tarea a otra columna (queda al final de esa columna).",
  schema: {
    id: { type: "string", description: 'Referencia de la tarea, como aparece en la tarjeta ("GST-4"); también acepta el número', required: true },
    column: { type: "string", description: "Nombre de la columna destino", required: true },
  },
  async run(ctx, input: { id: string; column: string }) {
    const t = await taskOf(ctx.projectId, input.id);
    const id = num(t.id);
    const col = await columnByName(ctx.projectId, input.column);
    await ops.moveTaskToColumn(ctx.sub, { id, project_id: ctx.projectId, column_id: col.id });
    return { id, column: col.name };
  },
});

const updateTask = defineAction({
  name: "update_task",
  description: "Cambia campos de una tarea: título, descripción, prioridad, estado o a quién está asignada.",
  schema: {
    id: { type: "string", description: 'Referencia de la tarea, como aparece en la tarjeta ("GST-4"); también acepta el número', required: true },
    title: { type: "string", description: "Nuevo título" },
    description: {
      type: "string",
      description: "Nueva descripción en MARKDOWN (no HTML)",
    },
    priority: { type: "string", description: "Prioridad", enum: PRIORITIES },
    status: { type: "string", description: "Estado", enum: ["open", "done"] },
    assignee: {
      type: "string",
      description: 'A quién se asigna: nombre, @handle, correo, "yo" — o "none" para dejarla sin asignar',
    },
    due: {
      type: "string",
      description: 'Vencimiento: AAAA-MM-DD, "hoy", "mañana" — o "none" para quitarlo',
    },
  },
  async run(ctx, input: { id: string; title?: string; description?: string; priority?: string; status?: string; assignee?: string; due?: string }) {
    const t = await taskOf(ctx.projectId, input.id);
    const id = num(t.id);
    let assignee: string | null | undefined;
    if (input.assignee === "none") assignee = null;
    else if (input.assignee) {
      const who = await memberBy(ctx, input.assignee);
      if ("candidates" in who) {
        return { needs: "disambiguation" as const, reason: `¿a cuál te refieres?`, candidates: who.candidates };
      }
      assignee = who.sub;
    }
    await ops.updateTask(ctx.sub, {
      id,
      project_id: ctx.projectId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: input.status,
      assignee_sub: assignee,
      due_date: input.due !== undefined ? parseDue(input.due) : undefined,
    });
    return { ok: true, id };
  },
});

/** Añade/quita etiquetas conservando las que ya tiene y reusando su color del tablero. */
async function setLabelsOn(ctx: { sub: string; projectId: number }, taskId: number, add: string[], remove: string[]) {
  const current = await dbq("SELECT label, color FROM task_labels WHERE task_id = ?", [taskId]);
  const known = await dbq(
    `SELECT DISTINCT l.label, l.color FROM task_labels l
       JOIN task_tasks t ON t.id = l.task_id WHERE t.project_id = ?`,
    [ctx.projectId]
  );
  const colorOf = new Map(known.map((k) => [(k.label ?? "").toLowerCase(), k.color ?? "#6b7280"]));
  const out = new Map(
    current.map((c) => [(c.label ?? "").toLowerCase(), { label: c.label ?? "", color: c.color ?? "#6b7280" }])
  );
  for (const l of remove) out.delete(l.trim().toLowerCase());
  for (const l of add) {
    const label = l.trim();
    if (!label) continue;
    out.set(label.toLowerCase(), { label, color: colorOf.get(label.toLowerCase()) ?? "#6b7280" });
  }
  const labels = [...out.values()];
  await ops.setTaskLabels(ctx.sub, { task_id: taskId, labels });
  return labels.map((l) => l.label);
}

const setLabels = defineAction({
  name: "set_labels",
  description: "Añade o quita etiquetas de una tarea. Las que ya tiene se conservan salvo que las quites.",
  schema: {
    id: { type: "string", description: 'Referencia de la tarea, como aparece en la tarjeta ("GST-4"); también acepta el número', required: true },
    add: { type: "string[]", description: "Etiquetas a añadir" },
    remove: { type: "string[]", description: "Etiquetas a quitar" },
  },
  async run(ctx, input: { id: string; add?: string[]; remove?: string[] }) {
    const t = await taskOf(ctx.projectId, input.id);
    const id = num(t.id);
    const labels = await setLabelsOn(ctx, id, input.add ?? [], input.remove ?? []);
    return { id, labels };
  },
});

const commentTask = defineAction({
  name: "comment_task",
  description: "Comenta en una tarea. El comentario queda a nombre de la persona que te pidió el trabajo.",
  schema: {
    id: { type: "string", description: 'Referencia de la tarea, como aparece en la tarjeta ("GST-4"); también acepta el número', required: true },
    body: { type: "string", description: "Texto del comentario", required: true },
  },
  async run(ctx, input: { id: string; body: string }) {
    const t = await taskOf(ctx.projectId, input.id);
    const id = num(t.id);
    const { listWorkspaceMembers } = await import("../../users.server");
    const me = (await listWorkspaceMembers().catch(() => [])).find((m) => m.sub === ctx.sub);
    const c = await ops.addComment(
      { sub: ctx.sub, name: me?.name ?? "Alguien", avatar: me?.avatar ?? "" },
      { task_id: id, body: input.body }
    );
    return { id: c.id };
  },
});

const addChecklistItem = defineAction({
  name: "add_checklist_item",
  description: "Añade un ítem al checklist de una tarea.",
  schema: {
    id: { type: "string", description: 'Referencia de la tarea, como aparece en la tarjeta ("GST-4"); también acepta el número', required: true },
    body: { type: "string", description: "Texto del ítem", required: true },
  },
  async run(ctx, input: { id: string; body: string }) {
    const t = await taskOf(ctx.projectId, input.id);
    const id = num(t.id);
    const item = await ops.addChecklistItem(ctx.sub, { task_id: id, body: input.body });
    return item;
  },
});

const deleteTask = defineAction({
  name: "delete_task",
  description:
    "Archiva una tarea: sale del tablero pero se puede recuperar. Sin confirm=true solo te dice cuál sería, para que se lo preguntes al usuario primero.",
  destructive: true,
  schema: {
    id: { type: "string", description: 'Referencia de la tarea, como aparece en la tarjeta ("GST-4"); también acepta el número', required: true },
    confirm: { type: "boolean", description: "true para archivarla de verdad" },
  },
  async run(ctx, input: { id: string; confirm?: boolean }) {
    const t = await taskOf(ctx.projectId, input.id);
    const id = num(t.id);
    if (!input.confirm) {
      return { needs: "confirmation" as const, would_archive: { id, title: t.title } };
    }
    await ops.deleteTask(ctx.sub, { id, project_id: ctx.projectId });
    return { ok: true, archived: id, note: "se puede recuperar" };
  },
});

// Sumar a alguien del workspace al tablero. Es una capacidad EXCLUSIVA del agente: la
// interfaz solo ofrece a los que ya participan, para que la lista no sea el workspace
// entero. Pedírselo al agente ("mete a Oscar") es el camino explícito; asignarle una
// tarea es el implícito.
const addMember = defineAction({
  name: "add_member",
  description:
    "Suma a alguien del equipo a este tablero para que pueda trabajarlo. Úsala cuando te pidan agregar a una persona, o antes de asignarle algo si no participa todavía.",
  schema: {
    who: { type: "string", description: 'Nombre, @handle, correo o "yo"', required: true },
  },
  async run(ctx, input: { who: string }) {
    const person = await memberBy(ctx, input.who);
    if ("candidates" in person) {
      return { needs: "disambiguation" as const, reason: `¿a cuál te refieres?`, candidates: person.candidates };
    }
    const { joinByAssignment } = await import("../ops/access");
    await joinByAssignment(ctx.projectId, person.sub);
    return { ok: true, added: person.name };
  },
});

/* ── Desarrollo: PRs, issues y ligas de una tarea ─────────────────────────── */
// El "development panel" de Jira / los attachments de Linear. Pegar la URL en la
// descripción funciona una vez; esto además se ve desde el tablero y deja que la tarea
// reaccione a lo que le pase al PR.

/**
 * Normaliza el estado a un vocabulario CERRADO.
 *
 * ⚠️ El modelo escribe lo que le parece —"rejected", "cerrado", "aprobado"— y un estado que
 * el pintor no conoce caía al color de "todo bien". Un PR rechazado en verde es peor que un
 * PR sin color.
 */
function normalizeState(v: unknown): string | null {
  const q = String(v ?? "").trim().toLowerCase();
  if (!q) return null;
  if (/(^|\W)(merged|mergeado|fusionado)/.test(q)) return "merged";
  if (/(^|\W)(draft|borrador)/.test(q)) return "draft";
  if (/(^|\W)(closed|rejected|cerrado|rechazad|declined)/.test(q)) return "closed";
  if (/(^|\W)(open|abierto|opened)/.test(q)) return "open";
  // Desconocido → sin estado. Mejor un chip neutro que uno que miente de color.
  return null;
}

/** "https://github.com/dueño/repo/pull/165" → {kind:"pr", ref:"dueño/repo#165"} */
function classifyLink(url: string): { kind: string; ref: string | null } {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/i);
  if (m) return { kind: m[3].toLowerCase() === "pull" ? "pr" : "issue", ref: `${m[1]}/${m[2]}#${m[4]}` };
  return { kind: "url", ref: null };
}

const linkTask = defineAction({
  name: "link_task",
  description:
    "Cuelga un pull request, un issue o una liga de una tarea. Úsala SIEMPRE que la tarea nazca de un PR o un issue: aparece como chip en el tablero y en el panel, en vez de perderse dentro del texto de la descripción.",
  schema: {
    id: { type: "string", description: 'La tarea ("GStudio-6", "#6" o 6).', required: true },
    url: { type: "string", description: "La URL completa.", required: true },
    title: { type: "string", description: "Título corto de lo que se enlaza." },
    state: { type: "string", description: "Estado si lo sabes, EXACTAMENTE uno de: open, draft, merged, closed. Un PR rechazado o cerrado es closed." },
  },
  async run(ctx, input: { id: string; url: string; title?: string; state?: string }) {
    const t = await taskOf(ctx.projectId, input.id);
    const url = String(input.url).trim();
    if (!/^https?:\/\//i.test(url)) throw new ActionInputError("la url tiene que empezar con http(s)://");
    const { kind, ref } = classifyLink(url);
    await dbq(
      `INSERT INTO task_links (task_id, kind, url, ref, title, state, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_id, url) DO UPDATE SET title = COALESCE(excluded.title, task_links.title),
                                               state = COALESCE(excluded.state, task_links.state),
                                               updated_at = unixepoch()`,
      [num(t.id), kind, url, ref, input.title ?? null, normalizeState(input.state), ctx.sub]
    );
    const { publish, ch } = await import("../bus.server");
    publish(ch.project(ctx.projectId), { t: "task:updated", id: num(t.id) } as never);
    return { ok: true, linked: ref ?? url, kind };
  },
});

const unlinkTask = defineAction({
  name: "unlink_task",
  description: "Quita una liga de una tarea.",
  schema: {
    id: { type: "string", description: "La tarea.", required: true },
    url: { type: "string", description: "La URL a quitar.", required: true },
  },
  async run(ctx, input: { id: string; url: string }) {
    const t = await taskOf(ctx.projectId, input.id);
    await dbq("DELETE FROM task_links WHERE task_id = ? AND url = ?", [num(t.id), String(input.url)]);
    return { ok: true };
  },
});

/* ── Acciones de ESPACIO ──────────────────────────────────────────────────── */
// Por encima del tablero: listar los que hay y crear uno. Van con `scope: "workspace"`
// porque el token del agente fija un `projectId` y "créame un tablero" no puede tener uno
// todavía. Sin esto, cada superficie acababa reimplementando "crear tablero" por su cuenta —
// que es justo lo que este archivo evita.

const listBoards = defineAction({
  name: "list_boards",
  description:
    "Lista los tableros de este espacio. Úsala cuando no sepas en cuál trabajar o te pregunten qué tableros hay.",
  schema: {},
  scope: "workspace",
  run: async () => {
    const { listProjects } = await import("../ops/projects.ops");
    const boards = await listProjects();
    return { boards: boards.map((b) => ({ name: b.name, slug: b.slug })) };
  },
});

const createBoard = defineAction({
  name: "create_board",
  description:
    "Crea un tablero nuevo, con sus columnas To Do / In Progress / Done. Úsala sólo si te piden trabajar en uno que no existe: comprueba antes con list_boards.",
  schema: {
    name: { type: "string", description: "Nombre del tablero.", required: true },
  },
  scope: "workspace",
  run: async (ctx, input: { name: string }) => {
    const { createProject } = await import("../ops/projects.ops");
    const b = await createProject(ctx.sub, { name: input.name });
    return { created: b.name, slug: b.slug, id: b.id, columns: ["To Do", "In Progress", "Done"] };
  },
});

export const ACTIONS: Action<never, unknown>[] = [
  listBoard,
  findTasks,
  createTask,
  moveTask,
  updateTask,
  setLabels,
  commentTask,
  addChecklistItem,
  addMember,
  deleteTask,
  linkTask,
  unlinkTask,
  listBoards,
  createBoard,
] as unknown as Action<never, unknown>[];

export const ACTIONS_BY_NAME = new Map(ACTIONS.map((a) => [a.name, a]));
