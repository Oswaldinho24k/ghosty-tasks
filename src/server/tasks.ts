import { createServerFn } from "@tanstack/react-start";
import { dbq, num } from "../dbq.server";
import { ensureSchema } from "./schema.server";
import type { Task } from "./projects";
import * as ops from "./ops/tasks.ops";

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

export const getTaskDetailFn = createServerFn({ method: "GET" })
  .validator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const rows = await dbq("SELECT * FROM task_tasks WHERE id = ?", [data.id]);
    if (!rows[0]) throw new Error("task not found");
    const task = rowToTask(rows[0]);

    const checklist = await dbq("SELECT * FROM task_checklist_items WHERE task_id = ? ORDER BY position ASC", [data.id]);
    const comments = await dbq("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC", [data.id]);
    const activities = await dbq("SELECT * FROM task_activities WHERE task_id = ? ORDER BY created_at ASC", [data.id]);
    const labels = await dbq("SELECT label, color FROM task_labels WHERE task_id = ?", [data.id]);
    const subtasks = await dbq("SELECT * FROM task_tasks WHERE parent_id = ? ORDER BY position ASC", [data.id]);

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
    return ops.createTask(await getUserSub(), data);
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
    await ops.updateTask(await getUserSub(), data);
  });

export const moveTaskFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; project_id: number; column_id: number; prev_position: number | null; next_position: number | null }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await ops.moveTask(await getUserSub(), data);
  });

export const deleteTaskFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; project_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await ops.deleteTask(await getUserSub(), data);
  });

export const setTaskLabelsFn = createServerFn({ method: "POST" })
  .validator((d: { task_id: number; labels: { label: string; color: string }[] }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await ops.setTaskLabels(await getUserSub(), data);
  });
