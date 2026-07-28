import { createServerFn } from "@tanstack/react-start";
import { dbq, num } from "../dbq.server";
import { ensureSchema } from "./schema.server";
import { publish, ch } from "./bus.server";

export type Label = { label: string; color: string };

async function getProjectId(task_id: number): Promise<number> {
  const rows = await dbq("SELECT project_id FROM task_tasks WHERE id = ?", [task_id]);
  return num(rows[0]?.project_id);
}

async function getUserSub(): Promise<string> {
  const { useSession } = await import("@tanstack/react-start/server");
  const { sessionConfig } = await import("./session.server");
  const s = await useSession<{ user?: { sub: string } }>(sessionConfig());
  const user = s.data.user;
  if (!user) throw new Error("unauthorized");
  return user.sub;
}

export const getTaskLabelsFn = createServerFn({ method: "GET" })
  .validator((d: { task_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const rows = await dbq("SELECT label, color FROM task_labels WHERE task_id = ?", [data.task_id]);
    return rows.map((r) => ({ label: r.label ?? "", color: r.color ?? "#6b7280" }));
  });

export const setTaskLabelsFn = createServerFn({ method: "POST" })
  .validator((d: { task_id: number; labels: Label[] }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    await dbq("DELETE FROM task_labels WHERE task_id = ?", [data.task_id]);
    for (const { label, color } of data.labels) {
      await dbq(
        "INSERT INTO task_labels (task_id, label, color) VALUES (?, ?, ?)",
        [data.task_id, label, color]
      );
    }
    const project_id = await getProjectId(data.task_id);
    publish(ch.project(project_id), { t: "task:updated", id: data.task_id, patch: { labels: data.labels } });
    return data.labels;
  });

export const getAllTaskLabelsFn = createServerFn({ method: "GET" })
  .validator((d: { project_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const rows = await dbq(
      `SELECT l.task_id, l.label, l.color
       FROM task_labels l
       JOIN task_tasks t ON t.id = l.task_id
       WHERE t.project_id = ?
       ORDER BY l.task_id, l.label ASC`,
      [data.project_id]
    );
    const result: Record<number, Label[]> = {};
    for (const r of rows) {
      const tid = num(r.task_id as string);
      if (!result[tid]) result[tid] = [];
      result[tid].push({ label: r.label ?? "", color: r.color ?? "#6b7280" });
    }
    return result;
  });

export const getProjectLabelsFn = createServerFn({ method: "GET" })
  .validator((d: { project_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    // Distinct labels used across all tasks in this project
    const rows = await dbq(
      `SELECT DISTINCT l.label, l.color
       FROM task_labels l
       JOIN task_tasks t ON t.id = l.task_id
       WHERE t.project_id = ?
       ORDER BY l.label ASC`,
      [data.project_id]
    );
    return rows.map((r) => ({ label: r.label ?? "", color: r.color ?? "#6b7280" }));
  });
