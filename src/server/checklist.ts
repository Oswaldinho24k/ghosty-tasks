import { createServerFn } from "@tanstack/react-start";
import { dbq, num } from "../dbq.server";
import { ensureSchema } from "./schema.server";
import { publish, ch } from "./bus.server";

export type ChecklistItem = {
  id: number;
  task_id: number;
  body: string;
  done: boolean;
  position: number;
};

async function getProjectId(task_id: number): Promise<number> {
  const rows = await dbq("SELECT project_id FROM gw_tasks WHERE id = ?", [task_id]);
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

export const getChecklistFn = createServerFn({ method: "GET" })
  .validator((d: { task_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const rows = await dbq("SELECT * FROM gw_checklist_items WHERE task_id = ? ORDER BY position ASC", [data.task_id]);
    return rows.map((r) => ({
      id: num(r.id),
      task_id: data.task_id,
      body: r.body ?? "",
      done: num(r.done) === 1,
      position: num(r.position),
    }));
  });

export const addChecklistItemFn = createServerFn({ method: "POST" })
  .validator((d: { task_id: number; body: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const maxRows = await dbq("SELECT COALESCE(MAX(position), -1) as m FROM gw_checklist_items WHERE task_id = ?", [data.task_id]);
    const position = num(maxRows[0]?.m) + 1;
    const rows = await dbq(
      "INSERT INTO gw_checklist_items (task_id, body, position) VALUES (?, ?, ?) RETURNING *",
      [data.task_id, data.body, position]
    );
    const project_id = await getProjectId(data.task_id);
    publish(ch.project(project_id), { t: "checklist:updated", task_id: data.task_id });
    return { id: num(rows[0].id), task_id: data.task_id, body: data.body, done: false, position };
  });

export const updateChecklistItemFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; task_id: number; body?: string; done?: boolean }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const sets: string[] = [];
    const args: unknown[] = [];
    if (data.body !== undefined) { sets.push("body = ?"); args.push(data.body); }
    if (data.done !== undefined) { sets.push("done = ?"); args.push(data.done ? 1 : 0); }
    if (!sets.length) return;
    args.push(data.id);
    await dbq(`UPDATE gw_checklist_items SET ${sets.join(", ")} WHERE id = ?`, args);
    const project_id = await getProjectId(data.task_id);
    publish(ch.project(project_id), { t: "checklist:updated", task_id: data.task_id });
  });

export const deleteChecklistItemFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; task_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    await dbq("DELETE FROM gw_checklist_items WHERE id = ?", [data.id]);
    const project_id = await getProjectId(data.task_id);
    publish(ch.project(project_id), { t: "checklist:updated", task_id: data.task_id });
  });
