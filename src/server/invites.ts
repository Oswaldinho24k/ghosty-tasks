import { createServerFn } from "@tanstack/react-start";

// dbq inline (same pattern as ghosty-teams) — avoid importing .server.ts at module top level
const BASE = process.env.EASYBITS_BASE_URL ?? "https://www.easybits.cloud";
const KEY = process.env.EASYBITS_API_KEY!;
const DB_ID = process.env.EASYBITS_DB_ID!;

async function dbq(sql: string, args: unknown[] = []) {
  const res = await fetch(`${BASE}/api/v2/databases/${DB_ID}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ sql, args }),
  });
  if (!res.ok) throw new Error(`db ${res.status}: ${await res.text()}`);
  return (await res.json()) as { cols: string[]; rows: (string | null)[][] };
}

export async function isKnownUser(sub: string): Promise<boolean> {
  const { rows } = await dbq("SELECT 1 FROM gw_users WHERE sub = ?", [sub]);
  return !!rows[0];
}

export async function consumeInvite(token: string, sub: string): Promise<boolean> {
  const { rows } = await dbq("SELECT used_by FROM gw_invites WHERE token = ?", [token]);
  if (!rows[0]) return false;
  if (rows[0][0]) return rows[0][0] === sub;
  await dbq("UPDATE gw_invites SET used_by = ?, used_at = unixepoch() WHERE token = ?", [sub, token]);
  return true;
}

export const createInvite = createServerFn({ method: "POST" }).handler(async () => {
  const { useSession } = await import("@tanstack/react-start/server");
  const { sessionConfig } = await import("./session.server");
  const s = await useSession<{ user?: { sub: string; isOwner: boolean } }>(sessionConfig());
  const user = s.data.user;
  if (!user?.isOwner) throw new Error("solo el owner puede invitar");
  const crypto = await import("node:crypto");
  const token = crypto.randomBytes(16).toString("hex");
  await dbq("INSERT INTO gw_invites (token, created_by) VALUES (?, ?)", [token, user.sub]);
  const { reqOrigin } = await import("../origin.server");
  return { url: `${await reqOrigin()}/join/${token}` };
});
