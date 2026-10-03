import crypto from "node:crypto";
import { dbq } from "../dbq.server";
import { currentNamespace } from "./tenant.server";

// Cómo se le habla al agente del workspace: el runtime NATIVO de Ghosty Studio, el
// mismo que usa Teams. Se autentica con firma de partner (no con un token del agente):
// `HMAC(secret, ts.namespace.rawBody)`, y el namespace del workspace viaja en su propio
// header — Studio resuelve al dueño desde ahí en vez de creerle al cuerpo.
//
// EasyBits ya no participa: los agentes `runtime='easybits'` simplemente no se ofrecen.

export type WorkspaceAgent = {
  id: number;
  handle: string;
  name: string;
  avatar: string;
  fleetId: string;
  groupNs: boolean;
};

/** Los agentes ACTIVADOS en este workspace (`gc_agents` vive en la misma DB). */
export async function listAgents(): Promise<WorkspaceAgent[]> {
  const rows = await dbq(
    `SELECT id, handle, name, avatar, fleet_id, group_ns
       FROM gc_agents
      WHERE enabled = 1 AND kind = 'fleet' AND runtime = 'gs-native'
      ORDER BY id`
  ).catch(() => []);
  return rows
    .filter((r) => r.fleet_id)
    .map((r) => ({
      id: Number(r.id),
      handle: r.handle ?? "",
      name: r.name ?? r.handle ?? "Agente",
      avatar: r.avatar ?? "",
      fleetId: r.fleet_id ?? "",
      groupNs: Number(r.group_ns) === 1,
    }));
}

export async function getAgent(handle: string): Promise<WorkspaceAgent | null> {
  const all = await listAgents();
  return all.find((a) => a.handle === handle) ?? null;
}

/**
 * Dónde vive el native gs runtime. Es UN valor y es el mismo en todas partes.
 *
 * ⚠️ Esto era sólo `process.env.GHOSTY_RUNTIME_URL` y **la caja de Tasks nunca la tuvo**:
 * su `.env` traía las once de siempre y ésa no. O sea que el agente de Tasks no funcionó
 * NUNCA — contestaba «Este workspace no tiene runtime de agentes configurado» y no había
 * ni un error en ningún log, porque desde el código es indistinguible de un tenant que a
 * propósito no tiene runtime.
 *
 * No es configuración: es una constante que alguien convirtió en env y luego se le olvidó
 * poner en una caja. Con un default aquí ese fallo es imposible; el env se queda como
 * override para desarrollo y `gc_config` para el tenant que apunte a otro lado.
 */
const GS_RUNTIME_URL = "https://www.ghosty.studio";

/** Base del runtime: lo del tenant → el env → el default de arriba. */
export async function runtimeBase(): Promise<string | null> {
  const rows = await dbq("SELECT v FROM gc_config WHERE k = 'agent_runtime_url'").catch(() => []);
  const v = (rows[0]?.v ?? "").trim();
  return v || process.env.GHOSTY_RUNTIME_URL?.trim() || GS_RUNTIME_URL;
}

export async function partnerHeaders(rawBody: string): Promise<Record<string, string>> {
  const secret = process.env.GHOSTY_PARTNER_SECRET;
  if (!secret) throw new Error("falta GHOSTY_PARTNER_SECRET");
  const ns = await currentNamespace();
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${ns}.${rawBody}`).digest("hex");
  return {
    "Content-Type": "application/json",
    "x-ghosty-ts": String(ts),
    "x-ghosty-ws": ns,
    "x-ghosty-sig": sig,
  };
}

/**
 * Clave de conversación: por AGENTE y por TABLERO, y con el namespace del workspace
 * delante — un agente compartido entre equipos no puede mezclar memorias.
 *
 * Deliberadamente distinta de la de Teams: "mueve la tarjeta a Done" no tiene por qué
 * entrar en la conversación del canal.
 */
export async function taskGroupId(agent: WorkspaceAgent, projectId: number): Promise<string> {
  return `ws-${await currentNamespace()}-ghosty-tasks-${agent.handle}-p${projectId}`;
}
