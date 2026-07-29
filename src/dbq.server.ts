// Cliente HTTP al sqld (libsql-server) self-hosted en el bare metal de OVH — el
// MISMO que sirve a Ghosty Teams, y con el MISMO namespace para un workspace dado:
// las tareas viven junto a los hilos de ese equipo.
//
// El namespace se resuelve POR REQUEST desde el subdominio (ver tenant.server.ts),
// nunca a nivel de módulo: un solo proceso sirve todos los workspaces.
//
// API pipeline de sqld: POST /v2/pipeline con header x-namespace; body
// { requests: [{type:"execute", stmt:{sql,args}}, {type:"close"}] }.
import { currentNamespace } from "./server/tenant.server";

const SQLD_URL = process.env.SQLD_URL ?? "http://172.20.0.1:8100";
const SQLD_AUTH = process.env.SQLD_AUTH_TOKEN ?? "";

export type Row = Record<string, string | null>;

type SqldArg = { type: "integer" | "float" | "text" | "null"; value?: string };
function toArg(v: unknown): SqldArg {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { type: "integer", value: String(v) }
      : { type: "float", value: String(v) };
  }
  if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
  return { type: "text", value: typeof v === "string" ? v : String(v) };
}

interface PipelineResponse {
  results: Array<{
    type: "ok" | "error";
    response?: {
      result: {
        cols: Array<{ name: string }>;
        rows: Array<Array<{ value?: unknown }>>;
      };
    };
    error?: { message: string };
  }>;
}

async function pipeline(stmts: { sql: string; args?: unknown[] }[]): Promise<PipelineResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-namespace": await currentNamespace(),
  };
  if (SQLD_AUTH) headers.Authorization = `Bearer ${SQLD_AUTH}`;
  const res = await fetch(`${SQLD_URL}/v2/pipeline`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      requests: [
        ...stmts.map((s) => ({
          type: "execute",
          stmt: { sql: s.sql, args: (s.args ?? []).map(toArg) },
        })),
        { type: "close" },
      ],
    }),
  });
  if (!res.ok) throw new Error(`db ${res.status}: ${await res.text()}`);
  return (await res.json()) as PipelineResponse;
}

function rowsOf(r: { cols: Array<{ name: string }>; rows: Array<Array<{ value?: unknown }>> }): Row[] {
  const cols = r.cols.map((c) => c.name);
  return r.rows.map((row) =>
    Object.fromEntries(
      cols.map((c, i) => [c, row[i]?.value == null ? null : String(row[i]!.value)])
    )
  ) as Row[];
}

export async function dbq(sql: string, args: unknown[] = []): Promise<Row[]> {
  const data = await pipeline([{ sql, args }]);
  const first = data.results[0];
  if (!first || first.type === "error") {
    throw new Error(`db: ${first?.error?.message ?? "sqld error"}`);
  }
  return rowsOf(first.response!.result);
}

// N sentencias en UN round-trip, tolerando fallos por-sentencia. Lo usa el migrador:
// son ~30 DDL idempotentes y pagarlas en serie hacía que el PRIMER request de cada
// workspace tardara segundos.
export async function dbqManySettled(
  stmts: { sql: string; args?: unknown[] }[]
): Promise<{ ok: boolean; rows: Row[]; error?: string }[]> {
  if (!stmts.length) return [];
  const data = await pipeline(stmts);
  return stmts.map((_, i) => {
    const r = data.results[i];
    if (!r || r.type === "error") return { ok: false, rows: [], error: r?.error?.message ?? "sqld error" };
    return { ok: true, rows: rowsOf(r.response!.result) };
  });
}

export const num = (v: string | null | undefined) => Number(v ?? 0);
export const str = (v: string | null | undefined) => v ?? "";
