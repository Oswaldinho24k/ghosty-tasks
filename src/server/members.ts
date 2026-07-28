import { createServerFn } from "@tanstack/react-start";
import { dbq } from "../dbq.server";
import { ensureSchema } from "./schema.server";

async function getUserSub(): Promise<string> {
  const { useSession } = await import("@tanstack/react-start/server");
  const { sessionConfig } = await import("./session.server");
  const s = await useSession<{ user?: { sub: string; isOwner: boolean } }>(sessionConfig());
  const user = s.data.user;
  if (!user) throw new Error("unauthorized");
  return user.sub;
}

export const addProjectMemberFn = createServerFn({ method: "POST" })
  .validator((d: { project_id: number; user_sub: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await getUserSub();
    // Solo se agrega a un proyecto a quien ya pertenece al workspace: si no, un sub
    // arbitrario entraría al tablero por la puerta de atrás.
    const { workspaceRoster } = await import("./membership.server");
    const roster = await workspaceRoster();
    if (roster.length && !roster.some((m) => m.sub === data.user_sub)) {
      throw new Error("esa persona no es miembro del workspace");
    }
    await dbq("INSERT OR IGNORE INTO task_project_members (project_id, user_sub, role) VALUES (?, ?, ?)",
      [data.project_id, data.user_sub, "member"]);
  });

export const removeProjectMemberFn = createServerFn({ method: "POST" })
  .validator((d: { project_id: number; user_sub: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const sub = await getUserSub();
    if (data.user_sub === sub) throw new Error("no puedes removerte a ti mismo");
    await dbq("DELETE FROM task_project_members WHERE project_id = ? AND user_sub = ?",
      [data.project_id, data.user_sub]);
  });

// Los miembros del workspace salen del control-plane (gs), no de una tabla local:
// listar `gc_users` sería listar "quien ya entró", y a alguien recién agregado al
// equipo no se le podría ni asignar una tarea. El perfil (nombre, avatar, handle) sí
// es local — ver users.server.ts.
export const listWorkspaceUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  await ensureSchema();
  await getUserSub();
  const { listWorkspaceMembers } = await import("../users.server");
  const members = await listWorkspaceMembers();
  return members.map((m) => ({
    sub: m.sub,
    name: m.name,
    avatar: m.avatar,
    handle: m.handle,
    isOwner: m.isOwner,
  }));
});
