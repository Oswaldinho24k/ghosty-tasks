// Cliente HTTP al sqld (libsql-server) self-hosted en el bare metal de OVH — el
// MISMO que sirve a Ghosty Teams. Ghosty Tasks es single-workspace, así que usa un
// namespace fijo (SQLD_NAMESPACE) en vez de resolverlo por subdominio.
//
// Reemplaza el endpoint de EasyBits (`/api/v2/databases/:id/query`): la cuenta topó
// el límite de 10 DBs del plan Mega y el sqld propio no tiene ese techo. El CONTRATO
// de salida es idéntico al que había (filas { [col]: string|null }), así que ningún
// caller cambió.
//
// API pipeline de sqld: POST /v2/pipeline con header x-namespace; body
// { requests: [{type:"execute", stmt:{sql,args}}, {type:"close"}] }.

const SQLD_URL = process.env.SQLD_URL ?? "http://172.20.0.1:8100";
const SQLD_AUTH = process.env.SQLD_AUTH_TOKEN ?? "";
const NAMESPACE = process.env.SQLD_NAMESPACE ?? "ghostytasks";

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

export async function dbq(sql: string, args: unknown[] = []): Promise<Row[]> {
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
  const data = (await res.json()) as PipelineResponse;
  const first = data.results[0];
  if (!first || first.type === "error") {
    throw new Error(`db: ${first?.error?.message ?? "sqld error"}`);
  }
  const r = first.response!.result;
  const cols = r.cols.map((c) => c.name);
  return r.rows.map((row) =>
    Object.fromEntries(
      cols.map((c, i) => [c, row[i]?.value == null ? null : String(row[i]!.value)])
    )
  ) as Row[];
}

export const num = (v: string | null | undefined) => Number(v ?? 0);
export const str = (v: string | null | undefined) => v ?? "";
