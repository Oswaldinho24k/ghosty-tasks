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
    await dbq("INSERT OR IGNORE INTO gw_project_members (project_id, user_sub, role) VALUES (?, ?, ?)",
      [data.project_id, data.user_sub, "member"]);
  });

export const removeProjectMemberFn = createServerFn({ method: "POST" })
  .validator((d: { project_id: number; user_sub: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const sub = await getUserSub();
    if (data.user_sub === sub) throw new Error("no puedes removerte a ti mismo");
    await dbq("DELETE FROM gw_project_members WHERE project_id = ? AND user_sub = ?",
      [data.project_id, data.user_sub]);
  });

export const listWorkspaceUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  await ensureSchema();
  await getUserSub();
  const rows = await dbq("SELECT sub, name, avatar, handle, is_owner FROM gw_users ORDER BY name");
  return rows.map((r) => ({
    sub: r.sub ?? "",
    name: r.name ?? "",
    avatar: r.avatar ?? "",
    handle: r.handle ?? "",
    isOwner: r.is_owner === "1",
  }));
});
