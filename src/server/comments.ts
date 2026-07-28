import { createServerFn } from "@tanstack/react-start";
import { dbq, num } from "../dbq.server";
import { ensureSchema } from "./schema.server";
import { publish, ch } from "./bus.server";

export type Comment = {
  id: number;
  task_id: number;
  sender_sub: string;
  sender_name: string;
  avatar: string | null;
  body: string;
  edited_at: number | null;
  created_at: number;
};

async function getProjectId(task_id: number): Promise<number> {
  const rows = await dbq("SELECT project_id FROM gw_tasks WHERE id = ?", [task_id]);
  return num(rows[0]?.project_id);
}

async function getUser(): Promise<{ sub: string; name: string; avatar: string | null }> {
  const { useSession } = await import("@tanstack/react-start/server");
  const { sessionConfig } = await import("./session.server");
  const s = await useSession<{ user?: { sub: string; name: string; avatar?: string } }>(sessionConfig());
  const user = s.data.user;
  if (!user) throw new Error("unauthorized");
  return { sub: user.sub, name: user.name, avatar: user.avatar ?? null };
}

function rowToComment(r: Record<string, string | null>): Comment {
  return {
    id: num(r.id),
    task_id: num(r.task_id),
    sender_sub: r.sender_sub ?? "",
    sender_name: r.sender_name ?? "",
    avatar: r.avatar ?? null,
    body: r.body ?? "",
    edited_at: r.edited_at != null ? num(r.edited_at) : null,
    created_at: num(r.created_at),
  };
}

export const getCommentsFn = createServerFn({ method: "GET" })
  .validator((d: { task_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUser();
    const rows = await dbq(
      "SELECT * FROM gw_task_comments WHERE task_id = ? ORDER BY created_at ASC",
      [data.task_id]
    );
    return rows.map(rowToComment);
  });

export const addCommentFn = createServerFn({ method: "POST" })
  .validator((d: { task_id: number; body: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const user = await getUser();
    const rows = await dbq(
      "INSERT INTO gw_task_comments (task_id, sender_sub, sender_name, avatar, body, created_at) VALUES (?, ?, ?, ?, ?, unixepoch()) RETURNING *",
      [data.task_id, user.sub, user.name, user.avatar, data.body]
    );
    const comment = rowToComment(rows[0]);
    const project_id = await getProjectId(data.task_id);
    publish(ch.project(project_id), { t: "comment:created", task_id: data.task_id, comment });
    return comment;
  });

export const updateCommentFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; task_id: number; body: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const user = await getUser();
    await dbq(
      "UPDATE gw_task_comments SET body = ?, edited_at = unixepoch() WHERE id = ? AND sender_sub = ?",
      [data.body, data.id, user.sub]
    );
    const rows = await dbq("SELECT * FROM gw_task_comments WHERE id = ?", [data.id]);
    const comment = rowToComment(rows[0]);
    const project_id = await getProjectId(data.task_id);
    publish(ch.project(project_id), { t: "comment:updated", task_id: data.task_id, comment });
    return comment;
  });

export const deleteCommentFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; task_id: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const user = await getUser();
    await dbq("DELETE FROM gw_task_comments WHERE id = ? AND sender_sub = ?", [data.id, user.sub]);
    const project_id = await getProjectId(data.task_id);
    publish(ch.project(project_id), { t: "comment:deleted", task_id: data.task_id, comment_id: data.id });
  });
