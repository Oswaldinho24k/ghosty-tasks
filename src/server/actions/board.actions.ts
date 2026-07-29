import { dbq, num } from "../../dbq.server";
import { defineAction, ActionInputError, type Action } from "./define";
import * as ops from "../ops/tasks.ops";

// Las acciones del tablero. Cada una es lo mismo que haría una persona con el mouse, y
// queda a nombre de quien la pidió (la bitácora usa `ctx.sub`).
//
// Regla que atraviesa todo: ante ambigüedad NO se elige. "La tarea de Oswaldo" con dos
// candidatas devuelve las dos y se pregunta — un agente que adivina y mueve la tarjeta
// equivocada cuesta más que uno que repregunta.

type Row = Record<string, string | null>;

const PRIORITIES = ["urgent", "high", "medium", "low"];

async function taskOf(projectId: number, id: number): Promise<Row> {
  const rows = await dbq("SELECT * FROM task_tasks WHERE id = ? AND project_id = ?", [id, projectId]);
  // Acotado al tablero del token: un id de otro proyecto no existe para esta sesión.
  if (!rows[0]) throw new ActionInputError(`no encuentro la tarea ${id} en este tablero`);
  return rows[0];
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
           FROM task_tasks WHERE project_id = ? AND parent_id IS NULL ORDER BY column_id, position`,
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
    return {
      columns: cols.map((c) => ({ id: num(c.id), name: c.name })),
      tasks: tasks.map((t) => ({
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
    const where: string[] = ["project_id = ?", "parent_id IS NULL"];
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
      const { listWorkspaceMembers } = await import("../../users.server");
      const members = await listWorkspaceMembers().catch(() => []);
      const q = input.assignee.replace(/^@/, "").toLowerCase();
      const hits = members.filter(
        (m) =>
          m.handle?.toLowerCase() === q ||
          m.email?.toLowerCase() === q ||
          m.name.toLowerCase().includes(q)
      );
      if (!hits.length) throw new ActionInputError(`no encuentro a "${input.assignee}" en el equipo`);
      if (hits.length > 1) {
        return {
          needs: "disambiguation" as const,
          reason: `hay varias personas que coinciden con "${input.assignee}"`,
          candidates: hits.map((m) => ({ sub: m.sub, name: m.name, handle: m.handle })),
        };
      }
      where.push("assignee_sub = ?");
      args.push(hits[0].sub);
    }

    const rows = await dbq(
      `SELECT id, title, column_id, status, priority, assignee_sub FROM task_tasks
        WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT 25`,
      args
    );
    return {
      count: rows.length,
      tasks: rows.map((t) => ({
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
    description: { type: "string", description: "Descripción" },
    priority: { type: "string", description: "Prioridad", enum: PRIORITIES },
    assignee_sub: { type: "string", description: "sub de la persona asignada (de list_board)" },
  },
  async run(ctx, input: { title: string; column?: string; description?: string; priority?: string; assignee_sub?: string }) {
    let columnId: number;
    if (input.column) {
      columnId = (await columnByName(ctx.projectId, input.column)).id;
    } else {
      const first = await dbq("SELECT id FROM task_columns WHERE project_id = ? ORDER BY position LIMIT 1", [ctx.projectId]);
      if (!first[0]) throw new ActionInputError("el tablero no tiene columnas");
      columnId = num(first[0].id);
    }
    const task = await ops.createTask(ctx.sub, {
      project_id: ctx.projectId,
      column_id: columnId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      assignee_sub: input.assignee_sub,
    });
    return { id: task.id, title: task.title, column_id: task.column_id };
  },
});

const moveTask = defineAction({
  name: "move_task",
  description: "Mueve una tarea a otra columna (queda al final de esa columna).",
  schema: {
    id: { type: "number", description: "id de la tarea", required: true },
    column: { type: "string", description: "Nombre de la columna destino", required: true },
  },
  async run(ctx, input: { id: number; column: string }) {
    await taskOf(ctx.projectId, input.id);
    const col = await columnByName(ctx.projectId, input.column);
    await ops.moveTaskToColumn(ctx.sub, { id: input.id, project_id: ctx.projectId, column_id: col.id });
    return { id: input.id, column: col.name };
  },
});

const updateTask = defineAction({
  name: "update_task",
  description: "Cambia campos de una tarea: título, descripción, prioridad, estado o a quién está asignada.",
  schema: {
    id: { type: "number", description: "id de la tarea", required: true },
    title: { type: "string", description: "Nuevo título" },
    description: { type: "string", description: "Nueva descripción" },
    priority: { type: "string", description: "Prioridad", enum: PRIORITIES },
    status: { type: "string", description: "Estado", enum: ["open", "done"] },
    assignee_sub: { type: "string", description: "sub de la persona; usa \"none\" para dejarla sin asignar" },
  },
  async run(ctx, input: { id: number; title?: string; description?: string; priority?: string; status?: string; assignee_sub?: string }) {
    await taskOf(ctx.projectId, input.id);
    await ops.updateTask(ctx.sub, {
      id: input.id,
      project_id: ctx.projectId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: input.status,
      assignee_sub: input.assignee_sub === "none" ? null : input.assignee_sub,
    });
    return { ok: true, id: input.id };
  },
});

const setLabels = defineAction({
  name: "set_labels",
  description: "Añade o quita etiquetas de una tarea. Las que ya tiene se conservan salvo que las quites.",
  schema: {
    id: { type: "number", description: "id de la tarea", required: true },
    add: { type: "string[]", description: "Etiquetas a añadir" },
    remove: { type: "string[]", description: "Etiquetas a quitar" },
  },
  async run(ctx, input: { id: number; add?: string[]; remove?: string[] }) {
    await taskOf(ctx.projectId, input.id);
    const current = await dbq("SELECT label, color FROM task_labels WHERE task_id = ?", [input.id]);
    // Reusa el color que esa etiqueta ya tenga en el tablero: dos "producción" de
    // colores distintos se ven como dos etiquetas diferentes.
    const known = await dbq(
      `SELECT DISTINCT l.label, l.color FROM task_labels l
         JOIN task_tasks t ON t.id = l.task_id WHERE t.project_id = ?`,
      [ctx.projectId]
    );
    const colorOf = new Map(known.map((k) => [(k.label ?? "").toLowerCase(), k.color ?? "#6b7280"]));

    const out = new Map(current.map((c) => [(c.label ?? "").toLowerCase(), { label: c.label ?? "", color: c.color ?? "#6b7280" }]));
    for (const l of input.remove ?? []) out.delete(l.trim().toLowerCase());
    for (const l of input.add ?? []) {
      const label = l.trim();
      if (!label) continue;
      out.set(label.toLowerCase(), { label, color: colorOf.get(label.toLowerCase()) ?? "#6b7280" });
    }
    const labels = [...out.values()];
    await ops.setTaskLabels(ctx.sub, { task_id: input.id, labels });
    return { id: input.id, labels: labels.map((l) => l.label) };
  },
});

const commentTask = defineAction({
  name: "comment_task",
  description: "Comenta en una tarea. El comentario queda a nombre de la persona que te pidió el trabajo.",
  schema: {
    id: { type: "number", description: "id de la tarea", required: true },
    body: { type: "string", description: "Texto del comentario", required: true },
  },
  async run(ctx, input: { id: number; body: string }) {
    await taskOf(ctx.projectId, input.id);
    const { listWorkspaceMembers } = await import("../../users.server");
    const me = (await listWorkspaceMembers().catch(() => [])).find((m) => m.sub === ctx.sub);
    const c = await ops.addComment(
      { sub: ctx.sub, name: me?.name ?? "Alguien", avatar: me?.avatar ?? "" },
      { task_id: input.id, body: input.body }
    );
    return { id: c.id };
  },
});

const addChecklistItem = defineAction({
  name: "add_checklist_item",
  description: "Añade un ítem al checklist de una tarea.",
  schema: {
    id: { type: "number", description: "id de la tarea", required: true },
    body: { type: "string", description: "Texto del ítem", required: true },
  },
  async run(ctx, input: { id: number; body: string }) {
    await taskOf(ctx.projectId, input.id);
    const item = await ops.addChecklistItem(ctx.sub, { task_id: input.id, body: input.body });
    return item;
  },
});

const deleteTask = defineAction({
  name: "delete_task",
  description:
    "Borra una tarea. Es irreversible: sin confirm=true solo te dice qué se borraría, para que se lo preguntes al usuario primero.",
  destructive: true,
  schema: {
    id: { type: "number", description: "id de la tarea", required: true },
    confirm: { type: "boolean", description: "true para borrar de verdad" },
  },
  async run(ctx, input: { id: number; confirm?: boolean }) {
    const t = await taskOf(ctx.projectId, input.id);
    if (!input.confirm) {
      return { needs: "confirmation" as const, would_delete: { id: input.id, title: t.title } };
    }
    await ops.deleteTask(ctx.sub, { id: input.id, project_id: ctx.projectId });
    return { ok: true, deleted: input.id };
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
  deleteTask,
] as unknown as Action<never, unknown>[];

export const ACTIONS_BY_NAME = new Map(ACTIONS.map((a) => [a.name, a]));
