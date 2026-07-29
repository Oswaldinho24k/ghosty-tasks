import crypto from "node:crypto";
import { currentSlug } from "./tenant.server";

// Puente a los conectores del usuario, que viven en Ghosty Teams (Deník, Calendly…).
//
// El canal de tools del turno es UNO: al usarlo para las acciones del tablero, entrar
// por Tasks le quitaba al agente todo lo que sí tiene en Teams. Así que Tasks federa:
// sirve las suyas y reenvía el resto.
//
// No hace falta inventar auth: Teams firma sus tool-token con el MISMO
// GHOSTY_PARTNER_SECRET, así que aquí se acuña uno con su formato
// (`base64url({sub,exp}).HMAC`) y se llama a su endpoint como lo haría el worker.
const TTL_S = 15 * 60;

function teamsToolToken(sub: string): string {
  const secret = process.env.GHOSTY_PARTNER_SECRET;
  if (!secret) throw new Error("falta GHOSTY_PARTNER_SECRET");
  const payload = Buffer.from(
    JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + TTL_S })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

async function teamsToolsUrl(): Promise<string | null> {
  const slug = await currentSlug();
  if (!slug) return null;
  const root = process.env.TEAMS_ROOT_DOMAIN ?? "teams.ghosty.studio";
  return `https://${slug}.${root}/api/connectors/tools`;
}

async function call(sub: string, body: unknown): Promise<unknown | null> {
  const url = await teamsToolsUrl();
  if (!url) return null;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${teamsToolToken(sub)}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    // Que Teams no conteste no puede dejar al agente sin las tools del tablero.
    return null;
  }
}

export async function connectorTools(sub: string): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
  const res = (await call(sub, { action: "list" })) as { tools?: Array<{ name: string; description: string; inputSchema: unknown }> } | null;
  return res?.tools ?? [];
}

export async function runConnectorTool(sub: string, name: string, args: unknown) {
  const res = (await call(sub, { action: "run", name, args })) as { ok?: boolean; result?: unknown; error?: string } | null;
  if (!res) return { ok: false, error: `no existe la herramienta "${name}"` };
  return res;
}
