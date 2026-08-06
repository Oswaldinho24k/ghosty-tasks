import { createServerFn } from "@tanstack/react-start";
import { dbq, num } from "../dbq.server";
import { ensureSchema } from "./schema.server";
import { localAvatar } from "../utils/avatar";

export type Project = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  archived: boolean;
  created_by: string;
  created_at: number;
};

export type Column = {
  id: number;
  project_id: number;
  name: string;
  position: number;
  color: string | null;
  wip_limit: number | null;
};

export type Task = {
  id: number;
  project_id: number;
  column_id: number;
  parent_id: number | null;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  assignee_sub: string | null;
  due_date: number | null;
  position: number;
  created_by: string;
  created_at: number;
  updated_at: number;
};

function rowToProject(r: Record<string, string | null>): Project {
  return {
    id: num(r.id),
    slug: r.slug ?? "",
    name: r.name ?? "",
    description: r.description,
    icon: r.icon,
    color: r.color ?? "#7c3aed",
    archived: num(r.archived) === 1,
    created_by: r.created_by ?? "",
    created_at: num(r.created_at),
  };
}

function rowToColumn(r: Record<string, string | null>): Column {
  return {
    id: num(r.id),
    project_id: num(r.project_id),
    name: r.name ?? "",
    position: num(r.position),
    color: r.color,
    wip_limit: r.wip_limit != null ? num(r.wip_limit) : null,
  };
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

async function getUserSub(): Promise<string> {
  const { useSession } = await import("@tanstack/react-start/server");
  const { sessionConfig } = await import("./session.server");
  const s = await useSession<{ user?: { sub: string } }>(sessionConfig());
  const user = s.data.user;
  if (!user) throw new Error("unauthorized");
  return user.sub;
}

export const listProjectsFn = createServerFn({ method: "GET" }).handler(async () => {
  await ensureSchema();
  const sub = await getUserSub();
  const rows = await dbq(
    `SELECT p.* FROM task_projects p
     WHERE p.archived = 0
       AND (p.created_by = ? OR EXISTS (SELECT 1 FROM task_project_members m WHERE m.project_id = p.id AND m.user_sub = ?))
     ORDER BY p.created_at ASC`,
    [sub, sub]
  );
  return rows.map(rowToProject);
});

export const getProjectShellFn = createServerFn({ method: "GET" })
  .validator((d: { slug: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const sub = await getUserSub();
    const projects = await dbq("SELECT * FROM task_projects WHERE slug = ?", [data.slug]);
    if (!projects[0]) throw new Error("project not found");
    const project = rowToProject(projects[0]);

    const columns = await dbq(
      "SELECT * FROM task_columns WHERE project_id = ? ORDER BY position ASC",
      [project.id]
    );
    const tasks = await dbq(
      "SELECT * FROM task_tasks WHERE project_id = ? AND parent_id IS NULL AND COALESCE(archived,0) = 0 ORDER BY position ASC",
      [project.id]
    );
    const members = await dbq(
      `SELECT u.sub, u.name, u.avatar, u.handle, m.role
       FROM task_project_members m JOIN gc_users u ON u.sub = m.user_sub
       WHERE m.project_id = ?`,
      [project.id]
    );
    const userRow = await dbq("SELECT is_owner FROM gc_users WHERE sub = ?", [sub]);
    const isOwner = num(userRow[0]?.is_owner) === 1;
    // Ver es de todo el workspace; participar, de los miembros del tablero.
    const { isProjectMember } = await import("./ops/access");
    const canEdit = await isProjectMember(sub, project.id);

    return {
      project,
      columns: columns.map(rowToColumn),
      tasks: tasks.map(rowToTask),
      members: members.map((r) => ({
        sub: r.sub ?? "",
        name: r.name ?? "",
        avatar: localAvatar(r.avatar),
        handle: r.handle ?? "",
        role: r.role ?? "member",
      })),
      currentSub: sub,
      isOwner,
      canEdit,
    };
  });

export const createProjectFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; icon?: string; color?: string; description?: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const sub = await getUserSub();
    // Cáscara: el cuerpo vive en ops/projects.ops.ts y lo comparte la acción `create_board`
    // del agente. Es el mismo reparto que ya tenían las mutaciones de tarea.
    const { createProject } = await import("./ops/projects.ops");
    const p = await createProject(sub, {
      name: data.name,
      description: data.description,
      icon: data.icon,
      color: data.color,
    });
    const rows = await dbq("SELECT * FROM task_projects WHERE id = ?", [p.id]);
    return rowToProject(rows[0]);
  });

export const updateProjectFn = createServerFn({ method: "POST" })
  .validator((d: { id: number; name?: string; description?: string; icon?: string; color?: string; archived?: boolean }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    const sets: string[] = [];
    const args: unknown[] = [];
    if (data.name !== undefined) { sets.push("name = ?"); args.push(data.name); }
    if (data.description !== undefined) { sets.push("description = ?"); args.push(data.description); }
    if (data.icon !== undefined) { sets.push("icon = ?"); args.push(data.icon); }
    if (data.color !== undefined) { sets.push("color = ?"); args.push(data.color); }
    if (data.archived !== undefined) { sets.push("archived = ?"); args.push(data.archived ? 1 : 0); }
    if (!sets.length) return;
    args.push(data.id);
    await dbq(`UPDATE task_projects SET ${sets.join(", ")} WHERE id = ?`, args);
  });
