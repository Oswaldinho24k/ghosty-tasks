import { createServerFn } from "@tanstack/react-start";
import { dbq, num } from "../dbq.server";
import { ensureSchema } from "./schema.server";
import { publish, ch } from "./bus.server";
import type { Task } from "./projects";

async function getUserSub(): Promise<string> {
  const { useSession } = await import("@tanstack/react-start/server");
  const { sessionConfig } = await import("./session.server");
  const s = await useSession<{ user?: { sub: string } }>(sessionConfig());
  const user = s.data.user;
  if (!user) throw new Error("unauthorized");
  return user.sub;
}

function rowToTask(r: Record<string, string | null>): Task {
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

// Fractional index: midpoint between prev and next positions (Linear-style)
async function nextPosition(column_id: number): Promise<number> {
  const rows = await dbq("SELECT COALESCE(MAX(position), 0) as m FROM gw_tasks WHERE column_id = ? AND parent_id IS NULL", [column_id]);
  return parseFloat(rows[0]?.m ?? "0") + 1000;
}

export const getTaskDetailFn = createServerFn({ method: "GET" })
  .validator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const rows = await dbq("SELECT * FROM gw_tasks WHERE id = ?", [data.id]);
    if (!rows[0]) throw new Error("task not found");
    const task = rowToTask(rows[0]);

    const checklist = await dbq("SELECT * FROM gw_checklist_items WHERE task_id = ? ORDER BY position ASC", [data.id]);
    const comments = await dbq("SELECT * FROM gw_task_comments WHERE task_id = ? ORDER BY created_at ASC", [data.id]);
    const activities = await dbq("SELECT * FROM gw_task_activities WHERE task_id = ? ORDER BY created_at ASC", [data.id]);
    const labels = await dbq("SELECT label, color FROM gw_task_labels WHERE task_id = ?", [data.id]);
    const subtasks = await dbq("SELECT * FROM gw_tasks WHERE parent_id = ? ORDER BY position ASC", [data.id]);

    return {
      task,
      checklist: checklist.map((r) => ({
        id: num(r.id),
        task_id: data.id,
        body: r.body ?? "",
        done: num(r.done) === 1,
        position: num(r.position),
      })),
      comments: comments.map((r) => ({
        id: num(r.id),
        task_id: data.id,
        sender_sub: r.sender_sub ?? "",
        sender_name: r.sender_name ?? "",
        avatar: r.avatar ?? "",
        body: r.body ?? "",
        edited_at: r.edited_at ? num(r.edited_at) : null,
        created_at: num(r.created_at),
      })),
      activities: activities.map((r) => ({
        id: num(r.id),
        task_id: data.id,
        user_sub: r.user_sub ?? "",
        action: r.action ?? "",
        old_val: r.old_val,
        new_val: r.new_val,
        created_at: num(r.created_at),
      })),
      labels: labels.map((r) => ({ label: r.label ?? "", color: r.color ?? "#6b7280" })),
      subtasks: subtasks.map(rowToTask),
    };
  });

export const createTaskFn = createServerFn({ method: "POST" })
  .validator((d: {
    project_id: number;
    column_id: number;
    title: string;
    description?: string;
    priority?: string;
    assignee_sub?: string;
    due_date?: number;
    parent_id?: number;
  }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const sub = await getUserSub();
    const position = await nextPosition(data.column_id);
    const rows = await dbq(
      `INSERT INTO gw_tasks (project_id, column_id, parent_id, title, description, priority, assignee_sub, due_date, position, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch()) RETURNING *`,
      [data.project_id, data.column_id, data.parent_id ?? null, data.title, data.description ?? null,
       data.priority ?? null, data.assignee_sub ?? null, data.due_date ?? null, position, sub]
    );
    const task = rowToTask(rows[0]);
    await dbq("INSERT INTO gw_task_activities (task_id, user_sub, action) VALUES (?, ?, ?)", [task.id, sub, "created"]);
    publish(ch.project(data.project_id), {
      t: "task:created",
      task: { id: task.id, project_id: task.project_id, column_id: task.column_id, title: task.title, priority: task.priority, assignee_sub: task.assignee_sub, position: task.position, status: task.status },
    });
    return task;
  });

