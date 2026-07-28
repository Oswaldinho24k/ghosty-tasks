import { createServerFn } from "@tanstack/react-start";
import { dbq, num } from "../dbq.server";
import { ensureSchema } from "./schema.server";
import { publish, ch } from "./bus.server";

async function getUserSub(): Promise<string> {
  const { useSession } = await import("@tanstack/react-start/server");
  const { sessionConfig } = await import("./session.server");
  const s = await useSession<{ user?: { sub: string } }>(sessionConfig());
  const user = s.data.user;
  if (!user) throw new Error("unauthorized");
  return user.sub;
}

export const createColumnFn = createServerFn({ method: "POST" })
  .validator((d: { project_id: number; name: string; color?: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const maxRows = await dbq(
      "SELECT COALESCE(MAX(position), -1) as m FROM task_columns WHERE project_id = ?",
      [data.project_id]
    );
    const position = num(maxRows[0]?.m) + 1;
    const rows = await dbq(
      "INSERT INTO task_columns (project_id, name, position, color) VALUES (?, ?, ?, ?) RETURNING *",
      [data.project_id, data.name, position, data.color ?? null]
    );
    const col = {
      id: num(rows[0].id),
      project_id: data.project_id,
      name: data.name,
      position,
      color: data.color ?? null,
    };
    publish(ch.project(data.project_id), { t: "column:created", column: col });
    return col;
  });

export const updateColumnFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; project_id: number; name?: string; color?: string; wip_limit?: number | null }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const sets: string[] = [];
    const args: unknown[] = [];
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) { sets.push("name = ?"); args.push(data.name); patch.name = data.name; }
    if (data.color !== undefined) { sets.push("color = ?"); args.push(data.color); patch.color = data.color; }
    if (data.wip_limit !== undefined) { sets.push("wip_limit = ?"); args.push(data.wip_limit); patch.wip_limit = data.wip_limit; }
    if (!sets.length) return;
    args.push(data.id);
    await dbq(`UPDATE task_columns SET ${sets.join(", ")} WHERE id = ?`, args);
    publish(ch.project(data.project_id), { t: "column:updated", id: data.id, patch });
  });

export const deleteColumnFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; project_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    // Move tasks to the first other column in the project
    const firstCol = await dbq(
      "SELECT id FROM task_columns WHERE project_id = ? AND id != ? ORDER BY position ASC LIMIT 1",
      [data.project_id, data.id]
    );
    if (firstCol[0]) {
      await dbq("UPDATE task_tasks SET column_id = ? WHERE column_id = ?", [firstCol[0].id, data.id]);
    }
    await dbq("DELETE FROM task_columns WHERE id = ?", [data.id]);
    publish(ch.project(data.project_id), { t: "column:deleted", id: data.id, project_id: data.project_id });
  });

export const reorderColumnsFn = createServerFn({ method: "POST" })
  .validator((d: { project_id: number; ordered_ids: number[] }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    for (let i = 0; i < data.ordered_ids.length; i++) {
      await dbq("UPDATE task_columns SET position = ? WHERE id = ? AND project_id = ?", [i, data.ordered_ids[i], data.project_id]);
    }
    publish(ch.project(data.project_id), { t: "columns:reordered", project_id: data.project_id, ordered_ids: data.ordered_ids });
  });
