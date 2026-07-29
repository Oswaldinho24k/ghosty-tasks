import { createServerFn } from "@tanstack/react-start";
import { dbq, num } from "../dbq.server";
import { ensureSchema } from "./schema.server";

export type Label = { label: string; color: string };

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

// Una sola implementación: la de las ops, que además comprueba que quien edita participe
// en el tablero. Antes había dos copias de "poner etiquetas" y solo una tenía permiso.
export const setTaskLabelsFn = createServerFn({ method: "POST" })
  .validator((d: { task_id: number; labels: Label[] }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const sub = await getUserSub();
    try {
      const ops = await import("./ops/tasks.ops");
      await ops.setTaskLabels(sub, { task_id: data.task_id, labels: data.labels });
    } catch (e) {
      // Sin esto, cualquier fallo del servidor llegaba al cliente como un "Error al
      // agregar label" sin más, imposible de diagnosticar.
      console.error(`[labels] task=${data.task_id}:`, e);
      throw e;
    }
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
