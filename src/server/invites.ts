import { createServerFn } from "@tanstack/react-start";

// dbq inline (same pattern as ghosty-teams) — avoid importing .server.ts at module top level.
// Habla el MISMO sqld que `src/dbq.server.ts`; devuelve la forma cruda { cols, rows }
// porque los callers de este archivo indexan por posición.
const SQLD_URL = process.env.SQLD_URL ?? "http://172.20.0.1:8100";
const SQLD_AUTH = process.env.SQLD_AUTH_TOKEN ?? "";
const NAMESPACE = process.env.SQLD_NAMESPACE ?? "ghostytasks";

function toArg(v: unknown) {
  if (v === null || v === undefined) return { type: "null" as const };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { type: "integer" as const, value: String(v) }
      : { type: "float" as const, value: String(v) };
  }
  if (typeof v === "boolean") return { type: "integer" as const, value: v ? "1" : "0" };
  return { type: "text" as const, value: typeof v === "string" ? v : String(v) };
}

async function dbq(sql: string, args: unknown[] = []) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-namespace": NAMESPACE,
  };
  if (SQLD_AUTH) headers.Authorization = `Bearer ${SQLD_AUTH}`;
  const res = await fetch(`${SQLD_URL}/v2/pipeline`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql, args: args.map(toArg) } },
        { type: "close" },
      ],
    }),
  });
  if (!res.ok) throw new Error(`db ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    results: Array<{
      type: "ok" | "error";
      response?: { result: { cols: Array<{ name: string }>; rows: Array<Array<{ value?: unknown }>> } };
      error?: { message: string };
    }>;
  };
  const first = data.results[0];
  if (!first || first.type === "error") throw new Error(`db: ${first?.error?.message ?? "sqld error"}`);
  const r = first.response!.result;
  return {
    cols: r.cols.map((c) => c.name),
    rows: r.rows.map((row) => row.map((cell) => (cell?.value == null ? null : String(cell.value)))),
  };
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