export const updateTaskFn = createServerFn({ method: "POST" })
  .validator((d: {
    id: number;
    project_id: number;
    title?: string;
    description?: string;
    priority?: string | null;
    assignee_sub?: string | null;
    due_date?: number | null;
    status?: string;
    column_id?: number;
  }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const sub = await getUserSub();
    const current = await dbq("SELECT * FROM gw_tasks WHERE id = ?", [data.id]);
    if (!current[0]) throw new Error("task not found");

    const sets: string[] = ["updated_at = unixepoch()"];
    const args: unknown[] = [];
    const patch: Record<string, unknown> = {};

    const track = async (action: string, oldVal: string | null, newVal: string | null) => {
      await dbq("INSERT INTO gw_task_activities (task_id, user_sub, action, old_val, new_val) VALUES (?, ?, ?, ?, ?)",
        [data.id, sub, action, oldVal, newVal]);
    };

    if (data.title !== undefined) { sets.push("title = ?"); args.push(data.title); patch.title = data.title; }
    if (data.description !== undefined) { sets.push("description = ?"); args.push(data.description); patch.description = data.description; }
    if (data.priority !== undefined) {
      sets.push("priority = ?"); args.push(data.priority);
      patch.priority = data.priority;
      await track("priority_changed", current[0].priority, data.priority);
    }
    if (data.assignee_sub !== undefined) {
      sets.push("assignee_sub = ?"); args.push(data.assignee_sub);
      patch.assignee_sub = data.assignee_sub;
      await track("assigned", current[0].assignee_sub, data.assignee_sub);
    }
    if (data.due_date !== undefined) { sets.push("due_date = ?"); args.push(data.due_date); patch.due_date = data.due_date; }
    if (data.status !== undefined) {
      sets.push("status = ?"); args.push(data.status);
      patch.status = data.status;
      await track("status_changed", current[0].status, data.status);
    }
    if (data.column_id !== undefined) {
      sets.push("column_id = ?"); args.push(data.column_id);
      patch.column_id = data.column_id;
      await track("moved", current[0].column_id, String(data.column_id));
    }

    args.push(data.id);
    await dbq(`UPDATE gw_tasks SET ${sets.join(", ")} WHERE id = ?`, args);
    publish(ch.project(data.project_id), { t: "task:updated", id: data.id, patch });
  });

export const moveTaskFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; project_id: number; column_id: number; prev_position: number | null; next_position: number | null }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const sub = await getUserSub();
    // Fractional index: midpoint between neighbors
    const prev = data.prev_position ?? 0;
    const next = data.next_position ?? prev + 2000;
    const position = (prev + next) / 2;
    await dbq(
      "UPDATE gw_tasks SET column_id = ?, position = ?, updated_at = unixepoch() WHERE id = ?",
      [data.column_id, position, data.id]
    );
    await dbq("INSERT INTO gw_task_activities (task_id, user_sub, action, new_val) VALUES (?, ?, ?, ?)",
      [data.id, sub, "moved", String(data.column_id)]);
    publish(ch.project(data.project_id), { t: "task:moved", id: data.id, column_id: data.column_id, position });
  });

export const deleteTaskFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; project_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    await dbq("DELETE FROM gw_checklist_items WHERE task_id = ?", [data.id]);
    await dbq("DELETE FROM gw_task_comments WHERE task_id = ?", [data.id]);
    await dbq("DELETE FROM gw_task_labels WHERE task_id = ?", [data.id]);
    await dbq("DELETE FROM gw_task_activities WHERE task_id = ?", [data.id]);
    await dbq("DELETE FROM gw_tasks WHERE id = ?", [data.id]);
    publish(ch.project(data.project_id), { t: "task:deleted", id: data.id, project_id: data.project_id });
  });

export const setTaskLabelsFn = createServerFn({ method: "POST" })
  .validator((d: { task_id: number; labels: { label: string; color: string }[] }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    await dbq("DELETE FROM gw_task_labels WHERE task_id = ?", [data.task_id]);
    for (const l of data.labels) {
      await dbq("INSERT INTO gw_task_labels (task_id, label, color) VALUES (?, ?, ?)", [data.task_id, l.label, l.color]);
    }
  });
