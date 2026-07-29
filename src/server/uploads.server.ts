import crypto from "node:crypto";
import { currentSlug } from "./tenant.server";

// Las imágenes van al storage de Ghosty Teams, no dentro del turno.
//
// Antes viajaban inline en base64: funciona para una captura, pero infla ~33%, cruza dos
// saltos y —lo caro— acaba metida en la sesión del agente comiéndose contexto. Y no se
// guardaba en ningún lado, así que al recargar desaparecía.
//
// Tasks no monta bucket propio: el workspace ya tiene uno y es el mismo equipo. Se sube
// firmando con el secreto de partner y se le pasa al agente una URI.
const TEAMS_ROOT = process.env.TEAMS_ROOT_DOMAIN ?? "teams.ghosty.studio";

function sign(data: string): string {
  const secret = process.env.GHOSTY_PARTNER_SECRET;
  if (!secret) throw new Error("falta GHOSTY_PARTNER_SECRET");
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

export type StoredFile = { fileId: string; uri: string; name: string; mimeType: string };

/** Sube un archivo al storage del workspace y devuelve cómo alcanzarlo. */
export async function storeAttachment(a: { name: string; mimeType: string; bytes: string }): Promise<StoredFile | null> {
  const slug = await currentSlug();
  if (!slug) return null;

  const ts = Math.floor(Date.now() / 1000);
  const base = `https://${slug}.${TEAMS_ROOT}`;
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from(a.bytes, "base64")], { type: a.mimeType }),
    a.name || "imagen"
  );

  try {
    const r = await fetch(`${base}/api/upload?ts=${ts}&sig=${sign(`${ts}.upload`)}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const up = (await r.json()) as { fileId?: string };
    if (!up.fileId) return null;
    // URI que el agente puede descargar: la puerta firmada de Teams redirige al objeto.
    const ts2 = Math.floor(Date.now() / 1000);
    const uri = `${base}/api/attachment/${encodeURIComponent(up.fileId)}?ts=${ts2}&sig=${sign(`${ts2}.${up.fileId}`)}`;
    return { fileId: up.fileId, uri, name: a.name, mimeType: a.mimeType };
  } catch {
    return null;
  }
}
