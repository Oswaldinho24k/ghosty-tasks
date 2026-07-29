// Multitenancy: resuelve el NAMESPACE de sqld que sirve este request a partir del
// subdominio (acme.tasks.ghosty.studio → workspace "acme" → namespace). Es el MISMO
// namespace que sirve a ese workspace en Ghosty Teams: un workspace = una DB, así que
// una tarea y un hilo viven juntos y ligarlos es un JOIN.
//
// El registro slug→namespace vive en el control-plane (ghosty.studio); lo
// consultamos firmado (GHOSTY_PARTNER_SECRET) y lo cacheamos por slug con TTL corto.
// Calcado de ghosty-chat/src/server/tenant.server.ts — mismo contrato, misma cache.
import crypto from "node:crypto";

const IDP = process.env.GHOSTY_IDENTITY_URL ?? "https://www.ghosty.studio";
const ROOT = process.env.TASKS_ROOT_DOMAIN ?? "tasks.ghosty.studio";

// Fallback single-tenant: namespace fijo por env. Es lo que mantiene vivo el tablero
// suelto del apex mientras se migra; en el corte final se quita del .env.
function envNamespace(): string | null {
  return process.env.SQLD_NAMESPACE || null;
}

const cache = new Map<string, { ns: string; exp: number }>();
const TTL_MS = 60_000;

// "acme" de acme.tasks.ghosty.studio. Apex (tasks / www) → null: sin tenant, es el
// selector de workspaces.
export function slugFromHost(host: string): string | null {
  const h = (host || "").split(":")[0].toLowerCase();
  if (!h || h === ROOT || h === `www.${ROOT}`) return null;
  if (h.endsWith(`.${ROOT}`)) return h.slice(0, -(ROOT.length + 1)).split(".")[0] || null;
  return null;
}

async function currentHost(): Promise<string> {
  try {
    const { getRequestHeader, getRequestHost } = await import("@tanstack/react-start/server");
    const o = getRequestHeader("x-ghosty-origin");
    if (o) {
      try {
        return new URL(o).host;
      } catch {
        /* origin malformado → sigue a los otros headers */
      }
    }
    return getRequestHeader("x-forwarded-host") || getRequestHost() || "";
  } catch {
    return "";
  }
}

async function resolveNamespace(slug: string): Promise<string> {
  const hit = cache.get(slug);
  if (hit && hit.exp > Date.now()) return hit.ns;
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac("sha256", process.env.GHOSTY_PARTNER_SECRET!)
    .update(`${ts}.${slug}`)
    .digest("hex");
  // Camino CRÍTICO: cada server-fn resuelve el namespace antes de tocar la DB. Sin
  // timeout, un gs lento cuelga TODO request. 1) timeout duro. 2) si hay un valor
  // cacheado —aunque expirado— se sirve stale ante error: un hipo de gs no debe tirar
  // la app entera.
  try {
    const r = await fetch(`${IDP}/internal/workspaces/${encodeURIComponent(slug)}?ts=${ts}&sig=${sig}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) throw new Error(`resolver ${r.status}`);
    const b = (await r.json()) as { namespace?: string };
    if (!b.namespace) throw new Error("resolver sin namespace");
    cache.set(slug, { ns: b.namespace, exp: Date.now() + TTL_MS });
    return b.namespace;
  } catch (e) {
    if (hit) {
      cache.set(slug, { ns: hit.ns, exp: Date.now() + 30_000 });
      return hit.ns;
    }
    throw e;
  }
}

export async function currentSlug(): Promise<string | null> {
  return slugFromHost(await currentHost());
}

export async function currentNamespace(): Promise<string> {
  const slug = await currentSlug();
  if (!slug) {
    const ns = envNamespace();
    if (!ns) throw new Error("sin tenant: host sin subdominio de workspace y sin SQLD_NAMESPACE");
    return ns;
  }
  return resolveNamespace(slug);
}

export function invalidateTenant(slug: string): void {
  cache.delete(slug);
}
