import { dbq, num } from "../../dbq.server";
import { publish, ch } from "../bus.server";
import type { Task } from "../projects";

// Las mutaciones, sin sesión: reciben QUIÉN las pide.
//
// Antes vivían dentro de los server-fn, que sacaban el `sub` de la cookie. El agente
// también actúa en nombre de una persona (la que le habló), así que necesita el mismo
// cuerpo con otro origen de identidad. Duplicarlo habría dejado dos "mover una tarea"
// que divergen; esto es la única implementación, y el server-fn queda como cáscara.
//
// Todas publican en el bus igual que la UI: si el agente mueve una tarjeta, se mueve en
// la pantalla de todos, no en el próximo refresh.

export function rowToTask(r: Record<string, string | null>): Task {
  return {
    id: num(r.id),
    project_id: num(r.project_id),
    column_id: num(r.column_id),
    parent_id: r.parent_id != null ? num(r.parent_id) : null,
    title: r.title ?? "",
    description: r.description,
    status: r.status ?? "open",
    priority: r.priority,
    assignee_sub: r.assignee_sub,
    due_date: r.due_date != null ? num(r.due_date) : null,
    position: parseFloat(r.position ?? "0"),
    created_by: r.created_by ?? "",
    created_at: num(r.created_at),
    updated_at: num(r.updated_at),
  };
}

async function nextPosition(column_id: number): Promise<number> {
  const rows = await dbq(
    "SELECT COALESCE(MAX(position), 0) as m FROM task_tasks WHERE column_id = ? AND parent_id IS NULL",
    [column_id]
  );
  return parseFloat(rows[0]?.m ?? "0") + 1000;
}

async function track(taskId: number, sub: string, action: string, oldVal: string | null, newVal: string | null) {
  await dbq(
    "INSERT INTO task_activities (task_id, user_sub, action, old_val, new_val) VALUES (?, ?, ?, ?, ?)",
    [taskId, sub, action, oldVal, newVal]
  );
}

export type CreateTaskInput = {
  project_id: number;
  column_id: number;
  title: string;
  description?: string;
  priority?: string;
  assignee_sub?: string;
  due_date?: number;
  parent_id?: number;
};

export async function createTask(sub: string, data: CreateTaskInput): Promise<Task> {
  const position = await nextPosition(data.column_id);
  const rows = await dbq(
    `INSERT INTO task_tasks (project_id, column_id, parent_id, title, description, priority, assignee_sub, due_date, position, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch()) RETURNING *`,
    [data.project_id, data.column_id, data.parent_id ?? null, data.title, data.description ?? null,
     data.priority ?? null, data.assignee_sub ?? null, data.due_date ?? null, position, sub]
  );
  const task = rowToTask(rows[0]);
  await dbq("INSERT INTO task_activities (task_id, user_sub, action) VALUES (?, ?, ?)", [task.id, sub, "created"]);
  await publish(ch.project(data.project_id), { t: "task:created", task });
  return task;
}

export type UpdateTaskInput = {
  id: number;
  project_id: number;
  title?: string;
  description?: string;
  priority?: string | null;
  assignee_sub?: string | null;
  due_date?: number | null;
  status?: string;
  column_id?: number;
};

export async function updateTask(sub: string, data: UpdateTaskInput): Promise<void> {
  const current = await dbq("SELECT * FROM task_tasks WHERE id = ?", [data.id]);
  if (!current[0]) throw new Error("task not found");

  const sets: string[] = ["updated_at = unixepoch()"];
  const args: unknown[] = [];
  const patch: Record<string, unknown> = {};

  if (data.title !== undefined) { sets.push("title = ?"); args.push(data.title); patch.title = data.title; }
  if (data.description !== undefined) { sets.push("description = ?"); args.push(data.description); patch.description = data.description; }
  if (data.priority !== undefined) {
    sets.push("priority = ?"); args.push(data.priority); patch.priority = data.priority;
    await track(data.id, sub, "priority_changed", current[0].priority, data.priority);
  }
  if (data.assignee_sub !== undefined) {
    sets.push("assignee_sub = ?"); args.push(data.assignee_sub); patch.assignee_sub = data.assignee_sub;
    await track(data.id, sub, "assigned", current[0].assignee_sub, data.assignee_sub);
  }
  if (data.due_date !== undefined) { sets.push("due_date = ?"); args.push(data.due_date); patch.due_date = data.due_date; }
  if (data.status !== undefined) {
    sets.push("status = ?"); args.push(data.status); patch.status = data.status;
    await track(data.id, sub, "status_changed", current[0].status, data.status);
  }
  if (data.column_id !== undefined) {
    sets.push("column_id = ?"); args.push(data.column_id); patch.column_id = data.column_id;
    await track(data.id, sub, "moved", current[0].column_id, String(data.column_id));
  }

  args.push(data.id);
  await dbq(`UPDATE task_tasks SET ${sets.join(", ")} WHERE id = ?`, args);
  await publish(ch.project(data.project_id), { t: "task:updated", id: data.id, patch });
}

