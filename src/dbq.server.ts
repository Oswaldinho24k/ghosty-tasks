const BASE = process.env.EASYBITS_BASE_URL ?? "https://www.easybits.cloud";
const KEY = process.env.EASYBITS_API_KEY!;
const DB_ID = process.env.EASYBITS_DB_ID!;

export type Row = Record<string, string | null>;

export async function dbq(sql: string, args: unknown[] = []): Promise<Row[]> {
  const res = await fetch(`${BASE}/api/v2/databases/${DB_ID}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ sql, args }),
  });
  if (!res.ok) throw new Error(`db ${res.status}: ${await res.text()}`);
  const { cols, rows } = (await res.json()) as { cols: string[]; rows: (string | null)[][] };
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

export const num = (v: string | null | undefined) => Number(v ?? 0);
export const str = (v: string | null | undefined) => v ?? "";
