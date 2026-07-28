import { createServerFn } from "@tanstack/react-start";
import { dbq, num } from "../dbq.server";
import { ensureSchema } from "./schema.server";
import { publish, ch } from "./bus.server";

export type Goal = {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  status: "open" | "done";
  due_date: number | null;
  created_by: string;
  created_at: number;
  total_tasks: number;
  completed_tasks: number;
};

export type GoalTask = {
  id: number;
  title: string;
  status: string;
  priority: string | null;
  assignee_sub: string | null;
};

async function getUserSub(): Promise<string> {
  const { useSession } = await import("@tanstack/react-start/server");
  const { sessionConfig } = await import("./session.server");
  const s = await useSession<{ user?: { sub: string } }>(sessionConfig());
  const user = s.data.user;
  if (!user) throw new Error("unauthorized");
  return user.sub;
}

function rowToGoal(r: Record<string, string | null>): Goal {
  return {
    id: num(r.id),
    project_id: num(r.project_id),
    title: r.title ?? "",
    description: r.description ?? null,
    status: (r.status ?? "open") as "open" | "done",
    due_date: r.due_date != null ? num(r.due_date) : null,
    created_by: r.created_by ?? "",
    created_at: num(r.created_at),
    total_tasks: num(r.total_tasks ?? "0"),
    completed_tasks: num(r.completed_tasks ?? "0"),
  };
}

export const getGoalsFn = createServerFn({ method: "GET" })
  .validator((d: { project_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const rows = await dbq(
      `SELECT g.*,
        COUNT(gt.task_id) as total_tasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as completed_tasks
       FROM gw_goals g
       LEFT JOIN gw_goal_tasks gt ON gt.goal_id = g.id
       LEFT JOIN gw_tasks t ON t.id = gt.task_id
       WHERE g.project_id = ?
       GROUP BY g.id
       ORDER BY g.created_at ASC`,
      [data.project_id]
    );
    return rows.map(rowToGoal);
  });

export const getGoalTasksFn = createServerFn({ method: "GET" })
  .validator((d: { goal_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const rows = await dbq(
      `SELECT t.id, t.title, t.status, t.priority, t.assignee_sub
       FROM gw_tasks t
       JOIN gw_goal_tasks gt ON gt.task_id = t.id
       WHERE gt.goal_id = ?
       ORDER BY t.created_at ASC`,
      [data.goal_id]
    );
    return rows.map((r) => ({
      id: num(r.id),
      title: r.title ?? "",
      status: r.status ?? "open",
      priority: r.priority ?? null,
      assignee_sub: r.assignee_sub ?? null,
    })) as GoalTask[];
  });

export const getTaskGoalsFn = createServerFn({ method: "GET" })
  .validator((d: { task_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const rows = await dbq(
      `SELECT g.id, g.title, g.status
       FROM gw_goals g
       JOIN gw_goal_tasks gt ON gt.goal_id = g.id
       WHERE gt.task_id = ?
       ORDER BY g.created_at ASC`,
      [data.task_id]
    );
    return rows.map((r) => ({ id: num(r.id), title: r.title ?? "", status: r.status ?? "open" }));
  });

export const createGoalFn = createServerFn({ method: "POST" })
  .validator((d: { project_id: number; title: string; description?: string; due_date?: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const sub = await getUserSub();
    const rows = await dbq(
      "INSERT INTO gw_goals (project_id, title, description, due_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, unixepoch()) RETURNING *",
      [data.project_id, data.title, data.description ?? null, data.due_date ?? null, sub]
    );
    const goal = rowToGoal({ ...rows[0], total_tasks: "0", completed_tasks: "0" });
    publish(ch.project(data.project_id), { t: "goal:created", goal });
    return goal;
  });

export const updateGoalFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; project_id: number; title?: string; description?: string; status?: string; due_date?: number | null }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const sets: string[] = [];
    const args: unknown[] = [];
    if (data.title !== undefined) { sets.push("title = ?"); args.push(data.title); }
    if (data.description !== undefined) { sets.push("description = ?"); args.push(data.description); }
    if (data.status !== undefined) { sets.push("status = ?"); args.push(data.status); }
    if (data.due_date !== undefined) { sets.push("due_date = ?"); args.push(data.due_date); }
    if (!sets.length) return;
    args.push(data.id);
    await dbq(`UPDATE gw_goals SET ${sets.join(", ")} WHERE id = ?`, args);
    publish(ch.project(data.project_id), { t: "goal:updated", id: data.id, project_id: data.project_id });
  });

export const deleteGoalFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; project_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    await dbq("DELETE FROM gw_goal_tasks WHERE goal_id = ?", [data.id]);
    await dbq("DELETE FROM gw_goals WHERE id = ?", [data.id]);
    publish(ch.project(data.project_id), { t: "goal:deleted", id: data.id, project_id: data.project_id });
  });

export const linkTaskToGoalFn = createServerFn({ method: "POST" })
  .validator((d: { goal_id: number; task_id: number; project_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    await dbq(
      "INSERT OR IGNORE INTO gw_goal_tasks (goal_id, task_id) VALUES (?, ?)",
      [data.goal_id, data.task_id]
    );
    publish(ch.project(data.project_id), { t: "goal:updated", id: data.goal_id, project_id: data.project_id });
  });

export const unlinkTaskFromGoalFn = createServerFn({ method: "POST" })
  .validator((d: { goal_id: number; task_id: number; project_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    await dbq("DELETE FROM gw_goal_tasks WHERE goal_id = ? AND task_id = ?", [data.goal_id, data.task_id]);
    publish(ch.project(data.project_id), { t: "goal:updated", id: data.goal_id, project_id: data.project_id });
  });
