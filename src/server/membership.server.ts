// Autorización: ¿esta persona pertenece al workspace de este subdominio, y con qué
// rol? La verdad vive en ghosty.studio (`Workspace` + `Membership`), NO en la DB del
// tenant.
//
// Por qué no basta con mirar `gc_users`: esa tabla es una proyección de perfil que
// escribe el producto por el que entras. Un miembro legítimo que nunca abrió Teams no
// tiene fila, y autorizarlo contra ella lo dejaría fuera de Tasks sin razón.
//
// Cache con la misma forma que la del namespace (TTL corto + stale-while-error), con
// UNA diferencia deliberada: solo se sirve stale lo que ya fue un SÍ. Una negativa no
// se extiende ante un fallo de gs — y tampoco se convierte en un sí.
import crypto from "node:crypto";
import { currentSlug } from "./tenant.server";

const IDP = process.env.GHOSTY_IDENTITY_URL ?? "https://www.ghosty.studio";
const TTL_MS = 60_000;

export type Membership = { member: boolean; role: string | null };

const cache = new Map<string, { v: Membership; exp: number }>();
const rosterCache = new Map<string, { v: RosterEntry[]; exp: number }>();

function sign(data: string): string {
  return crypto.createHmac("sha256", process.env.GHOSTY_PARTNER_SECRET!).update(data).digest("hex");
}

async function fetchMembership(sub: string, slug: string): Promise<Membership> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = sign(`${ts}.${sub}.${slug}`);
  const q = new URLSearchParams({ sub, slug, ts: String(ts), sig });
  const r = await fetch(`${IDP}/internal/memberships?${q}`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`membership ${r.status}`);
  const b = (await r.json()) as Membership;
  return { member: !!b.member, role: b.role ?? null };
}

/**
 * Membresía del usuario en el workspace del host actual.
 *
 * En el apex (sin slug) no hay workspace que comprobar: devuelve `member:true` para
 * que el selector de workspaces funcione sin tenant. Quien decide ahí es cada
 * subdominio.
 */
export async function membershipOf(sub: string): Promise<Membership> {
  const slug = await currentSlug();
  if (!slug) return { member: true, role: null };
  const key = `${sub}|${slug}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;
  try {
    const v = await fetchMembership(sub, slug);
    cache.set(key, { v, exp: Date.now() + TTL_MS });
    return v;
  } catch (e) {
    // Un hipo de gs no debe echar a quien ya estaba dentro; pero tampoco puede dejar
    // entrar a quien nunca validamos.
    if (hit?.v.member) {
      cache.set(key, { v: hit.v, exp: Date.now() + 30_000 });
      return hit.v;
    }
    throw e;
  }
}

export type RosterEntry = { sub: string; role: string; email: string };

/** El padrón completo del workspace actual (para asignar tareas y pintar Ajustes). */
export async function workspaceRoster(): Promise<RosterEntry[]> {
  const slug = await currentSlug();
  if (!slug) return [];
  const hit = rosterCache.get(slug);
  if (hit && hit.exp > Date.now()) return hit.v;
  const ts = Math.floor(Date.now() / 1000);
  const sig = sign(`${ts}.${slug}`);
  try {
    const r = await fetch(
      `${IDP}/internal/workspace-members/${encodeURIComponent(slug)}?ts=${ts}&sig=${sig}`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!r.ok) throw new Error(`roster ${r.status}`);
    const b = (await r.json()) as { members?: RosterEntry[] };
    const v = (b.members ?? []).map((m) => ({ sub: m.sub, role: m.role, email: m.email ?? "" }));
    rosterCache.set(slug, { v, exp: Date.now() + TTL_MS });
    return v;
  } catch (e) {
    if (hit) {
      rosterCache.set(slug, { v: hit.v, exp: Date.now() + 30_000 });
      return hit.v;
    }
    throw e;
  }
}

/** Lista de workspaces de los que este `sub` es miembro (selector del apex). */
export async function myWorkspaces(sub: string): Promise<Array<{ slug: string; role: string }>> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = sign(`${ts}.${sub}`);
  const q = new URLSearchParams({ sub, ts: String(ts), sig });
  const r = await fetch(`${IDP}/internal/user-workspaces?${q}`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`workspaces ${r.status}`);
  const b = (await r.json()) as { workspaces?: Array<{ slug: string; role: string }> };
  return b.workspaces ?? [];
}
