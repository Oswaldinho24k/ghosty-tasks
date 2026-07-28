import { dbq } from "./dbq.server";

export type SessionUser = {
  sub: string;
  email: string;
  name: string;
  avatar: string;
  isOwner: boolean;
  handle: string;
};

function slugHandle(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 20) || "user"
  );
}

async function ensureUniqueHandle(base: string, ownSub: string): Promise<string> {
  const b = slugHandle(base);
  let h = b;
  for (let i = 2; ; i++) {
    const rows = await dbq("SELECT sub FROM gw_users WHERE handle = ?", [h]);
    if (!rows[0] || rows[0].sub === ownSub) return h;
    h = `${b}${i}`;
  }
}

export async function upsertUser(id: {
  sub: string;
  email: string;
  name: string;
  avatar: string;
}): Promise<SessionUser> {
  const base = id.email.split("@")[0] || id.name;
  const existing = await dbq("SELECT is_owner, handle FROM gw_users WHERE sub = ?", [id.sub]);
  if (existing[0]) {
    let handle = existing[0].handle as string | null;
    if (!handle) {
      handle = await ensureUniqueHandle(base, id.sub);
      await dbq("UPDATE gw_users SET handle=? WHERE sub=?", [handle, id.sub]);
    }
    await dbq("UPDATE gw_users SET email=?, name=?, avatar=? WHERE sub=?", [
      id.email,
      id.name,
      id.avatar,
      id.sub,
    ]);
    return { ...id, isOwner: Number(existing[0].is_owner) === 1, handle };
  }
  const countRows = await dbq("SELECT COUNT(*) as c FROM gw_users");
  const isOwner = Number(countRows[0]?.c ?? 0) === 0 ? 1 : 0;
  const handle = await ensureUniqueHandle(base, id.sub);
  await dbq(
    "INSERT INTO gw_users (sub, email, name, avatar, is_owner, handle) VALUES (?, ?, ?, ?, ?, ?)",
    [id.sub, id.email, id.name, id.avatar, isOwner, handle]
  );
  return { ...id, isOwner: isOwner === 1, handle };
}

export async function isBanned(sub: string): Promise<boolean> {
  try {
    const rows = await dbq("SELECT banned FROM gw_users WHERE sub = ?", [sub]);
    return Number(rows[0]?.banned) === 1;
  } catch {
    return false;
  }
}

export type WorkspaceMember = { sub: string; handle: string; name: string; email: string; avatar: string; isOwner: boolean };

export async function listWorkspaceMembers(): Promise<WorkspaceMember[]> {
  const rows = await dbq(
    "SELECT sub, handle, name, email, avatar, is_owner FROM gw_users WHERE handle IS NOT NULL ORDER BY name"
  );
  return rows.map((r) => ({
    sub: r.sub ?? "",
    handle: r.handle ?? "",
    name: r.name ?? "",
    email: r.email ?? "",
    avatar: r.avatar ?? "",
    isOwner: Number(r.is_owner) === 1,
  }));
}