export async function moveTask(
  sub: string,
  data: { id: number; project_id: number; column_id: number; prev_position: number | null; next_position: number | null }
): Promise<number> {
  const prev = data.prev_position ?? 0;
  const next = data.next_position ?? prev + 2000;
  const position = (prev + next) / 2;
  await dbq("UPDATE task_tasks SET column_id = ?, position = ?, updated_at = unixepoch() WHERE id = ?",
    [data.column_id, position, data.id]);
  await dbq("INSERT INTO task_activities (task_id, user_sub, action, new_val) VALUES (?, ?, ?, ?)",
    [data.id, sub, "moved", String(data.column_id)]);
  await publish(ch.project(data.project_id), { t: "task:moved", id: data.id, column_id: data.column_id, position });
  return position;
}

/** Mueve al FINAL de una columna. Es lo que quiere decir "muévela a Done". */
export async function moveTaskToColumn(sub: string, data: { id: number; project_id: number; column_id: number }) {
  const position = await nextPosition(data.column_id);
  await dbq("UPDATE task_tasks SET column_id = ?, position = ?, updated_at = unixepoch() WHERE id = ?",
    [data.column_id, position, data.id]);
  await dbq("INSERT INTO task_activities (task_id, user_sub, action, new_val) VALUES (?, ?, ?, ?)",
    [data.id, sub, "moved", String(data.column_id)]);
  await publish(ch.project(data.project_id), { t: "task:moved", id: data.id, column_id: data.column_id, position });
  return position;
}

export async function deleteTask(_sub: string, data: { id: number; project_id: number }): Promise<void> {
  await dbq("DELETE FROM task_checklist_items WHERE task_id = ?", [data.id]);
  await dbq("DELETE FROM task_comments WHERE task_id = ?", [data.id]);
  await dbq("DELETE FROM task_labels WHERE task_id = ?", [data.id]);
  await dbq("DELETE FROM task_activities WHERE task_id = ?", [data.id]);
  await dbq("DELETE FROM task_tasks WHERE id = ?", [data.id]);
  await publish(ch.project(data.project_id), { t: "task:deleted", id: data.id, project_id: data.project_id });
}

export async function setTaskLabels(
  _sub: string,
  data: { task_id: number; labels: { label: string; color: string }[] }
): Promise<void> {
  const rows = await dbq("SELECT project_id FROM task_tasks WHERE id = ?", [data.task_id]);
  const projectId = num(rows[0]?.project_id);
  await dbq("DELETE FROM task_labels WHERE task_id = ?", [data.task_id]);
  for (const l of data.labels) {
    await dbq("INSERT OR IGNORE INTO task_labels (task_id, label, color) VALUES (?, ?, ?)",
      [data.task_id, l.label, l.color]);
  }
  if (projectId) {
    await publish(ch.project(projectId), { t: "task:updated", id: data.task_id, patch: { labels: data.labels } });
  }
}

export async function addComment(
  user: { sub: string; name: string; avatar: string },
  data: { task_id: number; body: string }
) {
  const rows = await dbq(
    `INSERT INTO task_comments (task_id, sender_sub, sender_name, avatar, body, created_at)
     VALUES (?, ?, ?, ?, ?, unixepoch()) RETURNING *`,
    [data.task_id, user.sub, user.name, user.avatar, data.body]
  );
  const c = rows[0];
  const comment = {
    id: num(c.id),
    task_id: num(c.task_id),
    sender_sub: c.sender_sub ?? "",
    sender_name: c.sender_name ?? "",
    avatar: c.avatar,
    body: c.body ?? "",
    edited_at: c.edited_at != null ? num(c.edited_at) : null,
    created_at: num(c.created_at),
  };
  await publish(ch.task(data.task_id), { t: "comment:created", task_id: data.task_id, comment });
  return comment;
}

export async function addChecklistItem(_sub: string, data: { task_id: number; body: string }) {
  const rows = await dbq(
    `INSERT INTO task_checklist_items (task_id, body, position)
     VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM task_checklist_items WHERE task_id = ?)) RETURNING *`,
    [data.task_id, data.body, data.task_id]
  );
  await publish(ch.task(data.task_id), { t: "checklist:updated", task_id: data.task_id });
  return { id: num(rows[0]?.id), body: data.body, done: false };
}

export async function toggleChecklistItem(_sub: string, data: { id: number; task_id: number; done: boolean }) {
  await dbq("UPDATE task_checklist_items SET done = ? WHERE id = ? AND task_id = ?",
    [data.done ? 1 : 0, data.id, data.task_id]);
  await publish(ch.task(data.task_id), { t: "checklist:updated", task_id: data.task_id });
}
